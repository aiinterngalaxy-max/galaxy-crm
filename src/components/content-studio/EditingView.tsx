import { useState } from 'react'
import { Avatar } from './ui'
import { fmtDate } from '@/lib/content-studio/format'
import { stageProgress, STAGE_INDEX, STAGES, STAGE_STYLE } from '@/lib/content-studio/stages'
import type { ContentRow } from '@/types/content-studio'
import { updateContent } from '@/lib/content-studio/queries'

interface Props {
  rows: ContentRow[]
  editors: string[]
  onChanged: () => void
}

const EDITING_STAGES = STAGES.filter((s) => {
  const i = STAGE_INDEX[s]
  return i >= STAGE_INDEX['Editing'] && i < STAGE_INDEX['Published']
})

export function EditingView({ rows, editors, onChanged }: Props) {
  const [editorFilter, setEditorFilter] = useState('')

  const filtered = editorFilter ? rows.filter((r) => r.editor === editorFilter) : rows

  const byStage = EDITING_STAGES.map((stage) => ({
    stage,
    items: filtered.filter((r) => r.stage === stage),
  })).filter((g) => g.items.length > 0)

  const overdueCount = filtered.filter((r) => {
    if (!r.due_date) return false
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return new Date(r.due_date + 'T00:00:00') < t
  }).length

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{filtered.length} piece{filtered.length !== 1 ? 's' : ''}</span>
          {overdueCount > 0 && <span className="font-semibold text-rose-400">{overdueCount} overdue</span>}
        </div>
        {editors.length > 0 && (
          <select className="form-input text-sm py-1.5 w-auto" value={editorFilter} onChange={(e) => setEditorFilter(e.target.value)}>
            <option value="">All editors</option>
            {editors.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No content pieces in editing right now.</p>
      ) : (
        <div className="space-y-6">
          {byStage.map(({ stage, items }) => (
            <Section key={stage} stage={stage} items={items} onChanged={onChanged} />
          ))}
        </div>
      )}
    </>
  )
}

function Section({ stage, items, onChanged }: { stage: string; items: ContentRow[]; onChanged: () => void }) {
  const style = STAGE_STYLE[stage] ?? { chip: 'bg-gray-800 text-gray-300', dot: 'bg-gray-500' }
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
          <h2 className="font-bold text-gray-100">{stage}</h2>
        </div>
        <span className="badge bg-gray-800 text-gray-300">{items.length}</span>
      </div>
      <div className="divide-y divide-gray-800">
        {items.map((r) => (
          <EditingRow key={r.id} row={r} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function EditingRow({ row, onChanged }: { row: ContentRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(row.stage)
  const [approved, setApproved] = useState(!!row.approved)

  const stageIdx = STAGE_INDEX[stage] ?? 0
  const publishedIdx = STAGE_INDEX['Published']!
  const canAdvance = stageIdx < publishedIdx - 1
  const progress = stageProgress(stage)

  const daysLeft = (() => {
    if (!row.due_date) return null
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return Math.round((new Date(row.due_date + 'T00:00:00').getTime() - t.getTime()) / 86400000)
  })()
  const overdue = daysLeft !== null && daysLeft < 0

  async function patch(body: Record<string, any>) {
    setBusy(true)
    try {
      const updated = await updateContent(row.id, body)
      if (body.stage) setStage(body.stage)
      if ('approved' in body) setApproved(!!body.approved)
      void updated
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const prevStage = stageIdx > STAGE_INDEX['Editing']! ? STAGES[stageIdx - 1] : null
  const nextStage = canAdvance ? STAGES[stageIdx + 1] : null

  return (
    <div className={`px-5 py-4 flex flex-wrap items-start gap-4 ${busy ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-gray-100 truncate">{row.title}</div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{row.brand_name}</span>
          {row.editor && (
            <span className="inline-flex items-center gap-1">
              <Avatar name={row.editor} /> {row.editor}
            </span>
          )}
          {row.format && <span>{row.format}</span>}
          {row.revision_rounds > 0 && <span>{row.revision_rounds} revision{row.revision_rounds === 1 ? '' : 's'}</span>}
          {row.due_date && (
            <span className={overdue ? 'text-rose-400 font-semibold' : ''}>
              due {fmtDate(row.due_date)}
              {daysLeft !== null && (daysLeft < 0 ? ` · ${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? ' · today' : ` · ${daysLeft}d left`)}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[11px] font-semibold text-gray-500 tabular-nums w-8 text-right">{progress}%</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        <button
          disabled={busy}
          onClick={() => patch({ approved: approved ? 0 : 1 })}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            approved ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-700 text-gray-500 hover:border-emerald-600 hover:text-emerald-400'
          }`}
        >
          <span>{approved ? '✓' : '○'}</span> Approved
        </button>

        {prevStage && (
          <button disabled={busy} onClick={() => patch({ stage: prevStage })} className="inline-flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            ← {prevStage}
          </button>
        )}

        {nextStage && (
          <button disabled={busy} onClick={() => patch({ stage: nextStage })} className="inline-flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {nextStage} →
          </button>
        )}
      </div>
    </div>
  )
}
