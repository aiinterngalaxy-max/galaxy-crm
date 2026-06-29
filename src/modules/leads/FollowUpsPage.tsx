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

  // Refresh the clock every minute so overdue vs upcoming updates live
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user) return
    const isAdmin = ['super_admin', 'management'].includes(role ?? '')
    const snap$ = isAdmin
      ? getDocs(query(collection(db, 'leads'), where('nextFollowUp', '!=', null), orderBy('nextFollowUp')))
      : getDocs(query(collection(db, 'leads'), where('assignedTo', '==', user.id), where('nextFollowUp', '!=', null), orderBy('nextFollowUp')))

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

  // Exclude won/lost
  const active = leads.filter(l => !['won', 'lost'].includes(l.status) && l.nextFollowUp)

  const overdue   = active.filter(l => toMs(l.nextFollowUp) < now.getTime() && !isSameDay(l.nextFollowUp, today)).sort((a, b) => toMs(b.nextFollowUp) - toMs(a.nextFollowUp))
  const todayList = active.filter(l => isSameDay(l.nextFollowUp, today)).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const tomorrowList = active.filter(l => isSameDay(l.nextFollowUp, tomorrow)).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp))
  const upcoming  = active.filter(l => toMs(l.nextFollowUp) > tomorrow.getTime() + 86400000).sort((a, b) => toMs(a.nextFollowUp) - toMs(b.nextFollowUp)).slice(0, 10)

  const totalToday = todayList.length + overdue.length

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-600">Loading follow-ups…</div>
  }

  return (
    <div className="space-y-6 max-w-3xl">
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

      {active.length === 0 && (
        <div className="glass-card p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No scheduled follow-ups</p>
          <p className="text-xs text-gray-700 mt-1">When you schedule follow-ups on leads, they appear here.</p>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <Section
          title="Overdue"
          icon={<AlertCircle className="w-4 h-4 text-red-400" />}
          color="text-red-400"
          leads={overdue}
          now={now}
          navigate={navigate}
          showDate
        />
      )}

      {/* Today */}
      {todayList.length > 0 && (
        <Section
          title="Today"
          icon={<Clock className="w-4 h-4 text-yellow-400" />}
          color="text-yellow-400"
          leads={todayList}
          now={now}
          navigate={navigate}
        />
      )}

      {/* Tomorrow */}
      {tomorrowList.length > 0 && (
        <Section
          title="Tomorrow"
          icon={<Calendar className="w-4 h-4 text-blue-400" />}
          color="text-blue-400"
          leads={tomorrowList}
          now={now}
          navigate={navigate}
        />
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Section
          title="Upcoming"
          icon={<Calendar className="w-4 h-4 text-gray-400" />}
          color="text-gray-400"
          leads={upcoming}
          now={now}
          navigate={navigate}
          showDate
        />
      )}
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
