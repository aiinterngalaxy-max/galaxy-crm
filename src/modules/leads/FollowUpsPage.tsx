import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertCircle, Calendar, ChevronRight, CheckCircle2, Phone } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, getDocs, orderBy } from '../../lib/firebase'
import { LEAD_STATUS_CONFIG, canManageLeads } from '../../lib/utils'
import type { Lead } from '../../types'

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

export function FollowUpsPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [tab, setTab] = useState<'today' | 'tomorrow' | 'upcoming'>('today')

  // Refresh the clock every minute so overdue vs upcoming updates live
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user) return
    const isAdmin = ['super_admin', 'management'].includes(role ?? '')
    // Non-admin: simple equality query (no composite index needed); filter nextFollowUp client-side
    const snap$ = isAdmin
      ? getDocs(query(collection(db, 'leads'), where('nextFollowUp', '!=', null), orderBy('nextFollowUp')))
      : getDocs(query(collection(db, 'leads'), where('assignedTo', '==', user.id)))

    snap$.then(snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
    }).catch(console.error).finally(() => setLoading(false))
  }, [user, role])

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

  // Exclude won/lost and leads without a follow-up set
  const active = leads.filter(l => !['won', 'lost'].includes(l.status) && l.nextFollowUp)

  // Overdue: past midnight today, sorted oldest-first (most urgent on top)
  const overdue      = active.filter(l => toMs(l.nextFollowUp) < today.getTime()).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const todayList    = active.filter(l => isSameDay(l.nextFollowUp, today)).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const tomorrowList = active.filter(l => isSameDay(l.nextFollowUp, tomorrow)).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  // Upcoming: strictly after tomorrow (day-after-tomorrow onwards)
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
      {/* Header */}
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

      {/* Tabs */}
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

      {/* Tab content */}
      {tab === 'today' && (
        <div className="space-y-4">
          {overdue.length > 0 && (
            <Section title="Overdue" icon={<AlertCircle className="w-4 h-4 text-red-400" />}
              color="text-red-400" leads={overdue} now={now} navigate={navigate} showDate />
          )}
          {todayList.length > 0 && (
            <Section title="Today" icon={<Clock className="w-4 h-4 text-yellow-400" />}
              color="text-yellow-400" leads={todayList} now={now} navigate={navigate} />
          )}
          {overdue.length === 0 && todayList.length === 0 && <Empty />}
        </div>
      )}

      {tab === 'tomorrow' && (
        <div>
          {tomorrowList.length > 0
            ? <Section title="Tomorrow" icon={<Calendar className="w-4 h-4 text-blue-400" />}
                color="text-blue-400" leads={tomorrowList} now={now} navigate={navigate} />
            : <Empty />}
        </div>
      )}

      {tab === 'upcoming' && (
        <div>
          {upcoming.length > 0
            ? <Section title="Upcoming" icon={<Calendar className="w-4 h-4 text-gray-400" />}
                color="text-gray-400" leads={upcoming} now={now} navigate={navigate} showDate />
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

function Section({ title, icon, color, leads, now, navigate, showDate }: {
  title: string
  icon: React.ReactNode
  color: string
  leads: Lead[]
  now: Date
  navigate: (path: string) => void
  showDate?: boolean
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
          return (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="flex items-center gap-4 px-4 py-3.5 hover:bg-white/[0.02] cursor-pointer transition-colors"
            >
              <div className="flex-1 min-w-0">
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
              </div>
              <div className="flex items-center gap-3 shrink-0">
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
