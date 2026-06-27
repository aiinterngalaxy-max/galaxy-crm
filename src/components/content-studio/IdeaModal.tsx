import { useEffect, useRef, useState } from 'react'
import type { Brand } from '@/types/content-studio'
import { createIdea } from '@/lib/content-studio/queries'

interface Props {
  brands: Brand[]
  onClose: () => void
  onSaved: () => void
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

export function IdeaModal({ brands, onClose, onSaved }: Props) {
  const firstRef = useRef<HTMLSelectElement>(null)

  const [form, setForm] = useState({ brand_id: '', month: currentMonth(), title: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.brand_id) {
      setError('Brand is required.')
      return
    }
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }

    setBusy(true)
    try {
      await createIdea({ brand_id: Number(form.brand_id), month: form.month, title: form.title.trim() })
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
      <div className="w-full max-w-md glass-modal">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-100">New idea</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Brand <span className="text-rose-400">*</span></label>
            <select ref={firstRef} className="form-input" value={form.brand_id} onChange={set('brand_id')} disabled={busy} required>
              <option value="">— select a brand —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Month <span className="text-rose-400">*</span></label>
            <input type="month" className="form-input" value={form.month} onChange={set('month')} disabled={busy} required />
          </div>

          <div>
            <label className="form-label">Title <span className="text-rose-400">*</span></label>
            <input type="text" className="form-input" placeholder="Idea title…" value={form.title} onChange={set('title')} disabled={busy} required />
          </div>

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
