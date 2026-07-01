import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertCircle, Calendar, ChevronRight, CheckCircle2, Phone, X, Pencil, MessageSquare } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, where, getDocs, orderBy, limit,
  addDoc, updateDoc, doc, serverTimestamp,
} from '../../lib/firebase'
import { LEAD_STATUS_CONFIG } from '../../lib/utils'
import type { Lead } from '../../types'
import toast from 'react-hot-toast'

interface LastActivity {
  description: string
  type: string
  performedByName?: string
  createdAt: any
}

function formatTime(ts: any): string {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDateLabel(ts: any): string {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isSameDay(ts: any, ref: Date): boolean {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
}

function toMs(ts: any): number {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.getTime()
}

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Phone Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'note', label: 'Note' },
]

interface DoneModalProps {
  lead: Lead
  onClose: () => void
  onDone: (leadId: string) => void
}

function DoneModal({ lead, onClose, onDone }: DoneModalProps) {
  const { user } = useAuth()
  const [actType, setActType] = useState('call')
  const [notes, setNotes] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!notes.trim()) { toast.error('Please add an update'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'leads', lead.id, 'activities'), {
        leadId: lead.id,
        type: actType,
        description: notes.trim(),
        performedBy: user?.id,
        performedByName: user?.name,
        ...(nextFollowUp ? { followUpDate: new Date(nextFollowUp) } : {}),
        createdAt: serverTimestamp(),
      })
      await updateDoc(doc(db, 'leads', lead.id), {
        nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null,
        updatedAt: serverTimestamp(),
      })
      toast.success('Follow-up marked as done')
      onDone(lead.id)
    } catch (e: any) {
      toast.error('Failed to save: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Mark Done — Log Activity</p>
            <p className="text-base font-semibold text-gray-100 mt-0.5">{lead.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">What did you do?</p>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setActType(t.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    actType === t.value
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Update / Notes <span className="text-red-400">*</span></p>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What happened? Any next steps?"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Next Follow-up <span className="text-gray-600">(optional)</span></p>
            <input
              type="datetime-local"
              value={nextFollowUp}
              onChange={e => setNextFollowUp(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3 justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : '✓ Mark Done'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface EditDateModalProps {
  lead: Lead
  onClose: () => void
  onSaved: (leadId: string, newTs: any) => void
}

function EditDateModal({ lead, onClose, onSaved }: EditDateModalProps) {
  const existing = lead.nextFollowUp as any
  const toLocalInput = (ts: any) => {
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [value, setValue] = useState(existing ? toLocalInput(existing) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!value) return
    setSaving(true)
    try {
      const newDate = new Date(value)
      await updateDoc(doc(db, 'leads', lead.id), {
        nextFollowUp: newDate,
        updatedAt: serverTimestamp(),
      })
      toast.success('Follow-up date updated')
      onSaved(lead.id, newDate)
    } catch (e: any) {
      toast.error('Failed: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Edit Follow-up Date</p>
            <p className="text-base font-semibold text-gray-100 mt-0.5">{lead.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">
          <input
            type="datetime-local"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="px-5 pb-5 flex gap-3 justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !value}
            className="text-sm px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FollowUpsPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState<Lead[]>([])
  const [lastActivities, setLastActivities] = useState<Map<string, LastActivity>>(new Map())
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [tab, setTab] = useState<'today' | 'tomorrow' | 'upcoming'>('today')
  const [doneModal, setDoneModal] = useState<Lead | null>(null)
  const [editModal, setEditModal] = useState<Lead | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user) return

    getDocs(query(collection(db, 'leads'), where('nextFollowUp', '!=', null), orderBy('nextFollowUp')))
      .then(async snap => {
        const fetchedLeads = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)
        setLeads(fetchedLeads)

        // Fetch last activity for each lead in parallel
        const entries = await Promise.all(
          fetchedLeads.map(async lead => {
            try {
              const actSnap = await getDocs(
                query(collection(db, 'leads', lead.id, 'activities'), orderBy('createdAt', 'desc'), limit(1))
              )
              if (!actSnap.empty) {
                const d = actSnap.docs[0].data()
                return [lead.id, { description: d.description, type: d.type, performedByName: d.performedByName, createdAt: d.createdAt }] as [string, LastActivity]
              }
            } catch { /* ignore per-lead errors */ }
            return null
          })
        )
        const map = new Map<string, LastActivity>()
        entries.forEach(e => { if (e) map.set(e[0], e[1]) })
        setLastActivities(map)
      })
      .catch(err => console.error('[FollowUps] fetch error:', err))
      .finally(() => setLoading(false))
  }, [user, role])

  function handleDone(leadId: string) {
    setLeads(prev => prev.filter(l => l.id !== leadId))
    setDoneModal(null)
  }

  function handleDateSaved(leadId: string, newTs: any) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, nextFollowUp: newTs } : l))
    setEditModal(null)
  }

  const today = useMemo(() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d
  }, [now.toDateString()])

  const tomorrow = useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return d
  }, [today])

  const active = leads.filter(l => !['won', 'lost'].includes(l.status) && l.nextFollowUp)

  const overdue      = active.filter(l => toMs(l.nextFollowUp) < now.getTime()).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const todayList    = active.filter(l => isSameDay(l.nextFollowUp, today) && toMs(l.nextFollowUp) >= now.getTime()).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const tomorrowList = active.filter(l => isSameDay(l.nextFollowUp, tomorrow)).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const dayAfterTomorrow = new Date(tomorrow); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1)
  const upcoming     = active.filter(l => toMs(l.nextFollowUp) >= dayAfterTomorrow.getTime()).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp)).slice(0, 10)

  const totalToday = todayList.length + overdue.length

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-600">Loading follow-ups…</div>
  }

  const TABS = [
    { key: 'today',    label: 'Today',    count: todayList.length + overdue.length },
    { key: 'tomorrow', label: 'Tomorrow', count: tomorrowList.length },
    { key: 'upcoming', label: 'Upcoming', count: upcoming.length },
  ] as const

  return (
    <div className="space-y-5 max-w-3xl">
      {doneModal && (
        <DoneModal lead={doneModal} onClose={() => setDoneModal(null)} onDone={handleDone} />
      )}
      {editModal && (
        <EditDateModal lead={editModal} onClose={() => setEditModal(null)} onSaved={handleDateSaved} />
      )}

      <div>
        <h1 className="page-title flex items-center gap-2">
          <Clock className="w-6 h-6 text-yellow-400" />
          Follow-ups
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {totalToday > 0
            ? `${totalToday} follow-up${totalToday > 1 ? 's' : ''} due today`
            : 'No follow-ups due today'}
          {overdue.length > 0 && ` · ${overdue.length} overdue`}
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-gray-700 text-white shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              tab === t.key ? 'bg-gold-500/20 text-gold-400' : 'bg-gray-700 text-gray-500'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div className="space-y-4">
          {overdue.length > 0 && (
            <Section title="Overdue" icon={<AlertCircle className="w-4 h-4 text-red-400" />}
              color="text-red-400" leads={overdue} now={now} navigate={navigate} showDate
              onDone={setDoneModal} onEdit={setEditModal} lastActivities={lastActivities} />
          )}
          {todayList.length > 0 && (
            <Section title="Today" icon={<Clock className="w-4 h-4 text-yellow-400" />}
              color="text-yellow-400" leads={todayList} now={now} navigate={navigate}
              onDone={setDoneModal} onEdit={setEditModal} lastActivities={lastActivities} />
          )}
          {overdue.length === 0 && todayList.length === 0 && <Empty />}
        </div>
      )}

      {tab === 'tomorrow' && (
        <div>
          {tomorrowList.length > 0
            ? <Section title="Tomorrow" icon={<Calendar className="w-4 h-4 text-blue-400" />}
                color="text-blue-400" leads={tomorrowList} now={now} navigate={navigate}
                onDone={setDoneModal} onEdit={setEditModal} lastActivities={lastActivities} />
            : <Empty />}
        </div>
      )}

      {tab === 'upcoming' && (
        <div>
          {upcoming.length > 0
            ? <Section title="Upcoming" icon={<Calendar className="w-4 h-4 text-gray-400" />}
                color="text-gray-400" leads={upcoming} now={now} navigate={navigate} showDate
                onDone={setDoneModal} onEdit={setEditModal} lastActivities={lastActivities} />
            : <Empty />}
        </div>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="glass-card p-12 text-center">
      <CheckCircle2 className="w-10 h-10 text-gray-700 mx-auto mb-3" />
      <p className="text-sm text-gray-500">No follow-ups here</p>
    </div>
  )
}

function Section({ title, icon, color, leads, now, navigate, showDate, onDone, onEdit, lastActivities }: {
  title: string
  icon: React.ReactNode
  color: string
  leads: Lead[]
  now: Date
  navigate: (path: string) => void
  showDate?: boolean
  onDone: (lead: Lead) => void
  onEdit: (lead: Lead) => void
  lastActivities: Map<string, LastActivity>
}) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${color}`}>
        {icon}
        {title}
        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full font-normal">{leads.length}</span>
      </div>
      <div className="glass-card divide-y divide-gray-800 overflow-hidden">
        {leads.map(lead => {
          const statusCfg = LEAD_STATUS_CONFIG[lead.status]
          const dueMs = lead.nextFollowUp ? (lead.nextFollowUp as any)?.toDate ? (lead.nextFollowUp as any).toDate().getTime() : new Date(lead.nextFollowUp as any).getTime() : 0
          const isPast = dueMs < now.getTime()
          const lastAct = lastActivities.get(lead.id)
          return (
            <div key={lead.id} className="flex items-start gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
              {/* Done + Edit buttons */}
              <div className="flex flex-col items-center gap-2 pt-0.5 shrink-0">
                <button
                  onClick={() => onDone(lead)}
                  title="Mark as done"
                  className="w-5 h-5 rounded-full border-2 border-gray-600 hover:border-green-500 hover:bg-green-500/10 transition-all flex items-center justify-center group"
                >
                  <CheckCircle2 className="w-3 h-3 text-transparent group-hover:text-green-500 transition-colors" />
                </button>
                <button
                  onClick={() => onEdit(lead)}
                  title="Edit follow-up date"
                  className="text-gray-600 hover:text-indigo-400 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Lead info */}
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/leads/${lead.id}`)}>
                <p className="text-sm font-medium text-gray-200 truncate">{lead.name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {lead.phone && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Phone className="w-3 h-3" />{lead.phone}
                    </span>
                  )}
                  {lead.assignedToName && (
                    <span className="text-xs text-gray-600">· {lead.assignedToName}</span>
                  )}
                </div>
                {/* Last activity note */}
                {lastAct && (
                  <div className="flex items-start gap-1.5 mt-1.5 bg-gray-800/50 rounded-lg px-2.5 py-1.5">
                    <MessageSquare className="w-3 h-3 text-indigo-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">
                      <span className="text-indigo-400 capitalize font-medium">{lastAct.type}</span>
                      {lastAct.performedByName && <span className="text-gray-400"> · {lastAct.performedByName}</span>}
                      <span className="text-gray-500"> — </span>
                      {lastAct.description}
                    </p>
                  </div>
                )}
                {!lastAct && (
                  <p className="text-xs text-gray-600 mt-1.5 italic">No activity logged yet</p>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0 cursor-pointer pt-0.5" onClick={() => navigate(`/leads/${lead.id}`)}>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${isPast ? 'text-red-400' : 'text-yellow-400'}`}>
                    {formatTime(lead.nextFollowUp)}
                  </p>
                  {showDate && (
                    <p className="text-xs text-gray-600">{formatDateLabel(lead.nextFollowUp)}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color} ${statusCfg.bg}`}>
                  {statusCfg.label}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-700" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
