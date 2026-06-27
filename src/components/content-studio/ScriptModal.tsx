import { useEffect, useRef, useState } from 'react'
import type { ContentRow, ContentScript } from '@/types/content-studio'
import { createScript, updateScript } from '@/lib/content-studio/queries'
import { notifySuperAdminsOfScriptSubmitted, notifyTeamOfScriptChangesRequired } from '@/lib/notifyHelpers'
import { useViewer } from '@/lib/content-studio/viewer-context'

const STATUSES = ['Pending', 'In Progress', 'Submitted', 'Changes Required'] as const
const ALL_STATUSES = [...STATUSES, 'Approved'] as const

interface Props {
  script?: ContentScript | null
  content: Pick<ContentRow, 'id' | 'title' | 'brand_name'>[]
  onClose: () => void
  onSaved: () => void
}

function blank() {
  return {
    content_id: '',
    writer: '',
    status: 'Pending' as string,
    deadline: '',
    revision_count: '0',
    review_comments: '',
  }
}

function fromScript(s: ContentScript) {
  return {
    content_id: String(s.content_id),
    writer: s.writer ?? '',
    status: s.status,
    deadline: s.deadline ?? '',
    revision_count: String(s.revision_count ?? 0),
    review_comments: s.review_comments ?? '',
  }
}

export function ScriptModal({ script, content, onClose, onSaved }: Props) {
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner
  const firstRef = useRef<HTMLSelectElement | HTMLInputElement>(null)
  const isEdit = !!script
  const statusOptions = canApprove ? ALL_STATUSES : STATUSES

  const [form, setForm] = useState(() => (script ? fromScript(script) : blank()))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(script ? fromScript(script) : blank())
    setError('')
  }, [script])

  useEffect(() => {
    ;(firstRef.current as HTMLElement | null)?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!isEdit && !form.content_id) {
      setError('Content piece is required.')
      return
    }

    const payload: Record<string, any> = {
      writer: form.writer.trim(),
      status: form.status,
      deadline: form.deadline || null,
      revision_count: Number(form.revision_count) || 0,
      review_comments: form.review_comments.trim(),
      approved: form.status === 'Approved' ? 1 : 0,
    }
    if (!isEdit) payload.content_id = Number(form.content_id)

    setBusy(true)
    try {
      const wasSubmitted = isEdit ? script!.status === 'Submitted' : false
      const wasChangesRequired = isEdit ? script!.status === 'Changes Required' : false
      let scriptId: number
      let contentTitle: string | undefined
      let brandName: string | undefined

      if (isEdit) {
        const saved = await updateScript(script!.id, payload)
        scriptId = saved.id
        const c = content.find((c) => c.id === script!.content_id)
        contentTitle = c?.title
        brandName = c?.brand_name
      } else {
        const saved = await createScript(payload as any)
        scriptId = saved.id
        const c = content.find((c) => c.id === Number(form.content_id))
        contentTitle = c?.title
        brandName = c?.brand_name
      }

      if (form.status === 'Submitted' && !wasSubmitted) {
        notifySuperAdminsOfScriptSubmitted({ scriptId, contentTitle: contentTitle || `script #${scriptId}`, brandName }).catch(console.error)
      }
      if (form.status === 'Changes Required' && !wasChangesRequired) {
        notifyTeamOfScriptChangesRequired({ scriptId, contentTitle: contentTitle || `script #${scriptId}`, brandName }).catch(console.error)
      }
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg glass-modal">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-100">{isEdit ? 'Edit script' : 'New script'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Content piece {!isEdit && <span className="text-rose-400">*</span>}</label>
            {isEdit ? (
              <p className="text-sm font-semibold text-gray-100 py-1">
                {content.find((c) => c.id === script!.content_id)?.title ?? `#${script!.content_id}`}
              </p>
            ) : (
              <select ref={firstRef as React.RefObject<HTMLSelectElement>} className="form-input" value={form.content_id} onChange={set('content_id')} disabled={busy} required>
                <option value="">— select a content piece —</option>
                {content.map((c) => (
                  <option key={c.id} value={c.id}>{c.brand_name} · {c.title}</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Writer</label>
              <input ref={isEdit ? (firstRef as React.RefObject<HTMLInputElement>) : undefined} className="form-input" placeholder="Name" value={form.writer} onChange={set('writer')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Status</label>
              <select
                className="form-input"
                value={form.status}
                onChange={set('status')}
                disabled={busy || (form.status === 'Approved' && !canApprove)}
              >
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                {form.status === 'Approved' && !canApprove && <option value="Approved">Approved</option>}
              </select>
              {!canApprove && <p className="text-[11px] text-gray-600 mt-1">Only the Owner can approve a script.</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Deadline</label>
              <input type="date" className="form-input" value={form.deadline} onChange={set('deadline')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Revision count</label>
              <input type="number" min={0} className="form-input" value={form.revision_count} onChange={set('revision_count')} disabled={busy} />
            </div>
          </div>

          <div>
            <label className="form-label">Review comments</label>
            <textarea className="form-input resize-none" rows={3} placeholder="Feedback or notes from the reviewer…" value={form.review_comments} onChange={set('review_comments')} disabled={busy} />
          </div>

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
