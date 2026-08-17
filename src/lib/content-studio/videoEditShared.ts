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
