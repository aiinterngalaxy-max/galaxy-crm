import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Pencil, Send, ChevronDown } from 'lucide-react'
import type { ContentRow, VideoJob } from '@/types/content-studio'
import { ensureVideoJob, updateVideoJob, updateContent, getContent, deleteContent } from '@/lib/content-studio/queries'
import { autoEditRemoveSilence, joinClips, renderFinal, renderSegments, AutoEditError, type AutoEditProgress, type ClipInput, type SegmentTrim, type CaptionPosition, type TimedCaption } from '@/lib/content-studio/autoEdit'
import { uploadVideoFile, uploadVideoBlob, downloadVideoBlob, VideoStorageError } from '@/lib/content-studio/videoStorage'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { parseJsonField, type ClipSegmentRecord, fmtTime, fixInfiniteDuration } from '@/lib/content-studio/videoEditShared'
import { getSocialPreview, previewImageSrc, type SocialPreview } from '@/lib/content-studio/socialPreview'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

/** ffmpeg.wasm handles these; anything else is rejected after upload. */
const ACCEPTED = '.mp4,.mov,.webm,.m4v'
const ACCEPTED_EXT = ACCEPTED.split(',')

interface PendingClip {
  id: string
  file: File
  trimStart: number
  trimEnd: number
  duration: number | null
  thumbnail: string
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes / (1024 * 1024) >= 10 ? 0 : 1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function isAcceptedVideoFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXT.some((ext) => name.endsWith(ext)) || file.type.startsWith('video/')
}

/** Reads a local clip's duration and a JPEG thumbnail entirely client-side (no upload needed yet). */
function probeClip(file: File): Promise<{ duration: number; thumbnail: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    const finish = (duration: number, thumbnail: string) => {
      URL.revokeObjectURL(url)
      resolve({ duration, thumbnail })
    }
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 0) / 2)
    }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      const ctx = canvas.getContext('2d')
      let thumb = ''
      try {
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          thumb = canvas.toDataURL('image/jpeg', 0.6)
        }
      } catch {
        thumb = ''
      }
      finish(video.duration, thumb)
    }
    video.onerror = () => finish(0, '')
    video.src = url
  })
}

function progressLabel(p: AutoEditProgress | null, mode: 'edit' | 'join' | 'plan' | 'trim' = 'edit'): string {
  if (!p) return ''
  if (p.phase === 'loading') return 'Loading the video engine (first time only)…'
  if (p.phase === 'analyzing') {
    if (mode === 'join') return 'Reading clip formats…'
    if (mode === 'plan') return 'Preparing captions and branding…'
    if (mode === 'trim') return 'Applying trim & caption…'
    return 'Finding silence and dead air…'
  }
  // ffmpeg's progress fraction is time-processed ÷ estimated total duration.
  // For joinClips, that estimate comes from only the first input clip, so
  // once processing runs past that clip's length the ratio climbs past 1 —
  // real work is still happening, the percentage is just wrong. Clamped so
  // the display never claims more than "done".
  const pct = p.fraction != null ? ` ${Math.min(100, Math.round(p.fraction * 100))}%` : ''
  if (mode === 'join') return `Joining clips…${pct}`
  if (mode === 'plan') return `Rendering the styled video…${pct}`
  if (mode === 'trim') return `Rendering the trimmed preview…${pct}`
  return `Rendering…${pct}`
}

/**
 * Full page, not a modal — this is "inside" the content piece rather than a
 * popup floating over the Editing board. Its own route (content-studio/
 * editing/:id) means it also survives a refresh and can be linked to directly.
 */
export function VideoStudioPage() {
  const { id } = useParams<{ id: string }>()
  const contentId = Number(id)
  const navigate = useNavigate()
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner

  const [content, setContent] = useState<ContentRow | null>(null)
  const [job, setJob] = useState<VideoJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [editProgress, setEditProgress] = useState<AutoEditProgress | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showAutoEditInfo, setShowAutoEditInfo] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const footageSectionRef = useRef<HTMLElement>(null)
  const autoEditSectionRef = useRef<HTMLElement>(null)
  const editSectionRef = useRef<HTMLElement>(null)
  const previewSectionRef = useRef<HTMLElement>(null)
  // Unlimited pending clips, added via drag-drop or the file picker, in the
  // order they'll be joined. trimStart/trimEnd are absolute timestamps within
  // that clip's OWN timeline to keep (e.g. 5/10 keeps seconds 5-10 of THAT
  // clip) — 0/0 means "keep the whole clip". duration/thumbnail fill in once
  // the browser has read the file.
  const [pendingClips, setPendingClips] = useState<PendingClip[]>([])
  const [previewingPendingId, setPreviewingPendingId] = useState<string | null>(null)
  const [rawPreviewUrl, setRawPreviewUrl] = useState('')
  const [rawPreviewLoading, setRawPreviewLoading] = useState(false)
  const [replacingFootage, setReplacingFootage] = useState(false)
  const [joining, setJoining] = useState(false)
  const [applyingTrim, setApplyingTrim] = useState(false)
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const [muteOriginalAudio, setMuteOriginalAudio] = useState(false)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  // ---------- reference link preview (getSocialPreview) ----------
  const [refPreview, setRefPreview] = useState<SocialPreview | null>(null)
  const [refPreviewLoading, setRefPreviewLoading] = useState(false)
  const [refPreviewError, setRefPreviewError] = useState('')
  const [refImageFailed, setRefImageFailed] = useState(false)
  const hydratedJobIdRef = useRef<number | null>(null)
  const multiClipInputRef = useRef<HTMLInputElement>(null)
  const replaceClipInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const musicInputRef = useRef<HTMLInputElement>(null)
  const pendingPreviewUrlRef = useRef('')
  const rawPreviewUrlRef = useRef('')

  // The raw File and the just-edited Blob stay in memory for this session so
  // Regenerate and Export don't need to re-download the file every time —
  // only a page that was reloaded (rawFile is null) has to fetch it back first.
  const rawFileRef = useRef<File | null>(null)
  const editedBlobRef = useRef<Blob | null>(null)
  const previewUrlRef = useRef('')

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

  function setPendingPreview(url: string) {
    if (pendingPreviewUrlRef.current) URL.revokeObjectURL(pendingPreviewUrlRef.current)
    pendingPreviewUrlRef.current = url
  }

  function setRawPreview(url: string) {
    if (rawPreviewUrlRef.current) URL.revokeObjectURL(rawPreviewUrlRef.current)
    rawPreviewUrlRef.current = url
    setRawPreviewUrl(url)
  }

  useEffect(() => () => setPreview(null), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { setPendingPreview(''); setRawPreview('') }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function persist(patch: Record<string, unknown>) {
    if (!job) return null
    const saved = await updateVideoJob(job.id, patch)
    setJob(saved)
    return saved
  }

  interface CachedRefPreview { forUrl: string; preview: SocialPreview }

  /** Fetches (or re-fetches) a reference link's preview and caches it onto
   *  the job — never crashes, never hangs the UI: a failure just clears the
   *  image and shows a plain message, the actual reason logged server-side. */
  async function fetchRefPreview(url: string) {
    const trimmed = url.trim()
    if (!trimmed) { setRefPreview(null); setRefPreviewError(''); return }
    setRefPreviewError('')
    setRefImageFailed(false)
    setRefPreviewLoading(true)
    try {
      const preview = await getSocialPreview(trimmed)
      setRefPreview(preview)
      const cached: CachedRefPreview = { forUrl: trimmed, preview }
      await persist({ reference_meta: JSON.stringify(cached) }).catch(() => {}) // caching is best-effort, never blocks showing the result
    } catch (err) {
      setRefPreview(null)
      setRefPreviewError(errText(err))
    } finally {
      setRefPreviewLoading(false)
    }
  }

  /** Only re-fetches when the pasted link actually changed since the last
   *  successful lookup — the whole point of caching is never re-scraping
   *  the same URL just because the field lost focus again. */
  function refreshRefPreviewIfChanged() {
    const current = job?.reference_url?.trim() || ''
    if (!current) { setRefPreview(null); setRefPreviewError(''); return }
    const cached = parseJsonField<CachedRefPreview>(job?.reference_meta)
    if (cached?.forUrl === current) return
    fetchRefPreview(current)
  }

  // Hydrate from the cached preview (or fetch once) the first time a job
  // loads — after that, only refreshRefPreviewIfChanged (on blur) touches
  // the network, so switching tabs/re-rendering never re-fetches.
  useEffect(() => {
    if (!job || hydratedJobIdRef.current === job.id) return
    hydratedJobIdRef.current = job.id
    const cached = parseJsonField<CachedRefPreview>(job.reference_meta)
    if (cached && cached.forUrl === job.reference_url) {
      setRefPreview(cached.preview)
      setRefPreviewError('')
      setRefImageFailed(false)
    } else if (job.reference_url?.trim()) {
      fetchRefPreview(job.reference_url)
    } else {
      setRefPreview(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id])

  function handleError(err: unknown) {
    if (err instanceof VideoStorageError) {
      setError(err.message)
    } else if (err instanceof AutoEditError) {
      setError(err.message)
    } else {
      setError(errText(err))
    }
  }

  const clipSegments = useMemo(() => parseJsonField<ClipSegmentRecord[]>(job?.clip_segments), [job?.clip_segments])

  // Any number of timed captions, each in its own [start,end] window (blank
  // start+end = shown for the whole video). Falls back to the old single
  // caption_text/caption_position pair so a job saved before this existed
  // still shows its caption here instead of silently losing it.
  const captionsList = useMemo((): TimedCaption[] => {
    const parsed = parseJsonField<TimedCaption[]>(job?.captions)
    if (parsed?.length) return parsed
    if (job?.caption_text?.trim()) return [{ text: job.caption_text, position: job.caption_position }]
    return []
  }, [job?.captions, job?.caption_text, job?.caption_position])

  function onAddCaption() {
    if (!job) return
    persist({ captions: JSON.stringify([...captionsList, { text: '', start: 0, end: 0, position: 'bottom' as CaptionPosition }]) })
  }

  function onUpdateCaption(i: number, patch: Partial<TimedCaption>) {
    if (!job) return
    persist({ captions: JSON.stringify(captionsList.map((c, idx) => (idx === i ? { ...c, ...patch } : c))) })
  }

  function onRemoveCaption(i: number) {
    if (!job) return
    persist({ captions: JSON.stringify(captionsList.filter((_, idx) => idx !== i)) })
  }

  function addPendingFiles(fileList: FileList | File[] | null) {
    if (!fileList) return
    const files = Array.from(fileList).filter(isAcceptedVideoFile)
    if (!files.length) return
    const additions: PendingClip[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      trimStart: 0,
      trimEnd: 0,
      duration: null,
      thumbnail: '',
    }))
    setPendingClips((clips) => [...clips, ...additions])
    additions.forEach((clip) => {
      probeClip(clip.file).then(({ duration, thumbnail }) => {
        setPendingClips((clips) => clips.map((c) => (c.id === clip.id ? { ...c, duration, thumbnail } : c)))
      })
    })
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    addPendingFiles(e.target.files)
    e.target.value = ''
  }

  function onDropFiles(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    addPendingFiles(e.dataTransfer.files)
  }

  function onReplacePendingFile(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !isAcceptedVideoFile(file)) return
    setPendingClips((clips) => clips.map((c) => (c.id === id ? { ...c, file, trimStart: 0, trimEnd: 0, duration: null, thumbnail: '' } : c)))
    probeClip(file).then(({ duration, thumbnail }) => {
      setPendingClips((clips) => clips.map((c) => (c.id === id ? { ...c, duration, thumbnail } : c)))
    })
    if (previewingPendingId === id) { setPendingPreview(''); setPreviewingPendingId(null) }
  }

  function onRemovePendingClip(id: string) {
    setPendingClips((clips) => clips.filter((c) => c.id !== id))
    delete replaceClipInputRefs.current[id]
    if (previewingPendingId === id) { setPendingPreview(''); setPreviewingPendingId(null) }
  }

  // ---------- drag-to-reorder (before Join & Upload) ----------
  const [draggedPendingId, setDraggedPendingId] = useState<string | null>(null)
  const [dragOverPendingId, setDragOverPendingId] = useState<string | null>(null)

  function movePendingClip(draggedId: string, targetId: string) {
    if (draggedId === targetId) return
    setPendingClips((clips) => {
      const from = clips.findIndex((c) => c.id === draggedId)
      const to = clips.findIndex((c) => c.id === targetId)
      if (from === -1 || to === -1) return clips
      const next = [...clips]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  /** Drag needs a mouse held down while moving — trackpads on "tap to
   *  click" can't do that reliably, so this button-based swap is the only
   *  way some laptop users can reorder at all, not just a convenience. */
  function movePendingClipByOffset(id: string, offset: -1 | 1) {
    setPendingClips((clips) => {
      const from = clips.findIndex((c) => c.id === id)
      const to = from + offset
      if (from === -1 || to < 0 || to >= clips.length) return clips
      const next = [...clips]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function onSetPendingTrim(id: string, field: 'trimStart' | 'trimEnd', value: number) {
    setPendingClips((clips) => clips.map((c) => (c.id === id ? { ...c, [field]: Math.max(0, value) } : c)))
  }

  function onTogglePendingPreview(id: string) {
    if (previewingPendingId === id) {
      setPendingPreview('')
      setPreviewingPendingId(null)
      return
    }
    const clip = pendingClips.find((c) => c.id === id)
    if (!clip) return
    const url = URL.createObjectURL(clip.file)
    setPendingPreview(url)
    setPreviewingPendingId(id)
  }

  /**
   * One clip with no trim works exactly like the old single-file upload
   * always did. Anything else — more than one clip, or a trim on the one
   * clip — goes through joinClips (which handles a single trimmed clip fine,
   * it just skips the concat step). That result is what everything
   * downstream (analysis, transcript, auto-edit) treats as "the raw
   * footage", same as a plain upload would be.
   */
  async function onUseClips() {
    const entries = pendingClips.map((c) => ({
      file: c.file,
      trim: { start: c.trimStart, end: c.trimEnd },
      duration: c.duration,
    }))
    if (!entries.length || !job || !content) return
    setError('')
    setBusy(true)
    setUploadPct(0)
    try {
      await persist({ status: 'Uploading', error: '' })

      // trim.start/end are already the absolute [keep-from, keep-to]
      // timestamps within that clip's own timeline — exactly what
      // joinClips'/ffmpeg's trim filter wants, no conversion needed.
      const clipInputs: ClipInput[] = entries.map(({ file, trim }) => ({
        blob: file,
        trimStart: trim.start > 0 ? trim.start : undefined,
        trimEnd: trim.end > 0 ? trim.end : undefined,
      }))
      const needsProcessing = clipInputs.length > 1 || clipInputs.some((c) => c.trimStart || c.trimEnd)

      let combined: Blob
      let name: string
      if (needsProcessing) {
        setJoining(true)
        combined = await joinClips(clipInputs, setEditProgress)
        name = entries.length > 1 ? `${content.title} (${entries.length} clips joined).mp4` : entries[0].file.name
        setJoining(false)
        setEditProgress(null)
      } else {
        combined = entries[0].file
        name = entries[0].file.name
      }
      rawFileRef.current = needsProcessing ? null : entries[0].file
      setPreview(combined)

      const { driveFileId, driveViewUrl } = !needsProcessing
        ? await uploadVideoFile(entries[0].file, entries[0].file.name, (f) => setUploadPct(Math.round(f * 100)))
        : await uploadVideoBlob(combined, name)

      // Only worth recording when there's more than one clip — a segment
      // list of one doesn't offer anything the plain trim_start/trim_end
      // fields don't already, and each entry's boundary is only meaningful
      // (i.e. only maps onto the actual joined output) once joinClips has
      // actually applied that entry's own trim and concatenated it in.
      let clipSegments = ''
      if (entries.length > 1 && entries.every((e) => e.duration != null)) {
        let cursor = 0
        const segments = entries.map((e, i) => {
          const keepStart = e.trim.start > 0 ? e.trim.start : 0
          const keepEnd = e.trim.end > 0 ? Math.min(e.trim.end, e.duration!) : e.duration!
          const trimmedDuration = Math.max(0, keepEnd - keepStart)
          const seg = { start: cursor, end: cursor + trimmedDuration, label: `Clip ${i + 1}` }
          cursor += trimmedDuration
          return seg
        })
        clipSegments = JSON.stringify(segments)
      }

      const saved = await persist({
        raw_drive_id: driveFileId,
        raw_view_url: driveViewUrl,
        raw_name: name,
        status: 'Idle',
        clip_segments: clipSegments,
        // A fresh upload invalidates whatever was generated/planned before.
        edited_drive_id: '', edited_view_url: '', approved: 0, export_drive_id: '', export_view_url: '',
        link_analysis: '', transcript: '', edit_plan: '',
      })
      editedBlobRef.current = null
      setPendingPreview('')
      setPreviewingPendingId(null)
      setPendingClips([])
      setReplacingFootage(false)
      if (saved) await generate(saved, combined)
    } catch (err) {
      await persist({ status: 'Failed', error: errText(err) }).catch(() => {})
      handleError(err)
    } finally {
      setBusy(false)
      setJoining(false)
      setUploadPct(0)
      if (multiClipInputRef.current) multiClipInputRef.current.value = ''
    }
  }

  async function getRawBlob(j: VideoJob): Promise<Blob> {
    if (rawFileRef.current) return rawFileRef.current
    if (!j.raw_drive_id) throw new Error('No raw footage on this job.')
    return downloadVideoBlob(j.raw_drive_id)
  }

  async function generate(j: VideoJob, sourceOverride?: Blob) {
    if (!content) return
    setError('')
    setBusy(true)
    setEditProgress(null)
    try {
      await persist({ status: 'Generating', error: '' })
      const raw = sourceOverride ?? (await getRawBlob(j))
      const edited = await autoEditRemoveSilence(
        raw,
        { thresholdDb: j.silence_threshold_db, minSilenceSec: j.min_silence_sec },
        setEditProgress,
      )
      editedBlobRef.current = edited
      setPreview(edited)

      const { driveFileId, driveViewUrl } = await uploadVideoBlob(edited, `${content.title} (edited).mp4`)
      await persist({
        status: 'Generated',
        edited_drive_id: driveFileId,
        edited_view_url: driveViewUrl,
        approved: 0, export_drive_id: '', export_view_url: '',
      })
    } catch (err) {
      await updateVideoJob(j.id, { status: 'Failed', error: errText(err) }).catch(() => {})
      const fresh = await ensureVideoJob(contentId).catch(() => null)
      if (fresh) setJob(fresh)
      handleError(err)
    } finally {
      setBusy(false)
      setEditProgress(null)
    }
  }

  async function onRegenerate() {
    if (!job) return
    const next = await persist({ regen_count: (job.regen_count ?? 0) + 1 })
    if (next) await generate(next)
  }


  function onChangeFootage() {
    setPendingClips([])
    setReplacingFootage(true)
  }

  async function onDeleteFootage() {
    if (!job || !confirm('Delete the uploaded footage? This clears everything generated from it too — the AI plan, auto-edit and export.')) return
    rawFileRef.current = null
    editedBlobRef.current = null
    setPreview(null)
    setRawPreview('')
    setPendingClips([])
    setReplacingFootage(false)
    await persist({
      raw_drive_id: '', raw_view_url: '', raw_name: '', status: 'Idle',
      edited_drive_id: '', edited_view_url: '', approved: 0, export_drive_id: '', export_view_url: '',
      link_analysis: '', transcript: '', edit_plan: '', clip_segments: '',
    })
  }

  async function onToggleRawPreview() {
    if (rawPreviewUrl) {
      setRawPreview('')
      return
    }
    if (!job) return
    setRawPreviewLoading(true)
    try {
      const blob = await getRawBlob(job)
      setRawPreview(URL.createObjectURL(blob))
    } catch (err) {
      handleError(err)
    } finally {
      setRawPreviewLoading(false)
    }
  }

  async function onApprove() {
    if (!job?.edited_drive_id) return
    await persist({ approved: 1 })
  }

  /**
   * Trim/caption only ever got applied at Export — the preview above it kept
   * showing the un-trimmed auto-edit, so setting these fields looked like it
   * did nothing until you actually exported. This renders them onto the
   * preview immediately (same renderFinal Export uses) without uploading or
   * touching approval/export state, so what you see here is what Export
   * will produce.
   */
  async function onPreviewTrim() {
    if (!job) return
    setError('')
    setBusy(true)
    setApplyingTrim(true)
    setEditProgress(null)
    try {
      const base = editedBlobRef.current
        ?? (job.edited_drive_id ? await downloadVideoBlob(job.edited_drive_id) : null)
      if (!base) throw new Error('No auto-edited footage to preview yet.')
      const rendered = await renderFinal(
        base,
        {
          trimStart: job.trim_start, trimEnd: job.trim_end, captions: captionsList,
          musicBlob: musicFile ?? undefined, muteOriginalAudio,
        },
        setEditProgress,
      )
      setPreview(rendered)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
      setApplyingTrim(false)
      setEditProgress(null)
    }
  }

  function onSetSegmentCut(i: number, field: 'cutStart' | 'cutEnd', value: number) {
    if (!clipSegments) return
    const next = clipSegments.map((s, idx) => (idx === i ? { ...s, [field]: Math.max(0, value) } : s))
    persist({ clip_segments: JSON.stringify(next) })
  }

  /**
   * Same idea as onPreviewTrim, but per original clip — re-cuts the merged
   * video using the boundaries joinClips recorded for each source clip, so
   * "trim clip 2" works on the already-merged footage without re-uploading.
   */
  async function onPreviewSegments() {
    if (!job || !clipSegments?.length) return
    setError('')
    setBusy(true)
    setApplyingTrim(true)
    setEditProgress(null)
    try {
      const base = editedBlobRef.current
        ?? (job.edited_drive_id ? await downloadVideoBlob(job.edited_drive_id) : null)
      if (!base) throw new Error('No auto-edited footage to preview yet.')
      const rendered = await renderSegments(
        base,
        clipSegments.map((s): SegmentTrim => ({ start: s.start, end: s.end, cutStart: s.cutStart, cutEnd: s.cutEnd })),
        {
          captions: captionsList,
          musicBlob: musicFile ?? undefined, muteOriginalAudio,
        },
        setEditProgress,
      )
      setPreview(rendered)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
      setApplyingTrim(false)
      setEditProgress(null)
    }
  }

  async function onExport() {
    if (!job?.edited_drive_id || !content) return
    setBusy(true)
    setError('')
    setEditProgress(null)
    try {
      await persist({ status: 'Exporting', error: '' })
      const source = editedBlobRef.current ?? (await downloadVideoBlob(job.edited_drive_id))
      const finalBlob = clipSegments?.length
        ? await renderSegments(
            source,
            clipSegments.map((s): SegmentTrim => ({ start: s.start, end: s.end, cutStart: s.cutStart, cutEnd: s.cutEnd })),
            {
              captions: captionsList,
              musicBlob: musicFile ?? undefined, muteOriginalAudio,
            },
            setEditProgress,
          )
        : await renderFinal(
            source,
            {
              trimStart: job.trim_start, trimEnd: job.trim_end, captions: captionsList,
              musicBlob: musicFile ?? undefined, muteOriginalAudio,
            },
            setEditProgress,
          )
      setPreview(finalBlob)
      const { driveFileId, driveViewUrl } = await uploadVideoBlob(finalBlob, `${content.title} (final).mp4`)
      await persist({ status: 'Exported', export_drive_id: driveFileId, export_view_url: driveViewUrl })
    } catch (err) {
      await updateVideoJob(job.id, { status: 'Failed', error: errText(err) }).catch(() => {})
      const fresh = await ensureVideoJob(contentId).catch(() => null)
      if (fresh) setJob(fresh)
      handleError(err)
    } finally {
      setBusy(false)
      setEditProgress(null)
    }
  }

  const status = job?.status ?? 'Idle'
  const hasEdit = !!job?.edited_drive_id

  function scrollToRef(ref: React.RefObject<HTMLElement>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onPreviewVideo() {
    scrollToRef(hasEdit ? previewSectionRef : footageSectionRef)
  }

  function onEditVideo() {
    // The dedicated editing workspace works on the generated first cut — with
    // nothing generated yet, there's nothing to open, so point at Auto-Edit
    // (or Raw footage, if there isn't footage to generate from either) instead.
    if (hasEdit) {
      navigate(`/content-studio/editing/${contentId}/edit`)
      return
    }
    scrollToRef(job?.raw_drive_id ? autoEditSectionRef : footageSectionRef)
  }

  async function onSubmitForReview() {
    if (!content || !confirm(`Submit "${content.title}" for review?`)) return
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

  async function handleDelete() {
    if (!content || !confirm(`Delete "${content.title}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteContent(content.id, viewer?.name)
      navigate('/content-studio/editing')
    } catch (err) {
      setError(errText(err))
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageHeader title="Video studio" />
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          Couldn't find that content piece.{' '}
          <Link to="/content-studio/editing" className="text-gold-500 hover:underline">Back to Editing</Link>
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/content-studio/editing')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Editing
        </button>
        <button
          disabled={deleting}
          onClick={handleDelete}
          title="Delete this piece"
          aria-label="Delete this piece"
          className="inline-flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-500 hover:border-rose-700 hover:text-rose-400 disabled:opacity-50 transition-colors"
        >
          🗑 DELETE
        </button>
      </div>

      <ProjectHeader
        content={content}
        status={status}
        approved={!!job?.approved}
        editor={content?.editor}
        onPreview={onPreviewVideo}
        onEdit={onEditVideo}
        onSubmitForReview={onSubmitForReview}
        submitting={submitting}
        busy={busy}
      />

      <div className="max-w-3xl space-y-5">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60">
          <button
            onClick={() => setShowAutoEditInfo((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] font-semibold text-gray-400 hover:text-gray-200"
          >
            <span>ⓘ How Auto-Edit Works</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showAutoEditInfo ? 'rotate-180' : ''}`} />
          </button>
          {showAutoEditInfo && (
            <div className="px-4 pb-3 text-[12px] text-gray-500 border-t border-gray-800 pt-3">
              Auto-edit removes silence/dead air, then Section 4 · Edit lets you trim, add timed captions, position
              them, and mix in your own music — all in this browser via ffmpeg.wasm, no external service. It does
              not rearrange clips or add zooms/transitions/color effects yet, and it never sources music on its own
              — reusing a reference video's actual track would be a copyright problem, so music only gets added if
              you supply your own track.
            </div>
          )}
        </div>

        {submitMsg && (
          <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{submitMsg}</div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {editProgress && (
          <div className="rounded-lg border border-indigo-800/50 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-200">
            {progressLabel(editProgress, joining ? 'join' : applyingTrim ? 'trim' : 'edit')}
          </div>
        )}

        {/* ---------- 1. reference ---------- */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">🔗 Reference</h3>
          <p className="text-[11px] text-gray-600 mb-2">
            Add a website, app, social-media post, or reference video that the editor should use for this project.
          </p>
          <div className="space-y-2">
            <div className="flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-gray-600">Reference Link</label>
                <input
                  ref={referenceInputRef}
                  className="form-input"
                  placeholder="Paste URL here"
                  value={job?.reference_url ?? ''}
                  onChange={(e) => persist({ reference_url: e.target.value })}
                  onBlur={refreshRefPreviewIfChanged}
                  disabled={busy}
                />
                {refPreviewLoading && <p className="text-[10px] text-gray-500 mt-1">Loading preview…</p>}
                {refPreviewError && <p className="text-[10px] text-rose-400 mt-1">{refPreviewError}</p>}
                {refPreview?.title && <p className="text-[10px] text-gray-500 mt-1 truncate">{refPreview.title}</p>}
                {refPreview?.note && !refPreview.image && <p className="text-[10px] text-amber-500 mt-1">{refPreview.note}</p>}
              </div>
              {/* 9:16 by default (Reels/Shorts are the common case) — object-cover
                  crops rather than stretching, so it never distorts. */}
              <div className="w-16 aspect-[9/16] shrink-0 rounded-md bg-gray-800 overflow-hidden flex items-center justify-center">
                {refPreviewLoading ? (
                  <LoadingSpinner size="sm" />
                ) : refPreview?.image && !refImageFailed ? (
                  <img
                    src={previewImageSrc(refPreview.image)}
                    alt={refPreview.title || 'Reference cover'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={() => setRefImageFailed(true)}
                  />
                ) : (
                  <span className="text-[9px] text-gray-600 text-center px-1 leading-tight">No cover available</span>
                )}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-600">Reference Notes (optional)</label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Example: Use the same style, pacing, hook, or visual idea."
                value={job?.reference_notes ?? ''}
                onChange={(e) => persist({ reference_notes: e.target.value })}
                disabled={busy}
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-600 mt-1">
            Stored as a note for whoever edits this piece — not applied automatically.
          </p>
        </section>

        {/* ---------- 2. source footage ---------- */}
        <section ref={footageSectionRef}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">🎥 Raw Footage</h3>
          <p className="text-[11px] text-gray-600 mb-2">
            Upload the original video clips from the shoot. These clips will be used to create the final video.
          </p>

          {job?.raw_drive_id && !replacingFootage ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <div className="w-16 h-10 shrink-0 rounded bg-gray-800 flex items-center justify-center text-gray-600">🎬</div>
                <div className="flex-1 min-w-0 text-sm">
                  <p className="text-gray-300 truncate">✓ {job.raw_name || 'Uploaded footage'}</p>
                  <p className="text-[11px] text-gray-600">
                    {clipSegments?.length ? `${clipSegments.length} clips joined` : 'Uploaded'} · Ready
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={onToggleRawPreview} disabled={busy || rawPreviewLoading} className="btn-secondary text-xs disabled:opacity-50">
                    {rawPreviewLoading ? 'Loading…' : rawPreviewUrl ? 'Hide preview' : 'Preview'}
                  </button>
                  <button onClick={onChangeFootage} disabled={busy} className="text-xs font-semibold text-gold-500 hover:underline disabled:opacity-50">
                    Replace
                  </button>
                  <button
                    onClick={onDeleteFootage}
                    disabled={busy}
                    title="Delete this footage"
                    aria-label="Delete this footage"
                    className="inline-flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-500 hover:border-rose-700 hover:text-rose-400 disabled:opacity-50 transition-colors"
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>

              {rawPreviewUrl && (
                <video src={rawPreviewUrl} onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)} controls className="w-full max-h-72 rounded-lg border border-gray-800 bg-black" />
              )}

              {!!clipSegments?.length && (
                <div className="pl-1 space-y-0.5">
                  {clipSegments.map((seg, i) => (
                    <p key={i} className="text-[11px] text-gray-600">
                      {seg.label} · {fmtTime(seg.start)}–{fmtTime(seg.end)}
                    </p>
                  ))}
                </div>
              )}

              <a href={job.raw_view_url} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-gray-600 hover:text-gray-300 hover:underline">
                View original file
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                onClick={() => multiClipInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropFiles}
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded-lg border-2 border-dashed border-gray-700 hover:border-gold-700/60 hover:bg-gray-900/40 transition-colors px-4 py-8 text-center"
              >
                <p className="text-sm font-semibold text-gray-300">+ Add Raw Footage</p>
                <p className="text-[11px] text-gray-600 mt-1">Drag & drop video files here, or click to browse</p>
                <input
                  ref={multiClipInputRef}
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  className="hidden"
                  onChange={onPickFiles}
                />
              </div>

              {pendingClips.length > 0 && (
                <div className="space-y-2">
                  {pendingClips.map((clip, i) => (
                    <div
                      key={clip.id}
                      draggable={pendingClips.length > 1}
                      onDragStart={(e) => { setDraggedPendingId(clip.id); e.dataTransfer.effectAllowed = 'move' }}
                      onDragEnd={() => { setDraggedPendingId(null); setDragOverPendingId(null) }}
                      onDragOver={(e) => { if (draggedPendingId) { e.preventDefault(); setDragOverPendingId(clip.id) } }}
                      onDragLeave={() => setDragOverPendingId((id) => (id === clip.id ? null : id))}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (draggedPendingId) movePendingClip(draggedPendingId, clip.id)
                        setDraggedPendingId(null)
                        setDragOverPendingId(null)
                      }}
                      title={pendingClips.length > 1 ? 'Drag to reorder' : undefined}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        draggedPendingId === clip.id
                          ? 'opacity-40 border-gold-600'
                          : dragOverPendingId === clip.id && draggedPendingId && draggedPendingId !== clip.id
                            ? 'border-gold-400 border-2'
                            : 'border-gray-800'
                      } ${pendingClips.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {pendingClips.length > 1 && (
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button
                              onClick={() => movePendingClipByOffset(clip.id, -1)}
                              disabled={busy || i === 0}
                              title="Move up"
                              className="text-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-500 leading-none px-1"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => movePendingClipByOffset(clip.id, 1)}
                              disabled={busy || i === pendingClips.length - 1}
                              title="Move down"
                              className="text-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-500 leading-none px-1"
                            >
                              ▼
                            </button>
                          </div>
                        )}
                        <div className="w-14 h-9 shrink-0 rounded bg-gray-800 overflow-hidden flex items-center justify-center text-gray-600 text-xs">
                          {clip.thumbnail ? (
                            <img src={clip.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : '🎬'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 truncate">
                            {pendingClips.length > 1 ? `${i + 1}. ` : ''}{clip.file.name}
                          </p>
                          <p className="text-[11px] text-gray-600">
                            {clip.duration != null ? fmtTime(clip.duration) : 'Reading…'} · {fmtSize(clip.file.size)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => onTogglePendingPreview(clip.id)} disabled={busy} className="text-[11px] font-semibold text-gray-400 hover:text-gray-200 disabled:opacity-50">
                            {previewingPendingId === clip.id ? 'Hide' : 'Preview'}
                          </button>
                          <button onClick={() => replaceClipInputRefs.current[clip.id]?.click()} disabled={busy} className="text-[11px] font-semibold text-gold-500 hover:underline disabled:opacity-50">
                            Replace
                          </button>
                          <button onClick={() => onRemovePendingClip(clip.id)} disabled={busy} className="text-[11px] font-semibold text-rose-400 hover:underline disabled:opacity-50">
                            Delete
                          </button>
                          <input
                            ref={(el) => { replaceClipInputRefs.current[clip.id] = el }}
                            type="file"
                            accept={ACCEPTED}
                            className="hidden"
                            onChange={(e) => onReplacePendingFile(clip.id, e)}
                          />
                        </div>
                      </div>

                      {previewingPendingId === clip.id && pendingPreviewUrlRef.current && (
                        <video src={pendingPreviewUrlRef.current} onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)} controls className="mt-2 w-full max-h-56 rounded-lg border border-gray-800 bg-black" />
                      )}

                      <details className="mt-2">
                        <summary className="text-[10px] text-gray-600 cursor-pointer hover:text-gray-400">Trim this clip (optional)</summary>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-600">Trim start (sec)</label>
                            <input
                              type="number" min="0" step="0.5"
                              className="form-input py-1 text-xs"
                              value={clip.trimStart || ''}
                              placeholder="0"
                              onChange={(e) => onSetPendingTrim(clip.id, 'trimStart', Number(e.target.value) || 0)}
                              disabled={busy}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-600">Trim end (sec, blank = full)</label>
                            <input
                              type="number" min="0" step="0.5"
                              className="form-input py-1 text-xs"
                              value={clip.trimEnd || ''}
                              placeholder={clip.duration != null ? clip.duration.toFixed(1) : '0'}
                              onChange={(e) => onSetPendingTrim(clip.id, 'trimEnd', Number(e.target.value) || 0)}
                              disabled={busy}
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {pendingClips.length > 0 && (
                  <button
                    onClick={() => multiClipInputRef.current?.click()}
                    disabled={busy}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    + Add Another Clip
                  </button>
                )}
                <button
                  onClick={onUseClips}
                  disabled={busy || !pendingClips.length}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {joining
                    ? 'Joining clips…'
                    : busy && uploadPct > 0
                      ? `Uploading… ${uploadPct}%`
                      : busy
                        ? 'Uploading…'
                        : pendingClips.length > 1
                          ? `Join ${pendingClips.length} clips & upload`
                          : 'Upload footage'}
                </button>
                {job?.raw_drive_id && (
                  <button
                    onClick={() => { setPendingClips([]); setReplacingFootage(false) }}
                    disabled={busy}
                    className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ---------- auto-edit result: edit / change / regenerate ---------- */}
        {job?.raw_drive_id && (
          <section ref={autoEditSectionRef}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">🤖 Auto-Edit</h3>
            <p className="text-[11px] text-gray-600 mb-3">
              Let AI create a first cut from your uploaded footage. You can edit the result manually afterwards.
            </p>

            {status === 'Generating' ? (
              <p className="text-sm text-gray-400">Auto-editing… this runs in your browser, so a long clip can take a few minutes. Don't close this tab.</p>
            ) : !hasEdit ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
                  <span className="rounded-md border border-gray-800 px-2 py-1">Raw Footage</span>
                  <span aria-hidden="true">→</span>
                  <span className="rounded-md border border-gray-800 px-2 py-1">AI creates first cut</span>
                  <span aria-hidden="true">→</span>
                  <span className="rounded-md border border-gray-800 px-2 py-1">You edit the result</span>
                </div>
                <button
                  onClick={() => job && generate(job)}
                  disabled={busy}
                  className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  ✨ Generate First Cut
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-400">✓ First Cut Generated</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={onPreviewVideo} disabled={busy} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5" /> Preview
                  </button>
                  <button onClick={onEditVideo} disabled={busy} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
                    <Pencil className="w-3.5 h-3.5" /> Edit Video
                  </button>
                  <button onClick={onRegenerate} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                    ↻ Regenerate
                  </button>
                  <button onClick={onChangeFootage} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                    Change Footage
                  </button>
                </div>
                {job && job.regen_count > 0 && (
                  <p className="text-[11px] text-gray-600">regenerated {job.regen_count}×</p>
                )}
              </div>
            )}

            <details className="mt-3">
              <summary className="text-[11px] text-gray-600 cursor-pointer hover:text-gray-400">Advanced settings (silence sensitivity)</summary>
              <div className="mt-2 grid grid-cols-2 gap-3 rounded-lg border border-gray-800 p-3 text-sm">
                <div>
                  <label className="form-label">Silence threshold (dB)</label>
                  <input
                    type="number" step="1" className="form-input"
                    value={job?.silence_threshold_db ?? -30}
                    onChange={(e) => persist({ silence_threshold_db: Number(e.target.value) || -30 })}
                    disabled={busy}
                  />
                  <p className="text-[11px] text-gray-600 mt-1">Louder rooms need this closer to 0.</p>
                </div>
                <div>
                  <label className="form-label">Minimum gap (seconds)</label>
                  <input
                    type="number" step="0.1" min="0.1" className="form-input"
                    value={job?.min_silence_sec ?? 0.5}
                    onChange={(e) => persist({ min_silence_sec: Number(e.target.value) || 0.5 })}
                    disabled={busy}
                  />
                  <p className="text-[11px] text-gray-600 mt-1">Shorter cuts more; catches natural pauses too.</p>
                </div>
              </div>
            </details>
          </section>
        )}

        {/* ---------- 4. edit the result ---------- */}
        {hasEdit && (
          <section ref={editSectionRef}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">4 · Edit</h3>
            <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-gray-800 p-3">
              {clipSegments?.length ? (
                <div className="sm:col-span-2 space-y-2">
                  <label className="form-label">Per-clip trim (this footage was joined from {clipSegments.length} clips)</label>
                  {clipSegments.map((seg, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-end rounded-lg border border-gray-800 p-2">
                      <span className="text-xs text-gray-400">
                        {seg.label}
                        <span className="block text-[10px] text-gray-600">{fmtTime(seg.start)}–{fmtTime(seg.end)}</span>
                      </span>
                      <div>
                        <label className="text-[10px] text-gray-600">Cut more from start (sec)</label>
                        <input
                          type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                          value={seg.cutStart || ''} placeholder="0"
                          onChange={(e) => onSetSegmentCut(i, 'cutStart', Number(e.target.value) || 0)}
                          disabled={busy}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-600">Cut more from end (sec)</label>
                        <input
                          type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                          value={seg.cutEnd || ''} placeholder="0"
                          onChange={(e) => onSetSegmentCut(i, 'cutEnd', Number(e.target.value) || 0)}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div>
                    <label className="form-label">Trim start (seconds)</label>
                    <input
                      type="number" min="0" step="0.1" className="form-input"
                      value={job?.trim_start ?? 0}
                      onChange={(e) => persist({ trim_start: Number(e.target.value) || 0 })}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label className="form-label">Trim end (seconds, 0 = none)</label>
                    <input
                      type="number" min="0" step="0.1" className="form-input"
                      value={job?.trim_end ?? 0}
                      onChange={(e) => persist({ trim_end: Number(e.target.value) || 0 })}
                      disabled={busy}
                    />
                  </div>
                </>
              )}
              <div className="sm:col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="form-label mb-0">Captions (burned into the export)</label>
                  <button onClick={onAddCaption} disabled={busy} className="text-xs font-semibold text-gold-500 hover:underline disabled:opacity-50">
                    + Add caption
                  </button>
                </div>
                {captionsList.length === 0 && (
                  <p className="text-[11px] text-gray-600">
                    None yet — add one for the whole video, or several with their own time windows (e.g. one for the
                    first 5 seconds, a different one in the middle, another at the end).
                  </p>
                )}
                {captionsList.map((c, i) => (
                  <div key={i} className="rounded-lg border border-gray-800 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <textarea
                        className="form-input flex-1" rows={2}
                        value={c.text}
                        onChange={(e) => onUpdateCaption(i, { text: e.target.value })}
                        disabled={busy}
                      />
                      <button onClick={() => onRemoveCaption(i)} disabled={busy} className="text-xs text-rose-400 hover:underline disabled:opacity-50 shrink-0">
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-600">Show from (sec, blank = start)</label>
                        <input
                          type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                          value={c.start || ''} placeholder="0"
                          onChange={(e) => onUpdateCaption(i, { start: Number(e.target.value) || 0 })}
                          disabled={busy}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-600">Show until (sec, blank = end)</label>
                        <input
                          type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                          value={c.end || ''} placeholder="end"
                          onChange={(e) => onUpdateCaption(i, { end: Number(e.target.value) || 0 })}
                          disabled={busy}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['top', 'bottom', 'left', 'right', 'center'] as CaptionPosition[]).map((pos) => (
                        <button
                          key={pos}
                          onClick={() => onUpdateCaption(i, { position: pos })}
                          disabled={busy}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors disabled:opacity-50 ${
                            (c.position ?? 'bottom') === pos
                              ? 'bg-gold-500/20 border-gold-700/60 text-gold-500'
                              : 'border-gray-800 bg-gray-900 text-gray-500 hover:border-gray-700 hover:text-gray-300'
                          }`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="sm:col-span-2">
                <label className="form-label">Background music (optional — your own licensed track)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => musicInputRef.current?.click()}
                    disabled={busy}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    {musicFile ? 'Replace track' : '+ Add music'}
                  </button>
                  {musicFile && (
                    <>
                      <span className="text-xs text-gray-400 truncate">{musicFile.name}</span>
                      <button onClick={() => setMusicFile(null)} disabled={busy} className="text-xs text-rose-400 hover:underline disabled:opacity-50">
                        Remove
                      </button>
                    </>
                  )}
                  <input
                    ref={musicInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => setMusicFile(e.target.files?.[0] ?? null)}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-2">
                    <input
                      type="checkbox"
                      checked={muteOriginalAudio}
                      onChange={(e) => setMuteOriginalAudio(e.target.checked)}
                      disabled={busy || !musicFile}
                    />
                    Mute the clip's own sound (use only this track)
                  </label>
                </div>
                <p className="text-[11px] text-gray-600 mt-1">
                  Nothing here sources music automatically — reusing a reference video's actual track would be a
                  copyright problem, so this only mixes in a track you supply. Unchecked, it mixes under the clip's
                  own audio; checked, it replaces it entirely.
                </p>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button
                  onClick={clipSegments?.length ? onPreviewSegments : onPreviewTrim}
                  disabled={busy}
                  className="btn-secondary text-xs disabled:opacity-50"
                >
                  {clipSegments?.length ? 'Preview per-clip trims & caption' : 'Preview trim & caption'}
                </button>
                <p className="text-[11px] text-gray-600">
                  Regenerate (above) and the AI plan don't apply these — they're only ever used at Export. Click this
                  to see them applied to the preview below before you export for real.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ---------- 5. preview → approve → export ---------- */}
        {hasEdit && (
          <section ref={previewSectionRef}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">5 · Preview → Approve → Export</h3>

            {previewUrl ? (
              <video src={previewUrl} onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)} controls className="w-full max-h-96 rounded-lg border border-gray-800 bg-black" />
            ) : (
              <p className="text-sm text-gray-500">
                {job?.edited_view_url ? (
                  <a href={job.edited_view_url} target="_blank" rel="noreferrer" className="text-gold-500 hover:underline">
                    View file
                  </a>
                ) : (
                  'No preview available yet.'
                )}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={onApprove}
                disabled={busy || !canApprove || !!job?.approved}
                className={`text-xs font-semibold rounded-md border px-3 py-1.5 transition-colors disabled:opacity-50 ${
                  job?.approved
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-gray-700 text-gray-300 hover:border-emerald-600 hover:text-emerald-400'
                }`}
              >
                {job?.approved ? '✓ Approved' : 'Approve'}
              </button>

              <button
                onClick={onExport}
                disabled={busy || !job?.approved || status === 'Exporting'}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {status === 'Exporting' ? 'Exporting…' : 'Export'}
              </button>

              {!canApprove && <span className="text-[11px] text-gray-600">Only the Owner can approve.</span>}
              {!job?.approved && canApprove && <span className="text-[11px] text-gray-600">Approve before exporting.</span>}
            </div>

            {job?.export_view_url && (
              <a
                href={job.export_view_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm font-semibold text-gold-500 hover:underline"
              >
                ↓ Open final video
              </a>
            )}
          </section>
        )}
      </div>
    </Page>
  )
}

function ProjectHeader({
  content,
  status,
  approved,
  editor,
  onPreview,
  onEdit,
  onSubmitForReview,
  submitting,
  busy,
}: {
  content: ContentRow | null
  status: string
  approved: boolean
  editor?: string
  onPreview: () => void
  onEdit: () => void
  onSubmitForReview: () => void
  submitting: boolean
  busy: boolean
}) {
  const subtitle = [content?.brand_name, content?.platform, content?.format].filter(Boolean).join(' ')
  return (
    <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <span aria-hidden="true">🎬</span> {content?.title ?? 'Video studio'}
          </h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <dt className="text-gray-600">Status:</dt>
              <dd><StatusStrip status={status} approved={approved} /></dd>
            </div>
            {editor && (
              <div className="flex items-center gap-1.5">
                <dt className="text-gray-600">Editor:</dt>
                <dd className="text-white font-medium">{editor}</dd>
              </div>
            )}
            {content?.platform && (
              <div className="flex items-center gap-1.5">
                <dt className="text-gray-600">Platform:</dt>
                <dd className="text-white font-medium">{content.platform}</dd>
              </div>
            )}
            {content?.format && (
              <div className="flex items-center gap-1.5">
                <dt className="text-gray-600">Format:</dt>
                <dd className="text-white font-medium">{content.format}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button onClick={onPreview} className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> Preview Video
          </button>
          <button onClick={onEdit} className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit Video
          </button>
          <button
            onClick={onSubmitForReview}
            disabled={busy || submitting}
            className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusStrip({ status, approved }: { status: string; approved: boolean }) {
  const tone: Record<string, string> = {
    Idle: 'bg-gray-800 text-gray-400',
    Uploading: 'bg-sky-900/60 text-sky-300',
    Generating: 'bg-indigo-900/60 text-indigo-300',
    Generated: 'bg-violet-900/60 text-violet-300',
    Exporting: 'bg-amber-900/60 text-amber-300',
    Exported: 'bg-emerald-900/60 text-emerald-300',
    Failed: 'bg-rose-900/60 text-rose-300',
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`badge ${tone[status] ?? tone.Idle}`}>{status}</span>
      {approved && <span className="badge bg-emerald-900/60 text-emerald-300">Approved</span>}
    </div>
  )
}
