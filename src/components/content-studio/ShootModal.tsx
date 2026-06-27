import { useEffect, useRef, useState } from 'react'
import type { Brand, Shoot } from '@/types/content-studio'
import { createShoot, deleteShoot, updateShoot } from '@/lib/content-studio/queries'

const STATUSES = ['Planned', 'Scheduled', 'Completed', 'Cancelled'] as const

type ShootRow = Shoot & { brand_name: string }

interface Props {
  shoot?: ShootRow | null
  brands: Brand[]
  onClose: () => void
  onSaved: () => void
}

function blank() {
  return {
    brand_id: '',
    title: '',
    shoot_date: '',
    shoot_time: '',
    location: '',
    talent: '',
    team: '',
    equipment: '',
    status: 'Planned' as string,
    notes: '',
  }
}

function fromShoot(s: ShootRow) {
  return {
    brand_id: String(s.brand_id),
    title: s.title ?? '',
    shoot_date: s.shoot_date ?? '',
    shoot_time: s.shoot_time ?? '',
    location: s.location ?? '',
    talent: s.talent ?? '',
    team: s.team ?? '',
    equipment: s.equipment ?? '',
    status: s.status,
    notes: s.notes ?? '',
  }
}

export function ShootModal({ shoot, brands, onClose, onSaved }: Props) {
  const firstRef = useRef<HTMLInputElement>(null)
  const isEdit = !!shoot

  const [form, setForm] = useState(() => (shoot ? fromShoot(shoot) : blank()))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(shoot ? fromShoot(shoot) : blank())
    setError('')
  }, [shoot])

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
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!isEdit && !form.brand_id) {
      setError('Brand is required.')
      return
    }
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }

    const payload: Record<string, any> = {
      title: form.title.trim(),
      shoot_date: form.shoot_date || null,
      shoot_time: form.shoot_time.trim() || null,
      location: form.location.trim() || null,
      talent: form.talent.trim() || null,
      team: form.team.trim() || null,
      equipment: form.equipment.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    }
    if (!isEdit) payload.brand_id = Number(form.brand_id)

    setBusy(true)
    try {
      if (isEdit) await updateShoot(shoot!.id, payload)
      else await createShoot(payload)
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${shoot!.title}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await deleteShoot(shoot!.id)
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
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
      <div className="w-full max-w-lg glass-modal max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-100">{isEdit ? 'Edit shoot' : 'New shoot'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Brand {!isEdit && <span className="text-rose-400">*</span>}</label>
            {isEdit ? (
              <p className="text-sm font-semibold text-gray-100 py-1">{shoot!.brand_name}</p>
            ) : (
              <select className="form-input" value={form.brand_id} onChange={set('brand_id')} disabled={busy} required>
                <option value="">— select a brand —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="form-label">Title <span className="text-rose-400">*</span></label>
            <input ref={firstRef} type="text" className="form-input" placeholder="Shoot title…" value={form.title} onChange={set('title')} disabled={busy} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.shoot_date} onChange={set('shoot_date')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Time</label>
              <input type="time" className="form-input" value={form.shoot_time} onChange={set('shoot_time')} disabled={busy} />
            </div>
          </div>

          <div>
            <label className="form-label">Location</label>
            <input type="text" className="form-input" placeholder="Studio, address, etc." value={form.location} onChange={set('location')} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Talent</label>
              <input type="text" className="form-input" placeholder="On-camera talent" value={form.talent} onChange={set('talent')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Team</label>
              <input type="text" className="form-input" placeholder="Crew members" value={form.team} onChange={set('team')} disabled={busy} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Equipment</label>
              <input type="text" className="form-input" placeholder="Camera, lenses, etc." value={form.equipment} onChange={set('equipment')} disabled={busy} />
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status} onChange={set('status')} disabled={busy}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input resize-none" rows={3} placeholder="Any additional notes…" value={form.notes} onChange={set('notes')} disabled={busy} />
          </div>

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <button type="button" disabled={busy} className="text-sm font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50" onClick={handleDelete}>
                Delete shoot
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
