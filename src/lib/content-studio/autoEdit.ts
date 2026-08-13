/**
 * Browser-only video auto-edit: cuts out silence/dead air.
 *
 * This is what "AI auto-edit" means here, and it's worth being precise about
 * that: it is a heuristic (find quiet stretches, remove them), not a model
 * that understands footage. No API key, no per-minute bill, no server —
 * ffmpeg runs as WebAssembly in the visitor's own browser via @ffmpeg/ffmpeg,
 * so the only cost is however long their machine takes to render.
 *
 * Nothing here attempts to replicate a *reference* video's editing style —
 * that would need a model watching the reference and inferring pacing/cut
 * rhythm from it, which no ffmpeg filter does and no free tool does either.
 * A reference link is stored elsewhere purely as a note for a human editor.
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg'

export class AutoEditError extends Error {}

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

let ffmpegSingleton: FFmpeg | null = null

/**
 * A crashed ffmpeg.wasm core (out-of-memory on a large clip, a fatal decode
 * error) can leave the WASM heap in a state where every LATER operation on
 * the same singleton fails too, with an opaque "ErrnoError: FS error" that
 * has nothing to do with what actually broke. Dropping the singleton after
 * any unexpected failure means the next attempt gets a clean instance
 * instead of being stuck failing until the page is reloaded.
 */
function resetFFmpeg() {
  ffmpegSingleton = null
  fontLoaded = false // the font lived in that instance's virtual FS, gone with it
}

/** Loaded once per page session — the core is ~25MB, not worth reloading per job. */
async function loadFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ])
  const ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message))

  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegSingleton = ffmpeg
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
async function ensureFont(ffmpeg: FFmpeg): Promise<string> {
  const fontFile = 'caption-font.ttf'
  if (fontLoaded) return fontFile
  const res = await fetch('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf')
  if (!res.ok) throw new AutoEditError('Could not load a font for captions/text overlays.')
  await ffmpeg.writeFile(fontFile, new Uint8Array(await res.arrayBuffer()))
  fontLoaded = true
  return fontFile
}

async function probeDuration(ffmpeg: FFmpeg, inputName: string): Promise<number> {
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

async function probeDimensions(ffmpeg: FFmpeg, inputName: string): Promise<{ width: number; height: number }> {
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
    args.push('-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', outputName)

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

/** Where the caption box sits on the frame — same five spots regardless of which render path draws it. */
function captionXY(position: CaptionPosition = 'bottom'): { x: string; y: string } {
  switch (position) {
    case 'top': return { x: '(w-text_w)/2', y: '60' }
    case 'left': return { x: '40', y: '(h-text_h)/2' }
    case 'right': return { x: 'w-text_w-40', y: '(h-text_h)/2' }
    case 'center': return { x: '(w-text_w)/2', y: '(h-text_h)/2' }
    case 'bottom': default: return { x: '(w-text_w)/2', y: 'h-th-60' }
  }
}

/**
 * Applies a manual trim (and, if set, a simple burned-in caption) — the
 * Export step, run on whatever the operator approved.
 */
export async function renderFinal(
  file: Blob,
  { trimStart = 0, trimEnd = 0, captionText = '', captionPosition = 'bottom' }:
    { trimStart?: number; trimEnd?: number; captionText?: string; captionPosition?: CaptionPosition },
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'final-input.mp4'
  const outputName = 'final-output.mp4'
  const buf = new Uint8Array(await file.arrayBuffer())
  await ffmpeg.writeFile(inputName, buf)

  try {
    const args = ['-i', inputName]
    if (trimStart > 0) args.push('-ss', String(trimStart))
    if (trimEnd > 0) args.push('-to', String(trimEnd))

    if (captionText.trim()) {
      const fontFile = await ensureFont(ffmpeg)
      const { x, y } = captionXY(captionPosition)
      args.push(
        '-vf',
        `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(captionText.trim())}':fontcolor=white:fontsize=42:` +
        `box=1:boxcolor=black@0.6:boxborderw=12:x=${x}:y=${y}`,
      )
    }
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
  captionText: string,
  onProgress?: (p: AutoEditProgress) => void,
  captionPosition: CaptionPosition = 'bottom',
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'segtrim-input.mp4'
  const outputName = 'segtrim-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

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
    let filterComplex = `${filters};${refs}concat=n=${keep.length}:v=1:a=1[outv][outa]`

    let videoOut = '[outv]'
    if (captionText.trim()) {
      const fontFile = await ensureFont(ffmpeg)
      const { x, y } = captionXY(captionPosition)
      filterComplex += `;[outv]drawtext=fontfile=${fontFile}:text='${escapeDrawtext(captionText.trim())}':` +
        `fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=12:x=${x}:y=${y}[outv2]`
      videoOut = '[outv2]'
    }

    onProgress?.({ phase: 'rendering' })
    await ffmpeg.exec(['-i', inputName, '-filter_complex', filterComplex, '-map', videoOut, '-map', '[outa]', outputName])

    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not apply the per-clip trims. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/** Escaping for ffmpeg's drawtext filter: backslash, colon and single quote are filter-syntax-significant. */
function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\n/g, ' ')
}

export interface CaptionSegment {
  start: number
  end: number
  text: string
}

export interface RenderPlanOptions {
  /** Real transcript segments (from Whisper) — each shown on screen only during its own time window. */
  captionSegments?: CaptionSegment[]
  /** App/product name — shown as a small persistent watermark, top-left. */
  brandingText?: string
  /** Referral CTA text — shown large, centered, only during ctaWindow. */
  ctaText?: string
  ctaWindow?: { start: number; end: number }
  /** A track the operator supplies themselves — nothing here sources or invents music, for licensing reasons. */
  musicBlob?: Blob
  /** 0-1, how loud the music plays under the original audio. */
  musicVolume?: number
}

/**
 * Burns the AI plan's recommendations onto an already-cut video: captions
 * synced to the real transcript, the product name as a watermark, the CTA
 * text during its window, and — only if the operator provided one — a music
 * bed mixed under the original audio. This does not cut/rearrange/trim
 * footage (autoEditRemoveSilence already did that) and does not add
 * transitions or zooms; it is the text/branding/audio layer only.
 */
export async function renderPlanned(
  file: Blob,
  opts: RenderPlanOptions,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const inputName = 'plan-input.mp4'
  const musicName = 'plan-music.mp3'
  const outputName = 'plan-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
  if (opts.musicBlob) await ffmpeg.writeFile(musicName, new Uint8Array(await opts.musicBlob.arrayBuffer()))

  try {
    onProgress?.({ phase: 'analyzing' })

    const hasText = (opts.captionSegments?.length ?? 0) > 0 || !!opts.brandingText?.trim() || !!opts.ctaText?.trim()
    const fontFile = hasText ? await ensureFont(ffmpeg) : null

    // A drawtext filter per caption line, each only visible in its own
    // window — capped so a long transcript can't build an enormous filter
    // chain (same reasoning as maxSegments elsewhere in this file).
    const drawtext: string[] = []
    for (const seg of (opts.captionSegments ?? []).slice(0, 60)) {
      const text = seg.text.trim()
      if (!text || seg.end <= seg.start) continue
      drawtext.push(
        `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(text)}':fontcolor=white:fontsize=34:box=1:boxcolor=black@0.55:` +
        `boxborderw=10:x=(w-text_w)/2:y=h-th-50:enable='between(t,${seg.start.toFixed(2)},${seg.end.toFixed(2)})'`,
      )
    }
    if (opts.brandingText?.trim()) {
      drawtext.push(
        `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(opts.brandingText.trim())}':fontcolor=white:fontsize=26:box=1:` +
        `boxcolor=black@0.5:boxborderw=8:x=24:y=24`,
      )
    }
    if (opts.ctaText?.trim() && opts.ctaWindow && opts.ctaWindow.end > opts.ctaWindow.start) {
      drawtext.push(
        `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(opts.ctaText.trim())}':fontcolor=white:fontsize=38:box=1:` +
        `boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=(h-text_h)/2:` +
        `enable='between(t,${opts.ctaWindow.start.toFixed(2)},${opts.ctaWindow.end.toFixed(2)})'`,
      )
    }
    const vf = drawtext.length ? drawtext.join(',') : null

    onProgress?.({ phase: 'rendering' })
    const args = ['-i', inputName]
    if (opts.musicBlob) {
      args.push('-i', musicName)
      const vol = opts.musicVolume ?? 0.18
      const filterComplex = [
        vf ? `[0:v]${vf}[v]` : null,
        `[1:a]volume=${vol}[music]`,
        `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[a]`,
      ].filter(Boolean).join(';')
      args.push('-filter_complex', filterComplex, '-map', vf ? '[v]' : '0:v', '-map', '[a]', '-shortest')
    } else if (vf) {
      args.push('-vf', vf)
    }
    args.push(outputName)

    await ffmpeg.exec(args)
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (!(err instanceof AutoEditError)) resetFFmpeg()
    throw new AutoEditError(`Could not render the plan onto the video. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    if (opts.musicBlob) await ffmpeg.deleteFile(musicName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}
