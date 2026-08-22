// Shared between VideoStudioPage (auto-edit/export) and VideoEditWorkspacePage
// (the manual trim workspace) — both read/write the same job.clip_segments /
// trim_start / trim_end fields, so the parsing has to stay identical.

/** job.link_analysis / transcript / edit_plan / clip_segments are stored as
 *  JSON strings — a blank or malformed value just means "not generated yet",
 *  never a crash. */
export function parseJsonField<T>(raw: string | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export interface ClipSegmentRecord {
  start: number
  end: number
  label: string
  /** Extra trim applied after the merge, on top of whatever was cut before joining. */
  cutStart?: number
  cutEnd?: number
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * A raw, untouched upload (a phone/WhatsApp video especially) very often has
 * its moov atom — the index ffmpeg/Chrome need to know the file's duration
 * and seek — written at the END of the file rather than the front. Streamed
 * from a URL that's fine (the browser range-requests the tail); played from
 * a Blob URL, which is read front-to-back with no seeking, Chrome can't find
 * it and reports `duration === Infinity` instead. Every duration display in
 * this app (fmtTime) then renders that as "0:00", and Play does nothing
 * because there's no known timeline to play across — the video is actually
 * fine, playback just can't start without a duration.
 *
 * Forcing a seek near the very end makes Chrome binary-search the (locally
 * available, so effectively instant) blob to find that trailing moov atom,
 * after which `duration` resolves to the real value. Attach as
 * `onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}` on any
 * `<video>` playing a raw/untouched upload — a plain `<video controls>`
 * picks the corrected duration up on its own once the seek-back settles.
 * Pass `onFixed` when something ELSE (React state, e.g.) also needs to know
 * the real duration — reading `video.duration` synchronously right after
 * calling this would still read Infinity, since the fix completes async.
 */
export function fixInfiniteDuration(video: HTMLVideoElement, onFixed?: (duration: number) => void): void {
  if (video.duration !== Infinity) return
  const onTimeUpdate = () => {
    video.currentTime = 0
    video.removeEventListener('timeupdate', onTimeUpdate)
    onFixed?.(video.duration)
  }
  video.addEventListener('timeupdate', onTimeUpdate)
  video.currentTime = 1e101
}

export interface SubtitleCue {
  text: string
  start: number
  end: number
}

function srtTimestamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const msPart = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msPart).padStart(3, '0')}`
}

/** Cues with no real duration (start==end, as caption/text overlays that
 *  cover "the whole video" store it) get a minimum 1s window — SRT/VTT
 *  players don't render a zero-length cue. */
function cueWindow(cue: SubtitleCue): { start: number; end: number } {
  return cue.end > cue.start ? { start: cue.start, end: cue.end } : { start: cue.start, end: cue.start + 1 }
}

/** Serializes caption/text overlays to a standard .srt file — one block per
 *  cue, sequential index, HH:MM:SS,mmm timestamps. */
export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .filter((c) => c.text.trim())
    .map((c, i) => {
      const { start, end } = cueWindow(c)
      return `${i + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${c.text.trim()}\n`
    })
    .join('\n')
}

function vttTimestamp(sec: number): string {
  return srtTimestamp(sec).replace(',', '.')
}

/** Serializes caption/text overlays to a standard WebVTT file. */
export function toVtt(cues: SubtitleCue[]): string {
  const body = cues
    .filter((c) => c.text.trim())
    .map((c) => {
      const { start, end } = cueWindow(c)
      return `${vttTimestamp(start)} --> ${vttTimestamp(end)}\n${c.text.trim()}\n`
    })
    .join('\n')
  return `WEBVTT\n\n${body}`
}
