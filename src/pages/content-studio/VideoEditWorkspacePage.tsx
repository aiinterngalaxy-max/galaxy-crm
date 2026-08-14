import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Volume2, Maximize, Scissors, Undo2, Redo2, Save, Send } from 'lucide-react'
import type { ContentRow, VideoJob } from '@/types/content-studio'
import { ensureVideoJob, updateVideoJob, updateContent, getContent } from '@/lib/content-studio/queries'
import { renderFinal, renderSegments, AutoEditError, type AutoEditProgress, type SegmentTrim } from '@/lib/content-studio/autoEdit'
import { downloadFromDrive, GoogleDriveError } from '@/lib/googleDrive'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { parseJsonField, type ClipSegmentRecord, fmtTime } from '@/lib/content-studio/videoEditShared'
import { Page } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** One block on the timeline — either an original clip within a joined video
 *  (from job.clip_segments) or, for a single-source job, the whole video. */
interface EditClip {
  id: string
  label: string
  start: number
  end: number
  cutStart: number
  cutEnd: number
  deleted: boolean
}

function progressLabel(p: AutoEditProgress | null): string {
  if (!p) return 'Preview'
  if (p.phase === 'loading') return 'Loading engine…'
  if (p.phase === 'analyzing') return 'Analyzing…'
  const pct = p.fraction != null ? ` ${Math.min(100, Math.round(p.fraction * 100))}%` : ''
  return `Rendering…${pct}`
}

/**
 * The manual editing workspace, opened from "Edit Video" once a first cut
 * exists. It works ON TOP of that generated video — the same edited_drive_id
 * blob — and saves into the same trim_start/trim_end (single-clip) or
 * clip_segments (joined-clip) fields Section 4 of VideoStudioPage already
 * reads/writes, via the same renderFinal/renderSegments used by Preview and
 * Export there. No new storage, no new render pipeline — just a clearer UI
 * over the trim state that already existed.
 */
export function VideoEditWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const contentId = Number(id)
  const navigate = useNavigate()
  const { viewer } = useViewer()

  const [content, setContent] = useState<ContentRow | null>(null)
  const [job, setJob] = useState<VideoJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!contentId) {
      setNotFound(true)
      setLoading(false)
      return
    }
    let cancelled = false
    Promise.all([getContent(contentId), ensureVideoJob(contentId)])
      .then(([c, j]) => {
        if (cancelled) return
        if (!c) {
          setNotFound(true)
          return
        }
        setContent(c)
        setJob(j)
      })
      .catch((e) => !cancelled && setError(errText(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [contentId])

  function handleError(err: unknown) {
    if (err instanceof GoogleDriveError) {
      setError(`${err.message} (Google Drive access is asked for once per browser session.)`)
    } else if (err instanceof AutoEditError) {
      setError(err.message)
    } else {
      setError(errText(err))
    }
  }

  const hasEdit = !!job?.edited_drive_id

  // ---------- load the actual generated video ----------
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const sourceBlobRef = useRef<Blob | null>(null)
  const sourceUrlRef = useRef('')

  useEffect(() => {
    if (!job?.edited_drive_id) return
    let cancelled = false
    setSourceLoading(true)
    downloadFromDrive(job.edited_drive_id)
      .then((blob) => {
        if (cancelled) return
        sourceBlobRef.current = blob
        const url = URL.createObjectURL(blob)
        sourceUrlRef.current = url
        setSourceUrl(url)
      })
      .catch((err) => !cancelled && handleError(err))
      .finally(() => !cancelled && setSourceLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.edited_drive_id])

  useEffect(() => () => { if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current) }, [])

  // ---------- player ----------
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function onVolumeChange(vol: number) {
    setVolume(vol)
    if (videoRef.current) videoRef.current.volume = vol
  }

  function toggleFullscreen() {
    videoRef.current?.requestFullscreen?.()
  }

  // ---------- clip/timeline state ----------
  const clipSegments = useMemo(() => parseJsonField<ClipSegmentRecord[]>(job?.clip_segments), [job?.clip_segments])
  const [mode, setMode] = useState<'segments' | 'single'>('single')
  const [clips, setClips] = useState<EditClip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<EditClip[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [dirty, setDirty] = useState(false)

  // Multi-clip: seed the timeline straight from the segments joinClips recorded.
  useEffect(() => {
    if (!job || clips.length) return
    if (!clipSegments?.length) return
    const init: EditClip[] = clipSegments.map((s, i) => ({
      id: `seg-${i}`,
      label: s.label || `Clip ${i + 1}`,
      start: s.start,
      end: s.end,
      cutStart: s.cutStart ?? 0,
      cutEnd: s.cutEnd ?? 0,
      deleted: false,
    }))
    setMode('segments')
    setClips(init)
    setHistory([init])
    setHistoryIndex(0)
    setSelectedId(init[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, clipSegments])

  // Single-source: one block for the whole video, needs the real duration
  // (not stored on the job) before it can be drawn — waits for the <video>.
  useEffect(() => {
    if (!job || clips.length) return
    if (clipSegments?.length) return
    if (duration <= 0) return
    const init: EditClip[] = [{
      id: 'whole',
      label: content?.title || 'Clip 1',
      start: 0,
      end: duration,
      cutStart: job.trim_start || 0,
      cutEnd: job.trim_end > 0 ? Math.max(0, duration - job.trim_end) : 0,
      deleted: false,
    }]
    setMode('single')
    setClips(init)
    setHistory([init])
    setHistoryIndex(0)
    setSelectedId('whole')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, clipSegments, duration, content])

  const selectedClip = clips.find((c) => c.id === selectedId) ?? null
  const aliveCount = clips.filter((c) => !c.deleted).length

  function commit(next: EditClip[]) {
    setClips(next)
    setHistory((h) => [...h.slice(0, historyIndex + 1), next])
    setHistoryIndex((i) => i + 1)
    setDirty(true)
  }

  function setCutStart(clipId: string, value: number) {
    commit(clips.map((c) => (c.id === clipId ? { ...c, cutStart: Math.max(0, value) } : c)))
  }

  function setCutEnd(clipId: string, value: number) {
    commit(clips.map((c) => (c.id === clipId ? { ...c, cutEnd: Math.max(0, value) } : c)))
  }

  function deleteClip(clipId: string) {
    if (aliveCount <= 1) return
    const next = clips.map((c) => (c.id === clipId ? { ...c, deleted: true } : c))
    commit(next)
    if (selectedId === clipId) setSelectedId(next.find((c) => !c.deleted)?.id ?? null)
  }

  function undo() {
    if (historyIndex <= 0) return
    const i = historyIndex - 1
    setHistoryIndex(i)
    setClips(history[i])
    setDirty(true)
  }

  function redo() {
    if (historyIndex >= history.length - 1) return
    const i = historyIndex + 1
    setHistoryIndex(i)
    setClips(history[i])
    setDirty(true)
  }

  // ---------- preview render (uses the exact same render functions Export uses) ----------
  const [previewUrl, setPreviewUrl] = useState('')
  const previewUrlRef = useRef('')
  const [rendering, setRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState<AutoEditProgress | null>(null)

  function setPreview(blob: Blob | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    if (!blob) {
      previewUrlRef.current = ''
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(blob)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }

  useEffect(() => () => setPreview(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function renderPreview() {
    if (!sourceBlobRef.current || !clips.length) return
    setError('')
    setRendering(true)
    setRenderProgress(null)
    try {
      const alive = clips.filter((c) => !c.deleted)
      let blob: Blob
      if (mode === 'segments') {
        const segs: SegmentTrim[] = alive.map((c) => ({ start: c.start, end: c.end, cutStart: c.cutStart, cutEnd: c.cutEnd }))
        blob = await renderSegments(sourceBlobRef.current, segs, {}, setRenderProgress)
      } else {
        const c = alive[0]
        const trimStart = c.cutStart
        const trimEnd = c.cutEnd > 0 ? Math.max(0.1, c.end - c.cutEnd) : 0
        blob = await renderFinal(sourceBlobRef.current, { trimStart, trimEnd }, setRenderProgress)
      }
      setPreview(blob)
    } catch (err) {
      handleError(err)
    } finally {
      setRendering(false)
      setRenderProgress(null)
    }
  }

  // ---------- save (writes the same fields Section 4 / Export already use) ----------
  const [saving, setSaving] = useState(false)

  async function saveChanges() {
    if (!job || !clips.length) return
    setError('')
    setSaving(true)
    try {
      let saved: VideoJob | null
      if (mode === 'segments') {
        const alive = clips.filter((c) => !c.deleted)
        const payload: ClipSegmentRecord[] = alive.map((c) => ({
          start: c.start, end: c.end, label: c.label,
          cutStart: c.cutStart || undefined, cutEnd: c.cutEnd || undefined,
        }))
        saved = await updateVideoJob(job.id, { clip_segments: JSON.stringify(payload) })
      } else {
        const c = clips[0]
        const trimStart = c.cutStart
        const trimEnd = c.cutEnd > 0 ? Math.max(0, c.end - c.cutEnd) : 0
        saved = await updateVideoJob(job.id, { trim_start: trimStart, trim_end: trimEnd })
      }
      if (saved) setJob(saved)
      setDirty(false)
    } catch (err) {
      handleError(err)
    } finally {
      setSaving(false)
    }
  }

  // ---------- submit for review (same stage move as the project header) ----------
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  async function submitForReview() {
    if (!content) return
    if (!confirm(`Submit "${content.title}" for review?`)) return
    setSubmitting(true)
    setSubmitMsg('')
    try {
      const updated = await updateContent(content.id, { stage: 'Review' }, viewer?.name)
      setContent(updated)
      setSubmitMsg('Submitted for review.')
    } catch (err) {
      setError(errText(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      </Page>
    )
  }

  if (notFound || !content) {
    return (
      <Page>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          Couldn't find that content piece.
        </div>
      </Page>
    )
  }

  const subtitle = [content.brand_name, content.platform, content.format].filter(Boolean).join(' ')

  return (
    <Page>
      <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 sm:px-5 sm:py-4">
        <button
          onClick={() => navigate(`/content-studio/editing/${contentId}`)}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Project
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <span aria-hidden="true">🎬</span> {content.title}
            </h1>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <span className="badge bg-indigo-900/60 text-indigo-300">Status: Editing</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {!hasEdit ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-10 text-center text-sm text-gray-400">
          No generated video yet.{' '}
          <button onClick={() => navigate(`/content-studio/editing/${contentId}`)} className="text-gold-500 hover:underline">
            Go back and generate a first cut
          </button>{' '}
          before editing.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="min-w-0 space-y-3">
            {/* ---------- video preview ---------- */}
            <div className="rounded-lg border border-gray-800 bg-black overflow-hidden flex items-center justify-center">
              {sourceLoading && !sourceUrl ? (
                <div className="aspect-video w-full flex items-center justify-center"><LoadingSpinner /></div>
              ) : (
                <video
                  ref={videoRef}
                  src={previewUrl || sourceUrl}
                  className="w-full max-h-[60vh] bg-black"
                  onTimeUpdate={(e) => setCurTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 px-1">
              <button onClick={togglePlay} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {playing ? 'Pause' : 'Play'}
              </button>
              <span className="text-xs text-gray-500 tabular-nums">{fmtTime(curTime)} / {fmtTime(duration)}</span>
              <div className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-gray-500" />
                <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => onVolumeChange(Number(e.target.value))} className="w-20" />
              </div>
              <button onClick={toggleFullscreen} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                <Maximize className="w-3.5 h-3.5" /> Fullscreen
              </button>
              {previewUrl && <span className="text-[11px] text-amber-400">Showing an unsaved preview</span>}
            </div>

            {/* ---------- timeline ---------- */}
            {clips.length > 0 && (
              <div className="rounded-lg border border-gray-800 p-3 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Video</p>
                  <div className="flex gap-1">
                    {clips.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        disabled={c.deleted}
                        style={{ flexGrow: Math.max(0.3, c.end - c.start) }}
                        className={`h-10 rounded-md border text-[11px] font-semibold truncate px-2 transition-colors ${
                          c.deleted
                            ? 'opacity-30 border-gray-800 bg-gray-900 text-gray-600 line-through'
                            : selectedId === c.id
                              ? 'border-gold-600 bg-gold-500/20 text-gold-400'
                              : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Audio</p>
                  <div className="h-6 rounded-md border border-gray-800 bg-gray-900/60 flex items-center px-2 text-[10px] text-gray-600">
                    Original clip audio
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ---------- editing tools ---------- */}
          <aside className="space-y-3">
            <div className="rounded-lg border border-gray-800 p-3">
              <h3 className="text-xs font-bold text-gray-300 mb-2 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5" /> Trim
              </h3>
              {selectedClip ? (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-600">Trim start (sec)</label>
                    <input
                      type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                      value={selectedClip.cutStart || ''} placeholder="0"
                      onChange={(e) => setCutStart(selectedClip.id, Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-600">Trim end (sec cut off)</label>
                    <input
                      type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                      value={selectedClip.cutEnd || ''} placeholder="0"
                      onChange={(e) => setCutEnd(selectedClip.id, Number(e.target.value) || 0)}
                    />
                  </div>
                  <button
                    onClick={() => deleteClip(selectedClip.id)}
                    disabled={aliveCount <= 1}
                    title={aliveCount <= 1 ? "Can't delete the only clip" : undefined}
                    className="text-[11px] font-semibold text-rose-400 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Delete this clip
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-gray-600">Select a clip on the timeline to trim it.</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-800 p-3 opacity-50">
              <h3 className="text-xs font-bold text-gray-400 mb-1">📝 Captions</h3>
              <p className="text-[10px] text-gray-600">Coming next</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-3 opacity-50">
              <h3 className="text-xs font-bold text-gray-400 mb-1">🔤 Text</h3>
              <p className="text-[10px] text-gray-600">Coming next</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-3 opacity-50">
              <h3 className="text-xs font-bold text-gray-400 mb-1">🎵 Music</h3>
              <p className="text-[10px] text-gray-600">Coming next</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-3">
              <h3 className="text-xs font-bold text-gray-300 mb-2">🔊 Audio</h3>
              <label className="text-[10px] text-gray-600">Preview volume</label>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => onVolumeChange(Number(e.target.value))} className="w-full" />
              <p className="text-[10px] text-gray-600 mt-1">Adjusts playback here — doesn't change the exported file.</p>
            </div>
          </aside>
        </div>
      )}

      {hasEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
          <button onClick={undo} disabled={historyIndex <= 0} className="btn-secondary text-xs disabled:opacity-40 inline-flex items-center gap-1.5">
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} className="btn-secondary text-xs disabled:opacity-40 inline-flex items-center gap-1.5">
            <Redo2 className="w-3.5 h-3.5" /> Redo
          </button>
          <button onClick={saveChanges} disabled={saving || !dirty} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={renderPreview} disabled={rendering} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> {rendering ? progressLabel(renderProgress) : 'Preview'}
          </button>
          <button onClick={submitForReview} disabled={submitting} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5 ml-auto">
            <Send className="w-3.5 h-3.5" /> {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      )}
      {submitMsg && <p className="mt-2 text-xs text-emerald-400">{submitMsg}</p>}
    </Page>
  )
}
