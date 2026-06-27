import { useEffect, useRef, useState } from 'react'
import type { Brand } from '@/types/content-studio'
import { createBrand, deleteBrand, updateBrand } from '@/lib/content-studio/queries'

const STATUSES = ['Active', 'Onboarding', 'Paused', 'Retired'] as const

interface Props {
  brand?: Brand | null
  onClose: () => void
  onSaved: () => void
}

export function BrandModal({ brand, onClose, onSaved }: Props) {
  const nameRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: brand?.name ?? '',
    category: brand?.category ?? '',
    status: brand?.status ?? 'Active',
    monthly_target: brand?.monthly_target != null ? String(brand.monthly_target) : '8',
    lead: brand?.lead ?? '',
    notes: brand?.notes ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({
      name: brand?.name ?? '',
      category: brand?.category ?? '',
      status: brand?.status ?? 'Active',
      monthly_target: brand?.monthly_target != null ? String(brand.monthly_target) : '8',
      lead: brand?.lead ?? '',
      notes: brand?.notes ?? '',
    })
    setError('')
  }, [brand])

  useEffect(() => {
    nameRef.current?.focus()
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

    const name = form.name.trim()
    if (!name) {
      setError('Name is required.')
      return
    }

    const monthly_target = Number(form.monthly_target)
    if (form.monthly_target !== '' && (isNaN(monthly_target) || monthly_target < 0)) {
      setError('Monthly target must be a positive number.')
      return
    }

    const payload = {
      name,
      category: form.category.trim(),
      status: form.status as Brand['status'],
      monthly_target: form.monthly_target === '' ? 8 : monthly_target,
      lead: form.lead.trim(),
      notes: form.notes.trim(),
    }

    setBusy(true)
    try {
      if (brand) await updateBrand(brand.id, payload)
      else await createBrand(payload)
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
          <h2 className="text-lg font-bold text-gray-100">{brand ? 'Edit brand' : 'New brand'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Brand name <span className="text-rose-400">*</span></label>
            <input ref={nameRef} className="form-input" placeholder="e.g. Galaxy Home Automation" value={form.name} onChange={set('name')} disabled={busy} required />
          </div>

          <div>
            <label className="form-label">Category</label>
            <input className="form-input" placeholder="e.g. Flagship brand, Premium villas…" value={form.category} onChange={set('category')} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status} onChange={set('status')} disabled={busy}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Monthly target</label>
              <input type="number" min={0} className="form-input" placeholder="8" value={form.monthly_target} onChange={set('monthly_target')} disabled={busy} />
            </div>
          </div>

          <div>
            <label className="form-label">Lead</label>
            <input className="form-input" placeholder="Name of the internal owner" value={form.lead} onChange={set('lead')} disabled={busy} />
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input resize-none" rows={3} placeholder="Any context about this brand…" value={form.notes} onChange={set('notes')} disabled={busy} />
          </div>

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {brand ? (
              <button
                type="button"
                disabled={busy}
                className="text-sm font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                onClick={async () => {
                  if (!confirm(`Delete "${brand.name}"? This cannot be undone.`)) return
                  setBusy(true)
                  setError('')
                  try {
                    await deleteBrand(brand.id)
                    onSaved()
                  } catch (err: any) {
                    setError(err.message || 'Something went wrong.')
                    setBusy(false)
                  }
                }}
              >
                Delete brand
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? 'Saving…' : brand ? 'Save changes' : 'Create brand'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
