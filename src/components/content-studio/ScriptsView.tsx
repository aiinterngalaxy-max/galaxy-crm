import { useState } from 'react'
import { Avatar } from './ui'
import { fmtDate } from '@/lib/content-studio/format'
import { ScriptStatus } from './ScriptStatus'
import { ScriptModal } from './ScriptModal'
import type { ContentRow, ContentScript } from '@/types/content-studio'

type ScriptRow = ContentScript & { title: string; brand_name: string }

interface Props {
  scripts: ScriptRow[]
  content: Pick<ContentRow, 'id' | 'title' | 'brand_name'>[]
  onChanged: () => void
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T00:00:00').getTime() - t.getTime()) / 86400000)
}

export function ScriptsView({ scripts, content, onChanged }: Props) {
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; script: ScriptRow } | null>(null)

  const pending = scripts.filter((s) => s.status !== 'Approved')
  const approved = scripts.filter((s) => s.status === 'Approved')

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
          + Add script
        </button>
      </div>

      {scripts.length === 0 ? (
        <p className="text-sm text-gray-500">No scripts yet.</p>
      ) : (
        <div className="space-y-6">
          <Section title="In progress" rows={pending} onEdit={(s) => setModal({ mode: 'edit', script: s })} onChanged={onChanged} />
          {approved.length > 0 && (
            <Section title="Approved" rows={approved} onEdit={(s) => setModal({ mode: 'edit', script: s })} onChanged={onChanged} muted />
          )}
        </div>
      )}

      {modal && (
        <ScriptModal
          script={modal.mode === 'edit' ? modal.script : null}
          content={content}
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
  rows: ScriptRow[]
  onEdit: (s: ScriptRow) => void
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
          const d = daysUntil(s.deadline)
          const overdue = d !== null && d < 0 && s.status !== 'Approved'
          return (
            <div key={s.id} className={`px-5 py-4 flex flex-wrap items-center gap-4 ${muted ? 'opacity-70' : ''}`}>
              <div className="min-w-0 flex-1">
                <button onClick={() => onEdit(s)} className="font-semibold text-gray-100 truncate text-left hover:text-gold-400 transition-colors">
                  {s.title}
                </button>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{s.brand_name}</span>
                  {s.writer && (
                    <span className="inline-flex items-center gap-1">
                      <Avatar name={s.writer} /> {s.writer}
                    </span>
                  )}
                  {s.revision_count > 0 && <span>{s.revision_count} revision{s.revision_count === 1 ? '' : 's'}</span>}
                  {s.deadline && (
                    <span className={overdue ? 'text-rose-400 font-semibold' : ''}>
                      due {fmtDate(s.deadline)}
                      {d !== null && s.status !== 'Approved' && (d < 0 ? ` · ${Math.abs(d)}d overdue` : d === 0 ? ' · today' : ` · ${d}d left`)}
                    </span>
                  )}
                </div>
                {s.review_comments && <div className="text-xs text-gray-500 mt-1.5 italic">"{s.review_comments}"</div>}
              </div>
              <ScriptStatus id={s.id} status={s.status} onChanged={onChanged} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
