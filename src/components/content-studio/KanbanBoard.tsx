import { useEffect, useMemo, useState } from 'react'
import { STAGES, STAGE_STYLE, stageProgress } from '@/lib/content-studio/stages'
import { fmtDate, dueLabel } from '@/lib/content-studio/format'
import type { ContentRow } from '@/types/content-studio'
import { ContentModal } from './ContentModal'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { deleteContent, updateContent } from '@/lib/content-studio/queries'

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T00:00:00').getTime() - t.getTime()) / 86400000)
}

export function KanbanBoard({
  initial,
  brands,
  editId,
  onChanged,
}: {
  initial: ContentRow[]
  brands: { id: number; name: string }[]
  editId?: number
  onChanged: () => void
}) {
  const { viewer } = useViewer()
  const actor = viewer?.name || 'System'
  const [rows, setRows] = useState<ContentRow[]>(initial)
  const [filter, setFilter] = useState<number | 'all'>('all')
  const [dragId, setDragId] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; content: ContentRow } | null>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [bulkWorking, setBulkWorking] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  useEffect(() => {
    setRows(initial)
  }, [initial])

  useEffect(() => {
    if (editId) {
      const target = initial.find((r) => r.id === editId)
      if (target) setModal({ mode: 'edit', content: target })
    }
  }, [editId])

  useEffect(() => {
    if (!selectMode) setSelected(new Set())
  }, [selectMode])

  const visible = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.brand_id === filter)), [rows, filter])

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function move(id: number, stage: string) {
    const prev = rows
    const cur = rows.find((r) => r.id === id)
    if (!cur || cur.stage === stage) return
    setSaving(id)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stage } : r)))
    try {
      const updated = await updateContent(id, { stage }, actor)
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      onChanged()
    } catch {
      setRows(prev)
    } finally {
      setSaving(null)
    }
  }

  async function bulkMove(stage: string) {
    if (!stage || selected.size === 0) return
    setBulkWorking(true)
    setBulkMsg('')
    const ids = [...selected]
    const errors: string[] = []
    for (const id of ids) {
      try {
        const updated = await updateContent(id, { stage }, actor)
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      } catch (e: any) {
        const title = rows.find((r) => r.id === id)?.title ?? `#${id}`
        errors.push(`"${title.slice(0, 30)}": ${e?.message || 'failed'}`)
      }
    }
    setBulkWorking(false)
    setSelected(new Set())
    setBulkStage('')
    if (errors.length) setBulkMsg(`${ids.length - errors.length} moved. Blocked: ${errors.join('; ')}`)
    else setBulkMsg(`${ids.length} piece${ids.length > 1 ? 's' : ''} moved to ${stage}`)
    onChanged()
    setTimeout(() => setBulkMsg(''), 5000)
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} selected piece${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkWorking(true)
    setBulkMsg('')
    const ids = [...selected]
    const blocked: string[] = []
    const deleted: number[] = []
    for (const id of ids) {
      try {
        await deleteContent(id, actor)
        deleted.push(id)
      } catch (e: any) {
        const title = rows.find((r) => r.id === id)?.title ?? `#${id}`
        blocked.push(`"${title.slice(0, 30)}": ${e?.message || 'failed'}`)
      }
    }
    if (deleted.length) setRows((rs) => rs.filter((r) => !deleted.includes(r.id)))
    setBulkWorking(false)
    setSelected(new Set())
    if (blocked.length) setBulkMsg(`${deleted.length} deleted. Couldn't delete: ${blocked.join('; ')}`)
    else setBulkMsg(`${deleted.length} piece${deleted.length > 1 ? 's' : ''} deleted`)
    onChanged()
    setTimeout(() => setBulkMsg(''), 6000)
  }

  const selectedCount = selected.size

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 no-print">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Brand</span>
        <select className="form-input max-w-[220px]" value={String(filter)} onChange={(e) => setFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{visible.length} pieces</span>

        <button
          className={`ml-2 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
            selectMode ? 'bg-gold-500 text-gray-950 border-gold-500' : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700'
          }`}
          onClick={() => setSelectMode((v) => !v)}
        >
          {selectMode ? `✓ Select mode (${selectedCount})` : 'Select'}
        </button>

        <button className="ml-auto btn-primary no-print" onClick={() => setModal({ mode: 'create' })}>
          + Add content
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const items = visible.filter((r) => r.stage === stage)
          const st = STAGE_STYLE[stage]
          return (
            <div
              key={stage}
              className={`w-72 shrink-0 rounded-xl bg-gray-900/60 border ${
                overStage === stage ? 'border-gold-500 ring-2 ring-gold-500/30' : 'border-gray-800'
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                setOverStage(stage)
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={() => {
                if (dragId != null) move(dragId, stage)
                setOverStage(null)
                setDragId(null)
              }}
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                  <span className="text-sm font-semibold text-gray-100">{stage}</span>
                </div>
                <span className="badge bg-gray-800 text-gray-400">{items.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[80px] max-h-[68vh] overflow-y-auto">
                {items.map((c) => (
                  <Card
                    key={c.id}
                    c={c}
                    saving={saving === c.id}
                    selectMode={selectMode}
                    selected={selected.has(c.id)}
                    onToggleSelect={() => toggleSelect(c.id)}
                    onDragStart={() => setDragId(c.id)}
                    onAdvance={() => {
                      const idx = STAGES.indexOf(c.stage as any)
                      if (idx < STAGES.length - 1) move(c.id, STAGES[idx + 1])
                    }}
                    onEdit={() => setModal({ mode: 'edit', content: c })}
                  />
                ))}
                {items.length === 0 && <div className="text-center text-xs text-gray-600 py-6">Drop here</div>}
              </div>
            </div>
          )
        })}
      </div>

      {selectMode && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-gray-950 border-t border-gray-800 shadow-[0_-4px_24px_rgba(0,0,0,0.5)] px-4 sm:px-6 lg:px-8 py-3">
          <div className="max-w-screen-xl mx-auto flex items-center gap-5 min-w-0">
            <div className="shrink-0 flex items-center gap-2">
              <span className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full text-sm font-bold ${
                selectedCount > 0 ? 'bg-gold-500 text-gray-950' : 'bg-gray-800 text-gray-500'
              }`}>
                {selectedCount}
              </span>
              <span className="text-sm text-gray-400 shrink-0">{selectedCount === 1 ? 'card selected' : 'cards selected'}</span>
            </div>

            <div className="shrink-0 h-5 w-px bg-gray-800" />

            <div className="shrink-0 flex items-stretch rounded-lg overflow-hidden border border-gray-800 text-sm">
              <select
                className="bg-gray-900 text-gray-200 pl-3 pr-8 py-1.5 appearance-none focus:outline-none disabled:opacity-30 min-w-[160px]"
                value={bulkStage}
                onChange={(e) => setBulkStage(e.target.value)}
                disabled={bulkWorking || selectedCount === 0}
              >
                <option value="">Move to stage…</option>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                className="bg-gold-500 hover:bg-gold-400 text-gray-950 font-semibold px-4 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-l border-gray-800"
                disabled={!bulkStage || bulkWorking || selectedCount === 0}
                onClick={() => bulkMove(bulkStage)}
              >
                {bulkWorking ? 'Moving…' : 'Move'}
              </button>
            </div>

            <div className="shrink-0 h-5 w-px bg-gray-800" />

            <button
              className="shrink-0 flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-rose-900/30 text-rose-300 hover:bg-rose-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-rose-900/50"
              disabled={bulkWorking || selectedCount === 0}
              onClick={bulkDelete}
            >
              <span className="text-base leading-none">✕</span>
              {bulkWorking ? 'Deleting…' : 'Delete'}
            </button>

            {bulkMsg && <span className="text-sm text-gray-400 truncate min-w-0">{bulkMsg}</span>}

            <button className="ml-auto shrink-0 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors" onClick={() => setSelectMode(false)}>
              ✕ Exit select
            </button>
          </div>
        </div>
      )}

      {modal && (
        <ContentModal
          content={modal.mode === 'edit' ? modal.content : null}
          brands={brands}
          defaultBrandId={filter !== 'all' ? filter : undefined}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function Card({
  c,
  saving,
  selectMode,
  selected,
  onToggleSelect,
  onDragStart,
  onAdvance,
  onEdit,
}: {
  c: ContentRow
  saving: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onDragStart: () => void
  onAdvance: () => void
  onEdit: () => void
}) {
  const d = daysUntil(c.due_date)
  const dl = dueLabel(d)
  const overdue = c.stage !== 'Published' && d !== null && d < 0
  const last = c.stage === 'Published'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group rounded-lg bg-gray-900 border p-3 transition-colors cursor-grab active:cursor-grabbing ${
        overdue ? 'border-rose-700' : selected ? 'border-gold-500 ring-2 ring-gold-500/30' : 'border-gray-800'
      } ${saving ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0 accent-gold-500 cursor-pointer"
          />
        )}
        <div className="text-sm font-semibold text-gray-100 leading-snug flex-1" onClick={selectMode ? onToggleSelect : undefined} style={selectMode ? { cursor: 'pointer' } : undefined}>
          {c.title}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="badge bg-gray-800 text-gray-300">{c.brand_name}</span>
        <span className="badge bg-gray-800 text-gray-400">{c.format}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${stageProgress(c.stage)}%`, background: 'linear-gradient(90deg, #A07820 0%, #C9A840 100%)' }} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`badge ${
            dl.tone === 'bad' ? 'bg-rose-900/30 text-rose-300' : dl.tone === 'warn' ? 'bg-amber-900/30 text-amber-300' : dl.tone === 'ok' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-gray-800 text-gray-500'
          }`}
        >
          {c.due_date ? fmtDate(c.due_date) : 'no date'} · {dl.text}
        </span>
        {!selectMode && (
          <div className="no-print flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
            <button onClick={onEdit} title="Edit" className="text-xs font-semibold text-gray-500 hover:text-gray-200">
              edit
            </button>
            {!last && (
              <button onClick={onAdvance} title="Advance to next stage" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                next →
              </button>
            )}
          </div>
        )}
      </div>
      {(c.writer || c.editor) && (
        <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
          {c.writer && <span>✍ {c.writer}</span>}
          {c.editor && <span>✂ {c.editor}</span>}
        </div>
      )}
    </div>
  )
}
