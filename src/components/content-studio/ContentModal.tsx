import { useEffect, useRef, useState } from 'react'
import { STAGES, PLATFORMS, PRIORITIES } from '@/lib/content-studio/stages'
import type { ContentRow } from '@/types/content-studio'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { createComment, createContent, deleteContent, getComments, updateContent } from '@/lib/content-studio/queries'

const FORMATS = ['Reel', 'Short', 'Long-form', 'Carousel', 'Post'] as const

interface Props {
  content?: ContentRow | null
  brands: { id: number; name: string }[]
  defaultBrandId?: number
  onClose: () => void
  onSaved: () => void
}

function blank(brands: { id: number; name: string }[], defaultBrandId?: number) {
  return {
    brand_id: String(defaultBrandId ?? brands[0]?.id ?? ''),
    title: '',
    format: 'Reel' as string,
    platform: 'Instagram' as string,
    stage: 'Idea' as string,
    priority: 'Normal' as string,
    writer: '',
    editor: '',
    talent: '',
    location: '',
    start_date: '',
    due_date: '',
    shoot_date: '',
    publish_date: '',
    notes: '',
  }
}

function fromRow(c: ContentRow) {
  return {
    brand_id: String(c.brand_id),
    title: c.title,
    format: c.format,
    platform: c.platform,
    stage: c.stage,
    priority: c.priority,
    writer: c.writer ?? '',
    editor: c.editor ?? '',
    talent: c.talent ?? '',
    location: c.location ?? '',
    start_date: c.start_date ?? '',
    due_date: c.due_date ?? '',
    shoot_date: c.shoot_date ?? '',
    publish_date: c.publish_date ?? '',
    notes: c.notes ?? '',
  }
}

interface Comment {
  id: number
  author: string
  text: string
  created_at: string
}

function fmtComment(ts: string): string {
  try {
    return new Date(ts + (ts.includes('T') ? '' : 'Z')).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ts
  }
}

export function ContentModal({ content, brands, defaultBrandId, onClose, onSaved }: Props) {
  const titleRef = useRef<HTMLInputElement>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const isEdit = !!content
  const { viewer } = useViewer()

  const [form, setForm] = useState(() => (content ? fromRow(content) : blank(brands, defaultBrandId)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentsLoaded, setCommentsLoaded] = useState(false)

  useEffect(() => {
    setForm(content ? fromRow(content) : blank(brands, defaultBrandId))
    setError('')
    setComments([])
    setCommentsLoaded(false)
    setCommentText('')
  }, [content])

  useEffect(() => {
    if (!isEdit || !content?.id || commentsLoaded) return
    getComments(content.id)
      .then((c) => setComments(c))
      .catch(() => {})
      .finally(() => setCommentsLoaded(true))
  }, [isEdit, content?.id, commentsLoaded])

  useEffect(() => {
    if (comments.length) commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  useEffect(() => {
    titleRef.current?.focus()
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

  async function postComment(e: React.FormEvent) {
    e.preventDefault()
    const text = commentText.trim()
    if (!text || !content?.id) return
    const author = viewer?.name || 'Anonymous'
    setCommentBusy(true)
    try {
      const comment = await createComment(content.id, text, author)
      setComments((prev) => [...prev, comment])
      setCommentText('')
    } catch {
      // ignore
    } finally {
      setCommentBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    if (!form.brand_id) {
      setError('Brand is required.')
      return
    }

    const payload: Record<string, any> = {
      brand_id: Number(form.brand_id),
      title: form.title.trim(),
      format: form.format,
      platform: form.platform,
      stage: form.stage,
      priority: form.priority,
      writer: form.writer.trim(),
      editor: form.editor.trim(),
      talent: form.talent.trim(),
      location: form.location.trim(),
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      shoot_date: form.shoot_date || null,
      publish_date: form.publish_date || null,
      notes: form.notes.trim(),
    }

    setBusy(true)
    try {
      if (isEdit) await updateContent(content!.id, payload, viewer?.name)
      else await createContent(payload, viewer?.name)
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl glass-modal my-8">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-100">{isEdit ? 'Edit content' : 'New content'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Brand <span className="text-rose-400">*</span></label>
            <select className="form-input" value={form.brand_id} onChange={set('brand_id')} disabled={busy || isEdit}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Title <span className="text-rose-400">*</span></label>
            <input ref={titleRef} className="form-input" placeholder="e.g. One-tap movie night scene" value={form.title} onChange={set('title')} disabled={busy} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Format</label>
              <select className="form-input" value={form.format} onChange={set('format')} disabled={busy}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Platform</label>
              <select className="form-input" value={form.platform} onChange={set('platform')} disabled={busy}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Stage</label>
              <select className="form-input" value={form.stage} onChange={set('stage')} disabled={busy}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority} onChange={set('priority')} disabled={busy}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Writer</label>
              <input className="form-input" placeholder="Name" value={form.writer} onChange={set('writer')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Editor</label>
              <input className="form-input" placeholder="Name" value={form.editor} onChange={set('editor')} disabled={busy} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Talent</label>
              <input className="form-input" placeholder="On-screen talent" value={form.talent} onChange={set('talent')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Location</label>
              <input className="form-input" placeholder="Shoot location" value={form.location} onChange={set('location')} disabled={busy} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Start date</label>
              <input type="date" className="form-input" value={form.start_date} onChange={set('start_date')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Due date</label>
              <input type="date" className="form-input" value={form.due_date} onChange={set('due_date')} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Shoot date</label>
              <input type="date" className="form-input" value={form.shoot_date} onChange={set('shoot_date')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Publish date</label>
              <input type="date" className="form-input" value={form.publish_date} onChange={set('publish_date')} disabled={busy} />
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input resize-none" rows={3} placeholder="Any context or instructions…" value={form.notes} onChange={set('notes')} disabled={busy} />
          </div>

          {isEdit && (
            <div className="border-t border-gray-800 pt-4">
              <div className="form-label">Comments</div>

              <div className="max-h-48 overflow-y-auto space-y-2 mb-3 pr-1">
                {!commentsLoaded && <p className="text-xs text-gray-600 py-2">Loading…</p>}
                {commentsLoaded && comments.length === 0 && <p className="text-xs text-gray-600 py-2">No comments yet.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-200">{c.author}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">{fmtComment(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{c.text}</p>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>

              <form onSubmit={postComment} className="flex gap-2 items-end">
                <textarea
                  className="form-input flex-1 resize-none text-sm"
                  rows={2}
                  placeholder={`Add a comment${viewer?.name ? ` as ${viewer.name}` : ''}…`}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  disabled={commentBusy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      postComment(e as any)
                    }
                  }}
                />
                <button type="submit" className="btn-secondary text-sm px-3 py-2 shrink-0 disabled:opacity-40" disabled={commentBusy || !commentText.trim()}>
                  {commentBusy ? '…' : 'Post'}
                </button>
              </form>
              <p className="text-[10px] text-gray-600 mt-1">⌘↵ to submit</p>
            </div>
          )}

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <button
                type="button"
                disabled={busy}
                className="text-sm font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                onClick={async () => {
                  if (!confirm(`Delete "${content!.title}"? This cannot be undone.`)) return
                  setBusy(true)
                  setError('')
                  try {
                    await deleteContent(content!.id, viewer?.name)
                    onSaved()
                  } catch (err: any) {
                    setError(err.message || 'Something went wrong.')
                    setBusy(false)
                  }
                }}
              >
                Delete content
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
