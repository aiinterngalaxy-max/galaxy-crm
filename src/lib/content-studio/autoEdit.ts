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
import { renderCaptionImage, renderMaskImage } from './captionOverlay'

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

async function probeFps(ffmpeg: FFmpeg, inputName: string): Promise<number> {
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
  /** One of FONT_FAMILIES (see aiEditCommands.ts) — omitted means the
   *  original fixed sans-serif look. */
  fontFamily?: string
  backgroundColor?: string
  backgroundOpacity?: number
  /** How the caption enters at its own `start` — 'slide-down' comes from
   *  above into its resting position, 'slide-up' from below, 'fade' just
   *  opacity-ins in place, 'bounce' drops in and settles with diminishing
   *  overshoots, 'shake' rattles side-to-side and settles, 'blur-in' starts
   *  out of focus and sharpens. Omitted/undefined = appears instantly, the
   *  original behavior. Has no effect on a caption with no start/end
   *  window (shown for the whole video — there's no "entrance" to animate). */
  animation?: 'slide-down' | 'slide-up' | 'fade' | 'bounce' | 'shake' | 'blur-in'
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
  ffmpeg: FFmpeg,
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
    const png = await renderCaptionImage({
      text: cap.text, position: cap.position, size: cap.size,
      color: cap.color, bold: cap.bold, outlineColor: cap.outlineColor, outlineWidth: cap.outlineWidth,
      fontFamily: cap.fontFamily, italic: cap.italic, underline: cap.underline, strikethrough: cap.strikethrough,
      backgroundColor: cap.backgroundColor, backgroundOpacity: cap.backgroundOpacity, glow: cap.glow,
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
    args.push('-map', videoMap, '-map', audioMap)
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
    args.push('-filter_complex', filterComplex.join(';'), '-map', videoOut, '-map', audioOut)
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
export async function applyCropAspect(
  file: Blob,
  aspect: CropAspect,
  onProgress?: (p: AutoEditProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'loading' })
  const ffmpeg = await loadFFmpeg()
  ffmpeg.on('progress', ({ progress }) => onProgress?.({ phase: 'rendering', fraction: progress }))

  const ratio = ASPECT_RATIOS[aspect]
  const inputName = 'crop-input.mp4'
  const outputName = 'crop-output.mp4'
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  try {
    onProgress?.({ phase: 'rendering' })
    const cropFilter =
      `crop=w='trunc(if(gt(iw/ih\\,${ratio})\\,ih*${ratio}\\,iw)/2)*2':` +
      `h='trunc(if(gt(iw/ih\\,${ratio})\\,ih\\,iw/${ratio})/2)*2':` +
      `x='(iw-out_w)/2':y='(ih-out_h)/2'`
    await ffmpeg.exec(['-i', inputName, '-vf', cropFilter, '-c:a', 'copy', outputName])
    const data = await ffmpeg.readFile(outputName)
    return new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' })
  } catch (err) {
    if (err instanceof AutoEditError) throw err
    resetFFmpeg()
    throw new AutoEditError(`Could not crop the video. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
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
    await ffmpeg.exec(['-i', inputName, '-filter_complex', filters.join(';'), '-map', '[outv]', '-map', '[outa]', outputName])
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
// All whole-FRAME effects — there is no person/object/background
// segmentation or tracking anywhere in this codebase (no such library is a
// dependency), so "blur the background but keep the person sharp" cannot be
// done here; only whole-frame blur/pixelate is offered, and the AI layer
// (aiEditCommands.ts) is instructed to say so plainly rather than silently
// applying a whole-frame blur to a person-only request.
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
    await ffmpeg.exec(['-i', inputName, '-vf', vf, ...extraArgs, outputName])
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
export async function applyBlur(file: Blob, { start, end, strength }: BlurOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const radius = Math.max(1, Math.min(20, Math.round(strength)))
  const vf = `boxblur=${radius}:1${windowClause(start, end)}`
  return runOneVideoFilter(file, vf, 'Could not blur the video.', onProgress, ['-c:a', 'copy'])
}

export interface PixelateOptions { start: number; end: number; strength: number }

/** Mosaic/pixelate over [start,end] — scales down then back up with
 *  nearest-neighbor, which is what produces the blocky look. Strength 1-20:
 *  higher = blockier (bigger downscale factor). */
export async function applyPixelate(file: Blob, { start, end, strength }: PixelateOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const factor = Math.max(2, Math.min(40, Math.round(strength * 2)))
  const w = windowClause(start, end)
  const vf = `scale=iw/${factor}:ih/${factor}${w},scale=iw*${factor}:ih*${factor}:flags=neighbor${w}`
  return runOneVideoFilter(file, vf, 'Could not pixelate the video.', onProgress, ['-c:a', 'copy'])
}

export interface ColorAdjustOptions {
  start: number
  end: number
  /** All optional — only the ones the instruction actually named are set,
   *  the rest pass through unaffected. Ranges: brightness -1..1 (0 = no
   *  change), contrast/saturation 0..3 (1 = no change), grayscale is a flag,
   *  warmth -1 (cooler/blue) .. 1 (warmer/orange), vignette 0..1 (intensity). */
  brightness?: number
  contrast?: number
  saturation?: number
  grayscale?: boolean
  warmth?: number
  vignette?: number
}

/** Combines brightness/contrast/saturation/grayscale/warmth/vignette into
 *  one filter chain, windowed together so they all apply/release at the
 *  same times. Grayscale is done by zeroing eq's own saturation rather than
 *  a separate hue filter — one fewer filter stage. */
export async function applyColorAdjust(file: Blob, opts: ColorAdjustOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const { start, end, brightness = 0, contrast = 1, saturation = 1, grayscale = false, warmth = 0, vignette = 0 } = opts
  const w = windowClause(start, end)
  const parts: string[] = []
  const effSaturation = grayscale ? 0 : saturation
  if (brightness !== 0 || contrast !== 1 || effSaturation !== 1) {
    parts.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${effSaturation}${w}`)
  }
  if (warmth !== 0) {
    // colorbalance nudges shadows/mids/highlights red-vs-blue together for a
    // simple, uniform warm/cool push rather than a full white-balance model.
    const r = (warmth * 0.4).toFixed(3)
    const b = (-warmth * 0.4).toFixed(3)
    parts.push(`colorbalance=rs=${r}:rm=${r}:rh=${r}:bs=${b}:bm=${b}:bh=${b}${w}`)
  }
  if (vignette > 0) {
    parts.push(`vignette=angle=PI/${Math.max(2, Math.round(6 / Math.max(0.01, vignette)))}${w}`)
  }
  if (!parts.length) return file // nothing actually requested to change
  return runOneVideoFilter(file, parts.join(','), 'Could not adjust the color of the video.', onProgress, ['-c:a', 'copy'])
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
 * shape, darkened outside it. Not a cutout/compositing mask (no chroma key
 * or background removal exists in this tool); this is the realistic version
 * of "circle mask"/"rectangle mask" given that constraint.
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

export interface VideoFadeOptions { direction: 'in' | 'out'; duration: number; durationSec: number }

/** A video fade-to-black at the very start ("in") or very end ("out") of the
 *  clip — ffmpeg's own `fade` filter is inherently anchored to one edge, so
 *  there's no separate time-window to validate here beyond the fade's own
 *  length not exceeding the clip. */
export async function applyVideoFade(file: Blob, { direction, duration, durationSec }: VideoFadeOptions, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const d = Math.max(0.1, Math.min(duration, durationSec))
  const st = direction === 'in' ? 0 : Math.max(0, durationSec - d)
  const vf = `fade=t=${direction}:st=${st}:d=${d}`
  return runOneVideoFilter(file, vf, 'Could not fade the video.', onProgress, ['-c:a', 'copy'])
}

/** 90°/180°/270° clockwise rotation. 90/270 swap width and height. */
export async function applyRotate(file: Blob, degrees: 90 | 180 | 270, onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = degrees === 90 ? 'transpose=1' : degrees === 270 ? 'transpose=2' : 'transpose=1,transpose=1'
  return runOneVideoFilter(file, vf, 'Could not rotate the video.', onProgress, ['-c:a', 'copy'])
}

export async function applyFlip(file: Blob, axis: 'horizontal' | 'vertical', onProgress?: (p: AutoEditProgress) => void): Promise<Blob> {
  const vf = axis === 'horizontal' ? 'hflip' : 'vflip'
  return runOneVideoFilter(file, vf, 'Could not flip the video.', onProgress, ['-c:a', 'copy'])
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
    await ffmpeg.exec(['-i', inputName, '-vf', 'reverse', '-af', 'areverse', outputName])
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

