/**
 * GPU-accelerated ffmpeg render service for Galaxy CRM's Content Studio.
 *
 * Why this exists: Content Studio's video editor runs ffmpeg entirely in
 * the browser via ffmpeg.wasm (WebAssembly, CPU-only) — every trim, caption,
 * crop, zoom, color grade, etc. re-encodes through it. That's slow, and it's
 * also part of why exported video quality was lower than the source (see
 * the app's own autoEdit.ts comments) — no explicit encoder quality was
 * ever set, so ffmpeg fell back to defaults every single pass.
 *
 * This service is a drop-in remote backend for that exact same workload.
 * It deliberately mirrors ffmpeg.wasm's own API shape (write a file, run
 * ffmpeg with an args array, read a file back) rather than inventing a new
 * one — the browser-side "adapter" (src/lib/content-studio/remoteFFmpeg.ts
 * in the main app) implements the same interface the real ffmpeg.wasm
 * object has, so none of the 30+ existing editing functions needed to be
 * rewritten to benefit from this.
 *
 * Design:
 *   POST   /session                        -> { sessionId }
 *   PUT    /session/:id/files/:name         -> streams a file's raw bytes into that session's temp dir
 *   POST   /session/:id/exec                -> { args: string[] } runs ffmpeg with cwd = that session's dir
 *   GET    /session/:id/files/:name         -> streams a file's bytes back
 *   DELETE /session/:id/files/:name         -> deletes one file
 *   DELETE /session/:id                     -> deletes the whole session dir
 *
 * Every route requires a matching `x-api-key` header — this process is
 * reachable from the public internet (via Tailscale Funnel), so it is NOT
 * left open to anyone who finds the URL.
 *
 * GPU encoding: when the args sent to /exec don't already specify a video
 * codec (the overwhelming majority of calls in autoEdit.ts — they only ever
 * set `-c:v copy` for the audio-only filters that should skip re-encoding
 * entirely), this appends `-c:v h264_nvenc` with quality settings tuned for
 * "as close to source quality as practical" rather than ffmpeg's software
 * defaults, right before the output filename (the last argument, by the
 * calling code's own consistent convention). Args that already name a
 * codec are left completely alone — the caller already decided.
 */
const express = require('express')
const { spawn } = require('child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const PORT = Number(process.env.PORT || 8787)
const API_KEY = process.env.RENDER_API_KEY
if (!API_KEY) {
  console.error('RENDER_API_KEY is not set. Refusing to start with no authentication configured.')
  process.exit(1)
}

const BASE_DIR = path.join(os.tmpdir(), 'galaxy-render-sessions')
const SESSION_IDLE_MS = 15 * 60 * 1000 // sweep sessions untouched for 15 minutes
const MAX_CONCURRENT_RENDERS = Number(process.env.RENDER_MAX_CONCURRENCY || 2)

fs.mkdirSync(BASE_DIR, { recursive: true })

// ---------- tiny concurrency-limiting queue ----------
// A consumer GPU can only run a handful of concurrent NVENC sessions, and
// the whole point is this machine's actual usage (1-2 people editing at
// once) — a real queue matters more than a smart scheduler here.
let active = 0
const waiting = []
function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++
      fn().then(
        (v) => { active--; drain(); resolve(v) },
        (e) => { active--; drain(); reject(e) },
      )
    }
    if (active < MAX_CONCURRENT_RENDERS) run()
    else waiting.push(run)
  })
}
function drain() {
  while (active < MAX_CONCURRENT_RENDERS && waiting.length) waiting.shift()()
}

// ---------- session bookkeeping ----------
const lastTouched = new Map() // sessionId -> timestamp, for the idle sweep

function sessionDir(id) {
  return path.join(BASE_DIR, id)
}

function touch(id) {
  lastTouched.set(id, Date.now())
}

/** Rejects any session id that isn't exactly what we generated ourselves,
 *  and any filename containing a path separator or "..". The video file's
 *  own name never reaches ffmpeg as anything other than one of these —
 *  this is what stands between an uploaded filename and a path-traversal
 *  write outside BASE_DIR. */
function safeSegment(s) {
  return typeof s === 'string' && /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..'
}

setInterval(() => {
  const now = Date.now()
  for (const [id, t] of lastTouched) {
    if (now - t > SESSION_IDLE_MS) {
      lastTouched.delete(id)
      fsp.rm(sessionDir(id), { recursive: true, force: true }).catch(() => {})
    }
  }
}, 60 * 1000).unref()

// ---------- app ----------
const app = express()
app.disable('x-powered-by')

app.use((req, res, next) => {
  if (req.get('x-api-key') !== API_KEY) {
    res.status(401).json({ error: 'Missing or invalid x-api-key.' })
    return
  }
  next()
})

app.post('/session', async (req, res) => {
  const id = crypto.randomUUID()
  await fsp.mkdir(sessionDir(id), { recursive: true })
  touch(id)
  res.json({ sessionId: id })
})

app.put('/session/:id/files/:name', (req, res) => {
  const { id, name } = req.params
  if (!safeSegment(id) || !safeSegment(name) || !fs.existsSync(sessionDir(id))) {
    res.status(404).json({ error: 'Unknown session.' })
    return
  }
  touch(id)
  const dest = path.join(sessionDir(id), name)
  const out = fs.createWriteStream(dest)
  req.pipe(out)
  out.on('finish', () => res.status(204).end())
  out.on('error', (err) => res.status(500).json({ error: String(err) }))
  req.on('error', (err) => { out.destroy(); res.status(500).json({ error: String(err) }) })
})

app.get('/session/:id/files/:name', (req, res) => {
  const { id, name } = req.params
  if (!safeSegment(id) || !safeSegment(name)) { res.status(404).end(); return }
  touch(id)
  const p = path.join(sessionDir(id), name)
  if (!fs.existsSync(p)) { res.status(404).json({ error: 'File not found.' }); return }
  res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(500).json({ error: String(err) }) })
})

app.delete('/session/:id/files/:name', async (req, res) => {
  const { id, name } = req.params
  if (!safeSegment(id) || !safeSegment(name)) { res.status(404).end(); return }
  touch(id)
  await fsp.rm(path.join(sessionDir(id), name), { force: true })
  res.status(204).end()
})

app.delete('/session/:id', async (req, res) => {
  const { id } = req.params
  if (!safeSegment(id)) { res.status(404).end(); return }
  lastTouched.delete(id)
  await fsp.rm(sessionDir(id), { recursive: true, force: true })
  res.status(204).end()
})

// The one route that reads a JSON body — everything above streams raw
// bytes, so express.json() is scoped to just this route rather than
// applied globally (which would otherwise try to parse file uploads).
app.post('/session/:id/exec', express.json({ limit: '2mb' }), async (req, res) => {
  const { id } = req.params
  const dir = sessionDir(id)
  if (!safeSegment(id) || !fs.existsSync(dir)) {
    res.status(404).json({ error: 'Unknown session.' })
    return
  }
  const args = req.body && Array.isArray(req.body.args) ? req.body.args.map(String) : null
  if (!args || !args.length) {
    res.status(400).json({ error: 'Missing args array.' })
    return
  }
  touch(id)

  const finalArgs = injectGpuEncodeIfNeeded(args)

  try {
    const { stdout, stderr } = await withSlot(() => runFfmpeg(finalArgs, dir))
    res.json({ ok: true, stdout, stderr })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

/**
 * If the caller didn't specify a video codec, ffmpeg would otherwise fall
 * back to software libx264 with un-tuned defaults — exactly the quality
 * problem this whole project started from. Insert GPU encoding with an
 * explicit, source-quality-preserving setting instead, positioned right
 * before the output filename (every caller in autoEdit.ts pushes the
 * output filename as its literal last argument — this is a real, checked
 * convention there, not a guess).
 *
 * `-rc vbr -cq 18 -b:v 0`: constant-quality VBR mode, uncapped bitrate —
 * NVENC's equivalent of libx264's -crf, rather than a fixed bitrate target
 * that would either waste space on simple scenes or starve complex ones.
 * CQ 18 is a visually-lossless-range setting (lower = higher quality).
 */
function injectGpuEncodeIfNeeded(args) {
  if (args.includes('-c:v')) return args // caller already decided (e.g. `-c:v copy`)
  const gpuFlags = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-pix_fmt', 'yuv420p']
  const out = args.slice()
  out.splice(out.length - 1, 0, ...gpuFlags)
  return out
}

function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args], { cwd })
    let stderr = ''
    let stdout = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr: stderr.slice(-4000) })
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

app.get('/health', (req, res) => res.json({ ok: true, activeRenders: active, queued: waiting.length }))

app.listen(PORT, () => {
  console.log(`Galaxy render server listening on port ${PORT} (max concurrent renders: ${MAX_CONCURRENT_RENDERS})`)
})
