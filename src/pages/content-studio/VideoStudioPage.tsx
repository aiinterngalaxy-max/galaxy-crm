import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { ContentRow, VideoJob } from '@/types/content-studio'
import { ensureVideoJob, updateVideoJob, getContent, deleteContent } from '@/lib/content-studio/queries'
import { autoEditRemoveSilence, renderFinal, AutoEditError, type AutoEditProgress } from '@/lib/content-studio/autoEdit'
import { uploadToDrive, uploadBlobToDrive, downloadFromDrive, GoogleDriveError } from '@/lib/googleDrive'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

/** ffmpeg.wasm handles these; anything else is rejected after upload. */
const ACCEPTED = '.mp4,.mov,.webm,.m4v'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function progressLabel(p: AutoEditProgress | null): string {
  if (!p) return ''
  if (p.phase === 'loading') return 'Loading the video engine (first time only)…'
  if (p.phase === 'analyzing') return 'Finding silence and dead air…'
  const pct = p.fraction != null ? ` ${Math.round(p.fraction * 100)}%` : ''
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
  const fileRef = useRef<HTMLInputElement>(null)

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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !job || !content) return
    setError('')
    rawFileRef.current = file
    setPreview(file)

    setBusy(true)
    setUploadPct(0)
    try {
      await persist({ status: 'Uploading', error: '', raw_name: file.name })
      const { driveFileId, driveViewUrl } = await uploadToDrive(file, (f) => setUploadPct(Math.round(f * 100)))
      const saved = await persist({
        raw_drive_id: driveFileId,
        raw_view_url: driveViewUrl,
        status: 'Idle',
        // A fresh upload invalidates whatever was generated/approved before.
        edited_drive_id: '', edited_view_url: '', approved: 0, export_drive_id: '', export_view_url: '',
      })
      editedBlobRef.current = null
      if (saved) await generate(saved, file)
    } catch (err) {
      await persist({ status: 'Failed', error: errText(err) }).catch(() => {})
      handleError(err)
    } finally {
      setBusy(false)
      setUploadPct(0)
      if (fileRef.current) fileRef.current.value = ''
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
    fileRef.current?.click()
  }

  async function onApprove() {
    if (!job?.edited_drive_id) return
    await persist({ approved: 1 })
  }

  async function onExport() {
    if (!job?.edited_drive_id || !content) return
    setBusy(true)
    setError('')
    setEditProgress(null)
    try {
      await persist({ status: 'Exporting', error: '' })
      const source = editedBlobRef.current ?? (await downloadFromDrive(job.edited_drive_id))
      const finalBlob = await renderFinal(
        source,
        { trimStart: job.trim_start, trimEnd: job.trim_end, captionText: job.caption_text },
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
          Auto-edit removes silence and dead air — it does not copy any other video's style. Footage is stored in
          your own Google Drive (no size limit); the editing itself runs in this browser, no external service, no
          API key.
        </div>

        {error && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {editProgress && (
          <div className="rounded-lg border border-indigo-800/50 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-200">
            {progressLabel(editProgress)}
          </div>
        )}

        {/* ---------- reference (informational only) ---------- */}
        <section>
          <label className="form-label">Reference link (optional)</label>
          <input
            className="form-input"
            placeholder="https://… — a video whose style you want the editor to aim for"
            value={job?.reference_url ?? ''}
            onChange={(e) => persist({ reference_url: e.target.value })}
            disabled={busy}
          />
          <p className="text-[11px] text-gray-600 mt-1">
            Shown to whoever does the Edit step below as a guide — not applied automatically.
          </p>
        </section>

        {/* ---------- 1. source footage ---------- */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">1 · Raw footage</h3>
          {job?.raw_drive_id ? (
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
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full rounded-lg border-2 border-dashed border-gray-700 py-8 text-sm text-gray-400 hover:border-gold-600 hover:text-gold-500 disabled:opacity-50 transition-colors"
            >
              {busy && uploadPct > 0 ? `Uploading to Drive… ${uploadPct}%` : 'Upload raw footage (MP4 / MOV / WebM)'}
            </button>
          )}
          <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={onPickFile} />
        </section>

        {/* ---------- 2 & 3. auto-edit result: edit / change / regenerate ---------- */}
        {job?.raw_drive_id && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">2 · Auto-edit</h3>
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
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">3 · Edit</h3>
            <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-gray-800 p-3">
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
              <div className="sm:col-span-2">
                <label className="form-label">Caption / on-screen text (burned into the export)</label>
                <textarea
                  className="form-input" rows={2}
                  value={job?.caption_text ?? ''}
                  onChange={(e) => persist({ caption_text: e.target.value })}
                  disabled={busy}
                />
              </div>
            </div>
          </section>
        )}

        {/* ---------- 5. preview → approve → export ---------- */}
        {hasEdit && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">4 · Preview → Approve → Export</h3>

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
