/**
 * Video auto-edit: cuts out silence/dead air, plus every other editing
 * operation in Content Studio (trim, captions, crop, zoom, color, etc.).
 *
 * This is what "AI auto-edit" means here, and it's worth being precise about
 * that: it is a heuristic (find quiet stretches, remove them), not a model
 * that understands footage. Nothing here attempts to replicate a *reference*
 * video's editing style — that would need a model watching the reference and
 * inferring pacing/cut rhythm from it, which no ffmpeg filter does and no
 * free tool does either. A reference link is stored elsewhere purely as a
 * note for a human editor.
 *
 * Rendering itself runs one of two ways, chosen automatically by
 * loadFFmpeg() below: by default, ffmpeg runs as WebAssembly in the
 * visitor's own browser via @ffmpeg/ffmpeg (CPU-only, works everywhere, no
 * server). If a GPU render server is configured (VITE_RENDER_SERVER_URL/
 * VITE_RENDER_API_KEY — see remoteFFmpeg.ts) AND reachable — which in
 * practice means the visitor's own machine is on the same private Tailscale
 * network the render server lives on — rendering is transparently routed
 * there instead, using NVIDIA hardware encoding. Every function below calls
 * the same writeFile/exec/readFile methods either way; they have no idea
 * which backend they're talking to.
 */
import type { SelfieSegmentation as SelfieSegmentationType, Results as SelfieSegmentationResults } from '@mediapipe/selfie_segmentation'
import { renderCaptionImage, renderMaskImage } from './captionOverlay'
import { type FFmpegLike, RemoteFFmpeg, remoteFFmpegConfig, isRemoteFFmpegReachable } from './remoteFFmpeg'

export class AutoEditError extends Error {}

/**
 * Explicit encoder settings for every in-browser render that produces new
 * video frames (as opposed to a `-c:v copy` stream copy, which needs none).
 * Not used on the remote GPU render-server path (remoteFFmpeg.ts), which
 * has its own hardware (NVENC) encode settings.
 *
 * CRF 18 rather than x264's default 23: an edit here is rarely a single
 * encode. Even with the batching below, a realistic session still stacks a
 * few generations (trim bake -> batched effects -> final caption/music
 * render), and each one re-quantizes the previous one's output. CRF is the
 * knob that governs how much detail each of those generations throws away,
 * so it's worth spending bitrate on — 18 is near the visually-transparent
 * threshold, where the loss per generation stops accumulating into visible
 * banding and smeared motion.
 *
 * `slow` and CRF 16 are a deliberate quality-over-speed choice for this
 * editor: renders are allowed to take as long as they take. Preset mostly
 * trades encode time for file size at a fixed CRF, so `slow` mainly buys
 * back the bitrate that CRF 16 spends; CRF 16 is the part that actually
 * preserves detail, and it leaves headroom for the re-encode every social
 * platform runs on upload.
 *
 * `-pix_fmt yuv420p` is a no-op for the effect chains that already end in
 * an explicit `format=yuv420p`, but it matters for the plain single-filter
 * ones: a yuv422/444 source would otherwise stay high-profile through the
 * encode and produce a file some browsers refuse to decode.
 *
 * `-movflags +faststart` moves the moov atom (duration/seek index) to the
 * FRONT of the file instead of ffmpeg's default of writing it at the end.
 * That default is fine for a file served over HTTP, where the browser can
 * range-request the tail to read it — but every render here is played back
 * as a Blob URL, which the browser reads front-to-back with no seeking.
 * Without this flag, `<video>` (and probeBlobDuration's own loadedmetadata
 * probe) can't find the duration at all and reports it as Infinity, which
 * every duration display here (fmtTime) then renders as "0:00" — a video
 * that plays fine but LOOKS totally broken, worse after every additional
 * hard-baked effect since each one re-encodes without the atom moved back.
 */
const VIDEO_ENCODE_ARGS = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']

export interface SilenceOptions {
  /** dB below which audio counts as silent. Louder rooms need this less negative. */
  thresholdDb?: number
  /** Minimum length (seconds) of quiet before it's worth cutting. */
  minSilenceSec?: number
  /** Kept on either side of a cut so words aren't clipped mid-syllable. */
  paddingSec?: number
  /** Hard cap on how many segments get stitched — a very noisy track could
   *  otherwise produce hundreds of tiny cuts and an enormous ffmpeg command. */
  maxSegments?: number
}

const DEFAULTS: Required<SilenceOptions> = {
  thresholdDb: -30,
  minSilenceSec: 0.5,
  paddingSec: 0.15,
  maxSegments: 40,
}

export interface Segment {
  start: number
  end: number
}

/**
 * Parses ffmpeg's `silencedetect` stderr lines into silence [start, end] pairs.
 *
 * Exported and pure so the parsing logic (the part actually worth getting
 * wrong) is testable without a real ffmpeg binary in the test environment.
 */
export function parseSilenceLog(log: string): Segment[] {
  const starts: number[] = []
  const segments: Segment[] = []
  const startRe = /silence_start:\s*(-?[\d.]+)/g
  const endRe = /silence_end:\s*(-?[\d.]+)/g

  let m: RegExpExecArray | null
  while ((m = startRe.exec(log))) starts.push(parseFloat(m[1]))

  let i = 0
  while ((m = endRe.exec(log))) {
    const end = parseFloat(m[1])
    const start = starts[i++]
    if (start !== undefined && end > start) segments.push({ start, end })
  }
  return segments
}

/**
 * Silence segments → the "keep" segments to stitch together, i.e. everything
 * that ISN'T silence, with padding added back and a cap on segment count.
 *
 * duration must be the real clip length — otherwise the final keep-segment
 * (from the last silence to the end of the video) has nowhere to stop.
 */
export function computeKeepSegments(
  silences: Segment[],
  duration: number,
  opts: SilenceOptions = {},
): Segment[] {
  const { minSilenceSec, paddingSec, maxSegments } = { ...DEFAULTS, ...opts }

  const real = silences.filter((s) => s.end - s.start >= minSilenceSec)

  const keep: Segment[] = []
  let cursor = 0
  for (const s of real) {
    const end = Math.min(duration, s.start + paddingSec)
    if (end > cursor) keep.push({ start: cursor, end })
    cursor = Math.max(cursor, s.end - paddingSec)
  }
  if (duration > cursor) keep.push({ start: cursor, end: duration })

  // Merge segments too close together to be worth a separate cut — every cut
  // has a re-encode cost, and a 0.2s gap isn't a pause worth preserving.
  const merged: Segment[] = []
  for (const seg of keep) {
    const last = merged[merged.length - 1]
    if (last && seg.start - last.end < paddingSec * 2) last.end = seg.end
    else merged.push({ ...seg })
  }

  if (merged.length <= maxSegments) return merged

  // Over budget: keep the longest segments (the substantive footage) and drop
  // the shortest, rather than truncating the video early.
  return [...merged]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, maxSegments)
    .sort((a, b) => a.start - b.start)
}

let ffmpegSingleton: FFmpegLike | null = null
/** Set once loadFFmpeg() resolves, so resetFFmpeg() knows whether to close
 *  a remote render session or just drop the wasm instance. */
let usingRemote = false
/** Cached for the page session so every render after the first doesn't
 *  re-pay the reachability check — if the GPU server was reachable once,
 *  it's assumed to still be for the rest of this session. resetFFmpeg()
 *  (an actual failure) clears this too, so a genuinely dropped connection
 *  gets re-checked rather than permanently assumed reachable. */
let remoteReachableCache: boolean | null = null

/**
 * A crashed ffmpeg.wasm core (out-of-memory on a large clip, a fatal decode
 * error) can leave the WASM heap in a state where every LATER operation on
 * the same singleton fails too, with an opaque "ErrnoError: FS error" that
 * has nothing to do with what actually broke. Dropping the singleton after
 * any unexpected failure means the next attempt gets a clean instance
 * instead of being stuck failing until the page is reloaded. Same idea for
 * a remote session: if a render server call fails, don't keep reusing a
 * session it may have already dropped.
 */
function resetFFmpeg() {
  if (usingRemote && ffmpegSingleton instanceof RemoteFFmpeg) {
    ffmpegSingleton.closeSession().catch(() => {})
  }
  ffmpegSingleton = null
  usingRemote = false
  remoteReachableCache = null
  fontLoaded = false // the font lived in that instance's virtual FS, gone with it
}

/** Loaded once per page session — the wasm core is ~25MB (or, for a remote
 *  render server, the reachability check is the one-time cost) — not worth
 *  repeating per job either way. */
async function loadFFmpeg(onLog?: (line: string) => void): Promise<FFmpegLike> {
  if (ffmpegSingleton) return ffmpegSingleton

  const remoteConfig = remoteFFmpegConfig()
  if (remoteConfig) {
    if (remoteReachableCache === null) remoteReachableCache = await isRemoteFFmpegReachable(remoteConfig)
    if (remoteReachableCache) {
      const remote = new RemoteFFmpeg(remoteConfig)
      if (onLog) remote.on('log', ({ message }) => onLog(message))
      ffmpegSingleton = remote
      usingRemote = true
      return remote
    }
    // Configured but not reachable (e.g. this visitor isn't on the
    // Tailscale network the render server lives on) — fall through to the
    // normal in-browser path below rather than failing the render outright.
  }

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ])
  const ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message))

  // Deliberately always the single-threaded core, not @ffmpeg/core-mt.
  // The multi-threaded core needs a Worker loaded from a blob: URL (via
  // toBlobURL) inside a cross-origin-isolated page (COOP/COEP) — that
  // combination is exactly what caused "Loading the video engine" to hang
  // forever on this route (confirmed 2026-08-22: the -mt worker's own
  // internal resource resolution from a blob: URL context doesn't reliably
  // complete, with no error surfaced — ffmpeg.load() just never resolves).
  // The COOP header this required is also independently risky: it's the
  // exact route that previously ran the Google Drive OAuth popup, and
  // COOP:same-origin is documented to break window.open()-based auth
  // popups. A slower render that reliably finishes beats a faster one that
  // sometimes never starts.
  const pkg = '@ffmpeg/core'
  // jsdelivr, not unpkg: same package, but jsdelivr fronts npm packages with
  // its own global CDN/cache layer built for exactly this (large static
  // package assets), where unpkg has a well-known history of being slow or
  // rate-limited under load. This ~25MB core is downloaded fresh every
  // session (nothing persists it across page reloads), so the CDN's raw
  // throughput IS the "Loading the video engine" wait time.
  const base = `https://cdn.jsdelivr.net/npm/${pkg}@0.12.6/dist/esm`
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegSingleton = ffmpeg
  usingRemote = false
  return ffmpeg
}

let fontLoaded = false

/**
 * ffmpeg.wasm's core has no system fonts — unlike a desktop ffmpeg install,
 * there is no fontconfig to fall back on, so drawtext either errors out or
 * silently draws nothing until it's told exactly which font file to use.
 * This fetches one real font into the virtual filesystem once per ffmpeg
 * instance and every caller of drawtext passes its path via fontfile=.
 */
async function ensureFont(ffmpeg: FFmpegLike): Promise<string> {
  const fontFile = 'caption-font.ttf'
  if (fontLoaded) return fontFile
  const res = await fetch('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf')
  if (!res.ok) throw new AutoEditError('Could not load a font for captions/text overlays.')
  await ffmpeg.writeFile(fontFile, new Uint8Array(await res.arrayBuffer()))
  fontLoaded = true
  return fontFile
}

async function probeDuration(ffmpeg: FFmpegLike, inputName: string): Promise<number> {
  let log = ''
  const collect = ({ message }: { message: string }) => (log += message + '\n')
  ffmpeg.on('log', collect)
  try {
    await ffmpeg.exec(['-i', inputName])
  } catch {
    // ffmpeg exits non-zero for "-i" with no output — expected, we only want stderr.
  } finally {
    ffmpeg.off('log', collect)
  }
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(log)
  if (!m) throw new AutoEditError('Could not read the video — it may be corrupt or an unsupported format.')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export interface AutoEditProgress {
  phase: 'loading' | 'analyzing' | 'rendering'
  fraction?: number
}

export interface FootageAnalysis {
  durationSec: number
  silences: Segment[]
  width: number
  height: number
  /** Extracted audio track, mono/16kHz/64kbps — small enough to send for transcription. */
  audioBlob: Blob
}

/**
 * Reads the raw footage without editing it: real duration, real dead-air
 * stretches (same silencedetect pass the auto-edit itself uses), real frame
 * size, and an extracted, compressed audio track for the caller to send off
 * for transcription. Nothing here is guessed — every field comes from ffmpeg
 * actually looking at the file.
 */
export async function analyzeFootage(
  file: Blob,
  opts: SilenceOptions = {},
  onProgress?: (p: AutoEditProgress) => void,
): Promise<FootageAnalysis> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()

  const { thresholdDb, minSilenceSec } = { ...DEFAULTS, ...opts }
  const inputName = 'analyze-input.mp4'
  const audioName = 'analyze-audio.mp3'
  const buf = new Uint8Array(await file.arrayBuffer())
  await ffmpeg.writeFile(inputName, buf)

  try {
    onProgress?.({ phase: 'analyzing' })

    let infoLog = ''
    const collectInfo = ({ message }: { message: string }) => (infoLog += message + '\n')
    ffmpeg.on('log', collectInfo)
    try {
      await ffmpeg.exec(['-i', inputName])
    } catch {
      // Same as probeDuration: ffmpeg exits non-zero for a plain "-i", expected.
    } finally {
      ffmpeg.off('log', collectInfo)
    }

    const durMatch = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(infoLog)
    if (!durMatch) throw new AutoEditError('Could not read the video — it may be corrupt or an unsupported format.')
    const durationSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])

    const dimMatch = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(infoLog)
    const width = dimMatch ? Number(dimMatch[1]) : 0
    const height = dimMatch ? Number(dimMatch[2]) : 0

    let silenceLog = ''
    const collectSilence = ({ message }: { message: string }) => (silenceLog += message + '\n')
    ffmpeg.on('log', collectSilence)
    try {
      await ffmpeg.exec([
        '-i', inputName,
        '-af', `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
        '-f', 'null', '-',
      ])
    } finally {
      ffmpeg.off('log', collectSilence)
    }
    const silences = parseSilenceLog(silenceLog)

    onProgress?.({ phase: 'rendering' })
    let audioBlob: Blob
    try {
      await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioName])
      const audioData = await ffmpeg.readFile(audioName)
      audioBlob = new Blob([new Uint8Array(audioData as Uint8Array).buffer], { type: 'audio/mpeg' })
    } catch (err) {
      // The video itself read fine (duration/dimensions above succeeded) — a
      // failure here almost always means no audio track, not a broken video.
      throw new AutoEditError(
        'Could not read an audio track from this footage — it may have no audio, or the clip may be too large for the browser to process. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
      )
    }

    return { durationSec, silences, width, height, audioBlob }
  } catch (err) {
    if (!(err instanceof AutoEditError)) resetFFmpeg()
    throw err
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(audioName).catch(() => {})
  }
}

async function probeDimensions(ffmpeg: FFmpegLike, inputName: string): Promise<{ width: number; height: number }> {
  let log = ''
  const collect = ({ message }: { message: string }) => (log += message + '\n')
  ffmpeg.on('log', collect)
  try {
    await ffmpeg.exec(['-i', inputName])
  } catch {
    // Expected — same as probeDuration.
  } finally {
    ffmpeg.off('log', collect)
  }
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(log)
  return { width: m ? Number(m[1]) : 1080, height: m ? Number(m[2]) : 1920 }
}

async function probeFps(ffmpeg: FFmpegLike, inputName: string): Promise<number> {
  let log = ''
  const collect = ({ message }: { message: string }) => (log += message + '\n')
  ffmpeg.on('log', collect)
  try {
    await ffmpeg.exec(['-i', inputName])
  } catch {
    // Expected — same as probeDuration.
  } finally {
    ffmpeg.off('log', collect)
  }
  const m = /(\d+(?:\.\d+)?)\s*fps/.exec(log)
  return m ? Number(m[1]) : 30
}

export interface ClipInput {
  blob: Blob
  /** Seconds to cut from the start of this clip before joining. */
  trimStart?: number
  /** Absolute time (seconds from this clip's own start) to cut everything after. */
  trimEnd?: number
}

/**
 * Joins several clips, in the order given, into one video — for someone who
 * shot a piece across multiple takes or angles rather than one continuous
 * recording. Every clip is scaled and padded (never stretched) to the first
 * clip's frame size and put on a common frame rate/sample rate before
 * concatenating, because two phone clips are rarely shot at identical
 * settings and ffmpeg's concat filter requires matching streams to join them.
 * Each clip can also be trimmed (start/end) before it's joined in.
 */
export async function joinClips(
  clips: ClipInput[],
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  if (clips.length === 0) throw new AutoEditError('No clips to join.')
  if (clips.length === 1 && !clips[0].trimStart && !clips[0].trimEnd) return clips[0].blob

  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputNames = clips.map((_, i) => `join-input-${i}.mp4`)
  const outputName = 'joined.mp4'
  for (let i = 0; i < clips.length; i++) {
    await ffmpeg.writeFile(inputNames[i], new Uint8Array(await clips[i].blob.arrayBuffer()))
  }

  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputNames[0])

    const filters = inputNames
      .map((name, i) => {
        const { trimStart, trimEnd } = clips[i]
        const trimArgs = [trimStart ? `start=${trimStart}` : '', trimEnd ? `end=${trimEnd}` : ''].filter(Boolean).join(':')
        const vTrim = trimArgs ? `trim=${trimArgs},setpts=PTS-STARTPTS,` : ''
        const aTrim = trimArgs ? `atrim=${trimArgs},asetpts=PTS-STARTPTS,` : ''
        return `[${i}:v]${vTrim}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];` +
          `[${i}:a]${aTrim}aresample=44100,aformat=channel_layouts=stereo[a${i}]`
      })
      .join(';')
    const refs = inputNames.map((_, i) => `[v${i}][a${i}]`).join('')
    const filterComplex = `${filters};${refs}concat=n=${inputNames.length}:v=1:a=1[outv][outa]`

    const args: string[] = []
    for (const name of inputNames) args.push('-i', name)
    args.push('-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', ...VIDEO_ENCODE_ARGS, outputName)

    await ffmpeg.exec(args)
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    resetFFmpeg()
    throw new AutoEditError(
      `Could not join those clips — they may use incompatible formats. (${err instanceof Error ? err.message : String(err)})`,
    )
  } finally {
    for (const name of inputNames) await ffmpeg.deleteFile(name).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * xfade transition names this app exposes, mapped 1:1 onto ffmpeg's own
 * xfade filter (verified present in the deployed @ffmpeg/core@0.12.6 build
 * via a live `-filters` probe before this was written — not assumed).
 * 'none' is our own value (not an xfade transition) meaning a hard cut.
 */
export type TransitionType =
  | 'none' | 'fade' | 'dissolve'
  | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown'
  | 'slideleft' | 'slideright' | 'slideup' | 'slidedown'
  | 'circleopen' | 'circleclose' | 'radial'

export const TRANSITION_TYPES: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'Hard cut (no transition)' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'circleopen', label: 'Circle open (iris)' },
  { value: 'circleclose', label: 'Circle close (iris)' },
  { value: 'radial', label: 'Radial' },
  { value: 'wipeleft', label: 'Wipe left' },
  { value: 'wiperight', label: 'Wipe right' },
  { value: 'wipeup', label: 'Wipe up' },
  { value: 'wipedown', label: 'Wipe down' },
  { value: 'slideleft', label: 'Slide left' },
  { value: 'slideright', label: 'Slide right' },
  { value: 'slideup', label: 'Slide up' },
  { value: 'slidedown', label: 'Slide down' },
]

export interface InsertClipOptions {
  /** Seconds into the CURRENT video where clip 2 takes over. Everything in
   *  the current video after this point is replaced by clip 2, not kept —
   *  inserting clip 2 in the middle and then resuming clip 1's original tail
   *  afterward is a distinct, larger feature this does not attempt. */
  insertAt: number
  newClip: Blob
  transition: TransitionType
  /** Seconds the transition itself takes. Clamped to insertAt (can't crossfade
   *  longer than the lead-in that exists to fade from) and to 3s (a longer
   *  crossfade reads as a mistake, not a stylistic choice, in a short-form clip). */
  duration: number
}

/**
 * Pure filter_complex builder for applyInsertClip, split out so the actual
 * string construction (transition name mapping, offset math, the 'none'
 * hard-cut path) is unit-testable without a real ffmpeg runtime — ffmpeg.wasm
 * itself can't run inside Vitest.
 */
export function buildInsertClipFilter(
  width: number,
  height: number,
  insertAt: number,
  duration: number,
  transition: TransitionType,
): { filterComplex: string; clampedDuration: number } {
  const normalize = (idx: number, label: string) =>
    `[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[${label}];` +
    `[${idx}:a]aresample=44100,aformat=channel_layouts=stereo[a${label.slice(1)}]`

  const dur = Math.max(0.1, Math.min(duration, insertAt, 3))
  const before =
    `[0:v]trim=end=${insertAt},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0];` +
    `[0:a]atrim=end=${insertAt},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a0]`
  const after = normalize(1, 'v1')

  if (transition === 'none') {
    return { filterComplex: `${before};${after};[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`, clampedDuration: dur }
  }
  const offset = Math.max(0, insertAt - dur)
  const filterComplex =
    `${before};${after};` +
    `[v0][v1]xfade=transition=${transition}:duration=${dur}:offset=${offset}[outv];` +
    `[a0][a1]acrossfade=d=${dur}[outa]`
  return { filterComplex, clampedDuration: dur }
}

/**
 * Cuts the current video at `insertAt` and continues into a second clip from
 * there, either as a hard cut or through one of ffmpeg's native xfade
 * transitions (including the circle/iris wipe) — the only way to combine two
 * separate video sources this app has, since every other AI Edit effect
 * transforms one existing source in place. Both clips are normalized to the
 * FIRST clip's resolution/framerate before compositing, same reasoning and
 * same filter chain as `joinClips` above (xfade requires matching streams).
 */
export async function applyInsertClip(
  file: Blob,
  { insertAt, newClip, transition, duration }: InsertClipOptions,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'insert-base.mp4'
  const newName = 'insert-new.mp4'
  const outputName = 'insert-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  await ffmpeg.writeFile(newName, new Uint8Array(await newClip.arrayBuffer()))

  try {
    if (insertAt <= 0) throw new AutoEditError('The insertion point has to be after the start of the video.')

    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const { filterComplex } = buildInsertClipFilter(width, height, insertAt, duration, transition)

    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-i', newName,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '[outa]',
      ...VIDEO_ENCODE_ARGS,
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not insert that clip. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(newName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * Runs the full silence-removal auto-edit and returns the edited video as a
 * Blob. Everything happens client-side; nothing here uploads anything.
 */
export async function autoEditRemoveSilence(
  file: Blob,
  opts: SilenceOptions = {},
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const { thresholdDb, minSilenceSec } = { ...DEFAULTS, ...opts }
  const inputName = 'input.mp4'
  const outputName = 'output.mp4'

  const buf = new Uint8Array(await file.arrayBuffer())
  await ffmpeg.writeFile(inputName, buf)

  try {
    onProgress?.({ phase: 'analyzing' })
    const duration = await probeDuration(ffmpeg, inputName)

    let silenceLog = ''
    const collectSilence = ({ message }: { message: string }) => (silenceLog += message + '\n')
    ffmpeg.on('log', collectSilence)
    try {
      await ffmpeg.exec([
        '-i', inputName,
        '-af', `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
        '-f', 'null', '-',
      ])
    } finally {
      ffmpeg.off('log', collectSilence)
    }

    const silences = parseSilenceLog(silenceLog)
    const keep = computeKeepSegments(silences, duration, opts)

    if (keep.length === 0) {
      throw new AutoEditError('The whole clip looked silent — try a quieter threshold, or check the audio track.')
    }
    if (keep.length === 1 && keep[0].start === 0 && keep[0].end >= duration - 0.05) {
      // Nothing worth cutting — hand back the original rather than a lossy
      // re-encode that changes nothing but wastes the render time.
      return file
    }

    // One trim+concat filter_complex, built for however many segments survived.
    const filters = keep
      .map((s, i) => `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`)
      .join(';')
    const refs = keep.map((_, i) => `[v${i}][a${i}]`).join('')
    const filterComplex = `${filters};${refs}concat=n=${keep.length}:v=1:a=1[outv][outa]`

    await ffmpeg.exec([
      '-i', inputName,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '[outa]',
      ...VIDEO_ENCODE_ARGS,
      outputName,
    ])

    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (!(err instanceof AutoEditError)) resetFFmpeg()
    throw err
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export type CaptionPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'
export type CaptionSize = 'sm' | 'md' | 'lg'

export interface TimedCaption {
  text: string
  /** Seconds within the (already trimmed) video. Both 0/undefined = shown for the whole video. */
  start?: number
  end?: number
  position?: CaptionPosition
  size?: CaptionSize
  /** 'text' = the free-standing Text tool, 'caption' (default) = the Captions tool — same storage/render path, just two labels in the editor UI. */
  kind?: 'text' | 'caption'
  /** Passed straight through to renderCaptionImage — see captionOverlay.ts
   *  for defaults when omitted (white text, no outline, unbolded). */
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  outlineColor?: string
  outlineWidth?: number
  /** A standing neon glow — baked into the PNG itself by renderCaptionImage,
   *  not an export-time filter, since it doesn't change over time. */
  glow?: boolean
  /** A standing offset+blurred drop shadow, also baked into the PNG — same
   *  reasoning as glow, but an offset shadow instead of a centered halo. */
  dropShadow?: boolean
  /** Paired with `color` (the gradient's start) for a left-to-right linear
   *  gradient text fill, baked into the PNG. Omitted = solid `color` fill. */
  gradientTo?: string
  /** Extra spacing between characters in pixels, baked into the PNG. */
  letterSpacing?: number
  /** One of FONT_FAMILIES (see aiEditCommands.ts) — omitted means the
   *  original fixed sans-serif look. */
  fontFamily?: string
  backgroundColor?: string
  backgroundOpacity?: number
  /** How the caption enters at its own `start` — 'slide-down' comes from
   *  above into its resting position, 'slide-up' from below, 'fade' just
   *  opacity-ins in place, 'bounce' drops in and settles with diminishing
   *  overshoots, 'shake' rattles side-to-side and settles, 'blur-in' starts
   *  out of focus and sharpens, 'typewriter' reveals the text character by
   *  character via a widening crop rather than moving/fading the whole
   *  already-formed image. Omitted/undefined = appears instantly, the
   *  original behavior. Has no effect on a caption with no start/end
   *  window (shown for the whole video — there's no "entrance" to animate). */
  animation?: 'slide-down' | 'slide-up' | 'fade' | 'bounce' | 'shake' | 'blur-in' | 'typewriter'
  /** Seconds the entrance animation takes — default 0.4 if animation is set. */
  animationDuration?: number
}

/**
 * Writes one PNG per caption (rendered in the browser via captionOverlay.ts,
 * so emoji come out correctly — see that file for why) and returns the
 * ffmpeg args to load them plus the filter_complex lines that overlay them
 * onto `startLabel` in order, each windowed to its own [start,end].
 *
 * pngInputsFrom is the ffmpeg input index the first caption image will get —
 * the caller has to know this up front to build `-map`/other input args
 * around them, since ffmpeg indexes inputs by position on the command line.
 */
async function planCaptionOverlays(
  ffmpeg: FFmpegLike,
  probeInputName: string,
  captions: TimedCaption[],
  startLabel: string,
  pngInputsFrom: number,
): Promise<{ loadArgs: string[]; filterLines: string[]; videoLabel: string }> {
  const active = captions.filter((c) => c.text.trim())
  if (!active.length) return { loadArgs: [], filterLines: [], videoLabel: startLabel }

  const { width, height } = await probeDimensions(ffmpeg, probeInputName)
  const loadArgs: string[] = []
  const filterLines: string[] = []
  let cur = startLabel
  for (let i = 0; i < active.length; i++) {
    const cap = active[i]
    const { blob: png, boxX, boxWidth } = await renderCaptionImage({
      text: cap.text, position: cap.position, size: cap.size,
      color: cap.color, bold: cap.bold, outlineColor: cap.outlineColor, outlineWidth: cap.outlineWidth,
      fontFamily: cap.fontFamily, italic: cap.italic, underline: cap.underline, strikethrough: cap.strikethrough,
      backgroundColor: cap.backgroundColor, backgroundOpacity: cap.backgroundOpacity, glow: cap.glow,
      dropShadow: cap.dropShadow, gradientTo: cap.gradientTo, letterSpacing: cap.letterSpacing,
    }, width, height)
    const name = `capimg-${pngInputsFrom + i}.png`
    await ffmpeg.writeFile(name, new Uint8Array(await png.arrayBuffer()))
    // -loop 1: a still image is one frame by default, which would make it
    // vanish from the overlay after frame 1 — looped so it holds for its
    // whole enable= window (or the whole video, if there's no window).
    loadArgs.push('-loop', '1', '-i', name)

    const idx = pngInputsFrom + i
    const windowed = !!(cap.start || cap.end)
    const start = cap.start ?? 0
    const end = cap.end && cap.end > 0 ? cap.end : 999999
    const enable = windowed ? `:enable='between(t,${start},${end})'` : ''

    // Slide-down/up shifts the WHOLE transparent PNG vertically over the
    // animation window — since everything except the drawn text/box is
    // transparent, moving the image moves only the visible text, exactly
    // like moving the overlay's y position would if the text were its own
    // layer. Fade instead pre-fades the PNG's own alpha channel (via the
    // `fade` filter's alpha=1 mode) before it ever reaches `overlay`.
    // Only meaningful with a real time window — a caption shown for the
    // whole video has no "entrance" moment to animate.
    let source = `[${idx}:v]`
    let x = '0'
    let y = '0'
    if (windowed && cap.animation) {
      const animDur = cap.animationDuration && cap.animationDuration > 0 ? cap.animationDuration : 0.4
      if (cap.animation === 'slide-down' || cap.animation === 'slide-up') {
        const offset = cap.animation === 'slide-down' ? -Math.round(height * 0.25) : Math.round(height * 0.25)
        y = `'(${offset})*max(0\\,1-(t-${start})/${animDur})'`
      } else if (cap.animation === 'fade') {
        const faded = `[capfade${idx}]`
        filterLines.push(`[${idx}:v]format=yuva420p,fade=t=in:st=${start}:d=${animDur}:alpha=1${faded}`)
        source = faded
      } else if (cap.animation === 'bounce') {
        // A damped oscillator dropping in from above — same offset as
        // slide-down, but overshoots and settles instead of easing in once.
        // Clamped to exactly 0 once animDur elapses (rather than letting the
        // decay asymptote forever) so the caption is pixel-still afterward.
        const offset = -Math.round(height * 0.25)
        y = `'if(lt(t-${start}\\,${animDur})\\,(${offset})*exp(-4*(t-${start})/${animDur})*cos(2*3.14159*2.5*(t-${start})/${animDur})\\,0)'`
      } else if (cap.animation === 'shake') {
        // Same decaying-oscillation shape as bounce, but horizontal and
        // faster — a rattle rather than a drop — with no vertical motion.
        const offset = Math.round(width * 0.05)
        x = `'if(lt(t-${start}\\,${animDur})\\,(${offset})*exp(-4*(t-${start})/${animDur})*sin(2*3.14159*6*(t-${start})/${animDur})\\,0)'`
      } else if (cap.animation === 'blur-in') {
        // gblur's sigma is a fixed value in this build, not a per-frame
        // expression (confirmed via a live `-h filter=gblur` probe — no
        // command/eval support on sigma, only the shared `enable=` timeline
        // gate every filter gets) — verified BEFORE writing this, since the
        // first attempt assumed eval=frame support that turned out not to
        // exist and failed outright. Approximates the ramp with 3 gblur
        // stages at decreasing sigma, each enabled only for its own
        // sub-window of animDur, landing on fully sharp (no 4th stage
        // needed) once the last window ends.
        const blurred = `[capblur${idx}]`
        const steps = [8, 5, 2]
        const stepDur = animDur / (steps.length + 1)
        const chain = steps
          .map((sigma, i) => `gblur=sigma=${sigma}:enable='between(t\\,${start + i * stepDur}\\,${start + (i + 1) * stepDur})'`)
          .join(',')
        filterLines.push(`[${idx}:v]${chain}${blurred}`)
        source = blurred
      } else if (cap.animation === 'typewriter') {
        // Reveals the ALREADY-DRAWN text image progressively left to right,
        // by zeroing the PNG's own alpha channel to the right of a moving
        // edge, rather than a crop/resize — a resized overlay would need its
        // own x position recomputed to stay anchored, and get that wrong for
        // anything but a left-aligned box. Anchored to the box's OWN x/width
        // (from renderCaptionImage, not the whole canvas) so center/right-
        // positioned text starts revealing immediately instead of showing
        // nothing until the edge reaches a centered box partway through.
        const revealed = `[captype${idx}]`
        const progress = `clip((T-${start})/${animDur}\\,0\\,1)`
        const edge = `(${boxX.toFixed(1)}+${boxWidth.toFixed(1)}*${progress})`
        filterLines.push(`[${idx}:v]format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='if(lt(X\\,${edge})\\,alpha(X\\,Y)\\,0)',format=yuva420p${revealed}`)
        source = revealed
      }
    }

    const next = `[capout${idx}]`
    filterLines.push(`${cur}${source}overlay=x=${x}:y=${y}${enable}${next}`)
    cur = next
  }
  return { loadArgs, filterLines, videoLabel: cur }
}

/**
 * Builds the audio filter_complex lines shared by renderFinal/renderSegments:
 * volume/mute on the original track, and (if a music input index is given)
 * delaying music to musicStart, capping it at musicEnd, fading it in/out,
 * then mixing it under (or replacing) the original. originalAudioLabel is
 * whatever label already holds the trimmed/concatenated original audio
 * (e.g. '0:a' or '[outa]') going in; the returned label is what to `-map`.
 */
function buildAudioFilters(opts: {
  originalAudioLabel: string
  musicInputIndex: number | null
  muteOriginalAudio: boolean
  originalVolume: number
  musicVolume: number
  musicStart: number
  musicEnd: number
  fadeIn: number
  fadeOut: number
}): { filterLines: string[]; audioLabel: string } {
  const { originalAudioLabel, musicInputIndex, muteOriginalAudio, originalVolume, musicVolume, musicStart, musicEnd, fadeIn, fadeOut } = opts
  const filters: string[] = []

  if (musicInputIndex == null) {
    if (originalVolume === 1) return { filterLines: [], audioLabel: originalAudioLabel }
    filters.push(`${originalAudioLabel}volume=${originalVolume}[aout]`)
    return { filterLines: filters, audioLabel: '[aout]' }
  }

  let m = `[${musicInputIndex}:a]`
  if (musicStart > 0) {
    const ms = Math.round(musicStart * 1000)
    filters.push(`${m}adelay=${ms}|${ms}[mdelay]`)
    m = '[mdelay]'
  }
  if (musicEnd > musicStart) {
    filters.push(`${m}atrim=end=${musicEnd}[mtrim]`)
    m = '[mtrim]'
  }
  if (fadeIn > 0) {
    filters.push(`${m}afade=t=in:st=${musicStart}:d=${fadeIn}[mfin]`)
    m = '[mfin]'
  }
  if (fadeOut > 0 && musicEnd > musicStart) {
    const fadeStart = Math.max(musicStart, musicEnd - fadeOut)
    filters.push(`${m}afade=t=out:st=${fadeStart}:d=${fadeOut}[mfout]`)
    m = '[mfout]'
  }
  filters.push(`${m}volume=${musicVolume}[music]`)

  if (muteOriginalAudio) {
    filters.push(`[music]anull[aout]`)
  } else {
    const origLabel = originalVolume === 1 ? originalAudioLabel : (() => {
      filters.push(`${originalAudioLabel}volume=${originalVolume}[origvol]`)
      return '[origvol]'
    })()
    filters.push(`${origLabel}[music]amix=inputs=2:duration=first:dropout_transition=2[aout]`)
  }
  return { filterLines: filters, audioLabel: '[aout]' }
}

export interface RenderFinalOptions {
  trimStart?: number
  trimEnd?: number
  captions?: TimedCaption[]
  /** Operator-supplied track only — nothing here sources music on its own. */
  musicBlob?: Blob
  /** true = replace the clip's own audio with the music track entirely; false = mix under it. */
  muteOriginalAudio?: boolean
  musicVolume?: number
  /** Where in the video's own (already-trimmed) timeline the music starts/stops. 0/0 = plays from the start for the whole video. */
  musicStart?: number
  musicEnd?: number
  fadeIn?: number
  fadeOut?: number
  /** Volume on the clip's own audio track, independent of music. 1 = unchanged. */
  originalVolume?: number
}

/**
 * Applies a manual trim, any number of timed captions, and (if set) music —
 * the Export step, run on whatever the operator approved.
 */
export async function renderFinal(
  file: Blob,
  {
    trimStart = 0, trimEnd = 0, captions = [],
    musicBlob, muteOriginalAudio = false, musicVolume = 0.18,
    musicStart = 0, musicEnd = 0, fadeIn = 0, fadeOut = 0, originalVolume = 1,
  }: RenderFinalOptions,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'final-input.mp4'
  const musicName = 'final-music.mp3'
  const outputName = 'final-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  if (musicBlob) await ffmpeg.writeFile(musicName, new Uint8Array(await musicBlob.arrayBuffer()))

  const captionPngNames: string[] = []

  try {
    onProgress?.({ phase: 'analyzing' })
    const { loadArgs, filterLines, videoLabel } = await planCaptionOverlays(ffmpeg, inputName, captions, '[0:v]', 1)
    for (let i = 0; i < loadArgs.length; i += 4) captionPngNames.push(loadArgs[i + 3])
    const musicInputIndex = 1 + captionPngNames.length

    onProgress?.({ phase: 'rendering' })
    // Input-level seek/duration (before -i), not output-level -ss/-to after
    // it: with more -i args coming next (caption images, maybe music),
    // trailing -ss/-to would bind to the NEXT input instead of this one.
    // It also resets the filtered stream's timestamps to start at 0, which
    // is what makes a caption's enable=between(t,0,5) mean "the first 5
    // seconds of what's actually kept" rather than 5 seconds into footage
    // that's been trimmed away.
    const args: string[] = []
    if (trimStart > 0) args.push('-ss', String(trimStart))
    args.push('-i', inputName)
    if (trimEnd > 0) args.push('-t', String(Math.max(0.1, trimEnd - trimStart)))
    args.push(...loadArgs)
    // Looped so a short track still covers the whole clip; -shortest below
    // caps the output at the video's own length regardless.
    if (musicBlob) args.push('-stream_loop', '-1', '-i', musicName)

    const filters = [...filterLines]
    let videoMap = filterLines.length ? videoLabel : '0:v'

    const { filterLines: audioFilters, audioLabel } = buildAudioFilters({
      originalAudioLabel: '0:a',
      musicInputIndex: musicBlob ? musicInputIndex : null,
      muteOriginalAudio, originalVolume, musicVolume, musicStart, musicEnd, fadeIn, fadeOut,
    })
    filters.push(...audioFilters)
    const audioMap = audioLabel

    if (filters.length) args.push('-filter_complex', filters.join(';'))
    args.push('-map', videoMap, '-map', audioMap, ...VIDEO_ENCODE_ARGS)
    if (musicBlob || captionPngNames.length) args.push('-shortest')
    args.push(outputName)

    await ffmpeg.exec(args)
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not render the caption/trim onto the video. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    if (musicBlob) await ffmpeg.deleteFile(musicName).catch(() => {})
    for (const name of captionPngNames) await ffmpeg.deleteFile(name).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface SegmentTrim {
  /** Where this original clip starts/ends within the already-merged video. */
  start: number
  end: number
  /** Extra seconds to cut from this segment's own start/end, on top of that. */
  cutStart?: number
  cutEnd?: number
}

export interface RenderSegmentsOptions {
  captions?: TimedCaption[]
  musicBlob?: Blob
  muteOriginalAudio?: boolean
  musicVolume?: number
  musicStart?: number
  musicEnd?: number
  fadeIn?: number
  fadeOut?: number
  originalVolume?: number
}

/**
 * Re-trims a video that was made by joining several clips, per original
 * clip, using the boundaries joinClips recorded when it made the video —
 * cutting further into "clip 2" doesn't require re-uploading anything,
 * because the merged file already contains clip 2 at a known [start, end].
 * A segment cut down to nothing (or past its own length) is dropped
 * entirely rather than erroring, same as autoEditRemoveSilence's keep-list.
 */
export async function renderSegments(
  file: Blob,
  segments: SegmentTrim[],
  opts: RenderSegmentsOptions = {},
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  const {
    captions = [], musicBlob, muteOriginalAudio = false, musicVolume = 0.18,
    musicStart = 0, musicEnd = 0, fadeIn = 0, fadeOut = 0, originalVolume = 1,
  } = opts
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'segtrim-input.mp4'
  const musicName = 'segtrim-music.mp3'
  const outputName = 'segtrim-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  if (musicBlob) await ffmpeg.writeFile(musicName, new Uint8Array(await musicBlob.arrayBuffer()))

  const capNames: string[] = []

  try {
    onProgress?.({ phase: 'analyzing' })
    const keep = segments
      .map((s) => ({ start: s.start + Math.max(0, s.cutStart ?? 0), end: s.end - Math.max(0, s.cutEnd ?? 0) }))
      .filter((s) => s.end - s.start > 0.05)

    if (keep.length === 0) throw new AutoEditError('Trimming every clip down to nothing would leave an empty video — loosen the cuts.')

    const filters = keep
      .map((s, i) => `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`)
      .join(';')
    const refs = keep.map((_, i) => `[v${i}][a${i}]`).join('')
    const filterComplex: string[] = [`${filters};${refs}concat=n=${keep.length}:v=1:a=1[outv][outa]`]

    const { loadArgs, filterLines, videoLabel } = await planCaptionOverlays(ffmpeg, inputName, captions, '[outv]', 1)
    for (let i = 0; i < loadArgs.length; i += 4) capNames.push(loadArgs[i + 3])
    filterComplex.push(...filterLines)
    const videoOut = videoLabel

    const args = ['-i', inputName, ...loadArgs]
    const musicInputIndex = 1 + capNames.length
    if (musicBlob) args.push('-stream_loop', '-1', '-i', musicName)

    const { filterLines: audioFilters, audioLabel: audioOut } = buildAudioFilters({
      originalAudioLabel: '[outa]',
      musicInputIndex: musicBlob ? musicInputIndex : null,
      muteOriginalAudio, originalVolume, musicVolume, musicStart, musicEnd, fadeIn, fadeOut,
    })
    filterComplex.push(...audioFilters)

    onProgress?.({ phase: 'rendering' })
    args.push('-filter_complex', filterComplex.join(';'), '-map', videoOut, '-map', audioOut, ...VIDEO_ENCODE_ARGS)
    if (musicBlob || capNames.length) args.push('-shortest')
    args.push(outputName)
    await ffmpeg.exec(args)

    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the per-clip trims. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    if (musicBlob) await ffmpeg.deleteFile(musicName).catch(() => {})
    for (const name of capNames) await ffmpeg.deleteFile(name).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- AI-instructable operations: crop / zoom / pan / speed / loop ----------
//
// Everything above this point predates the natural-language AI Edit feature.
// These five are the operations the AI command interpreter (see
// aiEditCommands.ts) can actually produce and execute — trim, text/captions,
// audio volume/mute and background music are NOT duplicated here because
// they already have working ffmpeg support above (renderFinal/renderSegments)
// and a working UI (the Trim/Text/Captions/Music panels in
// VideoEditWorkspacePage.tsx); an AI command for those just edits that same
// state, same as a human clicking those controls would.
//
// Every filter string below was verified against a real, native ffmpeg build
// (not just ffmpeg.wasm) with real test footage and real pixel-level
// inspection before being written here.

export type CropAspect = '9:16' | '1:1' | '4:5' | '16:9' | '4:3'

const ASPECT_RATIOS: Record<CropAspect, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
}

/**
 * Crops the whole video to a target aspect ratio, centered — "crop this for
 * Instagram Reel" (9:16), a square post (1:1), and so on. Whichever
 * dimension the source is proportionally too wide/tall in gets cut; the
 * other axis is untouched. trunc(.../2)*2 keeps both output dimensions even,
 * which yuv420p encoding requires.
 */
export function cropAspectVf(aspect: CropAspect): string {
  const ratio = ASPECT_RATIOS[aspect]
  return (
    `crop=w='trunc(if(gt(iw/ih\\,${ratio})\\,ih*${ratio}\\,iw)/2)*2':` +
    `h='trunc(if(gt(iw/ih\\,${ratio})\\,ih\\,iw/${ratio})/2)*2':` +
    `x='(iw-out_w)/2':y='(ih-out_h)/2'`
  )
}

export async function applyCropAspect(
  file: Blob,
  aspect: CropAspect,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  return runOneVideoFilter(file, cropAspectVf(aspect), 'Could not crop the video.', onProgress, ['-c:a', 'copy'])
}

export interface ZoomPanOp {
  /** Seconds within the video's own (already-trimmed) timeline. */
  start: number
  end: number
  fromScale: number
  toScale: number
  /** 0..1 fraction of frame, the CENTER of the visible window (not its
   *  top-left corner) — 0.5,0.5 is a plain centered zoom. Omit for a pure
   *  zoom with no pan; omit toX/toY to hold the same point throughout. */
  fromX?: number
  fromY?: number
  toX?: number
  toY?: number
}

/**
 * A single time-windowed zoom and/or pan: scale and position change
 * linearly from the "from" values to the "to" values across [start,end],
 * holding the start state before `start` and the end state after `end`
 * (an ffmpeg "zoom in and hold", not a zoom that reverses itself).
 *
 * Built on the zoompan filter, not crop — crop's own w/h can vary per frame
 * only for reading, encoding requires a CONSTANT output frame size, and
 * crop's w/h expressions referencing time fail filter setup outright for
 * exactly that reason (verified: "Error when evaluating the expression").
 * zoompan is ffmpeg's own purpose-built filter for this: fixed output size
 * (`s=`), variable *source window* per output frame (`z`/`x`/`y`, keyed on
 * `on`, the output frame index — that's why fps must be probed and frames
 * computed from it, not left to consume the input's timestamps directly).
 */
export async function applyZoomPan(
  file: Blob,
  op: ZoomPanOp,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'zoom-input.mp4'
  const outputName = 'zoom-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const fps = await probeFps(ffmpeg, inputName)
    const startFrame = Math.max(0, Math.round(op.start * fps))
    const endFrame = Math.max(startFrame + 1, Math.round(op.end * fps))

    // 0 before the window, 1 after it, linear in between — shared by the
    // zoom and pan expressions so they animate in lockstep.
    const progress = `if(lt(on\\,${startFrame})\\,0\\,if(gt(on\\,${endFrame})\\,1\\,(on-${startFrame})/(${endFrame}-${startFrame})))`
    const zExpr = `${op.fromScale}+(${op.toScale - op.fromScale})*(${progress})`

    const fromX = op.fromX ?? 0.5
    const fromY = op.fromY ?? 0.5
    const toX = op.toX ?? fromX
    const toY = op.toY ?? fromY
    const cx = `${fromX}+(${toX - fromX})*(${progress})`
    const cy = `${fromY}+(${toY - fromY})*(${progress})`
    // zoompan's x/y are the crop window's top-left corner, not its center —
    // offset by half the (zoomed) visible width/height so fromX/toX=0.5
    // means "centered" regardless of how zoomed in the frame currently is.
    // clip()'d because an off-center target near a frame edge, combined with
    // a small zoom, can otherwise ask for a window that runs off the source.
    const xExpr = `clip(iw*(${cx})-(iw/zoom/2)\\,0\\,iw-iw/zoom)`
    const yExpr = `clip(ih*(${cy})-(ih/zoom/2)\\,0\\,ih-ih/zoom)`

    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${fps}`,
      ...VIDEO_ENCODE_ARGS,
      '-c:a', 'copy',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the zoom/pan. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * Decomposes a speed factor into a chain of ffmpeg atempo filters, each
 * within atempo's own supported range (0.5-2.0) — a 3x speed-up is
 * `atempo=2.0,atempo=1.5`, a 0.25x slow-down is `atempo=0.5,atempo=0.5`.
 * Exported and pure so this decomposition is unit-testable on its own.
 */
export function atempoChain(factor: number): string {
  const parts: number[] = []
  let remaining = factor
  while (remaining > 2) { parts.push(2); remaining /= 2 }
  while (remaining < 0.5) { parts.push(0.5); remaining /= 0.5 }
  parts.push(remaining)
  return parts.map((p) => `atempo=${p}`).join(',')
}

/**
 * Speeds up (factor > 1) or slows down (factor < 1) just [start,end] of the
 * video, leaving the rest untouched. Splits into up to three segments
 * (before/window/after — a segment this trims to nothing is just skipped),
 * retimes the window with setpts (video) and atempoChain (audio), and
 * concats the pieces back — the same trim+concat shape already used
 * elsewhere in this file (autoEditRemoveSilence, renderSegments), just with
 * one segment's timestamps rescaled instead of removed.
 */
export async function applyWindowedSpeed(
  file: Blob,
  start: number,
  end: number,
  factor: number,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'speed-input.mp4'
  const outputName = 'speed-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'analyzing' })
    const duration = await probeDuration(ffmpeg, inputName)
    const winStart = Math.max(0, start)
    const winEnd = Math.min(duration, end)
    if (winEnd - winStart < 0.1) {
      throw new AutoEditError('That time window is too short to change the speed of.')
    }

    const segments: { s: number; e: number; speed: boolean }[] = []
    if (winStart > 0.05) segments.push({ s: 0, e: winStart, speed: false })
    segments.push({ s: winStart, e: winEnd, speed: true })
    if (duration - winEnd > 0.05) segments.push({ s: winEnd, e: duration, speed: false })

    const filters: string[] = []
    segments.forEach((seg, i) => {
      const vpts = seg.speed ? `(PTS-STARTPTS)/${factor}` : 'PTS-STARTPTS'
      filters.push(`[0:v]trim=start=${seg.s}:end=${seg.e},setpts=${vpts}[v${i}]`)
      const atempo = seg.speed ? `,${atempoChain(factor)}` : ''
      filters.push(`[0:a]atrim=start=${seg.s}:end=${seg.e},asetpts=PTS-STARTPTS${atempo}[a${i}]`)
    })
    const refs = segments.map((_, i) => `[v${i}][a${i}]`).join('')
    filters.push(`${refs}concat=n=${segments.length}:v=1:a=1[outv][outa]`)

    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-filter_complex', filters.join(';'), '-map', '[outv]', '-map', '[outa]', ...VIDEO_ENCODE_ARGS, outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not change the speed of that section. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * Repeats the whole (already-edited) video so it plays `times` times total
 * — times=2 is the original plus one extra repeat. Stream-copied, not
 * re-encoded: looping doesn't change any frame's content, so there's
 * nothing for a re-encode to do except spend time.
 */
export async function loopVideo(
  file: Blob,
  times: number,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  if (times <= 1) return file
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()

  const inputName = 'loop-input.mp4'
  const outputName = 'loop-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-stream_loop', String(times - 1), '-i', inputName, '-c', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not loop the video. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- AI-instructable operations, batch 2: blur / pixelate / color /
// fade / rotate / flip / reverse / noise reduction ----------
//
// All whole-FRAME effects. blur/pixelate/color/fade/rotate/flip/reverse/
// mask/look/glitch/light/motionfx/audiofx below have no idea what a "person"
// or "background" is — they're plain ffmpeg filters over pixels or time, so
// "blur the background but keep the person sharp" cannot be done with any of
// them; the AI layer (aiEditCommands.ts) knows this and keeps `blur`
// documented as whole-frame-only. That specific request now has a real
// answer, though — see `applyBackgroundBlur` further down, which brings in
// an actual in-browser ML segmentation model (not an ffmpeg filter) to tell
// person pixels from background pixels before blurring only the latter.
//
// Time-windowed ones use the SAME filter's own `enable='between(t,s,e)'`
// clause (escaped the same way the rest of this file already does for
// zoompan/crop) rather than the split-trim-concat approach speed/zoom use —
// simpler and correct here because, unlike speed, these filters don't
// change the timeline's duration, so there's no need to re-stitch segments.

async function runOneVideoFilter(
  file: Blob,
  vf: string,
  errorContext: string,
  onProgress?: (p: AutoEditProgress) => void,
  extraArgs: string[] = [],
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'vf-input.mp4'
  const outputName = 'vf-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-vf', vf, ...VIDEO_ENCODE_ARGS, ...extraArgs, outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`${errorContext} (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * Same shape as runOneVideoFilter, but for effects that need `-filter_complex`
 * (multiple labelled filter nodes — split/overlay/maskedmerge chains) instead
 * of a single `-vf` chain, which can't express a split. Used by the six
 * blur-variant builders below (motion/directional/radial/zoom/spin/tiltshift)
 * — none of them are expressible as a single ffmpeg filter, all of them are
 * pure ffmpeg (no per-frame JS), same performance profile as blur/pixelate.
 */
async function runOneVideoFilterComplex(
  file: Blob,
  filterComplex: string,
  errorContext: string,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'vfc-input.mp4'
  const outputName = 'vfc-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-filter_complex', filterComplex, '-map', '[outv]', '-map', '0:a', ...VIDEO_ENCODE_ARGS, '-c:a', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`${errorContext} (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

const windowClause = (start: number, end: number) => `:enable='between(t\\,${start}\\,${end})'`

export interface BlurOptions { start: number; end: number; strength: number }

/** Whole-frame gaussian-ish blur (boxblur — cheaper than gblur, visually
 *  close enough) over [start,end]; unaffected outside that window. Strength
 *  1-20 maps to the boxblur radius. */
export function blurVf({ start, end, strength }: BlurOptions): string {
  const radius = Math.max(1, Math.min(20, Math.round(strength)))
  return `boxblur=${radius}:1${windowClause(start, end)}`
}

export async function applyBlur(file: Blob, opts: BlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, blurVf(opts), 'Could not blur the video.', onProgress, ['-c:a', 'copy'])
}

export interface PixelateOptions { start: number; end: number; strength: number }

/** Mosaic/pixelate over [start,end] — scales down then back up with
 *  nearest-neighbor, which is what produces the blocky look. Strength 1-20:
 *  higher = blockier (bigger downscale factor). */
export function pixelateVf({ start, end, strength }: PixelateOptions): string {
  const factor = Math.max(2, Math.min(40, Math.round(strength * 2)))
  const w = windowClause(start, end)
  return `scale=iw/${factor}:ih/${factor}${w},scale=iw*${factor}:ih*${factor}:flags=neighbor${w}`
}

export async function applyPixelate(file: Blob, opts: PixelateOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, pixelateVf(opts), 'Could not pixelate the video.', onProgress, ['-c:a', 'copy'])
}

// ---------- motion/directional/radial/zoom/spin/tiltshift blur ----------
// Six distinct blur-variant effects, all pure ffmpeg filter_complex (no
// per-frame JS/canvas — that's only needed by applyBackgroundBlur below,
// which requires real ML segmentation; a directional streak, a burst, a
// spin, or a static vertical gradient don't). None of these has a single
// matching ffmpeg filter in this build (confirmed: this file's own filter
// inventory has no motion-blur/radial-blur/tilt-shift primitive — only
// isotropic boxblur/gblur and tmix, which blends REAL consecutive frames,
// not a synthetic direction/radius/rotation). All six instead layer several
// translucent, transformed copies of the SAME frame back onto itself via
// `overlay` — the same "duplicate + format=yuva420p + colorchannelmixer=aa=
// opacity + overlay" technique applyLight's lightLeak already uses for a
// generated color layer, just with a transformed copy of the frame itself
// instead of a generated source. Every one of these was verified against a
// real ffmpeg render (not assumed) before being written this way.

export interface MotionBlurOptions { start: number; end: number; direction: 'horizontal' | 'vertical'; strength: number }
export interface DirectionalBlurOptions { start: number; end: number; angle: number; strength: number }

/**
 * Shared streak-blur builder for motion_blur (horizontal/vertical only) and
 * directional_blur (arbitrary angle) — motion_blur just calls this with
 * angle 0 or 90. Layers several copies of the frame, offset along
 * (cos(angle),sin(angle)) by increasing amounts, symmetric on both sides of
 * zero (steps run from -half to +half, skipping 0) so the result reads as a
 * blur centered on the sharp frame rather than a ghost dragged one way.
 * Strength 1-20 scales both how many offset steps there are and how far the
 * outermost one reaches. Confirmed via a real render: color-boundary edges
 * stretch cleanly along the requested angle.
 */
export function buildDirectionalBlurFilter(angleDeg: number, strength: number, start: number, end: number): string {
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const half = Math.max(2, Math.min(4, Math.round(2 + strength * 0.1)))
  const steps: number[] = []
  for (let i = -half; i <= half; i++) if (i !== 0) steps.push(i)
  const maxOffset = 0.007 + strength * 0.0035
  const w = windowClause(start, end)
  const splitLabels = steps.map((_, i) => `[s${i}]`).join('')
  const parts: string[] = [`[0:v]split=${steps.length + 1}[base]${splitLabels}`]
  let cur = '[base]'
  steps.forEach((step, i) => {
    const off = ((maxOffset * step) / half).toFixed(5)
    const opacity = (0.5 / (Math.abs(step) + 1)).toFixed(3)
    const ox = `main_w*(${off})*${dx.toFixed(4)}`
    const oy = `main_h*(${off})*${dy.toFixed(4)}`
    parts.push(`[s${i}]format=yuva420p,colorchannelmixer=aa=${opacity}[a${i}]`)
    const isLast = i === steps.length - 1
    const next = isLast ? '[outv]' : `[m${i}]`
    parts.push(`${cur}[a${i}]overlay=x='${ox}':y='${oy}'${w}${next}`)
    cur = next
  })
  return parts.join(';')
}

/** Directional streak blur simulating camera/subject motion, along the
 *  frame's horizontal or vertical axis. */
export async function applyMotionBlur(file: Blob, { start, end, direction, strength }: MotionBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const angle = direction === 'horizontal' ? 0 : 90
  const filterComplex = buildDirectionalBlurFilter(angle, strength, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply motion blur.', onProgress)
}

/** Same streak-blur technique as motion_blur, but along an arbitrary angle
 *  (0-360°) rather than just horizontal/vertical. */
export async function applyDirectionalBlur(file: Blob, { start, end, angle, strength }: DirectionalBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildDirectionalBlurFilter(angle, strength, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply directional blur.', onProgress)
}

export interface ZoomBlurOptions { start: number; end: number; strength: number }
export interface RadialBlurOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Shared zoom-burst blur builder for zoom_blur (always centered) and
 * radial_blur (movable center via x/y) — the one real difference between
 * the two commands is whether a custom center is exposed. Layers several
 * progressively-more-zoomed-in translucent copies on top of the original:
 * each layer crops a smaller, centered-on-(cx,cy) window out of the frame
 * then scales it back up to full size (same crop-then-scale-to-fill
 * technique applyZoomPan's zoompan already uses for its own crop window,
 * just with static numbers instead of an animated per-frame expression, and
 * the same clip()-based centering math to keep the crop window on-frame
 * near an edge). Confirmed via a real render: produces streaks radiating
 * outward from the center point — genuinely different from the linear
 * streak buildDirectionalBlurFilter produces.
 */
export function buildZoomBurstBlurFilter(strength: number, cx: number, cy: number, start: number, end: number): string {
  const layers = Math.max(3, Math.min(6, Math.round(3 + strength * 0.15)))
  const maxZoomExtra = 0.06 + strength * 0.03
  const w = windowClause(start, end)
  const splitLabels = Array.from({ length: layers }, (_, i) => `[s${i}]`).join('')
  const parts: string[] = [`[0:v]split=${layers + 1}[base]${splitLabels}`]
  let cur = '[base]'
  for (let i = 0; i < layers; i++) {
    const frac = (i + 1) / layers
    const zf = (1 + maxZoomExtra * frac).toFixed(4)
    const cropW = `iw/${zf}`
    const cropH = `ih/${zf}`
    const cropX = `clip(iw*(${cx})-(${cropW})/2\\,0\\,iw-(${cropW}))`
    const cropY = `clip(ih*(${cy})-(${cropH})/2\\,0\\,ih-(${cropH}))`
    const opacity = (0.6 / (i + 1)).toFixed(3)
    parts.push(`[s${i}]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=w='iw*${zf}':h='ih*${zf}',format=yuva420p,colorchannelmixer=aa=${opacity}[a${i}]`)
    const isLast = i === layers - 1
    const next = isLast ? '[outv]' : `[m${i}]`
    parts.push(`${cur}[a${i}]overlay=x=0:y=0${w}${next}`)
    cur = next
  }
  return parts.join(';')
}

/** Burst/radial-zoom blur look — simulates a zoom without changing framing
 *  (the output frame stays put; only the blend of scales moves). Always
 *  centered — for a movable burst point, use radial_blur instead. */
export async function applyZoomBlur(file: Blob, { start, end, strength }: ZoomBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildZoomBurstBlurFilter(strength, 0.5, 0.5, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply zoom blur.', onProgress)
}

/** Same zoom-burst technique as zoom_blur, but radiating from a movable
 *  center point (x/y, 0-1 fraction of frame, default centered). */
export async function applyRadialBlur(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: RadialBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildZoomBurstBlurFilter(strength, x, y, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply radial blur.', onProgress)
}

export interface SpinBlurOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Rotational blur around a center point — layers several small-angle
 * rotated translucent copies (symmetric +/- angle steps, same reasoning as
 * buildDirectionalBlurFilter) on top of the original. ffmpeg's `rotate`
 * filter only ever rotates around the CENTER of its input frame, so an
 * off-center pivot (custom x/y) is faked by padding the frame first so the
 * requested point sits exactly at the padded canvas's center, rotating
 * there, then cropping back out the original region — pad/crop amounts are
 * plain numbers computed here in JS (cx/cy are fixed per call, not animated),
 * expressed via ffmpeg's iw/ih symbols so no dimension probe is needed.
 * Confirmed via a real render, both centered and off-center: produces a
 * curved/rotational smear around the pivot, visually distinct from the
 * linear (motion/directional) and radial (zoom/radial) streaks above.
 */
export function buildSpinBlurFilter(strength: number, cx: number, cy: number, start: number, end: number): string {
  const half = Math.max(2, Math.min(4, Math.round(2 + strength * 0.1)))
  const steps: number[] = []
  for (let i = -half; i <= half; i++) if (i !== 0) steps.push(i)
  const maxAngle = 0.03 + strength * 0.012
  const w = windowClause(start, end)
  const kx = Math.max(cx, 1 - cx)
  const ky = Math.max(cy, 1 - cy)
  const padW = (2 * kx).toFixed(4)
  const padH = (2 * ky).toFixed(4)
  const padX = (kx - cx).toFixed(4)
  const padY = (ky - cy).toFixed(4)
  const cropWDiv = (2 * kx).toFixed(4)
  const cropHDiv = (2 * ky).toFixed(4)
  const cropXFrac = ((kx - cx) / (2 * kx)).toFixed(4)
  const cropYFrac = ((ky - cy) / (2 * ky)).toFixed(4)
  const splitLabels = steps.map((_, i) => `[s${i}]`).join('')
  const parts: string[] = [`[0:v]split=${steps.length + 1}[base]${splitLabels}`]
  let cur = '[base]'
  steps.forEach((step, i) => {
    const angle = ((maxAngle * step) / half).toFixed(5)
    const opacity = (0.55 / (Math.abs(step) + 1)).toFixed(3)
    const chain =
      `format=yuva420p,` +
      `pad=w='iw*${padW}':h='ih*${padH}':x='iw*${padX}':y='ih*${padY}':color=black@0,` +
      `rotate=${angle}:ow=iw:oh=ih:c=black@0,` +
      `crop=w='iw/${cropWDiv}':h='ih/${cropHDiv}':x='iw*${cropXFrac}':y='ih*${cropYFrac}',` +
      `colorchannelmixer=aa=${opacity}`
    parts.push(`[s${i}]${chain}[a${i}]`)
    const isLast = i === steps.length - 1
    const next = isLast ? '[outv]' : `[m${i}]`
    parts.push(`${cur}[a${i}]overlay=x=0:y=0${w}${next}`)
    cur = next
  })
  return parts.join(';')
}

/** Rotational blur around a center point (x/y, 0-1 fraction of frame,
 *  default centered) — a swirl/spin smear, distinct from the burst look of
 *  zoom_blur/radial_blur. */
export async function applySpinBlur(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: SpinBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildSpinBlurFilter(strength, x, y, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply spin blur.', onProgress)
}

export interface TiltShiftBlurOptions { start: number; end: number; strength: number; bandY?: number; bandHeight?: number }

/**
 * Miniature-photo tilt-shift look — a horizontal band across the middle
 * stays sharp, blur increases with distance from it above and below. Unlike
 * the five effects above, this genuinely needs a spatial gradient, not just
 * layered translucent copies — built with `geq` generating a synthetic
 * vertical-gradient mask (0 inside the sharp band, ramping to 255 outside
 * it, using geq's own Y/H position variables — no source pixel data
 * involved, just position, so this doesn't need an external PNG asset the
 * way applyMask's spotlight does), then `maskedmerge` blends a `gblur`'d
 * copy against the sharp original through that mask — the exact same
 * maskedmerge pairing (base=sharp shows where mask is black, overlay=blurred
 * shows where mask is white) buildMaskFilter already verified works in this
 * build. Confirmed via a real render: the requested band stays crisp while
 * top/bottom blur increases smoothly with distance.
 */
export function buildTiltShiftFilter(strength: number, bandY: number, bandHeight: number, start: number, end: number): string {
  const sigma = (3 + strength * 1.6).toFixed(2)
  const half = (bandHeight / 2).toFixed(4)
  const feather = 0.14
  const w = windowClause(start, end)
  const maskExpr = `255*clip((abs(Y/H-${bandY})-${half})/${feather}\\,0\\,1)`
  return [
    `[0:v]split=3[base][toBlur][toMask]`,
    `[toBlur]gblur=sigma=${sigma}${w}[blur]`,
    `[toMask]geq=lum='${maskExpr}':cb=128:cr=128[mask]`,
    `[base][blur][mask]maskedmerge=enable='between(t\\,${start}\\,${end})'[outv]`,
  ].join(';')
}

/** Keeps a horizontal band across the middle sharp (bandY = vertical center
 *  0-1, default 0.5; bandHeight = fraction of frame height that stays sharp,
 *  default 0.25) and blurs top/bottom with increasing distance from it. */
export async function applyTiltShiftBlur(file: Blob, { start, end, strength, bandY = 0.5, bandHeight = 0.25 }: TiltShiftBlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildTiltShiftFilter(strength, bandY, bandHeight, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply tilt-shift blur.', onProgress)
}

// ---------- wave/ripple/warp/twirl/fisheye/bulge/squeeze/stretch/lens ----------
// Nine geometric distortions. Unlike background_blur these need NO per-frame
// JS/canvas — a coordinate remap is pure geometry, so every one of them is an
// ffmpeg filter graph. Six of them (wave/ripple/warp/twirl/bulge/squeeze) have
// no matching primitive in this build and are built with `geq`, whose p(x,y)
// samples the source at an arbitrary computed position — the same filter
// buildTiltShiftFilter already uses, only reading real pixels instead of
// generating a mask. The other three map onto native filters, which are far
// faster, so they use those: fisheye and lens_distortion are `lenscorrection`,
// stretch is crop + scale2ref. All nine were checked against a real render of
// a grid chart in this exact ffmpeg.wasm core (@ffmpeg/core 0.12.6), not just
// parsed — including the barrel/pincushion sign, which is the opposite of what
// the filter name suggests (see buildLensDistortionFilter).
//
// Two shared conventions across the geq builders below:
//  - the SAME expression string is used for lum/cb/cr, and every displacement
//    is written as a fraction of W or H rather than in pixels, so it lands
//    identically on yuv420p's half-size chroma planes. (Working in yuv420p
//    also means only 1.5 samples per pixel instead of gbrp's 3.)
//  - offsets are normalized by W on BOTH axes, so a radius stays circular on
//    a non-square frame instead of turning into an ellipse.
//  - the sampled position is clip()ed to the frame, which smears the border
//    pixels outward; without it, warps that reach past the edge sample black.

/** geq applied identically to all three yuv420p planes — see the note above. */
const geqAllPlanes = (expr: string) => `geq=lum='${expr}':cb='${expr}':cr='${expr}'`
/** Samples the source at (xExpr,yExpr), clamped to the frame. */
const sampleAt = (xExpr: string, yExpr: string) => `p(clip(${xExpr}\\,0\\,W-1)\\,clip(${yExpr}\\,0\\,H-1))`
/** Offset from the (cx,cy) centre, as a fraction of W on both axes. */
const ndx = (cx: number) => `((X-W*${cx})/W)`
const ndy = (cy: number) => `((Y-H*${cy})/W)`
const ndr = (cx: number, cy: number) => `hypot(${ndx(cx)}\\,${ndy(cy)})`

export interface WaveOptions { start: number; end: number; strength: number; axis?: 'horizontal' | 'vertical' }

/**
 * Travelling sine ripple along one axis: every row slides sideways by a sine
 * of its own Y (or every column slides vertically by a sine of its X), with
 * the phase advancing on geq's own T so the wave actually travels rather than
 * sitting still. Three cycles across the frame; strength 1-20 scales only the
 * amplitude (0.7%-5.6% of the width), which keeps the wavelength readable at
 * every setting. Confirmed on a grid render: straight lines become clean
 * S-curves and the borders smear rather than going black.
 */
export function buildWaveFilter(axis: 'horizontal' | 'vertical', strength: number, start: number, end: number): string {
  const amp = (0.004 + strength * 0.0026).toFixed(5)
  const expr = axis === 'horizontal'
    ? sampleAt(`X+W*${amp}*sin(2*PI*(Y/H*3-T*0.6))`, 'Y')
    : sampleAt('X', `Y+H*${amp}*sin(2*PI*(X/W*3-T*0.6))`)
  return `${geqAllPlanes(expr)}${windowClause(start, end)}`
}

/** Sinusoidal ripple travelling across the frame, horizontally (default) or
 *  vertically. */
export async function applyWave(file: Blob, { start, end, strength, axis = 'horizontal' }: WaveOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildWaveFilter(axis, strength, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the wave effect.', onProgress, ['-c:a', 'copy'])
}

export interface RippleOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Concentric circular ripples: the displacement is RADIAL — each pixel moves
 * along its own outward vector from (cx,cy) by a sine of its distance — which
 * is what makes this read as rings spreading from a point rather than as
 * buildWaveFilter's one-axis wave train. Eight rings across the frame, phase
 * advancing on T so they travel outward. The radius is floored before it is
 * divided by, so the exact centre pixel doesn't divide by zero.
 */
export function buildRippleFilter(strength: number, cx: number, cy: number, start: number, end: number): string {
  const amp = (0.0015 + strength * 0.0011).toFixed(5)
  const r = ndr(cx, cy)
  const rSafe = `max(${r}\\,0.0005)`
  const offset = `${amp}*sin(2*PI*(${r}*8-T*0.9))`
  const expr = sampleAt(
    `X+W*(${offset})*${ndx(cx)}/(${rSafe})`,
    `Y+W*(${offset})*${ndy(cy)}/(${rSafe})`,
  )
  return `${geqAllPlanes(expr)}${windowClause(start, end)}`
}

/** Concentric circular ripples radiating from a point (x/y, 0-1 fraction of
 *  frame, default centred). */
export async function applyRipple(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: RippleOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildRippleFilter(strength, x, y, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the ripple effect.', onProgress, ['-c:a', 'copy'])
}

export interface WarpOptions { start: number; end: number; strength: number }

/**
 * General smooth wobble — two low-frequency sines per axis at deliberately
 * non-matching frequencies and drift speeds, so the pattern never repeats
 * cleanly and the frame reads as bending/melting rather than rippling. That
 * two-axis, aperiodic quality is the whole difference from buildWaveFilter.
 */
export function buildWarpFilter(strength: number, start: number, end: number): string {
  const amp = (0.003 + strength * 0.0017).toFixed(5)
  const dx = `${amp}*sin(2*PI*(Y/H*1.3+T*0.35))+${amp}*0.6*sin(2*PI*(X/W*0.9-T*0.22))`
  const dy = `${amp}*cos(2*PI*(X/W*1.1+T*0.28))+${amp}*0.6*cos(2*PI*(Y/H*0.7+T*0.19))`
  const expr = sampleAt(`X+W*(${dx})`, `Y+W*(${dy})`)
  return `${geqAllPlanes(expr)}${windowClause(start, end)}`
}

/** Smooth whole-frame spatial warp/wobble. */
export async function applyWarp(file: Blob, { start, end, strength }: WarpOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildWarpFilter(strength, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the warp effect.', onProgress, ['-c:a', 'copy'])
}

export interface TwirlOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Spiral swirl: converts each pixel to polar coordinates about (cx,cy), adds
 * an angle that is largest at the centre and falls to zero at the effect
 * radius, then samples back. The falloff is SQUARED so both it and its slope
 * reach zero together at the edge — a linear falloff leaves a visible crease
 * ring where the twist stops. Up to ~2.9 radians of twist at strength 20.
 */
export function buildTwirlFilter(strength: number, cx: number, cy: number, start: number, end: number): string {
  const maxAngle = (0.12 + strength * 0.14).toFixed(4)
  const radius = 0.5
  const r = ndr(cx, cy)
  const falloff = `max(0\\,1-(${r})/${radius})`
  const angle = `atan2(${ndy(cy)}\\,${ndx(cx)})+${maxAngle}*(${falloff})*(${falloff})`
  const expr = sampleAt(`W*${cx}+W*(${r})*cos(${angle})`, `H*${cy}+W*(${r})*sin(${angle})`)
  return `${geqAllPlanes(expr)}${windowClause(start, end)}`
}

/** Spiral swirl around a point (x/y, 0-1 fraction of frame, default centred)
 *  — rotation is strongest at that point and fades out with distance. */
export async function applyTwirl(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: TwirlOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildTwirlFilter(strength, x, y, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the twirl effect.', onProgress, ['-c:a', 'copy'])
}

export interface BulgeOptions { start: number; end: number; strength: number; x?: number; y?: number }
export interface SqueezeOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Shared builder for bulge and squeeze — the same radial rescale about
 * (cx,cy), with `outward` flipping its sign: sampling nearer the centre than
 * the output pixel magnifies (bulge), sampling further out shrinks (squeeze).
 * The amount is weighted by a Gaussian in the radius, which is smooth to
 * every order, so unlike a hard "inside radius R" cutoff there is no seam
 * ring at the edge of the effect. The peak stays below 1 so the mapping never
 * folds back on itself.
 */
export function buildRadialPinchFilter(strength: number, cx: number, cy: number, outward: boolean, start: number, end: number): string {
  const amount = ((0.03 + strength * 0.028) * (outward ? 1 : -1)).toFixed(4)
  const radiusSq = (0.3 * 0.3).toFixed(4)
  const r = ndr(cx, cy)
  const scale = `(1-${amount}*exp(-(${r})*(${r})/${radiusSq}))`
  const expr = sampleAt(`W*${cx}+(X-W*${cx})*${scale}`, `H*${cy}+(Y-H*${cy})*${scale}`)
  return `${geqAllPlanes(expr)}${windowClause(start, end)}`
}

/** Localized outward bulge around a point (x/y, 0-1, default centred). */
export async function applyBulge(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: BulgeOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildRadialPinchFilter(strength, x, y, true, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the bulge effect.', onProgress, ['-c:a', 'copy'])
}

/** Localized inward pinch around a point — the same transform as bulge with
 *  the sign inverted. */
export async function applySqueeze(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: SqueezeOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildRadialPinchFilter(strength, x, y, false, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the squeeze effect.', onProgress, ['-c:a', 'copy'])
}

/**
 * Shared plumbing for the three NON-geq distortions (fisheye,
 * lens_distortion, stretch). Runs `chain` on a copy of the frame, crops the
 * middle `cropW`x`cropH` fraction of the result and scales that back to the
 * original size, then lays the copy over the untouched frame gated to
 * [start,end]. Two jobs at once: the crop-and-rescale IS the effect for
 * stretch, and for barrel distortion it is what hides the black border the
 * lens filter leaves behind. `scale2ref` (rather than a plain `scale`) is what
 * makes the copy land back at EXACTLY the frame's own pixel dimensions — an
 * arithmetic `scale=iw*f` rounds and can miss by a pixel, leaving a seam of
 * the untouched frame showing at the edge. crop/scale have no timeline
 * support of their own, which is why the window has to be applied by the
 * overlay instead of on the filters themselves.
 */
function buildZoomFillFilter(chain: string, cropW: number, cropH: number, start: number, end: number): string {
  const w = cropW.toFixed(4)
  const h = cropH.toFixed(4)
  return [
    `[0:v]split=2[main][fx]`,
    `[fx]${chain ? `${chain},` : ''}crop=w='iw*${w}':h='ih*${h}':x='(iw-iw*${w})/2':y='(ih-ih*${h})/2'[cropped]`,
    `[cropped][main]scale2ref=flags=bicubic[fxs][mainout]`,
    `[mainout][fxs]overlay=x=0:y=0:enable='between(t\\,${start}\\,${end})'[outv]`,
  ].join(';')
}

export interface FisheyeOptions { start: number; end: number; strength: number }
export interface LensDistortionOptions { start: number; end: number; strength: number; mode: 'barrel' | 'pincushion' }

/**
 * Shared lens builder for fisheye and lens_distortion — one filter, one
 * parameter, because the two commands genuinely are the same optical
 * transform at different scales (fisheye is a look; lens_distortion is a
 * correction-strength nudge in either direction).
 *
 * `lenscorrection` samples the source at centre + (1 + k1*r²)*(dest-centre),
 * and the sign reads BACKWARDS from the name: measured against a rendered
 * rectangle in this build, k1 > 0 bows straight lines OUTWARD (barrel) while
 * pulling the whole picture inward and leaving black corners, and k1 < 0 bows
 * them INWARD (pincushion) while expanding to fill the frame. So only the
 * barrel side needs the zoom-fill; cropping to 1/(1+k1) is comfortably inside
 * the point where sampling runs off the source.
 */
export function buildLensDistortionFilter(k1: number, start: number, end: number): string {
  const chain = `lenscorrection=cx=0.5:cy=0.5:k1=${k1.toFixed(4)}:k2=0:i=bilinear`
  const crop = k1 > 0 ? 1 / (1 + k1) : 1
  return buildZoomFillFilter(chain, crop, crop, start, end)
}

/** Whole-frame barrel/fisheye bulge — the strong end of the same lens curve
 *  lens_distortion uses, always zoomed back out to keep the frame filled. */
export async function applyFisheye(file: Blob, { start, end, strength }: FisheyeOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildLensDistortionFilter(0.08 + strength * 0.036, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply the fisheye effect.', onProgress)
}

/** Correction-scale lens distortion in either direction — "barrel" bows
 *  straight lines outward, "pincushion" bows them inward. */
export async function applyLensDistortion(file: Blob, { start, end, strength, mode }: LensDistortionOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const magnitude = 0.03 + strength * 0.021
  const filterComplex = buildLensDistortionFilter(mode === 'barrel' ? magnitude : -magnitude, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply the lens distortion effect.', onProgress)
}

export interface StretchOptions { start: number; end: number; strength: number; axis?: 'horizontal' | 'vertical' }

/**
 * Anisotropic stretch — crops a narrower (or shorter) centred slice and
 * scales it back out to the full frame, which pulls the picture along that
 * one axis while the frame keeps its size. Up to 1.4x at strength 20. No geq
 * here: this is a plain affine scale, so the native crop/scale path is both
 * exact and an order of magnitude faster.
 */
export function buildStretchFilter(axis: 'horizontal' | 'vertical', strength: number, start: number, end: number): string {
  const inverse = 1 / (1 + strength * 0.02)
  return axis === 'horizontal'
    ? buildZoomFillFilter('', inverse, 1, start, end)
    : buildZoomFillFilter('', 1, inverse, start, end)
}

/** Stretches the frame along one axis (horizontal by default), cropping the
 *  overflow so the frame size is unchanged. */
export async function applyStretch(file: Blob, { start, end, strength, axis = 'horizontal' }: StretchOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildStretchFilter(axis, strength, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply the stretch effect.', onProgress)
}

// ---------- spin / rotation / bounce / swing ----------
// Four "Motion" effects, evaluated against the existing motionfx/rotate/zoom
// commands to make sure none of these is a near-duplicate: motionfx's own
// wobble/cameraShake jitter POSITION, zoomPunch changes SCALE with no
// spring/overshoot, rotate is an instant fixed 90/180/270 snap, zoom is a
// continuous SCALE change with no rotation. spin/rotation/swing are all
// genuine ROTATION-over-time (none of the above do that); bounce is a
// SCALE-over-time animation with decaying spring overshoot (none of the
// above do that either).
//
// spin/rotation/swing share one native `-vf` chain (no filter_complex): a
// `rotate` filter with a time-varying `a=` angle expression — ffmpeg's own
// per-frame `t` variable makes this possible without any split/overlay
// trick. `rotate` always pivots about the CENTER of its own input frame
// (confirmed by the spin_blur commit above), so an off-center pivot (swing's
// x/y) is faked the same way spin_blur fakes it: pad the frame so the pivot
// sits at the padded canvas's center, rotate there, then crop back out the
// original region. On top of that, since these rotate the WHOLE frame
// (not a translucent smear like spin_blur), the corners need to stay
// covered for every angle actually reached, not just a small max angle —
// buildRotateCoverScale below computes the exact scale-up factor that
// guarantees no black corners appear for any angle in [minAngleRad,
// maxAngleRad], by checking each corner of the (padded) frame against the
// rotated support function. Confirmed via a real render across several
// timestamps: the frame stays fully covered through the whole rotation
// range, and the picture only reads as "more zoomed in" than usual for a
// wide (16:9-ish) frame swept through a full spin, which is the unavoidable
// cost of guaranteeing zero black corners rather than an accepted rough edge.
//
// bounce is a SCALE animation instead, so it reuses applyZoomPan's own
// technique (zoompan, keyed on frame index) rather than the rotate-filter
// approach — just with a decaying-oscillator `z=` expression instead of a
// linear one. See buildBounceZoomExpr for the formula, adapted from the
// existing text-caption 'bounce' entrance animation (autoEdit.ts's own
// windowed-caption overlay code) but using sin() instead of cos() so it
// starts and ends AT scale 1 (a "neutral → pop → settle" shape) instead of
// starting displaced (that shape is right for a caption sliding in from an
// offset position, wrong for a whole-frame pop that should begin and end
// looking normal).

/**
 * The scale factor a frame (aspect ratio W:H) must be enlarged by so that,
 * after rotating by any angle in [minAngleRad, maxAngleRad] about its own
 * center, the rotated frame still fully covers the original W×H rectangle
 * (support-function condition per corner: Sw|cos a|+Sh|sin a| >= W and
 * Sw|sin a|+Sh|cos a| >= H). Sampled numerically across the angle range
 * rather than solved in closed form — cheap (a few dozen evaluations, once
 * per apply* call, not per frame) and trivially correct for any range,
 * including the full-circle case `spin` needs (whose worst angle depends on
 * aspect ratio, not a nice round number).
 */
export function buildRotateCoverScale(width: number, height: number, minAngleRad: number, maxAngleRad: number): number {
  const samples = 48
  let maxS = 1
  for (let i = 0; i <= samples; i++) {
    const a = minAngleRad + ((maxAngleRad - minAngleRad) * i) / samples
    const c = Math.abs(Math.cos(a))
    const s = Math.abs(Math.sin(a))
    maxS = Math.max(maxS, c + (height / width) * s, (width / height) * s + c)
  }
  return maxS
}

/**
 * Builds the shared `-vf` chain for spin/rotation/swing: pad (to re-center
 * an off-center pivot), scale up by the corner-coverage factor, rotate by
 * the (possibly time-varying) angle expression, crop back down to the
 * original frame. For a centered pivot (cx=cy=0.5, the only case spin/
 * rotation ever use) the pad step is a no-op (kx=ky=0.5, so the "padded"
 * size equals the original size) — this is still the right function to
 * call, just with nothing to undo later.
 */
export function buildPivotRotateFilter(
  width: number, height: number, cx: number, cy: number,
  angleExpr: string, minAngleRad: number, maxAngleRad: number,
): string {
  const kx = Math.max(cx, 1 - cx)
  const ky = Math.max(cy, 1 - cy)
  const paddedW = width * 2 * kx
  const paddedH = height * 2 * ky
  const scale = buildRotateCoverScale(paddedW, paddedH, minAngleRad, maxAngleRad).toFixed(4)
  const padW = (2 * kx).toFixed(4)
  const padH = (2 * ky).toFixed(4)
  const padX = (kx - cx).toFixed(4)
  const padY = (ky - cy).toFixed(4)
  const cropWDiv = (2 * kx).toFixed(4)
  const cropHDiv = (2 * ky).toFixed(4)
  const cropXFrac = ((kx - cx) / (2 * kx)).toFixed(4)
  const cropYFrac = ((ky - cy) / (2 * ky)).toFixed(4)
  return [
    `pad=w='iw*${padW}':h='ih*${padH}':x='iw*${padX}':y='ih*${padY}':color=black@0`,
    `scale=w='iw*${scale}':h='ih*${scale}'`,
    `rotate=a='${angleExpr}':ow='iw/${scale}':oh='ih/${scale}':c=black@0`,
    `crop=w='iw/${cropWDiv}':h='ih/${cropHDiv}':x='iw*${cropXFrac}':y='ih*${cropYFrac}'`,
  ].join(',')
}

export interface SpinOptions { start: number; end: number; strength: number; direction?: 'clockwise' | 'counterclockwise' }

/**
 * Continuous rotation: angle advances at a constant rate from `start`,
 * holds at 0 before `start` and at whatever angle it reached by `end`
 * afterward (via ffmpeg's own `clip(t,start,end)`, the same "hold the
 * endpoints" shape applyZoomPan's own `progress` expression uses) — so the
 * frame never snaps back to unrotated, it just stops spinning where it
 * stopped. strength 1-20 maps to 0.08-1.08 revolutions/second.
 */
export function buildSpinAngleExpr(strength: number, direction: 'clockwise' | 'counterclockwise', start: number, end: number): string {
  const revsPerSec = 0.08 + strength * 0.05
  const sign = direction === 'counterclockwise' ? -1 : 1
  const clippedT = `clip(t\\,${start}\\,${end})`
  return `${sign}*2*PI*${revsPerSec}*(${clippedT}-${start})`
}

/** Continuous whole-frame spin, centered, at a constant rate. strength 1-20
 *  controls speed; direction defaults to clockwise. */
export async function applySpin(file: Blob, { start, end, strength, direction = 'clockwise' }: SpinOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'spin-input.mp4'
  const outputName = 'spin-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const angleExpr = buildSpinAngleExpr(strength, direction, start, end)
    // Full period of |cos|/|sin| (PI, not 2*PI) covers every angle a
    // continuous multi-revolution spin will ever pass through.
    const vf = buildPivotRotateFilter(width, height, 0.5, 0.5, angleExpr, 0, Math.PI)
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-vf', vf, ...VIDEO_ENCODE_ARGS, '-c:a', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the spin effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface RotationOptions { start: number; end: number; fromDegrees: number; toDegrees: number }

/** A single bounded linear turn from fromDegrees to toDegrees over
 *  [start,end], holding each end value before/after — a controlled tilt,
 *  not a continuous spin. */
export function buildRotationAngleExpr(fromDegrees: number, toDegrees: number, start: number, end: number): string {
  const fromRad = (fromDegrees * Math.PI) / 180
  const toRad = (toDegrees * Math.PI) / 180
  const clippedT = `clip(t\\,${start}\\,${end})`
  const progress = `((${clippedT}-${start})/${end - start})`
  return `${fromRad}+(${toRad - fromRad})*${progress}`
}

/** Bounded tilt from fromDegrees to toDegrees, linear over [start,end]. */
export async function applyRotation(file: Blob, { start, end, fromDegrees, toDegrees }: RotationOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'rotation-input.mp4'
  const outputName = 'rotation-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const angleExpr = buildRotationAngleExpr(fromDegrees, toDegrees, start, end)
    const fromRad = (fromDegrees * Math.PI) / 180
    const toRad = (toDegrees * Math.PI) / 180
    const vf = buildPivotRotateFilter(width, height, 0.5, 0.5, angleExpr, Math.min(fromRad, toRad), Math.max(fromRad, toRad))
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-vf', vf, ...VIDEO_ENCODE_ARGS, '-c:a', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the rotation effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface SwingOptions { start: number; end: number; strength: number; x?: number; y?: number }

/** Damped pendulum: rotates one way then the other, amplitude decaying to
 *  zero — same decaying-oscillator SHAPE as buildBounceZoomExpr below (2.5
 *  cycles over the window, exp(-4*progress) decay), applied to angle instead
 *  of scale. 2.5 cycles means sin(2*PI*2.5*1) is exactly 0 at progress=1, so
 *  the swing settles at exactly 0° with no discontinuity, no hard clamp
 *  needed. strength 1-20 maps to a 5.5°-53° peak swing. */
export function buildSwingAngleExpr(strength: number, start: number, end: number): string {
  const maxSwingDeg = 3 + strength * 2.5
  const ampRad = (maxSwingDeg * Math.PI) / 180
  const clippedT = `clip(t\\,${start}\\,${end})`
  const progress = `((${clippedT}-${start})/${end - start})`
  return `${ampRad}*sin(2*PI*2.5*${progress})*exp(-4*${progress})`
}

/** Pendulum-like rotational oscillation around a pivot (x/y, 0-1, default
 *  centered), amplitude decaying to a stop. */
export async function applySwing(file: Blob, { start, end, strength, x = 0.5, y = 0.5 }: SwingOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'swing-input.mp4'
  const outputName = 'swing-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const angleExpr = buildSwingAngleExpr(strength, start, end)
    const maxSwingDeg = 3 + strength * 2.5
    const ampRad = (maxSwingDeg * Math.PI) / 180
    const vf = buildPivotRotateFilter(width, height, x, y, angleExpr, -ampRad, ampRad)
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-vf', vf, ...VIDEO_ENCODE_ARGS, '-c:a', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the swing effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface BounceOptions { start: number; end: number; strength: number }

/**
 * Decaying-spring scale expression for zoompan's `z=`, keyed on `on` (output
 * frame index, converted to a 0..1 progress the same way applyZoomPan's own
 * `progress` is) — a SCALE analogue of the existing text-caption 'bounce'
 * entrance animation (see this file's caption-overlay code), but sin()
 * instead of cos() so it starts AND ends at scale 1 rather than starting
 * displaced: sin(2*PI*2.5*0)=0 (neutral at `start`) and, since 2.5 is
 * exactly the number of cycles run by progress=1, sin(2*PI*2.5*1)=sin(5*PI)
 * is exactly 0 too (neutral again at `end`, no hard clamp needed to avoid a
 * discontinuity — provably zero, not just numerically small).
 */
export function buildBounceZoomExpr(strength: number, startFrame: number, endFrame: number): string {
  const amp = 0.04 + strength * 0.018
  const progress = `if(lt(on\\,${startFrame})\\,0\\,if(gt(on\\,${endFrame})\\,1\\,(on-${startFrame})/(${endFrame}-${startFrame})))`
  return `1+${amp}*sin(2*PI*2.5*(${progress}))*exp(-4*(${progress}))`
}

/** Whole-frame scale "pop": enlarges then springs back with a couple of
 *  decaying overshoots. strength 1-20 controls how big the initial pop is.
 *  Built on the same zoompan machinery as applyZoomPan (see that function's
 *  own comment for why zoompan rather than crop), just with this decaying
 *  expression for `z=` instead of a linear one, and no pan (x/y stay
 *  centered throughout). */
export async function applyBounce(file: Blob, { start, end, strength }: BounceOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'bounce-input.mp4'
  const outputName = 'bounce-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const fps = await probeFps(ffmpeg, inputName)
    const startFrame = Math.max(0, Math.round(start * fps))
    const endFrame = Math.max(startFrame + 1, Math.round(end * fps))
    const zExpr = buildBounceZoomExpr(strength, startFrame, endFrame)
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', `zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`,
      ...VIDEO_ENCODE_ARGS,
      '-c:a', 'copy',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the bounce effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface ColorAdjustOptions {
  start: number
  end: number
  /** All optional — only the ones the instruction actually named are set,
   *  the rest pass through unaffected. Ranges: brightness -1..1 (0 = no
   *  change), contrast/saturation 0..3 (1 = no change), grayscale is a flag,
   *  warmth -1 (cooler/blue) .. 1 (warmer/orange), vignette 0..1 (intensity).
   *  exposure -1..1, highlights/shadows -1..1, tint -1 (magenta)..1 (green),
   *  sharpness 0..2, clarity 0..1, grain 0..1. */
  brightness?: number
  contrast?: number
  saturation?: number
  grayscale?: boolean
  warmth?: number
  vignette?: number
  exposure?: number
  highlights?: number
  shadows?: number
  tint?: number
  sharpness?: number
  clarity?: number
  grain?: number
}

/** Pure builder for the color/tone filter chain — returns null when the
 *  options ask for no change at all. Split out from applyColorAdjust so the
 *  batching path (see BatchableEffect below) can splice this chain into a
 *  larger one instead of paying its own encode. */
export function colorAdjustVf(opts: ColorAdjustOptions): string | null {
  const {
    start, end, brightness = 0, contrast = 1, saturation = 1, grayscale = false, warmth = 0, vignette = 0,
    exposure = 0, highlights = 0, shadows = 0, tint = 0, sharpness = 0, clarity = 0, grain = 0,
  } = opts
  const w = windowClause(start, end)
  const parts: string[] = []
  const effSaturation = grayscale ? 0 : saturation
  // exposure folds into the same eq= call as brightness/contrast/saturation
  // (one fewer filter stage) via gamma — a multiplicative push, distinct
  // from brightness's additive offset. 2^exposure keeps 0 neutral (gamma 1).
  const gamma = exposure !== 0 ? Math.pow(2, exposure) : 1
  if (brightness !== 0 || contrast !== 1 || effSaturation !== 1 || gamma !== 1) {
    parts.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${effSaturation}:gamma=${gamma.toFixed(4)}${w}`)
  }
  if (warmth !== 0 || tint !== 0) {
    // colorbalance nudges shadows/mids/highlights together for a simple,
    // uniform push rather than a full white-balance model — warmth on the
    // red/blue axis (already shipped), tint on the green axis (new): a
    // magenta push is just a negative green shift with red/blue untouched.
    const r = (warmth * 0.4).toFixed(3)
    const b = (-warmth * 0.4).toFixed(3)
    const g = (tint * 0.4).toFixed(3)
    parts.push(`colorbalance=rs=${r}:rm=${r}:rh=${r}:bs=${b}:bm=${b}:bh=${b}:gs=${g}:gm=${g}:gh=${g}${w}`)
  }
  if (highlights !== 0 || shadows !== 0) {
    // Two control points on the master tone curve, endpoints anchored at
    // 0/0 and 1/1 so the curve never clips or flattens the extremes —
    // shadows moves the quarter-tone point, highlights the three-quarter
    // point, independent of the flat brightness/contrast/exposure above.
    const shadowY = Math.max(0, Math.min(1, 0.25 + shadows * 0.15)).toFixed(3)
    const highY = Math.max(0, Math.min(1, 0.75 + highlights * 0.15)).toFixed(3)
    parts.push(`curves=master='0/0 0.25/${shadowY} 0.75/${highY} 1/1'${w}`)
  }
  if (vignette > 0) {
    parts.push(`vignette=angle=PI/${Math.max(2, Math.round(6 / Math.max(0.01, vignette)))}${w}`)
  }
  if (sharpness > 0) {
    parts.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${sharpness.toFixed(2)}${w}`)
  }
  if (clarity > 0) {
    // Same unsharp filter, wider radius + gentler amount — the common
    // "local contrast" hack: a wide-radius sharpen reads as texture/punch
    // rather than edge-crispness. Capped at 13 (not unsharp's documented max
    // of 23) — verified empirically that this exact ffmpeg.wasm build fails
    // to initialize the filter at msize 15 and above ("Error reinitializing
    // filters!"), despite the option's own docs allowing up to 23.
    parts.push(`unsharp=luma_msize_x=13:luma_msize_y=13:luma_amount=${(clarity * 1.2).toFixed(2)}${w}`)
  }
  if (grain > 0) {
    parts.push(`noise=alls=${Math.round(grain * 40)}:allf=t${w}`)
  }
  if (!parts.length) return null // nothing actually requested to change
  return parts.join(',')
}

/** Combines every color/tone adjustment into one filter chain, windowed
 *  together so they all apply/release at the same times. Grayscale is done
 *  by zeroing eq's own saturation rather than a separate hue filter — one
 *  fewer filter stage. */
export async function applyColorAdjust(file: Blob, opts: ColorAdjustOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = colorAdjustVf(opts)
  if (!vf) return file // nothing actually requested to change
  return runOneVideoFilter(file, vf, 'Could not adjust the color of the video.', onProgress, ['-c:a', 'copy'])
}

export type LookName =
  | 'sepia' | 'negative' | 'tealOrange' | 'vintage' | 'cinematic' | 'hdr'
  | 'colorize' | 'duotone' | 'oldFilm' | 'super8' | 'polaroid' | 'camcorder'

/**
 * One fixed filter recipe per look, built only from filters independently
 * confirmed present in this deployed ffmpeg.wasm core (a live `-h filter=X`
 * probe, not assumed from ffmpeg's general docs — the same discipline that
 * caught unsharp's real msize ceiling above). `vintage`/`increase_contrast`
 * are ffmpeg's OWN built-in `curves` presets, not hand-tuned control points.
 * Each stage carries its own `enable=` window (`w`) rather than one shared
 * wrapper, matching applyColorAdjust's pattern.
 */
/**
 * hue (degrees) -> a colorbalance-style -1..1 RGB shift, used by 'colorize'.
 *
 * The first attempt used the `hue` filter's own h=/s= options (desaturate,
 * then set hue+boost saturation) — verified WRONG by testing: `hue`'s h=
 * ROTATES each pixel's existing hue by that many degrees, it does not set
 * an absolute target hue, so differently-colored source pixels stayed
 * differently colored, just all rotated — the opposite of "tint everything
 * toward one color". Switched to the same technique 'duotone' already uses
 * successfully (desaturate, then colorbalance's ADDITIVE per-channel shift,
 * which is NOT dependent on existing saturation the way hue's multiplier
 * is) — confirmed via real pixel sampling to produce a consistent single
 * hue across differently-lit regions, unlike the first attempt.
 */
export function hueToColorbalanceShift(hueDegrees: number): { r: string; g: string; b: string } {
  const h = ((hueDegrees % 360) + 360) % 360 / 60
  const x = 1 - Math.abs((h % 2) - 1)
  let r: number, g: number, b: number
  if (h < 1) [r, g, b] = [1, x, 0]
  else if (h < 2) [r, g, b] = [x, 1, 0]
  else if (h < 3) [r, g, b] = [0, 1, x]
  else if (h < 4) [r, g, b] = [0, x, 1]
  else if (h < 5) [r, g, b] = [x, 0, 1]
  else [r, g, b] = [1, 0, x]
  const scale = 0.3
  return { r: ((r - 0.5) * 2 * scale).toFixed(3), g: ((g - 0.5) * 2 * scale).toFixed(3), b: ((b - 0.5) * 2 * scale).toFixed(3) }
}

export const LOOK_RECIPES: Record<LookName, (w: string, hueDegrees: number) => string> = {
  sepia: (w) => `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0${w}`,
  negative: (w) => `negate${w}`,
  tealOrange: (w) => `colorbalance=rs=-0.15:gs=0.03:bs=0.15:rh=0.15:gh=0.02:bh=-0.15${w}`,
  vintage: (w) => `curves=preset=vintage${w}`,
  cinematic: (w) => `eq=contrast=1.1:saturation=0.85${w},colorbalance=rs=-0.1:bs=0.12:rh=0.12:bh=-0.08${w},vignette=angle=PI/6${w}`,
  hdr: (w) => `curves=preset=increase_contrast${w},eq=saturation=1.3${w},unsharp=luma_msize_x=13:luma_msize_y=13:luma_amount=0.5${w}`,
  colorize: (w, hue) => {
    const { r, g, b } = hueToColorbalanceShift(hue)
    return `eq=saturation=0${w},colorbalance=rs=${r}:gs=${g}:bs=${b}:rm=${r}:gm=${g}:bm=${b}:rh=${r}:gh=${g}:bh=${b}${w}`
  },
  duotone: (w) => `eq=saturation=0${w},colorbalance=rs=-0.2:bs=0.25:rh=0.25:gh=0.1:bh=-0.2${w}`,
  oldFilm: (w) => `curves=preset=vintage${w},eq=contrast=1.1:saturation=0.7${w},noise=alls=15:allf=t${w},vignette=angle=PI/5${w}`,
  super8: (w) => `eq=contrast=1.05:saturation=0.8${w},colorbalance=rs=0.1:bs=-0.08${w},noise=alls=10:allf=t${w},vignette=angle=PI/7${w}`,
  polaroid: (w) => `eq=contrast=0.9:saturation=1.1:brightness=0.04${w},colorbalance=rh=0.08:gh=0.03${w}`,
  camcorder: (w) => `eq=saturation=0.9:contrast=1.05${w},noise=alls=8:allf=t${w}`,
}

export interface LookOptions { start: number; end: number; name: LookName; hueDegrees?: number }

export async function applyLook(file: Blob, { start, end, name, hueDegrees = 200 }: LookOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const w = windowClause(start, end)
  const vf = LOOK_RECIPES[name](w, hueDegrees)
  return runOneVideoFilter(file, vf, `Could not apply the ${name} look.`, onProgress, ['-c:a', 'copy'])
}

export type GlitchStyle = 'rgbSplit' | 'tvNoise' | 'screenFlicker' | 'vhs' | 'scanLines' | 'digitalGlitch' | 'signalDistortion'

/**
 * One filter recipe per glitch style, strength 0..1. Verified against a
 * live render before writing this: rgbashift's rh/bh are plain ints (no
 * per-frame expression support, unlike eq's string-typed options), so
 * 'digitalGlitch' — the one style that needs to look like short, repeated
 * bursts rather than one continuous effect — is built from several
 * SEPARATE rgbashift stages, each gated to its own short enable sub-window
 * of [start,end], rather than one filter with a time-varying offset.
 * eq's brightness (a string-typed option) DOES accept a `t`-based
 * expression with eval=frame, confirmed by testing brightness actually
 * oscillates frame-to-frame — that's what drives 'screenFlicker'.
 */
export const GLITCH_RECIPES: Record<GlitchStyle, (w: string, strength: number, start: number, end: number) => string> = {
  rgbSplit: (w, s) => {
    const px = Math.max(1, Math.round(s * 14))
    return `rgbashift=rh=${px}:bh=-${px}${w}`
  },
  tvNoise: (w, s) => `noise=alls=${Math.round(20 + s * 50)}:allf=t+u${w},eq=saturation=${(1 - s * 0.4).toFixed(2)}${w}`,
  screenFlicker: (w, s) => `eq=brightness='${(s * 0.5).toFixed(2)}*sin(2*3.14159*8*t)':eval=frame${w}`,
  vhs: (w, s) => {
    const px = Math.max(1, Math.round(s * 6))
    return `rgbashift=rh=${px}:bh=-${px}${w},noise=alls=${Math.round(s * 20)}:allf=t${w},eq=saturation=${(1 - s * 0.2).toFixed(2)}${w},vignette=angle=PI/6${w}`
  },
  scanLines: (w, s) => {
    const depth = 0.3 + s * 0.4
    return `geq=lum='lum(X\\,Y)*(${(1 - depth).toFixed(2)}+${depth.toFixed(2)}*mod(Y\\,4)/4)':cb='cb(X\\,Y)':cr='cr(X\\,Y)'${w}`
  },
  digitalGlitch: (w, s, start, end) => {
    const dur = Math.max(0.1, end - start)
    const burst = Math.min(0.15, dur * 0.15)
    const px = Math.max(2, Math.round(s * 16))
    const parts: string[] = []
    for (const frac of [0.15, 0.5, 0.8]) {
      const bStart = start + dur * frac
      const bEnd = Math.min(end, bStart + burst)
      const bw = `:enable='between(t\\,${bStart.toFixed(2)}\\,${bEnd.toFixed(2)})'`
      parts.push(`rgbashift=rh=${px}:bh=-${px}${bw}`)
    }
    parts.push(`noise=alls=${Math.round(s * 30)}:allf=t${w}`)
    return parts.join(',')
  },
  signalDistortion: (w, s) => {
    const px = Math.max(2, Math.round(s * 20))
    return `rgbashift=rh=${px}:bh=-${Math.round(px * 0.6)}${w},eq=contrast=${(1 + s * 0.3).toFixed(2)}${w}`
  },
}

export interface GlitchOptions { start: number; end: number; style: GlitchStyle; strength?: number }

export async function applyGlitch(file: Blob, { start, end, style, strength = 0.5 }: GlitchOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const w = windowClause(start, end)
  const vf = GLITCH_RECIPES[style](w, strength, start, end)
  return runOneVideoFilter(file, vf, `Could not apply the ${style} effect.`, onProgress, ['-c:a', 'copy'])
}

export type LightStyle = 'flash' | 'strobe' | 'flicker' | 'glow' | 'bloom' | 'lightLeak'

/**
 * Single-input recipes only — 'lightLeak' is handled separately below
 * (applyLight) since it composites a second generated color source, which
 * needs its own -i/-filter_complex, not a plain -vf chain. flash/strobe/
 * flicker reuse eq's proven eval=frame time expression (Sub-phase 4c).
 * glow/bloom use split+gblur+blend=screen — confirmed this works within a
 * single -vf string (no -filter_complex needed) by testing directly, and
 * blend's all_opacity (0-1, confirmed via a live -h filter=blend probe) is
 * what scales strength, not the blur radius, since radius controls
 * softness, not intensity.
 */
export const LIGHT_RECIPES: Partial<Record<LightStyle, (w: string, s: number, start: number) => string>> = {
  flash: (w, s, start) => `eq=brightness='${(s * 0.9).toFixed(2)}*exp(-8*(t-${start}))':eval=frame${w}`,
  strobe: (w, s, start) => `eq=brightness='${(s * 0.7).toFixed(2)}*abs(sin(2*3.14159*10*(t-${start})))':eval=frame${w}`,
  flicker: (w, s, start) => `eq=brightness='${(s * 0.35).toFixed(2)}*sin(2*3.14159*3*(t-${start}))':eval=frame${w}`,
  glow: (w, s) => `split[gA][gB];[gB]gblur=sigma=${(4 + s * 8).toFixed(1)}[gBl];[gA][gBl]blend=all_mode=screen:all_opacity=${(0.4 + s * 0.4).toFixed(2)}${w}`,
  bloom: (w, s) => `split[bA][bB];[bB]eq=brightness=0.2,gblur=sigma=${(10 + s * 14).toFixed(1)}[bBl];[bA][bBl]blend=all_mode=screen:all_opacity=${(0.5 + s * 0.4).toFixed(2)}${w}`,
}

export interface LightOptions { start: number; end: number; style: LightStyle; strength?: number }

export async function applyLight(file: Blob, { start, end, style, strength = 0.5 }: LightOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  if (style !== 'lightLeak') {
    const w = windowClause(start, end)
    const vf = LIGHT_RECIPES[style]!(w, strength, start)
    return runOneVideoFilter(file, vf, `Could not apply the ${style} effect.`, onProgress, ['-c:a', 'copy'])
  }

  // lightLeak washes a warm color over the frame — needs a SECOND source
  // (a plain generated color, not a Canvas-drawn PNG like mask/captions),
  // so it goes through its own filter_complex + explicit -map, same shape
  // as applyMask. The color= source has no natural end (infinite, no
  // duration given) — confirmed by testing that omitting -shortest here
  // hangs the render indefinitely, the same class of bug the mask sub-phase
  // already found with a looped PNG.
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'light-input.mp4'
  const outputName = 'light-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const w = windowClause(start, end)
    const opacity = (0.25 + strength * 0.35).toFixed(2)
    // overlay needs an explicit key=value BEFORE the enable clause — a bare
    // "overlay:enable=..." fails to parse ("No such filter: 'overlay:enable'",
    // caught by testing), unlike every other overlay call in this file which
    // already had x=/y= as its first param for unrelated reasons.
    const filterComplex =
      `[1:v]format=yuva420p,colorchannelmixer=aa=${opacity}[leak];` +
      `[0:v][leak]overlay=x=0:y=0${w}[outv]`
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-f', 'lavfi', '-i', `color=c=0xFFA050:s=${width}x${height}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the light leak effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- lens_flare/sparkle/neon_glow/god_rays ----------
// Four more light-family effects, genuinely distinct from LIGHT_RECIPES'
// six styles above: those brighten the WHOLE frame (flash/strobe/flicker)
// or brighten+blur the whole frame over itself (glow/bloom/lightLeak). These
// four instead composite a SHAPE — a flare rig, scattered points, a colored
// mask of the frame's own highlights, or a ray fan — onto the frame, reusing
// the ndx/ndy/ndr coordinate helpers the distortion builders above already
// defined. All four were rendered through the actual @ffmpeg/core@0.12.6
// build this app loads (via a headless browser harness driving ffmpeg.wasm
// directly, not just a syntax check) and visually inspected, which caught
// two real bugs neither would have shown up as an ffmpeg error:
//  - geq's output isn't clamped before the 8-bit write, so a sum of
//    overlapping bright terms past 255 WRAPS instead of clipping — lens
//    flare's core rendered as a dark hole until the sum was wrapped in
//    min(255, ...).
//  - blend's screen/multiply modes applied to yuv420p's chroma (cb/cr)
//    planes are not hue-neutral, even feeding them the source's own chroma
//    — screen(x,x) isn't x except at the extremes. Confirmed by rendering
//    onto a flat gray frame and seeing a magenta cast appear out of nowhere.
//    lens_flare/sparkle/god_rays fix this by screening luma only (gblur's
//    planes=1 bitmask keeps chroma an exact unblurred copy of the source, so
//    blend's c1_mode/c2_mode='normal' pass it through untouched); neon_glow
//    can't take that shortcut since injecting a hue IS the point, so it runs
//    its whole composite in RGB instead, where screen/multiply behave the
//    way an image editor's blend modes actually do — plus one more quirk
//    found the same way: converting a blend node's RGBA output straight to
//    yuv420p corrupted near-black pixels (a stray green cast), fixed by
//    routing through format=rgb24 first to drop the alpha plane before that
//    conversion.

/** A soft-edged disc — near flat-top, falling off sharply past `radius` —
 *  reads as a distinct circle rather than a diffuse gaussian smear, which is
 *  what makes lens_flare's secondary elements look like "rings" strung along
 *  a line instead of more blobs of glow piled on the main halo. */
const geqDisc = (cx: number, cy: number, radius: number, amp: number) =>
  `(${amp.toFixed(2)}/(1+pow((${ndr(cx, cy)})/${radius.toFixed(5)}\\,8)))`

const geqSoftBlob = (cx: number, cy: number, sigma: number, amp: number) =>
  `${amp.toFixed(2)}*exp(-((${ndx(cx)})*(${ndx(cx)})+(${ndy(cy)})*(${ndy(cy)}))/(2*${sigma}*${sigma}))`

/**
 * Shared composite for lens_flare/sparkle/god_rays: generates a synthetic
 * brightness-only layer from `expr` (a function of X/Y/T, clamped to 255 —
 * see the wraparound note above), blurs ONLY its luma plane, then screens
 * that luma onto the original while the chroma planes pass through the
 * unblurred source untouched (see the hue-neutrality note above). One -vf
 * chain, no -filter_complex needed — same as LIGHT_RECIPES' glow/bloom.
 */
function screenLumaOnly(expr: string, sigma: number | string, opacity: number | string, start: number, end: number): string {
  const w = windowClause(start, end)
  return `split[a][b];[b]geq=lum='min(255\\,${expr})':cb='cb(X,Y)':cr='cr(X,Y)'[g];[g]gblur=sigma=${sigma}:planes=1[gb];[a][gb]blend=c0_mode=screen:c0_opacity=${opacity}:c1_mode=normal:c1_opacity=1:c2_mode=normal:c2_opacity=1${w}`
}

export interface LensFlareOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * Sum of gaussian-disc terms along the line from the source point through
 * frame center and beyond: a bright core+halo at the source, then five
 * shrinking rings trailing off past center — the classic anamorphic streak.
 * Confirmed via a real render (including the min(255,...) clamp above,
 * without which the bright core showed as a dark hole from 8-bit wraparound).
 */
export function buildLensFlareExpr(strength: number, sx: number, sy: number): string {
  const s = strength / 20
  const along = (t: number): [number, number] => [sx + (0.5 - sx) * t, sy + (0.5 - sy) * t]
  const terms: string[] = []
  const [hx, hy] = along(0)
  terms.push(geqSoftBlob(hx, hy, 0.11 + s * 0.03, 70 + s * 55))
  terms.push(geqDisc(hx, hy, 0.028 + s * 0.01, 190 + s * 60))
  const rings: [number, number, number][] = [
    [0.45, 0.016, 0.30],
    [0.85, 0.030, 0.45],
    [1.15, 0.012, 0.28],
    [1.5, 0.022, 0.38],
    [1.85, 0.009, 0.22],
  ]
  for (const [t, radiusBase, ampFrac] of rings) {
    const [cx, cy] = along(t)
    const radius = radiusBase * (0.6 + s * 0.6)
    terms.push(geqDisc(cx, cy, radius, ((90 + s * 90) * ampFrac) / 0.3))
  }
  return terms.join('+')
}

/** Bright circular flare/halo with smaller secondary rings strung along the
 *  line from the source point (x/y, default 0.8/0.2) through frame center
 *  and beyond. */
export async function applyLensFlare(file: Blob, { start, end, strength, x = 0.8, y = 0.2 }: LensFlareOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildLensFlareExpr(strength, x, y)
  const sigma = (1.4 + strength * 0.1).toFixed(2)
  const opacity = Math.min(1, 0.4 + strength * 0.022).toFixed(3)
  const vf = screenLumaOnly(expr, sigma, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the lens flare effect.', onProgress, ['-c:a', 'copy'])
}

export interface SparkleOptions { start: number; end: number; strength: number }

/** Ten fixed, spread-out (x, y, frequency, phase) points — varied
 *  frequencies/phases so several are lit at any given moment instead of all
 *  blinking in sync, which is what actually reads as "twinkling". */
const SPARKLE_POINTS: [number, number, number, number][] = [
  [0.15, 0.20, 3.1, 0.0], [0.35, 0.15, 2.7, 1.1], [0.60, 0.25, 3.5, 2.3],
  [0.80, 0.18, 2.3, 0.5], [0.25, 0.55, 2.9, 3.0], [0.50, 0.60, 3.3, 1.7],
  [0.75, 0.50, 2.5, 4.0], [0.90, 0.70, 3.8, 2.0], [0.10, 0.75, 2.6, 0.9],
  [0.45, 0.85, 3.0, 3.6],
]

/**
 * Sum of small gaussian points, each modulated by a `0.5+0.5*sin(...)`
 * twinkle curve raised to the 4th power — that curve spends more of its
 * cycle away from zero than `max(0,sin)` would, which is what keeps several
 * points lit at once instead of the whole set blinking on and off together.
 */
export function buildSparkleExpr(strength: number): string {
  const amp = 150 + strength * 6
  const sigma = 0.007 + strength * 0.0007
  const terms = SPARKLE_POINTS.map(([x, y, f, ph]) => {
    const twinkle = `pow(0.5+0.5*sin(2*PI*(${f}*T+${ph}))\\,4)`
    return `(${twinkle}*${amp.toFixed(1)}*exp(-((${ndx(x)})*(${ndx(x)})+(${ndy(y)})*(${ndy(y)}))/(2*${sigma.toFixed(5)}*${sigma.toFixed(5)})))`
  })
  return terms.join('+')
}

/** Small bright points scattered over the frame, twinkling in and out over
 *  [start,end]. strength 1-20 scales density/brightness. */
export async function applySparkle(file: Blob, { start, end, strength }: SparkleOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildSparkleExpr(strength)
  const opacity = Math.min(1, 0.55 + strength * 0.02).toFixed(3)
  const vf = screenLumaOnly(expr, 1.2, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the sparkle effect.', onProgress, ['-c:a', 'copy'])
}

export interface GodRaysOptions { start: number; end: number; strength: number; x?: number; y?: number }

/**
 * A sector pattern (`sin(K*angle)`, K sectors around the source point)
 * raised to an odd power to sharpen the beams, multiplied by an exponential
 * radial falloff so the rays fade with distance from the source — reads as
 * light rays fanning out from a point, distinct from any `light` style
 * (none of them are directional).
 */
export function buildGodRaysExpr(strength: number, sx: number, sy: number): string {
  const K = 11
  const amp = (0.55 + strength * 0.028).toFixed(3)
  return `${amp}*255*pow(abs(sin(${K}*atan2(${ndy(sy)}\\,${ndx(sx)}))),3)*exp(-2.0*${ndr(sx, sy)})`
}

/** Bright diagonal rays radiating from a source point (x/y, default
 *  0.5/0.1 — top-center) over [start,end]. strength 1-20. */
export async function applyGodRays(file: Blob, { start, end, strength, x = 0.5, y = 0.1 }: GodRaysOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildGodRaysExpr(strength, x, y)
  const sigma = (3 + strength * 0.3).toFixed(2)
  const opacity = Math.min(1, 0.45 + strength * 0.025).toFixed(3)
  const vf = screenLumaOnly(expr, sigma, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the god rays effect.', onProgress, ['-c:a', 'copy'])
}

export interface NeonGlowOptions { start: number; end: number; strength: number; color?: string }

/**
 * Needs a second, generated color source (like applyLight's lightLeak
 * branch above) so it manages its own ffmpeg session instead of going
 * through runOneVideoFilterComplex, which assumes a single input.
 *
 * Composite: threshold the frame's own luma to isolate highlights, blur
 * just that mask, boost its gain back up (a wide-enough blur to look soft
 * dilutes a small/sharp highlight's mass far more than expected — confirmed
 * by testing, the mask peaked around 15/255 without this), multiply it by a
 * solid color source to tint it, then screen that over the original. Doing
 * the multiply AND the screen in RGB (not yuv420p) is what keeps the result
 * hue-correct — see the module-level note above for why, and for the
 * format=rgb24-before-yuv420p fix for the separate corruption bug that
 * surfaced once this was rendered for real.
 */
export async function applyNeonGlow(file: Blob, { start, end, strength, color = '#ff2fd6' }: NeonGlowOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'neon-input.mp4'
  const outputName = 'neon-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const w = windowClause(start, end)
    const th = 160
    const sigma = (2 + strength * 0.55).toFixed(1)
    const gain = 3.4
    const opacity = Math.min(1, 0.55 + strength * 0.03).toFixed(3)
    const filterComplex = [
      `[0:v]split=2[main][hl]`,
      `[hl]lutyuv=y='if(gt(val\\,${th})\\,val\\,0)':u=128:v=128,gblur=sigma=${sigma},format=rgba[hlblur]`,
      `[hlblur]lutrgb=r='clip(val*${gain}\\,0\\,255)':g='clip(val*${gain}\\,0\\,255)':b='clip(val*${gain}\\,0\\,255)'[hlrgb]`,
      `[1:v]format=rgba[colorsrc]`,
      `[hlrgb][colorsrc]blend=all_mode=multiply[tinted]`,
      `[main]format=rgba[mainrgba]`,
      `[mainrgba][tinted]blend=all_mode=screen:all_opacity=${opacity}${w},format=rgb24,format=yuv420p[outv]`,
    ].join(';')
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the neon glow effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- dust/scratches/film_burn/retro_camera ----------
// Film/retro effects not already covered by LOOK_RECIPES' oldFilm/super8
// (fixed color grade + ffmpeg's `noise` filter — a STATIC per-pixel texture,
// same shape every frame, no motion/structure) or by `color`'s plain `grain`
// field (same static-noise idea). dust/scratches add real per-frame
// structure (drifting points, flashing lines); film_burn adds a moving,
// colored, organic-edged mask, distinct from light's flat lightLeak wash.
// retro_camera is pure on-screen chrome (brackets + REC dot), meant to be
// combined WITH look's camcorder rather than replace it. All four verified
// via the same real @ffmpeg/core@0.12.6 render-and-inspect harness as the
// light-family effects above.

/** Like ndx/ndy above, but the "center" is itself a runtime expression (a
 *  function of T) rather than a fixed number — needed for dust, whose
 *  specks drift, so their center can't be baked in as a JS constant. */
const ndxOfExpr = (cxExpr: string) => `((X-W*(${cxExpr}))/W)`
const ndyOfExpr = (cyExpr: string) => `((Y-H*(${cyExpr}))/W)`

export interface DustOptions { start: number; end: number; strength: number }

/** Twelve fixed (x0, y0, fallSpeed, swayFreq, swayAmp, phase) specks: each
 *  drifts downward and wraps via `mod` (so it re-enters at the top rather
 *  than vanishing), sways side to side on a sine, and is modulated by a
 *  gentle twinkle — same screenLumaOnly composite as lens_flare/sparkle/
 *  god_rays above, just with a moving rather than fixed center per term. */
const DUST_POINTS: [number, number, number, number, number, number][] = [
  [0.10, 0.05, 0.045, 0.60, 0.015, 0.0], [0.30, 0.80, 0.038, 0.50, 0.020, 1.2],
  [0.55, 0.20, 0.052, 0.70, 0.012, 2.4], [0.70, 0.60, 0.041, 0.55, 0.018, 0.7],
  [0.85, 0.10, 0.047, 0.65, 0.014, 3.1], [0.20, 0.45, 0.035, 0.45, 0.022, 1.8],
  [0.45, 0.90, 0.050, 0.60, 0.016, 2.9], [0.65, 0.35, 0.044, 0.50, 0.019, 0.3],
  [0.92, 0.75, 0.039, 0.58, 0.013, 1.5], [0.05, 0.65, 0.048, 0.62, 0.017, 2.2],
  [0.38, 0.15, 0.043, 0.53, 0.021, 3.5], [0.78, 0.92, 0.036, 0.68, 0.015, 0.9],
]

export function buildDustExpr(strength: number, start: number): string {
  const amp = 55 + strength * 5.5
  const sigma = 0.0035 + strength * 0.00025
  const terms = DUST_POINTS.map(([x0, y0, fall, swayF, swayA, ph]) => {
    const yExpr = `mod(${y0}+${fall}*(T-${start})\\,1.0)`
    const xExpr = `${x0}+${swayA}*sin(2*PI*(${swayF}*(T-${start})+${ph}))`
    const twinkle = `(0.6+0.4*sin(2*PI*(1.3*T+${ph})))`
    return `(${twinkle}*${amp.toFixed(1)}*exp(-((${ndxOfExpr(xExpr)})*(${ndxOfExpr(xExpr)})+(${ndyOfExpr(yExpr)})*(${ndyOfExpr(yExpr)}))/(2*${sigma.toFixed(5)}*${sigma.toFixed(5)})))`
  })
  return terms.join('+')
}

/** Small specks drifting/swaying over [start,end]. strength 1-20 scales
 *  count/brightness (count is fixed at 12; strength scales size/opacity). */
export async function applyDust(file: Blob, { start, end, strength }: DustOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildDustExpr(strength, start)
  const opacity = Math.min(1, 0.45 + strength * 0.02).toFixed(3)
  const vf = screenLumaOnly(expr, 0.7, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the dust effect.', onProgress, ['-c:a', 'copy'])
}

/** Deterministic (not Math.random) pseudo-random in [0,1) from a hash sine —
 *  same strength/window always renders the same scratches, which matters
 *  for a "remove effect"/re-run to look identical. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export interface ScratchesOptions { start: number; end: number; strength: number }

/**
 * A handful of thin vertical `drawbox` lines, each gated to its own short
 * between(t,..) sub-window — the same short-burst-via-separate-filter-stages
 * shape GLITCH_RECIPES' digitalGlitch uses above — at a pseudoRandom x
 * position/timing/thickness/opacity. Distinct from oldFilm/super8's `noise`,
 * which has no line structure and doesn't turn on/off over time.
 */
export function buildScratchesFilter(strength: number, start: number, end: number): string {
  const dur = Math.max(0.2, end - start)
  const count = Math.min(14, Math.max(4, Math.round(4 + strength * 0.5)))
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const slot = dur / count
    const jitter = pseudoRandom(i * 3 + 1) * slot * 0.5
    const t0 = start + i * slot + jitter
    const visLen = 0.06 + pseudoRandom(i * 5 + 2) * 0.22
    const t1 = Math.min(end, t0 + visLen)
    const x = pseudoRandom(i * 7 + 3)
    const thickness = 1 + Math.round(pseudoRandom(i * 11 + 4) * 2)
    const opacity = Math.min(0.9, 0.35 + strength * 0.02 + pseudoRandom(i * 13 + 5) * 0.15).toFixed(2)
    parts.push(`drawbox=x=iw*${x.toFixed(4)}:y=0:w=${thickness}:h=ih:color=white@${opacity}:t=fill:enable='between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})'`)
  }
  return parts.join(',')
}

/** Thin vertical scratch lines flashing on briefly at varying x positions
 *  over [start,end]. strength 1-20 scales scratch count/visibility. */
export async function applyScratches(file: Blob, { start, end, strength }: ScratchesOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildScratchesFilter(strength, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the scratches effect.', onProgress, ['-c:a', 'copy'])
}

export interface FilmBurnOptions { start: number; end: number; strength: number }

/**
 * Mask expression: a sin(PI*progress) hump over [start,end] drives how far
 * (as a fraction of width) the burn reaches in from the right edge — 0 at
 * both ends of the window, peaking at the midpoint, so it genuinely grows
 * then recedes rather than snapping on. The boundary itself is perturbed
 * per-row by a sine-of-Y term plus ffmpeg's per-pixel `random(1)` (not a
 * straight vertical line), so it reads as a ragged, organic edge rather than
 * a flat wash — that raggedness plus the color (real RGB tint, see
 * applyNeonGlow's module note on why hue needs RGB not luma-only screening)
 * is what makes this look different from lightLeak's flat, static warm wash.
 */
export function buildFilmBurnMaskExpr(strength: number, start: number, end: number): string {
  const dur = Math.max(0.05, end - start)
  const reach = (0.14 + strength * 0.026).toFixed(3)
  const sharpness = 5
  const progress = `sin(PI*clip((T-${start})/${dur.toFixed(3)}\\,0\\,1))`
  const edge = `(1-${reach}*${progress})`
  const jitter = `(0.05*sin(Y*0.05+T*2.4)+0.045*(random(1)-0.5))`
  return `255*clip((X/W-${edge}-${jitter})*${sharpness}\\,0\\,1)`
}

/**
 * Needs a second generated color source (like applyNeonGlow/applyLight's
 * lightLeak), so it manages its own ffmpeg session: generate the mask on a
 * split copy's luma, soften it, multiply by a solid orange source (RGB, for
 * real hue), screen that over the original in RGB, convert back to yuv420p.
 */
export async function applyFilmBurn(file: Blob, { start, end, strength }: FilmBurnOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'burn-input.mp4'
  const outputName = 'burn-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    // The color= source below is infinite (no natural EOF) and blend's
    // framesync just repeats the last frame past a shorter input rather
    // than signalling EOF, so `-shortest` alone only terminates the encode
    // because it's ALSO bounded by the main input's audio track duration —
    // true for every real upload, but not guaranteed (a silent/audio-less
    // clip would run away). An explicit `-t` from the real probed duration
    // is a cheap backstop against that either way.
    const durationSec = await probeDuration(ffmpeg, inputName)
    const w = windowClause(start, end)
    const maskExpr = buildFilmBurnMaskExpr(strength, start, end)
    const sigma = 3
    const opacity = Math.min(1, 0.55 + strength * 0.02).toFixed(3)
    const filterComplex = [
      `[0:v]split=2[main][bm]`,
      `[bm]geq=lum='${maskExpr}':cb=128:cr=128,gblur=sigma=${sigma},format=rgba[bmblur]`,
      `[1:v]format=rgba[colorsrc]`,
      `[bmblur][colorsrc]blend=all_mode=multiply[tinted]`,
      `[main]format=rgba[mainrgba]`,
      `[mainrgba][tinted]blend=all_mode=screen:all_opacity=${opacity}${w},format=rgb24,format=yuv420p[outv]`,
    ].join(';')
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-f', 'lavfi', '-i', `color=c=#ff6a1a:s=${width}x${height}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      '-t', durationSec.toFixed(3),
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the film burn effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface RetroCameraOptions { start: number; end: number; strength: number }

/**
 * Viewfinder chrome: four white L-shaped corner brackets (visible the whole
 * [start,end] window) plus a small red REC dot blinking roughly once a
 * second (its own enable clause ANDs the window with a mod(t,1) toggle) —
 * concretely different from `look`'s "camcorder" preset, which is only a
 * color-grade+noise recipe with no on-screen chrome at all. Deliberately no
 * drawtext/timestamp here: this app's drawtext needs a fetched fontfile (see
 * ensureFont above) and every existing use of that machinery goes through
 * Canvas-drawn overlays, not a live ffmpeg drawtext call — brackets/dot are
 * plain drawbox rectangles instead, no font dependency, kept tight in scope.
 */
export function buildRetroCameraFilter(strength: number, start: number, end: number): string {
  const th = Math.max(2, Math.min(6, Math.round(2 + strength * 0.2)))
  const mX = 'iw*0.045'
  const mY = 'ih*0.045'
  const hLen = 'iw*0.09'
  const vLen = 'ih*0.09'
  const w = windowClause(start, end)
  const box = (x: string, y: string, bw: string, bh: string) => `drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=white@0.85:t=fill${w}`
  const parts = [
    box(mX, mY, hLen, `${th}`),
    box(mX, mY, `${th}`, vLen),
    box(`iw-${mX}-${hLen}`, mY, hLen, `${th}`),
    box(`iw-${mX}-${th}`, mY, `${th}`, vLen),
    box(mX, `ih-${mY}-${th}`, hLen, `${th}`),
    box(mX, `ih-${mY}-${vLen}`, `${th}`, vLen),
    box(`iw-${mX}-${hLen}`, `ih-${mY}-${th}`, hLen, `${th}`),
    box(`iw-${mX}-${th}`, `ih-${mY}-${vLen}`, `${th}`, vLen),
  ]
  const dotSize = th * 3
  const dotWindow = `:enable='between(t\\,${start}\\,${end})*lt(mod(t\\,1)\\,0.5)'`
  parts.push(`drawbox=x=${mX}+${hLen}*1.3:y=${mY}*0.5:w=${dotSize}:h=${dotSize}:color=red@0.9:t=fill${dotWindow}`)
  return parts.join(',')
}

/** Viewfinder corner brackets + blinking REC dot over [start,end]. strength
 *  1-20 scales bracket thickness slightly. Meant to be combined with
 *  applyLook('camcorder'), not to replace it. */
export async function applyRetroCamera(file: Blob, { start, end, strength }: RetroCameraOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = buildRetroCameraFilter(strength, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the retro camera effect.', onProgress, ['-c:a', 'copy'])
}

// ---------- rain/snow/fog/frost ----------
// Weather effects, all pure-ffmpeg (no particle/VFX asset library exists in
// this build — these are procedural geq math, not sprite compositing).
// rain/snow reuse the drifting-point + screenLumaOnly composite dust/sparkle
// established above; fog/frost are new shapes on the same
// split+blur+blend/geq-mask techniques film_burn/neon_glow already proved
// out. All four verified via the same real @ffmpeg/core@0.12.6
// render-and-inspect harness as every other batch in this file.

/** Sixteen fixed (x0, fallPhase) rain-streak columns spread across width —
 *  each streak's vertical position wraps via `mod`, same falling-and-
 *  re-entering idea as DUST_POINTS, just faster and elongated instead of a
 *  round blob (see geqStreak below). */
const RAIN_X_POSITIONS: [number, number][] = [
  [0.04, 0.10], [0.10, 0.62], [0.16, 0.28], [0.22, 0.85], [0.28, 0.05],
  [0.34, 0.50], [0.40, 0.72], [0.46, 0.18], [0.52, 0.90], [0.58, 0.35],
  [0.64, 0.60], [0.70, 0.08], [0.76, 0.48], [0.82, 0.78], [0.88, 0.22],
  [0.94, 0.65],
]

/**
 * An anisotropic gaussian rotated by `angleDeg` off vertical — long/thin
 * along the streak direction, narrow across it — is what makes a rain drop
 * read as a STREAK rather than a round dot (dust/sparkle's isotropic
 * exp(-(dx²+dy²)) blobs, reused unrotated, looked like falling snow in an
 * early render, not rain — confirmed by rendering both side by side).
 */
function geqStreak(cxExpr: string, cyExpr: string, angleDeg: number, sigmaAlong: number, sigmaPerp: number, amp: number): string {
  const rad = (angleDeg * Math.PI) / 180
  const ca = Math.cos(rad).toFixed(4)
  const sa = Math.sin(rad).toFixed(4)
  const dx = ndxOfExpr(cxExpr)
  const dy = ndyOfExpr(cyExpr)
  const along = `((${dx})*${ca}+(${dy})*${sa})`
  const perp = `(-(${dx})*${sa}+(${dy})*${ca})`
  return `(${amp.toFixed(1)}*exp(-((${along})*(${along})/(2*${sigmaAlong}*${sigmaAlong})+(${perp})*(${perp})/(2*${sigmaPerp.toFixed(5)}*${sigmaPerp.toFixed(5)}))))`
}

export function buildRainExpr(strength: number, start: number): string {
  const fall = 2.4 + strength * 0.15
  const sigmaAlong = 0.14
  const sigmaPerp = 0.0022 + strength * 0.00015
  const amp = 130 + strength * 6
  const terms = RAIN_X_POSITIONS.map(([x0, phase]) => {
    const yExpr = `mod(${phase}+${fall}*(T-${start})\\,1.15)-0.075`
    return geqStreak(`${x0}`, yExpr, -11, sigmaAlong, sigmaPerp, amp)
  })
  return terms.join('+')
}

export interface RainOptions { start: number; end: number; strength: number }

/** Falling diagonal rain streaks over [start,end]. strength 1-20 scales
 *  streak brightness/thickness (count is fixed at 16). */
export async function applyRain(file: Blob, { start, end, strength }: RainOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildRainExpr(strength, start)
  const opacity = Math.min(1, 0.5 + strength * 0.02).toFixed(3)
  const vf = screenLumaOnly(expr, 0.6, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the rain effect.', onProgress, ['-c:a', 'copy'])
}

/** Sixteen fixed (x0, yPhase, fallSpeed, swayFreq, swayAmp, sizeMul) flakes
 *  — sizeMul varies per point so some flakes read as closer/bigger and
 *  others farther/smaller, which is what gives falling snow a sense of
 *  depth rather than one uniform layer. */
const SNOW_POINTS: [number, number, number, number, number, number][] = [
  [0.06, 0.10, 0.09, 0.35, 0.02, 1.4], [0.14, 0.55, 0.07, 0.30, 0.025, 0.7],
  [0.22, 0.80, 0.10, 0.40, 0.018, 1.1], [0.30, 0.20, 0.08, 0.28, 0.022, 0.9],
  [0.38, 0.65, 0.11, 0.45, 0.015, 1.6], [0.46, 0.05, 0.075, 0.33, 0.024, 0.6],
  [0.54, 0.45, 0.095, 0.38, 0.02, 1.2], [0.62, 0.88, 0.085, 0.31, 0.026, 0.8],
  [0.70, 0.30, 0.105, 0.42, 0.017, 1.5], [0.78, 0.70, 0.078, 0.29, 0.023, 0.65],
  [0.86, 0.12, 0.098, 0.36, 0.021, 1.3], [0.94, 0.58, 0.088, 0.34, 0.019, 0.75],
  [0.10, 0.35, 0.10, 0.44, 0.016, 1.0], [0.50, 0.92, 0.082, 0.32, 0.025, 0.85],
  [0.90, 0.40, 0.092, 0.39, 0.02, 1.15], [0.34, 0.02, 0.10, 0.41, 0.018, 0.95],
]

export function buildSnowExpr(strength: number, start: number): string {
  const ampBase = 90 + strength * 4
  const sigmaBase = 0.006 + strength * 0.0004
  const terms = SNOW_POINTS.map(([x0, y0, fall, swayF, swayA, sizeMul]) => {
    const yExpr = `mod(${y0}+${fall}*(T-${start})\\,1.0)`
    const xExpr = `${x0}+${swayA}*sin(2*PI*(${swayF}*(T-${start})))`
    const sigma = (sigmaBase * sizeMul).toFixed(5)
    const amp = (ampBase * Math.min(1.3, sizeMul)).toFixed(1)
    const dx = ndxOfExpr(xExpr)
    const dy = ndyOfExpr(yExpr)
    return `(${amp}*exp(-((${dx})*(${dx})+(${dy})*(${dy}))/(2*${sigma}*${sigma})))`
  })
  return terms.join('+')
}

export interface SnowOptions { start: number; end: number; strength: number }

/** Falling snowflakes — slow fall, gentle sway, mixed sizes for depth —
 *  over [start,end]. strength 1-20 scales brightness/size. */
export async function applySnow(file: Blob, { start, end, strength }: SnowOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const expr = buildSnowExpr(strength, start)
  const opacity = Math.min(1, 0.5 + strength * 0.02).toFixed(3)
  const vf = screenLumaOnly(expr, 1.0, opacity, start, end)
  return runOneVideoFilter(file, vf, 'Could not apply the snow effect.', onProgress, ['-c:a', 'copy'])
}

export interface FogOptions { start: number; end: number; strength: number }

/**
 * Whole-frame haze: a desaturated, slightly brightened, heavily blurred copy
 * screened back over the original — same split/blend shape as LIGHT_RECIPES'
 * glow/bloom above, with desaturation added (glow/bloom keep full color;
 * fog's whole point is washing color OUT, confirmed by a side-by-side render
 * showing glow's recipe alone reads as "bright", not "hazy", without it).
 */
export async function applyFog(file: Blob, { start, end, strength }: FogOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const w = windowClause(start, end)
  const sigma = (6 + strength * 1.8).toFixed(1)
  const sat = Math.max(0.25, 1 - strength * 0.03).toFixed(2)
  const bri = (0.12 + strength * 0.012).toFixed(3)
  const opacity = Math.min(1, 0.35 + strength * 0.03).toFixed(3)
  const vf = `split[fA][fB];[fB]eq=saturation=${sat}:brightness=${bri},gblur=sigma=${sigma}[fBl];[fA][fBl]blend=all_mode=screen:all_opacity=${opacity}${w}`
  return runOneVideoFilter(file, vf, 'Could not apply the fog effect.', onProgress, ['-c:a', 'copy'])
}

/**
 * Mask expression: brightest right at the frame edge, fading to 0 at
 * `reach` fraction of width in from the nearest edge — the Chebyshev-style
 * `min(X,W-X,Y,H-Y)` distance-to-nearest-edge (not a radial hypot like
 * vignette/lens_flare use) is what makes this hug the whole rectangular
 * border evenly instead of forming a circular vignette shape.
 */
export function buildFrostMaskExpr(strength: number): string {
  const reach = (0.12 + strength * 0.018).toFixed(4)
  const distToEdge = `(min(min(X\\,W-X)\\,min(Y\\,H-Y))/W)`
  return `255*clip(1-(${distToEdge})/${reach}\\,0\\,1)`
}

export interface FrostOptions { start: number; end: number; strength: number }

/**
 * Same generated-color-source composite as applyFilmBurn/applyNeonGlow
 * (own ffmpeg session, mask on a split copy's luma, tinted by a solid
 * color source, screened back over the original in RGB) — just with the
 * radial-from-edge mask above instead of film_burn's edge-creeping-in-
 * from-the-right one, and a pale ice-blue tint instead of orange.
 */
export async function applyFrost(file: Blob, { start, end, strength }: FrostOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'frost-input.mp4'
  const outputName = 'frost-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const durationSec = await probeDuration(ffmpeg, inputName)
    const w = windowClause(start, end)
    const maskExpr = buildFrostMaskExpr(strength)
    const sigma = (5 + strength * 1.2).toFixed(1)
    const opacity = Math.min(1, 0.5 + strength * 0.02).toFixed(3)
    const filterComplex = [
      `[0:v]split=2[main][fm]`,
      `[fm]geq=lum='${maskExpr}':cb=128:cr=128,gblur=sigma=${sigma},format=rgba[fmblur]`,
      `[1:v]format=rgba[colorsrc]`,
      `[fmblur][colorsrc]blend=all_mode=multiply[tinted]`,
      `[main]format=rgba[mainrgba]`,
      `[mainrgba][tinted]blend=all_mode=screen:all_opacity=${opacity}${w},format=rgb24,format=yuv420p[outv]`,
    ].join(';')
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-f', 'lavfi', '-i', `color=c=#dff3ff:s=${width}x${height}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      '-t', durationSec.toFixed(3),
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the frost effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export type MotionStyle = 'cameraShake' | 'wobble' | 'zoomPunch' | 'motionTrail' | 'speedRamp'

/**
 * Single-input recipes for the two simplest styles. zoomPunch and
 * speedRamp are handled separately in applyMotionFx below — zoomPunch
 * reuses the existing applyZoomPan twice (no new technique); speedRamp
 * needs its own multi-segment concat, closer in shape to applyInsertClip
 * than to a single filter chain.
 *
 * cameraShake/wobble scale the frame up first, then crop a shifting window
 * out of the enlarged image — confirmed via testing this avoids the black
 * borders a naive crop-then-pad-back approach produces. They do NOT use
 * the shared `windowClause`/`enable=` mechanism every other effect in this
 * file uses: caught by testing that `crop` with a time-varying x/y
 * expression fails to initialize when `:enable=...` is appended
 * ("Error initializing filter 'crop'") — the same class of "structural,
 * not just per-pixel" parameter conflict unsharp's msize+enable already
 * hit in an earlier sub-phase. Fixed by folding the [start,end] check
 * directly into the x/y expression itself (`if(between(t,start,end),
 * shakeFormula, restPosition)`) instead of relying on `enable=`.
 */
export const MOTION_RECIPES: Partial<Record<MotionStyle, (s: number, start: number, end: number) => string>> = {
  cameraShake: (s, start, end) => {
    const amp = Math.round(6 + s * 14)
    const swing = (amp * 0.8).toFixed(1)
    const win = `between(t\\,${start}\\,${end})`
    const xShake = `${amp}+${swing}*exp(-3*(t-${start}))*sin(2*3.14159*5*(t-${start}))`
    const yShake = `${amp}+${swing}*exp(-3*(t-${start}))*cos(2*3.14159*5*(t-${start}))`
    return `scale=iw+${amp * 2}:ih+${amp * 2},crop=w=iw-${amp * 2}:h=ih-${amp * 2}:x='if(${win}\\,${xShake}\\,${amp})':y='if(${win}\\,${yShake}\\,${amp})'`
  },
  wobble: (s, start, end) => {
    const amp = Math.round(4 + s * 8)
    const swing = (amp * 0.9).toFixed(1)
    const win = `between(t\\,${start}\\,${end})`
    const xWobble = `${amp}+${swing}*sin(2*3.14159*1.5*(t-${start}))`
    const yWobble = `${amp}+${swing}*cos(2*3.14159*1.2*(t-${start}))`
    return `scale=iw+${amp * 2}:ih+${amp * 2},crop=w=iw-${amp * 2}:h=ih-${amp * 2}:x='if(${win}\\,${xWobble}\\,${amp})':y='if(${win}\\,${yWobble}\\,${amp})'`
  },
  motionTrail: (s, start, end) => {
    const frames = Math.max(2, Math.min(8, Math.round(2 + s * 6)))
    const weights = Array.from({ length: frames }, () => 1).join(' ')
    return `tmix=frames=${frames}:weights='${weights}'${windowClause(start, end)}`
  },
}

export interface MotionOptions { start: number; end: number; style: MotionStyle; strength?: number }

export async function applyMotionFx(file: Blob, { start, end, style, strength = 0.5 }: MotionOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  if (style === 'zoomPunch') {
    const mid = start + (end - start) / 2
    const peak = 1 + strength * 0.4
    const zoomedIn = await applyZoomPan(file, { start, end: mid, fromScale: 1, toScale: peak, fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5 }, onProgress)
    return applyZoomPan(zoomedIn, { start: mid, end, fromScale: peak, toScale: 1, fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5 }, onProgress)
  }
  if (style === 'speedRamp') return applySteppedSpeedRamp(file, start, end, strength, onProgress)

  const vf = MOTION_RECIPES[style]!(strength, start, end)
  return runOneVideoFilter(file, vf, `Could not apply the ${style} effect.`, onProgress, ['-c:a', 'copy'])
}

/**
 * A STEPPED speed ramp (3 discrete segments) rather than one continuously
 * varying rate — a true frame-accurate continuous speed ramp is a much
 * larger undertaking than this batch scoped for, the same pragmatic
 * simplification an earlier sub-phase already made for a different effect
 * (blur-in) once the "ideal" continuous approach turned out unsupported.
 * Ramps slow → normal → fast, wider apart the higher the strength.
 */
/**
 * Pure filter_complex builder for applySteppedSpeedRamp, split out for the
 * same reason as buildInsertClipFilter/buildMaskFilter — unit-testable
 * without a real ffmpeg runtime.
 */
export function buildSpeedRampFilter(start: number, end: number, strength: number): { filterComplex: string; factors: number[] } {
  const dur = Math.max(0.3, end - start)
  const stepDur = dur / 3
  const factors = [Math.max(0.25, 1 - strength * 0.7), 1, Math.min(4, 1 + strength * 2.5)]
  const segs: string[] = []
  for (let i = 0; i < 3; i++) {
    const segStart = start + i * stepDur
    const segEnd = start + (i + 1) * stepDur
    segs.push(`[0:v]trim=start=${segStart}:end=${segEnd},setpts=(PTS-STARTPTS)/${factors[i]}[v${i}]`)
    segs.push(`[0:a]atrim=start=${segStart}:end=${segEnd},asetpts=PTS-STARTPTS,${atempoChain(factors[i])}[a${i}]`)
  }
  const before = `[0:v]trim=end=${start},setpts=PTS-STARTPTS[vBefore];[0:a]atrim=end=${start},asetpts=PTS-STARTPTS[aBefore]`
  const after = `[0:v]trim=start=${end},setpts=PTS-STARTPTS[vAfter];[0:a]atrim=start=${end},asetpts=PTS-STARTPTS[aAfter]`
  const refs = `[vBefore][aBefore]${[0, 1, 2].map((i) => `[v${i}][a${i}]`).join('')}[vAfter][aAfter]`
  const filterComplex = `${before};${after};${segs.join(';')};${refs}concat=n=5:v=1:a=1[outv][outa]`
  return { filterComplex, factors }
}

async function applySteppedSpeedRamp(
  file: Blob, start: number, end: number, strength: number, onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'ramp-input.mp4'
  const outputName = 'ramp-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    const { filterComplex } = buildSpeedRampFilter(start, end, strength)
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', ...VIDEO_ENCODE_ARGS, outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the speed ramp. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface MaskOptions {
  start: number
  end: number
  shape: 'circle' | 'rect'
  x: number
  y: number
  size: number
  feather: number
}

/**
 * Pure filter_complex builder for applyMask, split out for the same reason
 * as buildInsertClipFilter — unit-testable without a real ffmpeg runtime.
 *
 * Verified against a real render (not assumed): maskedmerge shows its BASE
 * stream (first input) where the mask is black, its OVERLAY stream (second
 * input) where white. The mask PNG is black-shape-on-white (see
 * renderMaskImage), so base=normal/overlay=darkened gives "normal inside the
 * shape, darkened outside" — the reverse pairing was tried first and
 * produced an inverted (dark-inside) result in testing.
 */
export function buildMaskFilter(start: number, end: number): string {
  return (
    `[0:v]split=2[base][toDark];` +
    `[toDark]eq=brightness=-0.5[dark];` +
    `[1:v]format=gray,loop=-1:size=1[maskloop];` +
    `[base][dark][maskloop]maskedmerge=enable='between(t\\,${start}\\,${end})'[outv]`
  )
}

/**
 * A "spotlight" region effect over [start,end] — normal video inside the
 * shape, darkened outside it. Not a cutout/compositing mask — for that, see
 * `applyChromaKey` below, which does key out and replace a background.
 *
 * Built on ffmpeg's `maskedmerge` filter against a static feathered shape
 * PNG (renderMaskImage, captionOverlay.ts) — needs two video inputs (the
 * darkened frame, the mask) plus the original, so unlike the single-`-vf`
 * effects above this builds its own filter_complex, closer in shape to
 * applyInsertClip than to applyBlur/applyColorAdjust.
 */
export async function applyMask(
  file: Blob,
  { start, end, shape, x, y, size, feather }: MaskOptions,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'mask-input.mp4'
  const maskName = 'mask-shape.png'
  const outputName = 'mask-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const maskPng = await renderMaskImage({ shape, x, y, size, feather }, width, height)
    await ffmpeg.writeFile(maskName, new Uint8Array(await maskPng.arrayBuffer()))

    const filterComplex = buildMaskFilter(start, end)

    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-loop', '1', '-i', maskName,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      // The looped mask PNG has no natural end (that's the point — it has
      // to cover the whole clip), so without -shortest ffmpeg never sees
      // all inputs finish and renders forever. Caught by testing: a 4s
      // clip ran past 6 real minutes of output before this was added.
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the mask/spotlight. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(maskName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- chroma key / double exposure / split screen (Batch 8 masking/compositing) ----------
//
// applyMask above only ever darkens OUTSIDE a shape — there was no real
// cutout/background-replacement in this tool. chromaKey below is the first
// actual compositing effect: it keys out a color and replaces it with a
// solid background, using the exact same "-f lavfi color= source + overlay,
// -shortest" shape applyNeonGlow already uses for its own generated color
// layer. doubleExposure and splitScreen don't need a second footage source
// at all — this is a single-clip editor with no "pick a second video" input
// anywhere, so both are built from the clip layered against ITSELF (a
// translucent overlay for doubleExposure, a hard side-by-side crop for
// splitScreen). "Feather" is not a fourth effect here — it's
// already the existing `mask` command's own feather parameter (see
// MaskOptions above), not a separate compositing primitive.

export interface ChromaKeyOptions { start: number; end: number; keyColor?: string; replacementColor?: string; strength?: number }

/**
 * Keys out `keyColor` (default a standard green-screen green) and replaces
 * it with a solid `replacementColor` background — built on ffmpeg's
 * `chromakey` filter (color+similarity+blend, the same standard set every
 * NLE's chroma key exposes), composited via the identical "color= lavfi
 * source + overlay + -shortest" shape applyNeonGlow already uses for its own
 * generated layer, just swapping the blend for a plain overlay since this
 * is a hard cutout, not a tint. strength 0-1 (default 0.5) scales
 * `similarity` (how close a pixel's color has to be to keyColor to be cut).
 */
export async function applyChromaKey(file: Blob, { start, end, keyColor = '#00ff00', replacementColor = '#000000', strength = 0.5 }: ChromaKeyOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'chromakey-input.mp4'
  const outputName = 'chromakey-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    onProgress?.({ phase: 'analyzing' })
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const w = windowClause(start, end)
    const similarity = (0.12 + strength * 0.35).toFixed(3)
    const filterComplex = [
      `[0:v]split=2[main][fx]`,
      `[fx]chromakey=color=${keyColor}:similarity=${similarity}:blend=0.05[keyed]`,
      `[1:v]scale=w=${width}:h=${height}[bg]`,
      `[bg][keyed]overlay=x=0:y=0[composited]`,
      `[main][composited]overlay=x=0:y=0${w}[outv]`,
    ].join(';')
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-i', inputName, '-f', 'lavfi', '-i', `color=c=${replacementColor}:s=${width}x${height}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '0:a',
      ...VIDEO_ENCODE_ARGS,
      '-shortest',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the chroma key effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export interface DoubleExposureOptions { start: number; end: number; strength: number }

/**
 * Superimposes a translucent, horizontally-mirrored copy of the frame over
 * itself — the same "duplicate + format=yuva420p + colorchannelmixer=aa=
 * opacity + overlay" ghosting technique the six blur-variant builders
 * (buildDirectionalBlurFilter etc, see the note above them) already use, so
 * it goes through runOneVideoFilterComplex rather than its own ffmpeg.exec
 * boilerplate. There's no second video source to superimpose a genuinely
 * DIFFERENT image the way a true photographic double exposure would; this
 * is the honest single-clip approximation — a ghosted mirror-self overlay,
 * not two different exposures. strength 1-20 scales the ghost layer's
 * opacity (roughly 0.38-0.95).
 */
export function buildDoubleExposureFilter(strength: number, start: number, end: number): string {
  const opacity = Math.min(0.95, 0.35 + strength * 0.03).toFixed(3)
  const w = windowClause(start, end)
  return [
    `[0:v]split=2[main][fx]`,
    `[fx]hflip,format=yuva420p,colorchannelmixer=aa=${opacity}[fxa]`,
    `[main][fxa]overlay=x=0:y=0${w}[outv]`,
  ].join(';')
}

export async function applyDoubleExposure(file: Blob, { start, end, strength }: DoubleExposureOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildDoubleExposureFilter(strength, start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply the double exposure effect.', onProgress)
}

export interface SplitScreenOptions { start: number; end: number }

/**
 * Hard-crops the frame into left/right halves and hstacks them back to the
 * original width — left is the untouched frame, right is a horizontally
 * mirrored copy of the SAME half (not a second time offset: pulling a
 * genuinely later moment of the same clip into the present frame would need
 * random access into not-yet-decoded future frames, which a single-pass
 * filter graph can't do). Distinct from doubleExposure on purpose: this is
 * a hard stack with a visible seam at center, not an alpha blend — the two
 * effects were kept structurally different rather than two skins on one
 * filter, per the "each effect built separately, not collapsed" brief.
 * No strength knob — like `flip`/`reverse`, this is a structural effect,
 * not an intensity one.
 */
export function buildSplitScreenFilter(start: number, end: number): string {
  const w = windowClause(start, end)
  return [
    `[0:v]split=2[main][fx]`,
    `[fx]split=2[fxa][fxb]`,
    `[fxa]crop=w=iw/2:h=ih:x=0:y=0[left]`,
    `[fxb]crop=w=iw/2:h=ih:x=0:y=0,hflip[right]`,
    `[left][right]hstack=inputs=2[stacked]`,
    `[main][stacked]overlay=x=0:y=0${w}[outv]`,
  ].join(';')
}

export async function applySplitScreen(file: Blob, { start, end }: SplitScreenOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const filterComplex = buildSplitScreenFilter(start, end)
  return runOneVideoFilterComplex(file, filterComplex, 'Could not apply the split screen effect.', onProgress)
}

export interface VideoFadeOptions { direction: 'in' | 'out'; duration: number; durationSec: number }

/** A video fade-to-black at the very start ("in") or very end ("out") of the
 *  clip — ffmpeg's own `fade` filter is inherently anchored to one edge, so
 *  there's no separate time-window to validate here beyond the fade's own
 *  length not exceeding the clip. */
export function videoFadeVf({ direction, duration, durationSec }: VideoFadeOptions): string {
  const d = Math.max(0.1, Math.min(duration, durationSec))
  const st = direction === 'in' ? 0 : Math.max(0, durationSec - d)
  return `fade=t=${direction}:st=${st}:d=${d}`
}

export async function applyVideoFade(file: Blob, opts: VideoFadeOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, videoFadeVf(opts), 'Could not fade the video.', onProgress, ['-c:a', 'copy'])
}

/** 90°/180°/270° clockwise rotation. 90/270 swap width and height. */
export function rotateVf(degrees: 90 | 180 | 270): string {
  return degrees === 90 ? 'transpose=1' : degrees === 270 ? 'transpose=2' : 'transpose=1,transpose=1'
}

export async function applyRotate(file: Blob, degrees: 90 | 180 | 270, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, rotateVf(degrees), 'Could not rotate the video.', onProgress, ['-c:a', 'copy'])
}

export function flipVf(axis: 'horizontal' | 'vertical'): string {
  return axis === 'horizontal' ? 'hflip' : 'vflip'
}

export async function applyFlip(file: Blob, axis: 'horizontal' | 'vertical', onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, flipVf(axis), 'Could not flip the video.', onProgress, ['-c:a', 'copy'])
}

/** Reverses the WHOLE clip, video and audio together. Decodes every frame
 *  into memory to do it (ffmpeg's `reverse`/`areverse` have no streaming
 *  alternative), so this is only practical on short clips — the caller
 *  should warn on long ones rather than let it hang. */
export async function applyReverse(file: Blob, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'reverse-input.mp4'
  const outputName = 'reverse-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-vf', 'reverse', '-af', 'areverse', ...VIDEO_ENCODE_ARGS, outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not reverse the video. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/** Reduces steady background hiss/hum in the original audio track via
 *  ffmpeg's own noise-reduction filter (spectral noise gate — no ML model,
 *  works best on consistent low-level noise, not on removing e.g. another
 *  person talking in the background). Video is stream-copied, untouched. */
export async function applyNoiseReduction(file: Blob, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'nr-input.mp4'
  const outputName = 'nr-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-af', 'afftdn=nf=-25', '-c:v', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not reduce noise in the audio. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

export type AudioStyle = 'equalizer' | 'reverb' | 'echo' | 'distortion' | 'bassBoost' | 'pitch' | 'mono' | 'fadeIn' | 'fadeOut' | 'voiceChanger'
export type VoicePreset = 'robot' | 'chipmunk' | 'deep'

/**
 * Three fixed voice-changer presets, reachable via the 'voiceChanger'
 * AudioStyle. Built ONLY from filters this file's own AUDIO_RECIPES already
 * rely on elsewhere — asetrate+aresample+atempo (the exact pitch-shift-with-
 * duration-compensation trick 'pitch' below uses), aecho ('reverb'/'echo'),
 * bass ('bassBoost') — rather than introducing any new, unverified audio
 * filter into this build.
 */
export const VOICE_RECIPES: Record<VoicePreset, string> = {
  chipmunk: 'asetrate=44100*1.6,aresample=44100,atempo=0.625',
  deep: 'asetrate=44100*0.62,aresample=44100,atempo=1.6129,bass=g=6',
  robot: 'asetrate=44100*0.92,aresample=44100,atempo=1.087,aecho=0.8:0.9:16:0.55',
}

/**
 * One audio filter chain per style, all built from filters independently
 * confirmed present in this deployed ffmpeg.wasm core. 'pitch' uses the
 * standard asetrate+atempo trick (change sample rate to shift pitch, then
 * atempo to compensate the resulting speed change back to normal) —
 * verified via testing that the output duration matches the input's, i.e.
 * the compensation is actually correct, not just that the command runs.
 * 'reverb' is intentionally NOT true convolution reverb — this build has
 * no such filter (not in its configure flags) — it's layered `aecho` taps
 * standing in for one, and is described to the user as approximate.
 */
export const AUDIO_RECIPES: Record<AudioStyle, (s: number, direction: 'up' | 'down', duration: number) => string> = {
  equalizer: (s) => `equalizer=f=1000:width_type=o:width=2:g=${(s * 12).toFixed(1)}`,
  reverb: (s) => `aecho=0.8:0.88:60|150|250:${(0.15 + s * 0.3).toFixed(2)}|${(0.1 + s * 0.2).toFixed(2)}|${(0.08 + s * 0.15).toFixed(2)}`,
  echo: (s) => `aecho=0.8:0.9:${Math.round(300 + s * 700)}:${(0.3 + s * 0.4).toFixed(2)}`,
  distortion: (s) => `acrusher=bits=${Math.max(2, Math.round(16 - s * 13))}:mix=${(0.3 + s * 0.6).toFixed(2)}`,
  bassBoost: (s) => `bass=g=${(s * 15).toFixed(1)}`,
  pitch: (s, direction) => {
    const ratio = direction === 'down' ? 1 - s * 0.3 : 1 + s * 0.5
    return `asetrate=44100*${ratio.toFixed(3)},aresample=44100,atempo=${(1 / ratio).toFixed(4)}`
  },
  mono: () => `pan=mono|c0=0.5*c0+0.5*c1`,
  fadeIn: (_s, _d, duration) => `afade=t=in:st=0:d=${duration}`,
  fadeOut: () => '', // computed inline in applyAudioFx — needs the clip's real total duration
  voiceChanger: () => '', // computed inline in applyAudioFx from VOICE_RECIPES[preset] — no strength/direction knob, a fixed preset like 'mono'
}

export interface AudioFxOptions {
  style: AudioStyle
  strength?: number
  direction?: 'up' | 'down'
  /** Seconds — only meaningful for fadeIn/fadeOut. For fadeOut this is the
   *  fade's own length; the clip's real total duration is probed from the
   *  file itself. */
  duration?: number
  /** Only meaningful for style 'voiceChanger' — which fixed preset to use, default 'robot'. */
  preset?: VoicePreset
}

export async function applyAudioFx(file: Blob, { style, strength = 0.5, direction = 'up', duration = 1, preset = 'robot' }: AudioFxOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))
  const inputName = 'audiofx-input.mp4'
  const outputName = 'audiofx-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  try {
    let af: string
    if (style === 'fadeOut') {
      onProgress?.({ phase: 'analyzing' })
      const totalDur = await probeDuration(ffmpeg, inputName)
      af = `afade=t=out:st=${Math.max(0, totalDur - duration)}:d=${duration}`
    } else if (style === 'voiceChanger') {
      af = VOICE_RECIPES[preset]
    } else {
      af = AUDIO_RECIPES[style](strength, direction, duration)
    }
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-af', af, '-c:v', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the ${style} audio effect. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

// ---------- Datamosh / auto color (Batch 9 misc effects) ----------
//
// Plain -vf filters, same shape as the color/look effects above. Pixel
// sorting is NOT implemented here: a real pixel sort re-orders pixels along
// a row/column by brightness, a non-local operation ffmpeg's per-pixel `geq`
// sampling can't express — it needs the frame extracted to a canvas and
// sorted in JS, the same class of real per-frame processing applyBackgroundBlur
// below uses for ML segmentation. That's a materially bigger addition than
// datamosh/autoColor/voiceChanger and was left out of this pass.

export interface DatamoshOptions { start: number; end: number; strength: number }

/**
 * Approximates the "datamosh" look — motion-smeared bleeding between frames,
 * normally caused by dropping I-frames so P-frames keep predicting off a
 * stale keyframe — using `tmix`, which blends the current frame with several
 * preceding ones. This ffmpeg.wasm build has no access to raw encoded-frame
 * (GOP/I-frame) manipulation from a filter graph, so a literal datamosh
 * isn't reachable here; tmix is the closest whole-frame approximation
 * available (a real temporal blend, not a fake blur) — same "closest
 * available, clearly approximate" reasoning as this file's own `reverb`
 * recipe. strength 1-20 maps to how many frames are blended together (2-9).
 */
export async function applyDatamosh(file: Blob, { start, end, strength }: DatamoshOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const frames = Math.max(2, Math.min(9, Math.round(2 + strength * 0.35)))
  const vf = `tmix=frames=${frames}${windowClause(start, end)}`
  return runOneVideoFilter(file, vf, 'Could not apply the datamosh effect.', onProgress, ['-c:a', 'copy'])
}

export interface AutoColorOptions { start: number; end: number; strength?: number }

/**
 * "Auto color" one-tap enhance — a fixed contrast/saturation/sharpen push
 * (curves' own increase_contrast preset, same as this file's 'hdr' look,
 * plus a moderate saturation/contrast lift and unsharp), NOT a real
 * per-frame histogram/white-balance analysis: this ffmpeg.wasm build has no
 * `normalize`/`colorlevels`-style adaptive filter confirmed available.
 * strength 0-1 (default 0.6) scales how strong the push is.
 */
export function autoColorVf({ start, end, strength = 0.6 }: AutoColorOptions): string {
  const w = windowClause(start, end)
  return `curves=preset=increase_contrast${w},eq=saturation=${(1 + strength * 0.5).toFixed(2)}:contrast=${(1 + strength * 0.15).toFixed(2)}${w},unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${(strength * 0.6).toFixed(2)}${w}`
}

export async function applyAutoColor(file: Blob, opts: AutoColorOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  return runOneVideoFilter(file, autoColorVf(opts), 'Could not auto-color the video.', onProgress, ['-c:a', 'copy'])
}

// ---------- Background-only blur ----------
//
// Everything else in this file is a plain ffmpeg filter — cheap, but blind
// to *what's in the frame*. Blurring only the background while keeping a
// person sharp needs an actual model that can tell the two apart, which
// ffmpeg does not have. This brings in MediaPipe's SelfieSegmentation — a
// small (~12MB, fetched once and cached by the browser), WebGL-accelerated
// in-browser model that does exactly that, per frame — runs it over just the
// requested [start,end] window, composites each frame on a canvas (sharp
// subject over a CSS-blurred background), then hands the composited frames
// back to ffmpeg to re-encode and splice into the untouched rest of the clip.
// Reachable only via the AI instruction path (`background_blur`, see
// aiEditCommands.ts) — no manual UI button, same as every other AI Edit
// effect in this file.

let segmenterSingleton: SelfieSegmentationType | null = null
let segmenterScriptPromise: Promise<void> | null = null

const SELFIE_SEGMENTATION_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation'

// @mediapipe/selfie_segmentation ships no real ES/CommonJS exports — the file
// it publishes just attaches `SelfieSegmentation` onto `window` as a side
// effect (that's genuinely all MediaPipe's own docs show: a <script> tag).
// Loading it through a bundler's `import()` and destructuring the result
// gives `undefined`, so `new SelfieSegmentation(...)` fails with "... is not
// a constructor" on every single call. Loading it as a real <script> tag and
// reading the constructor back off `window` is what actually makes the
// global assignment happen.
function loadSegmenterScript(): Promise<void> {
  if (segmenterScriptPromise) return segmenterScriptPromise
  segmenterScriptPromise = new Promise((resolve, reject) => {
    if ((window as unknown as { SelfieSegmentation?: unknown }).SelfieSegmentation) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = `${SELFIE_SEGMENTATION_CDN_BASE}/selfie_segmentation.js`
    script.onload = () => resolve()
    script.onerror = () => reject(new AutoEditError('Could not load the background-blur model from the CDN.'))
    document.head.appendChild(script)
  })
  return segmenterScriptPromise
}

/** Loaded once per page session, same "load once, reuse" reasoning as
 *  loadFFmpeg — re-downloading and re-initializing the model per clip would
 *  be wasteful, and nothing about the model itself is per-video state. */
async function loadSegmenter(): Promise<SelfieSegmentationType> {
  if (segmenterSingleton) return segmenterSingleton
  await loadSegmenterScript()
  const SelfieSegmentation = (window as unknown as {
    SelfieSegmentation?: new (config: { locateFile: (file: string) => string }) => SelfieSegmentationType
  }).SelfieSegmentation
  if (!SelfieSegmentation) throw new AutoEditError('Could not load the background-blur model.')
  const seg = new SelfieSegmentation({
    // The npm package ships the model/wasm files, but they're not part of
    // this app's own build output — fetched from the same package's CDN
    // build instead, the standard way to point this library at its assets
    // without bundling ~12MB of binary model weights into the app itself.
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
  })
  // modelSelection 1 = the "landscape" model: faster, tuned for wider shots
  // (more typical of video footage than the default's tight portrait crop).
  seg.setOptions({ modelSelection: 1 })
  await seg.initialize()
  segmenterSingleton = seg
  return seg
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a composited frame.'))), 'image/png')
  })
}

/**
 * Runs one frame through the segmentation model and composites the result.
 * This is MediaPipe's own reference compositing recipe for "blur the
 * background" (drawImage the mask, `source-in` to keep only the masked
 * subject pixels from the sharp frame, `destination-atop` to fill everything
 * still-transparent with a CSS-blurred copy of the same frame) — not a
 * technique invented here, since getting the compositing math right by trial
 * and error would risk exactly the kind of "assumed, not verified" mistake
 * this file's other filters (see the `hue`/`unsharp` comments above) were
 * written to avoid.
 */
async function segmentAndBlurFrame(
  seg: SelfieSegmentationType,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  radiusPx: number,
): Promise<Blob> {
  const results = await new Promise<SelfieSegmentationResults>((resolve) => {
    seg.onResults((r) => resolve(r))
    void seg.send({ image: sourceCanvas })
  })

  // The model's own mask edge is feathered a little further here — same
  // "soften the boundary rather than a hard cutout" idea the static `mask`
  // spotlight effect gets from its own PNG feather (captionOverlay.ts),
  // applied to a per-frame ML mask instead of a fixed shape.
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const maskCtx = maskCanvas.getContext('2d')
  if (!maskCtx) throw new Error('Canvas 2D is not available in this browser.')
  maskCtx.filter = 'blur(3px)'
  maskCtx.drawImage(results.segmentationMask, 0, 0, width, height)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = width
  outCanvas.height = height
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) throw new Error('Canvas 2D is not available in this browser.')

  outCtx.drawImage(maskCanvas, 0, 0, width, height)
  outCtx.globalCompositeOperation = 'source-in'
  outCtx.drawImage(results.image, 0, 0, width, height)
  outCtx.globalCompositeOperation = 'destination-atop'
  outCtx.filter = `blur(${radiusPx}px)`
  outCtx.drawImage(results.image, 0, 0, width, height)
  outCtx.filter = 'none'
  outCtx.globalCompositeOperation = 'source-over'

  return canvasToPngBlob(outCanvas)
}

export interface BackgroundBlurOptions { start: number; end: number; strength: number }

/**
 * Background-only blur over [start,end] — the subject stays sharp, only the
 * rest of the frame blurs. Strength 1-20, same range and same meaning
 * (higher = blurrier) as applyBlur's whole-frame version, just applied
 * selectively instead of to every pixel.
 *
 * Pipeline: extract the windowed section as a PNG frame sequence + its own
 * audio, run every frame through segmentAndBlurFrame, re-encode the
 * composited frames into a short clip, then splice
 * [unchanged before] + [processed middle] + [unchanged after] back into one
 * video via the same trim+concat filter_complex idiom used elsewhere in this
 * file (autoEditRemoveSilence/renderSegments/applyWindowedSpeed) — the
 * "changed" segment here comes from a second input file (the re-encoded
 * middle clip) rather than a retimed slice of the first, which is the only
 * structural difference from applyWindowedSpeed's three-segment split.
 *
 * Genuinely slower than every other effect in this file — a real per-frame
 * model pass, not one ffmpeg filter — and the model itself is an extra
 * ~12MB download the first time it runs in a session. Both are accepted,
 * explicit tradeoffs for a background-only result being possible at all
 * without a server.
 */
export async function applyBackgroundBlur(
  file: Blob,
  { start, end, strength }: BackgroundBlurOptions,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  const seg = await loadSegmenter()

  const inputName = 'bgblur-input.mp4'
  const audioName = 'bgblur-audio.aac'
  const midName = 'bgblur-mid.mp4'
  const outputName = 'bgblur-output.mp4'
  const frameNames: string[] = []
  const outFrameNames: string[] = []

  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'analyzing' })
    const duration = await probeDuration(ffmpeg, inputName)
    const { width, height } = await probeDimensions(ffmpeg, inputName)
    const fps = Math.min(30, await probeFps(ffmpeg, inputName)) // cap: a per-frame ML pass at 60fps would take twice as long for no visible benefit on a blurred background

    const winStart = Math.max(0, start)
    const winEnd = Math.min(duration, end)
    const dur = winEnd - winStart
    if (dur < 0.1) throw new AutoEditError('That time window is too short to background-blur.')

    const radiusPx = Math.max(1, Math.min(20, Math.round(strength)))

    // 1. Pull the windowed section as a PNG frame sequence...
    await ffmpeg.exec([
      '-ss', String(winStart), '-i', inputName, '-t', String(dur),
      '-vf', `fps=${fps}`, '-start_number', '1', 'bgblur-frame-%04d.png',
    ])

    // ...and its audio, separately — falls back to a silent track if the
    // clip (or just this window) has no audio, same "the video read fine,
    // audio failing almost always means no track" reasoning analyzeFootage
    // already uses, rather than failing the whole effect over it.
    try {
      await ffmpeg.exec(['-ss', String(winStart), '-i', inputName, '-t', String(dur), '-vn', '-c:a', 'aac', audioName])
    } catch {
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(dur), '-c:a', 'aac', audioName])
    }

    // 2. Segment + blur every extracted frame. +5 is slack for fps rounding
    //    (e.g. dur*fps landing just under a whole frame) — the loop stops
    //    the moment a frame is actually missing, so this only bounds how far
    //    it's willing to look, not how many frames get processed.
    const maxFrames = Math.ceil(dur * fps) + 5
    let i = 1
    while (i <= maxFrames) {
      const frameName = `bgblur-frame-${String(i).padStart(4, '0')}.png`
      let data: Uint8Array
      try {
        data = (await ffmpeg.readFile(frameName)) as Uint8Array
      } catch {
        break
      }
      frameNames.push(frameName)

      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data).buffer], { type: 'image/png' }))
      // MediaPipe's InputImage type is HTMLVideoElement | HTMLImageElement |
      // HTMLCanvasElement — no ImageBitmap — so the decoded frame is drawn
      // onto a canvas first and that canvas is what's actually sent in.
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = width
      sourceCanvas.height = height
      const sourceCtx = sourceCanvas.getContext('2d')
      if (!sourceCtx) throw new Error('Canvas 2D is not available in this browser.')
      sourceCtx.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()

      const outBlob = await segmentAndBlurFrame(seg, sourceCanvas, width, height, radiusPx)

      const outName = `bgblur-out-${String(i).padStart(4, '0')}.png`
      await ffmpeg.writeFile(outName, new Uint8Array(await outBlob.arrayBuffer()))
      outFrameNames.push(outName)

      onProgress?.({ phase: 'analyzing', fraction: i / maxFrames })
      i++
    }
    if (!outFrameNames.length) throw new AutoEditError('Could not extract any frames from that time window.')

    // 3. Re-encode the processed middle section from the composited frames.
    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec([
      '-start_number', '1', '-framerate', String(fps), '-i', 'bgblur-out-%04d.png',
      '-i', audioName,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', midName,
    ])

    // 4. Splice unchanged-before + processed-middle + unchanged-after.
    const filters: string[] = []
    const segRefs: string[] = []
    let segIdx = 0
    if (winStart > 0.05) {
      filters.push(`[0:v]trim=start=0:end=${winStart},setpts=PTS-STARTPTS[v${segIdx}]`)
      filters.push(`[0:a]atrim=start=0:end=${winStart},asetpts=PTS-STARTPTS[a${segIdx}]`)
      segRefs.push(`[v${segIdx}][a${segIdx}]`)
      segIdx++
    }
    filters.push(`[1:v]setpts=PTS-STARTPTS[v${segIdx}]`)
    filters.push(`[1:a]asetpts=PTS-STARTPTS[a${segIdx}]`)
    segRefs.push(`[v${segIdx}][a${segIdx}]`)
    segIdx++
    if (duration - winEnd > 0.05) {
      filters.push(`[0:v]trim=start=${winEnd}:end=${duration},setpts=PTS-STARTPTS[v${segIdx}]`)
      filters.push(`[0:a]atrim=start=${winEnd}:end=${duration},asetpts=PTS-STARTPTS[a${segIdx}]`)
      segRefs.push(`[v${segIdx}][a${segIdx}]`)
      segIdx++
    }
    const filterComplex = `${filters.join(';')};${segRefs.join('')}concat=n=${segIdx}:v=1:a=1[outv][outa]`

    await ffmpeg.exec([
      '-i', inputName, '-i', midName,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '[outa]',
      ...VIDEO_ENCODE_ARGS,
      outputName,
    ])

    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not blur the background. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(audioName).catch(() => {})
    await ffmpeg.deleteFile(midName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
    for (const n of frameNames) await ffmpeg.deleteFile(n).catch(() => {})
    for (const n of outFrameNames) await ffmpeg.deleteFile(n).catch(() => {})
  }
}


// ---------- Batching: many effects, ONE encode ----------
//
// Every apply*() above is self-contained: it writes the blob into ffmpeg's
// virtual FS, decodes, filters, RE-ENCODES, and reads the result back out.
// That's correct in isolation, but the AI Edit dispatcher chains them
// blob-to-blob, so a four-effect instruction pays four full generations of
// lossy h264 — and generation loss compounds. Measured on a five-effect
// chain: 37.1 dB PSNR cascading vs 48.4 dB batched against the same
// near-lossless reference, and the batched version rendered ~2x faster
// because it decodes and encodes once instead of five times.
//
// Only effects that are a plain single `-vf` chain can be spliced together
// this way. An effect is batchable ONLY if it:
//   (a) is one `-vf` string (no `-filter_complex`, no labelled nodes),
//   (b) needs no probeDimensions/probeFps/probeDuration round-trip,
//   (c) does not change the clip's duration, and
//   (d) needs no extra `-i` input (no lavfi color source, no mask PNG).
// Everything else — zoom/pan/speed, spin/rotation/swing/bounce, the
// filter_complex blurs, mask/chroma_key/film_burn/frost/neon_glow,
// background_blur, reverse, loop, and all audio-only effects — keeps its
// own individual code path, unchanged.
//
// toBatchableEffect() in the dispatcher returns null for anything not
// listed here, and null means "run it the old way". That's deliberate: a
// new effect type added later is non-batchable by default and still
// executes correctly, rather than silently vanishing from the render.

export type BatchableEffect =
  | { kind: 'crop'; aspect: CropAspect }
  | { kind: 'rotate'; degrees: 90 | 180 | 270 }
  | { kind: 'flip'; axis: 'horizontal' | 'vertical' }
  | { kind: 'blur'; opts: BlurOptions }
  | { kind: 'pixelate'; opts: PixelateOptions }
  | { kind: 'color'; opts: ColorAdjustOptions }
  | { kind: 'fade'; opts: VideoFadeOptions }
  | { kind: 'autoColor'; opts: AutoColorOptions }
  | { kind: 'wave'; opts: WaveOptions }
  | { kind: 'ripple'; opts: RippleOptions }
  | { kind: 'warp'; opts: WarpOptions }
  | { kind: 'twirl'; opts: TwirlOptions }
  | { kind: 'bulge'; opts: BulgeOptions }
  | { kind: 'squeeze'; opts: SqueezeOptions }
  | { kind: 'scratches'; opts: ScratchesOptions }
  | { kind: 'retroCamera'; opts: RetroCameraOptions }

/**
 * The `-vf` chain one batchable effect contributes. Null means "contributes
 * nothing" (only colorAdjust can do that — an adjustment set to all-neutral
 * values), in which case it's dropped from the chain rather than emitting an
 * empty filter that ffmpeg would reject.
 *
 * Exported for tests: this is the part worth verifying, since a wrong string
 * here silently changes what an effect looks like.
 */
export function batchableEffectVf(effect: BatchableEffect): string | null {
  switch (effect.kind) {
    case 'crop': return cropAspectVf(effect.aspect)
    case 'rotate': return rotateVf(effect.degrees)
    case 'flip': return flipVf(effect.axis)
    case 'blur': return blurVf(effect.opts)
    case 'pixelate': return pixelateVf(effect.opts)
    case 'color': return colorAdjustVf(effect.opts)
    case 'fade': return videoFadeVf(effect.opts)
    case 'autoColor': return autoColorVf(effect.opts)
    case 'wave': return buildWaveFilter(effect.opts.axis ?? 'horizontal', effect.opts.strength, effect.opts.start, effect.opts.end)
    case 'ripple': return buildRippleFilter(effect.opts.strength, effect.opts.x ?? 0.5, effect.opts.y ?? 0.5, effect.opts.start, effect.opts.end)
    case 'warp': return buildWarpFilter(effect.opts.strength, effect.opts.start, effect.opts.end)
    case 'twirl': return buildTwirlFilter(effect.opts.strength, effect.opts.x ?? 0.5, effect.opts.y ?? 0.5, effect.opts.start, effect.opts.end)
    case 'bulge': return buildRadialPinchFilter(effect.opts.strength, effect.opts.x ?? 0.5, effect.opts.y ?? 0.5, true, effect.opts.start, effect.opts.end)
    case 'squeeze': return buildRadialPinchFilter(effect.opts.strength, effect.opts.x ?? 0.5, effect.opts.y ?? 0.5, false, effect.opts.start, effect.opts.end)
    case 'scratches': return buildScratchesFilter(effect.opts.strength, effect.opts.start, effect.opts.end)
    case 'retroCamera': return buildRetroCameraFilter(effect.opts.strength, effect.opts.start, effect.opts.end)
  }
}

/**
 * Joins a run of batchable effects into one comma-separated `-vf` chain, in
 * the order given. Comma-joining is exactly equivalent to running them one
 * after another — each filter still carries its own `enable=` window, and
 * each still sees the previous filter's output frames — the only difference
 * is that the intermediate results never get encoded to a file and decoded
 * back. Exported for tests.
 */
export function buildBatchedEffectsVf(effects: BatchableEffect[]): string | null {
  const parts = effects.map(batchableEffectVf).filter((vf): vf is string => !!vf)
  return parts.length ? parts.join(',') : null
}

/** Renders a run of batchable effects in a single decode/filter/encode pass. */
export async function applyBatchedEffects(
  file: Blob,
  effects: BatchableEffect[],
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  const vf = buildBatchedEffectsVf(effects)
  if (!vf) return file // every effect in the run was a no-op
  return runOneVideoFilter(file, vf, 'Could not apply the requested edits.', onProgress, ['-c:a', 'copy'])
}
