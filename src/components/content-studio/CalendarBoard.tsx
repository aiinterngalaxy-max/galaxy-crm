import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { STAGE_STYLE, PLATFORM_STYLE } from '@/lib/content-studio/stages'
import { monthLabel } from '@/lib/content-studio/format'
import { updateContent } from '@/lib/content-studio/queries'

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface ContentItem {
  id: number
  title: string
  platform: string
  stage: string
  brand_name: string
  publish_date: string | null
  due_date: string | null
}

interface ShootItem {
  id: number
  title: string
  brand_name: string
  shoot_date: string | null
}

export function CalendarBoard({
  initialContent,
  shoots,
  ym,
  onChanged,
}: {
  initialContent: ContentItem[]
  shoots: ShootItem[]
  ym: string
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [content, setContent] = useState(initialContent)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overDate, setOverDate] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [toast, setToast] = useState<string>('')

  const [year, mon] = ym.split('-').map(Number)
  const todayKey = new Date().toISOString().slice(0, 10)

  const byDay = new Map<string, { content: ContentItem[]; shoots: ShootItem[] }>()
  const push = (key: string, kind: 'content' | 'shoots', item: any) => {
    if (!byDay.has(key)) byDay.set(key, { content: [], shoots: [] })
    ;(byDay.get(key)![kind] as any[]).push(item)
  }
  for (const c of content) {
    const date = c.publish_date || c.due_date
    if (date && date.startsWith(ym)) push(date, 'content', c)
  }
  for (const s of shoots) {
    if (s.shoot_date && s.shoot_date.startsWith(ym)) push(s.shoot_date, 'shoots', s)
  }

  const first = new Date(year, mon - 1, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, mon, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)

  const monthCount = content.filter((c) => (c.publish_date || c.due_date || '').startsWith(ym)).length

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function reschedule(id: number, newDate: string) {
    const item = content.find((c) => c.id === id)
    if (!item || (item.publish_date || item.due_date) === newDate) return

    setSaving(id)
    setContent((prev) => prev.map((c) => (c.id === id ? { ...c, publish_date: newDate } : c)))

    try {
      await updateContent(id, { publish_date: newDate })
      showToast(`"${item.title.slice(0, 40)}" moved to ${newDate}`)
      onChanged()
    } catch (e: any) {
      setContent((prev) => prev.map((c) => (c.id === id ? item : c)))
      showToast(`Error: ${e?.message || 'save failed'}`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Content Calendar</h1>
          <p className="text-gray-500 text-sm mt-0.5">{monthCount} pieces scheduled · drag cards to reschedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/content-studio/calendar?m=${shiftMonth(ym, -1)}`)} className="btn-ghost">←</button>
          <span className="font-semibold text-gray-100 w-40 text-center">{monthLabel(ym)}</span>
          <button onClick={() => navigate(`/content-studio/calendar?m=${shiftMonth(ym, 1)}`)} className="btn-ghost">→</button>
        </div>
      </div>

      {toast && (
        <div className="mb-4 rounded-lg bg-gray-800 text-gray-100 text-sm px-4 py-2.5 flex items-center gap-2">
          <span>{toast}</span>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-900 text-gray-300 text-xs font-semibold">
          {WD.map((w) => (
            <div key={w} className="px-3 py-2 text-center">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((key, i) => {
            const day = key ? Number(key.slice(-2)) : null
            const bucket = key ? byDay.get(key) : null
            const isToday = key === todayKey
            const isOver = key === overDate

            return (
              <div
                key={i}
                className={`min-h-[118px] border-b border-r border-gray-800 p-1.5 transition-colors ${!key ? 'bg-gray-900/40' : ''} ${
                  isToday ? 'bg-gold-500/10' : ''
                } ${isOver ? 'bg-sky-900/30 ring-2 ring-inset ring-sky-700' : ''}`}
                onDragOver={(e) => {
                  if (!key || dragId === null) return
                  e.preventDefault()
                  setOverDate(key)
                }}
                onDragLeave={() => setOverDate(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setOverDate(null)
                  if (key && dragId !== null) reschedule(dragId, key)
                  setDragId(null)
                }}
              >
                {day && (
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-semibold ${
                        isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-gray-950' : 'text-gray-500'
                      }`}
                    >
                      {day}
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  {bucket?.shoots.map((s: any) => (
                    <div key={'s' + s.id} className="rounded bg-rose-900/40 text-rose-300 px-1.5 py-0.5 text-[10px] font-medium truncate" title={`Shoot: ${s.title} (${s.brand_name})`}>
                      ◎ {s.title}
                    </div>
                  ))}
                  {bucket?.content.map((c: any) => {
                    const st = STAGE_STYLE[c.stage]
                    const isSaving = saving === c.id
                    return (
                      <div
                        key={'c' + c.id}
                        draggable
                        onDragStart={() => setDragId(c.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setOverDate(null)
                        }}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium truncate cursor-grab active:cursor-grabbing select-none ${
                          PLATFORM_STYLE[c.platform] || 'bg-gray-800 text-gray-300'
                        } ${isSaving ? 'opacity-50' : ''} ${dragId === c.id ? 'opacity-40 ring-1 ring-sky-600' : ''}`}
                        title={`${c.title} — ${c.brand_name} · ${c.platform} · ${c.stage}`}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${st.dot} mr-1 align-middle`} />
                        {c.title}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-semibold">Platforms:</span>
        {Object.keys(PLATFORM_STYLE).map((p) => (
          <span key={p} className={`badge ${PLATFORM_STYLE[p]}`}>{p}</span>
        ))}
        <span className="badge bg-rose-900/40 text-rose-300">◎ Shoot</span>
        <span className="ml-2 text-gray-600">· Drag a card to reschedule its publish date</span>
      </div>
    </div>
  )
}
