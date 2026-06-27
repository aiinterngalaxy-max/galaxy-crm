import { useState } from 'react'
import { Avatar } from './ui'
import { fmtDate } from '@/lib/content-studio/format'
import { ShootStatus } from './ShootStatus'
import { ShootModal } from './ShootModal'
import type { Brand, Shoot } from '@/types/content-studio'

type ShootRow = Shoot & { brand_name: string }

interface Props {
  shoots: ShootRow[]
  brands: Brand[]
  onChanged: () => void
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T00:00:00').getTime() - t.getTime()) / 86400000)
}

export function ShootsView({ shoots, brands, onChanged }: Props) {
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; shoot: ShootRow } | null>(null)

  const active = shoots.filter((s) => s.status !== 'Cancelled')
  const upcoming = active.filter((s) => s.status !== 'Completed').sort((a, b) => (a.shoot_date || '9999').localeCompare(b.shoot_date || '9999'))
  const done = active.filter((s) => s.status === 'Completed')

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
          + Add shoot
        </button>
      </div>

      {shoots.length === 0 ? (
        <p className="text-sm text-gray-500">No shoots yet.</p>
      ) : (
        <div className="space-y-6">
          <Section title="Upcoming & planned" rows={upcoming} onEdit={(s) => setModal({ mode: 'edit', shoot: s })} onChanged={onChanged} />
          {done.length > 0 && <Section title="Completed" rows={done} onEdit={(s) => setModal({ mode: 'edit', shoot: s })} onChanged={onChanged} muted />}
        </div>
      )}

      {modal && (
        <ShootModal
          shoot={modal.mode === 'edit' ? modal.shoot : null}
          brands={brands}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function Section({
  title,
  rows,
  onEdit,
  onChanged,
  muted,
}: {
  title: string
  rows: ShootRow[]
  onEdit: (s: ShootRow) => void
  onChanged: () => void
  muted?: boolean
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 border-b border-gray-800 flex items-center justify-between">
        <h2 className="font-bold text-gray-100">{title}</h2>
        <span className="badge bg-gray-800 text-gray-300">{rows.length}</span>
      </div>
      <div className="divide-y divide-gray-800">
        {rows.length === 0 && <div className="p-5 text-sm text-gray-500">Nothing here.</div>}
        {rows.map((s) => {
          const d = daysUntil(s.shoot_date)
          const soon = d !== null && d >= 0 && d <= 3 && s.status !== 'Completed'
          return (
            <div key={s.id} className={`px-5 py-4 flex flex-wrap items-center gap-4 ${muted ? 'opacity-70' : ''}`}>
              <div className="w-16 shrink-0 text-center">
                <div className={`text-lg font-bold ${soon ? 'text-rose-400' : 'text-gray-100'}`}>
                  {s.shoot_date ? fmtDate(s.shoot_date).split(' ')[0] : '—'}
                </div>
                <div className="text-[11px] uppercase text-gray-500">{s.shoot_date ? fmtDate(s.shoot_date).split(' ')[1] : ''}</div>
                {s.shoot_time && <div className="text-[10px] text-gray-600 mt-0.5">{s.shoot_time}</div>}
              </div>
              <div className="min-w-0 flex-1">
                <button onClick={() => onEdit(s)} className="font-semibold text-gray-100 truncate text-left hover:text-gold-400 transition-colors">
                  {s.title}
                </button>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{s.brand_name}</span>
                  {s.location && <span>📍 {s.location}</span>}
                  {s.talent && (
                    <span className="inline-flex items-center gap-1">
                      <Avatar name={s.talent} /> {s.talent}
                    </span>
                  )}
                  {s.team && <span>👥 {s.team}</span>}
                  {s.equipment && <span className="text-gray-600">🎥 {s.equipment}</span>}
                  {d !== null && s.status !== 'Completed' && (
                    <span className={soon ? 'text-rose-400 font-semibold' : ''}>{d < 0 ? `${Math.abs(d)}d ago` : d === 0 ? 'today' : `in ${d}d`}</span>
                  )}
                </div>
              </div>
              <ShootStatus id={s.id} status={s.status} onChanged={onChanged} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
