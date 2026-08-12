import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentRow, VideoClip, VideoJob } from '@/types/content-studio'
import { ensureVideoJob, updateVideoJob } from '@/lib/content-studio/queries'
import {
  DEFAULT_GENERATE_OPTIONS,
  KlapNotConfiguredError,
  getExportStatus,
  getTaskStatus,
  listClips,
  startExport,
  startGeneration,
  type GenerateOptions,
} from '@/lib/content-studio/klap'
import { uploadToCloudinary, CLOUDINARY_MAX_BYTES } from '@/lib/cloudinaryUpload'
import { useViewer } from '@/lib/content-studio/viewer-context'

interface Props {
  content: Pick<ContentRow, 'id' | 'title' | 'brand_name'>
  onClose: () => void
  onSaved: () => void
}

/** Klap accepts these; anything else is rejected server-side after the upload. */
const ACCEPTED = '.mp4,.mov,.webm'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function VideoStudioModal({ content, onClose, onSaved }: Props) {
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner

  const [job, setJob] = useState<VideoJob | null>(null)
  const [clips, setClips] = useState<VideoClip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_GENERATE_OPTIONS)
  const [showOptions, setShowOptions] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Polling runs on an interval that must be torn down if the modal closes
  // mid-render, otherwise it keeps hitting the API after unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const loadClips = useCallback(async (folderId: string) => {
    try {
      const { clips: list } = await listClips(folderId)
      setClips(list)
    } catch (err) {
      setError(errText(err) || 'Could not load the generated clips.')
    }
  }, [])

  // Initial load. A job left mid-render by a previous session resumes here
  // rather than starting over — regenerating costs money, reconnecting is free.
  useEffect(() => {
    let cancelled = false
    ensureVideoJob(content.id)
      .then(async (j) => {
        if (cancelled) return
        setJob(j)
        if (j.klap_folder_id && (j.status === 'Generated' || j.status === 'Exported' || j.status === 'Exporting')) {
          await loadClips(j.klap_folder_id)
        }
        if (j.status === 'Generating' && j.klap_task_id) resumeGenerate(j)
        if (j.status === 'Exporting' && j.klap_export_id) resumeExport(j)
      })
      .catch((e) => !cancelled && setError(e?.message || String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.id])

  function handleKlapError(err: unknown) {
    if (err instanceof KlapNotConfiguredError) setNotConfigured(err.message)
    else setError(errText(err))
  }

  async function persist(patch: Record<string, unknown>) {
    if (!job) return null
    const saved = await updateVideoJob(job.id, patch)
    setJob(saved)
    return saved
  }

  function resumeGenerate(j: VideoJob) {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const { status, folderId } = await getTaskStatus(j.klap_task_id)
        if (status === 'ready') {
          stopPolling()
          const fid = folderId || j.klap_folder_id
          await updateVideoJob(j.id, { status: 'Generated', klap_folder_id: fid })
          const fresh = await ensureVideoJob(content.id)
          setJob(fresh)
          await loadClips(fid)
          onSaved()
        } else if (status === 'error') {
          stopPolling()
          const saved = await updateVideoJob(j.id, { status: 'Failed', error: 'Klap could not process this footage.' })
          setJob(saved)
        }
      } catch (err) {
        stopPolling()
        handleKlapError(err)
      }
    }, 5000)
  }

  function resumeExport(j: VideoJob) {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const { status, url } = await getExportStatus(j.klap_folder_id, j.klap_project_id, j.klap_export_id)
        if (status === 'ready') {
          stopPolling()
          const saved = await updateVideoJob(j.id, { status: 'Exported', output_url: url })
          setJob(saved)
          onSaved()
        } else if (status === 'error') {
          stopPolling()
          const saved = await updateVideoJob(j.id, { status: 'Failed', error: 'Export failed.' })
          setJob(saved)
        }
      } catch (err) {
        stopPolling()
        handleKlapError(err)
      }
    }, 5000)
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !job) return
    setError('')
    setNotConfigured('')

    if (file.size > CLOUDINARY_MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The free storage plan accepts up to ` +
          `${CLOUDINARY_MAX_BYTES / 1024 / 1024} MB — trim the footage or export it smaller first.`,
      )
      return
    }

    setBusy(true)
    setUploadPct(0)
    try {
      await persist({ status: 'Uploading', error: '', source_name: file.name })
      const { url } = await uploadToCloudinary(file, file.name, (f) => setUploadPct(Math.round(f * 100)))
      const saved = await persist({ source_url: url, status: 'Idle' })
      if (saved) await generate(saved, url)
    } catch (err) {
      await persist({ status: 'Failed', error: errText(err) }).catch(() => {})
      handleKlapError(err)
    } finally {
      setBusy(false)
      setUploadPct(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function generate(j: VideoJob, sourceUrl: string) {
    setError('')
    setNotConfigured('')
    setBusy(true)
    try {
      const { taskId, folderId } = await startGeneration(sourceUrl, content.title, options)
      // Persist the ids *before* polling — if the tab closes now, reopening
      // resumes this same task instead of paying to generate a second time.
      const saved = await updateVideoJob(j.id, {
        status: 'Generating',
        klap_task_id: taskId,
        klap_folder_id: folderId ?? '',
        options: JSON.stringify(options),
        error: '',
      })
      setJob(saved)
      setClips([])
      resumeGenerate(saved)
      onSaved()
    } catch (err) {
      await updateVideoJob(j.id, { status: 'Failed', error: errText(err) }).catch(() => {})
      handleKlapError(err)
    } finally {
      setBusy(false)
    }
  }

  async function onRegenerate() {
    if (!job?.source_url) return
    const next = await persist({ regen_count: (job.regen_count ?? 0) + 1, approved: 0, klap_project_id: '', output_url: '' })
    if (next) await generate(next, next.source_url)
  }

  async function onChooseClip(clipId: string) {
    // Choosing a different clip invalidates any prior approval and export —
    // otherwise Export would render whatever was approved before the switch.
    await persist({ klap_project_id: clipId, approved: 0, klap_export_id: '', output_url: '', status: 'Generated' })
    onSaved()
  }

  async function onApprove() {
    if (!job?.klap_project_id) return
    await persist({ approved: 1 })
    onSaved()
  }

  async function onExport() {
    if (!job?.klap_project_id || !job.klap_folder_id) return
    setBusy(true)
    setError('')
    try {
      const { exportId, status, url } = await startExport(job.klap_folder_id, job.klap_project_id)
      if (status === 'ready' && url) {
        const saved = await persist({ status: 'Exported', klap_export_id: exportId, output_url: url })
        if (saved) onSaved()
        return
      }
      const saved = await persist({ status: 'Exporting', klap_export_id: exportId, error: '' })
      if (saved) resumeExport(saved)
      onSaved()
    } catch (err) {
      handleKlapError(err)
    } finally {
      setBusy(false)
    }
  }

  const status = job?.status ?? 'Idle'
  const chosen = clips.find((c) => c.id === job?.klap_project_id) ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-3xl glass-modal max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4 sticky top-0 bg-gray-900/95 backdrop-blur z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-100 truncate">Video studio</h2>
            <p className="text-xs text-gray-500 truncate">{content.brand_name} · {content.title}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <StatusStrip status={status} approved={!!job?.approved} />

          {notConfigured && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              <p className="font-semibold mb-1">Video auto-editing isn't switched on yet</p>
              <p className="text-amber-300/90 text-[13px]">{notConfigured}</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : (
            <>
              {/* ---------- 1. source footage ---------- */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">1 · Raw footage</h3>
                {job?.source_url ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <video src={job.source_url} controls className="w-48 rounded-lg border border-gray-800 bg-black" />
                    <div className="min-w-0 text-sm">
                      <p className="text-gray-300 truncate">{job.source_name || 'Uploaded footage'}</p>
                      <button
                        onClick={() => fileRef.current?.click()}
                        disabled={busy}
                        className="mt-1 text-xs font-semibold text-gold-500 hover:underline disabled:opacity-50"
                      >
                        Replace footage
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="w-full rounded-lg border-2 border-dashed border-gray-700 py-8 text-sm text-gray-400 hover:border-gold-600 hover:text-gold-500 disabled:opacity-50 transition-colors"
                  >
                    {busy && uploadPct > 0 ? `Uploading… ${uploadPct}%` : 'Upload raw footage (MP4 / MOV / WebM)'}
                  </button>
                )}
                <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={onPickFile} />
              </section>

              {/* ---------- 2. generate ---------- */}
              {job?.source_url && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">2 · AI edit</h3>
                    <button onClick={() => setShowOptions((s) => !s)} className="text-xs text-gray-500 hover:text-gray-300">
                      {showOptions ? 'Hide options' : 'Options'}
                    </button>
                  </div>

                  {showOptions && (
                    <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-800 p-3 text-sm">
                      {([
                        ['captions', 'Captions'],
                        ['reframe', 'Reframe to vertical'],
                        ['removeSilences', 'Remove silences'],
                        ['emojis', 'Emojis'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-gray-400">
                          <input
                            type="checkbox"
                            checked={!!options[key]}
                            onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                            disabled={busy}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}

                  {status === 'Generating' ? (
                    <p className="text-sm text-gray-400">Cutting your footage… this usually takes a few minutes. You can close this and come back.</p>
                  ) : clips.length === 0 ? (
                    <button
                      onClick={() => job && generate(job, job.source_url)}
                      disabled={busy}
                      className="btn-primary text-sm disabled:opacity-50"
                    >
                      Generate edit
                    </button>
                  ) : null}
                </section>
              )}

              {/* ---------- 3. results: edit / change / regenerate ---------- */}
              {clips.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                    3 · {clips.length} clip{clips.length === 1 ? '' : 's'} generated
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {clips.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => onChooseClip(c.id)}
                        disabled={busy}
                        className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                          job?.klap_project_id === c.id
                            ? 'border-gold-500 bg-gold-500/10'
                            : 'border-gray-800 hover:border-gray-600'
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-200 truncate">{c.name || 'Clip'}</p>
                        {c.virality_score !== null && (
                          <p className="text-[11px] text-gray-500 mt-0.5">score {c.virality_score}</p>
                        )}
                        {job?.klap_project_id === c.id && (
                          <p className="text-[11px] font-semibold text-gold-500 mt-1">Selected</p>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={onRegenerate} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                      ↻ Regenerate
                    </button>
                    <span className="text-[11px] text-gray-600 self-center">
                      Pick a different clip above to change the selection
                      {job?.regen_count ? ` · regenerated ${job.regen_count}×` : ''}
                    </span>
                  </div>
                </section>
              )}

              {/* ---------- 4. edit the chosen clip ---------- */}
              {chosen && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">4 · Edit</h3>
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
                      <label className="form-label">Caption / on-screen text</label>
                      <textarea
                        className="form-input" rows={2}
                        value={job?.caption_text ?? ''}
                        onChange={(e) => persist({ caption_text: e.target.value })}
                        disabled={busy}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1">
                    Trim and caption are saved with the piece for the editor to apply. They are not sent to the AI —
                    use Regenerate with different options to change how it cuts.
                  </p>
                </section>
              )}

              {/* ---------- 5. preview → approve → export ---------- */}
              {chosen && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">5 · Preview → Approve → Export</h3>

                  <div className="rounded-lg border border-gray-800 overflow-hidden bg-black aspect-[9/16] max-h-80 mx-auto">
                    <iframe
                      src={chosen.preview_url}
                      title="Clip preview"
                      className="w-full h-full"
                      allow="autoplay; fullscreen"
                    />
                  </div>

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

                    {!canApprove && (
                      <span className="text-[11px] text-gray-600">Only the Owner can approve.</span>
                    )}
                    {!job?.approved && canApprove && (
                      <span className="text-[11px] text-gray-600">Approve before exporting.</span>
                    )}
                  </div>

                  {job?.output_url && (
                    <a
                      href={job.output_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm font-semibold text-gold-500 hover:underline"
                    >
                      ↓ Download final MP4
                    </a>
                  )}
                </section>
              )}
            </>
          )}
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
