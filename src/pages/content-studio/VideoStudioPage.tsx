import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { ContentRow, VideoJob } from '@/types/content-studio'
import { ensureVideoJob, updateVideoJob, getContent, deleteContent } from '@/lib/content-studio/queries'
import { autoEditRemoveSilence, joinClips, renderFinal, renderSegments, AutoEditError, type AutoEditProgress, type ClipInput, type SegmentTrim, type CaptionPosition, type TimedCaption } from '@/lib/content-studio/autoEdit'
import { uploadToDrive, uploadBlobToDrive, downloadFromDrive, GoogleDriveError } from '@/lib/googleDrive'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

/** job.link_analysis / transcript / edit_plan are stored as JSON strings — a
 *  blank or malformed value just means "not generated yet", never a crash. */
function parseJsonField<T>(raw: string | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

interface ClipSegmentRecord {
  start: number
  end: number
  label: string
  /** Extra trim applied after the merge, on top of whatever was cut before joining. */
  cutStart?: number
  cutEnd?: number
}

/** ffmpeg.wasm handles these; anything else is rejected after upload. */
const ACCEPTED = '.mp4,.mov,.webm,.m4v'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Burned-in captions use a plain typeface (Roboto) for the video export —
 * it has no color-emoji glyphs, and ffmpeg.wasm's drawtext has no fallback
 * font to reach for when a glyph is missing. freetype just skips characters
 * it can't draw, so an emoji doesn't error, it just silently isn't there.
 * This flags it up front instead of letting someone find out after exporting.
 */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}️]/u
function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text)
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
  const [showOptions, setShowOptions] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clipSlots, setClipSlots] = useState<(File | null)[]>([null, null, null, null])
  // start/end here are absolute timestamps within that clip's OWN timeline to
  // keep — e.g. start=5,end=10 keeps seconds 5-10, same as scrubbing a
  // trimmer to those two points. 0/0 means "keep the whole clip".
  const [clipTrims, setClipTrims] = useState<{ start: number; end: number }[]>(
    Array.from({ length: 4 }, () => ({ start: 0, end: 0 })),
  )
  const [clipDurations, setClipDurations] = useState<(number | null)[]>([null, null, null, null])
  const [replacingFootage, setReplacingFootage] = useState(false)
  const [joining, setJoining] = useState(false)
  const [applyingTrim, setApplyingTrim] = useState(false)
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const [muteOriginalAudio, setMuteOriginalAudio] = useState(false)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const clipInputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null])
  const musicInputRef = useRef<HTMLInputElement>(null)

  // The raw File and the just-edited Blob stay in memory for this session so
  // Regenerate and Export don't need to re-download from Drive every time —
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

  useEffect(() => () => setPreview(null), []) // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleError(err: unknown) {
    if (err instanceof GoogleDriveError) {
      setError(`${err.message} (Google Drive access is asked for once per browser session.)`)
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

  function onPickClip(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setClipSlots((slots) => {
      const next = [...slots]
      next[i] = file
      return next
    })
    setClipTrims((trims) => {
      const next = [...trims]
      next[i] = { start: 0, end: 0 }
      return next
    })
    setClipDurations((durs) => {
      const next = [...durs]
      next[i] = null
      return next
    })
    if (file) {
      // Read via a plain <video> element rather than ffmpeg — just the
      // duration, so it's not worth loading the ~25MB ffmpeg core for it.
      const url = URL.createObjectURL(file)
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        setClipDurations((durs) => {
          const next = [...durs]
          next[i] = probe.duration
          return next
        })
        URL.revokeObjectURL(url)
      }
      probe.src = url
    }
  }

  function onRemoveClip(i: number) {
    setClipSlots((slots) => {
      const next = [...slots]
      next[i] = null
      return next
    })
    setClipTrims((trims) => {
      const next = [...trims]
      next[i] = { start: 0, end: 0 }
      return next
    })
    setClipDurations((durs) => {
      const next = [...durs]
      next[i] = null
      return next
    })
    if (clipInputRefs.current[i]) clipInputRefs.current[i]!.value = ''
  }

  function onSetClipTrim(i: number, field: 'start' | 'end', value: number) {
    setClipTrims((trims) => {
      const next = [...trims]
      next[i] = { ...next[i], [field]: Math.max(0, value) }
      return next
    })
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
    const entries = clipSlots
      .map((file, i) => (file ? { file, trim: clipTrims[i], duration: clipDurations[i] } : null))
      .filter((e): e is { file: File; trim: { start: number; end: number }; duration: number | null } => !!e)
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
        ? await uploadToDrive(entries[0].file, (f) => setUploadPct(Math.round(f * 100)))
        : await uploadBlobToDrive(combined, name)

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
      setClipSlots([null, null, null, null])
      setClipTrims(Array.from({ length: 4 }, () => ({ start: 0, end: 0 })))
      setClipDurations([null, null, null, null])
      setReplacingFootage(false)
      if (saved) await generate(saved, combined)
    } catch (err) {
      await persist({ status: 'Failed', error: errText(err) }).catch(() => {})
      handleError(err)
    } finally {
      setBusy(false)
      setJoining(false)
      setUploadPct(0)
      clipInputRefs.current.forEach((el) => { if (el) el.value = '' })
    }
  }

  async function getRawBlob(j: VideoJob): Promise<Blob> {
    if (rawFileRef.current) return rawFileRef.current
    if (!j.raw_drive_id) throw new Error('No raw footage on this job.')
    return downloadFromDrive(j.raw_drive_id)
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

      const { driveFileId, driveViewUrl } = await uploadBlobToDrive(edited, `${content.title} (edited).mp4`)
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
    setClipSlots([null, null, null, null])
    setClipTrims(Array.from({ length: 4 }, () => ({ start: 0, end: 0 })))
    setClipDurations([null, null, null, null])
    setReplacingFootage(true)
  }

  async function onDeleteFootage() {
    if (!job || !confirm('Delete the uploaded footage? This clears everything generated from it too — the AI plan, auto-edit and export.')) return
    rawFileRef.current = null
    editedBlobRef.current = null
    setPreview(null)
    setClipSlots([null, null, null, null])
    setReplacingFootage(false)
    await persist({
      raw_drive_id: '', raw_view_url: '', raw_name: '', status: 'Idle',
      edited_drive_id: '', edited_view_url: '', approved: 0, export_drive_id: '', export_view_url: '',
      link_analysis: '', transcript: '', edit_plan: '', clip_segments: '',
    })
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
        ?? (job.edited_drive_id ? await downloadFromDrive(job.edited_drive_id) : null)
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
        ?? (job.edited_drive_id ? await downloadFromDrive(job.edited_drive_id) : null)
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
      const source = editedBlobRef.current ?? (await downloadFromDrive(job.edited_drive_id))
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
      const { driveFileId, driveViewUrl } = await uploadBlobToDrive(finalBlob, `${content.title} (final).mp4`)
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

      <PageHeader
        title={content?.title ?? 'Video studio'}
        subtitle={content?.brand_name}
        right={<StatusStrip status={status} approved={!!job?.approved} />}
      />

      <div className="max-w-3xl space-y-5">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 text-[12px] text-gray-500">
          Auto-edit removes silence/dead air, then Section 4 · Edit lets you trim, add timed captions, position them,
          and mix in your own music — all in this browser via ffmpeg.wasm, no external service. It does not
          rearrange clips or add zooms/transitions/color effects yet, and it never sources music on its own —
          reusing a reference video's actual track would be a copyright problem, so music only gets added if you
          supply your own track.
        </div>

        {error && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {editProgress && (
          <div className="rounded-lg border border-indigo-800/50 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-200">
            {progressLabel(editProgress, joining ? 'join' : applyingTrim ? 'trim' : 'edit')}
          </div>
        )}

        {/* ---------- 1. referral / app link ---------- */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">1 · Referral / app link</h3>
          <input
            ref={referenceInputRef}
            className="form-input"
            placeholder="https://… — the app/product link this piece is promoting"
            value={job?.reference_url ?? ''}
            onChange={(e) => persist({ reference_url: e.target.value })}
            disabled={busy}
          />
          <p className="text-[11px] text-gray-600 mt-1">
            Stored as a note for whoever edits this piece — not applied automatically.
          </p>
        </section>

        {/* ---------- 2. source footage ---------- */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">2 · Raw footage</h3>
          {job?.raw_drive_id && !replacingFootage ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm min-w-0">
                <p className="text-gray-300 truncate">{job.raw_name || 'Uploaded footage'}</p>
                <a href={job.raw_view_url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-gray-300 hover:underline">
                  View in Google Drive
                </a>
              </div>
              <button onClick={onChangeFootage} disabled={busy} className="text-xs font-semibold text-gold-500 hover:underline disabled:opacity-50">
                Replace footage
              </button>
              <button
                onClick={onDeleteFootage}
                disabled={busy}
                title="Delete this footage"
                aria-label="Delete this footage"
                className="inline-flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-500 hover:border-rose-700 hover:text-rose-400 disabled:opacity-50 transition-colors"
              >
                🗑 DELETE
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-600">
                Add up to 4 clips — filmed as separate takes or angles. Trim start/end below are timestamps within
                that clip's own footage (e.g. 5 to 10 keeps seconds 5-10 of THAT clip), then they're joined in order
                into one video. Just one clip, with no trim, works exactly like a normal upload.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {clipSlots.map((file, i) => (
                  <div key={i} className="rounded-lg border-2 border-dashed border-gray-700 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-gray-500">Clip {i + 1}{i > 0 ? ' (optional)' : ''}</span>
                      {file && (
                        <button onClick={() => onRemoveClip(i)} disabled={busy} className="text-[11px] text-rose-400 hover:underline disabled:opacity-50">
                          Remove
                        </button>
                      )}
                    </div>
                    {file ? (
                      <>
                        <p className="text-xs text-gray-300 truncate">{file.name}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-600">Trim start (sec)</label>
                            <input
                              type="number" min="0" step="0.5"
                              className="form-input py-1 text-xs"
                              value={clipTrims[i]?.start || ''}
                              placeholder="0"
                              onChange={(e) => onSetClipTrim(i, 'start', Number(e.target.value) || 0)}
                              disabled={busy}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-600">Trim end (sec, blank = full)</label>
                            <input
                              type="number" min="0" step="0.5"
                              className="form-input py-1 text-xs"
                              value={clipTrims[i]?.end || ''}
                              placeholder={clipDurations[i] != null ? clipDurations[i]!.toFixed(1) : '0'}
                              onChange={(e) => onSetClipTrim(i, 'end', Number(e.target.value) || 0)}
                              disabled={busy}
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-1">Keeps this clip's own {clipTrims[i]?.start || 0}s–{clipTrims[i]?.end || (clipDurations[i]?.toFixed(1) ?? '…')}s.</p>
                        {clipDurations[i] == null ? (
                          <p className="text-[10px] text-gray-600 mt-1">Reading length…</p>
                        ) : (
                          <p className="text-[10px] text-gray-600 mt-1">{clipDurations[i]!.toFixed(1)}s total</p>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => clipInputRefs.current[i]?.click()}
                        disabled={busy}
                        className="text-xs text-gray-500 hover:text-gold-500 disabled:opacity-50"
                      >
                        + Add clip
                      </button>
                    )}
                    <input
                      ref={(el) => { clipInputRefs.current[i] = el }}
                      type="file"
                      accept={ACCEPTED}
                      className="hidden"
                      onChange={(e) => onPickClip(i, e)}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={onUseClips}
                  disabled={busy || !clipSlots.some(Boolean)}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {joining
                    ? 'Joining clips…'
                    : busy && uploadPct > 0
                      ? `Uploading… ${uploadPct}%`
                      : busy
                        ? 'Uploading…'
                        : clipSlots.filter(Boolean).length > 1
                          ? `Join ${clipSlots.filter(Boolean).length} clips & upload`
                          : 'Upload footage'}
                </button>
                {job?.raw_drive_id && (
                  <button
                    onClick={() => { setClipSlots([null, null, null, null]); setReplacingFootage(false) }}
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
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">3 · Auto-edit</h3>
              <button onClick={() => setShowOptions((s) => !s)} className="text-xs text-gray-500 hover:text-gray-300">
                {showOptions ? 'Hide options' : 'Options'}
              </button>
            </div>

            {showOptions && (
              <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg border border-gray-800 p-3 text-sm">
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
            )}

            {status === 'Generating' ? (
              <p className="text-sm text-gray-400">Auto-editing… this runs in your browser, so a long clip can take a few minutes. Don't close this tab.</p>
            ) : !hasEdit ? (
              <button
                onClick={() => job && generate(job)}
                disabled={busy}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Generate edit
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={onRegenerate} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                  ↻ Regenerate
                </button>
                <button onClick={onChangeFootage} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                  ⤒ Change footage
                </button>
                {job && job.regen_count > 0 && (
                  <span className="text-[11px] text-gray-600 self-center">regenerated {job.regen_count}×</span>
                )}
              </div>
            )}
          </section>
        )}

        {/* ---------- 4. edit the result ---------- */}
        {hasEdit && (
          <section>
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
                    {hasEmoji(c.text) && (
                      <p className="text-[11px] text-amber-500">
                        ⚠ Emoji won't appear in the exported video — the burned-in text font can't draw them, so
                        they're silently skipped. Rewrite with words if you need something there.
                      </p>
                    )}
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
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">5 · Preview → Approve → Export</h3>

            {previewUrl ? (
              <video src={previewUrl} controls className="w-full max-h-96 rounded-lg border border-gray-800 bg-black" />
            ) : (
              <p className="text-sm text-gray-500">
                {job?.edited_view_url ? (
                  <a href={job.edited_view_url} target="_blank" rel="noreferrer" className="text-gold-500 hover:underline">
                    View in Drive
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
                ↓ Open final video in Google Drive
              </a>
            )}
          </section>
        )}
      </div>
    </Page>
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
