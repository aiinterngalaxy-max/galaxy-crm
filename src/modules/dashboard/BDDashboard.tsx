import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Calendar, Users2, TrendingUp, Plus, ChevronRight } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, orderBy, limit, getDocs, Timestamp } from '../../lib/firebase'
import { formatRelative, LEAD_STATUS_CONFIG, getScoreColor } from '../../lib/utils'
import type { Lead, LeadActivity } from '../../types'
import { startOfDay, endOfDay } from 'date-fns'

export function BDDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [myLeads, setMyLeads] = useState<Lead[]>([])
  const [todayActivities, setTodayActivities] = useState<LeadActivity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function fetchData() {
      try {
        const leadsSnap = await getDocs(
          query(
            collection(db, 'leads'),
            where('assignedTo', '==', user!.id),
            orderBy('updatedAt', 'desc'),
            limit(30)
          )
        )
        setMyLeads(leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [user])

  const today = new Date()
  const followUpsDueToday = myLeads.filter(l => {
    if (!l.nextFollowUp) return false
    const d = l.nextFollowUp.toDate()
    return d >= startOfDay(today) && d <= endOfDay(today)
  })
  const activeLeads = myLeads.filter(l => !['won', 'lost'].includes(l.status))
  const hotLeads = myLeads.filter(l => l.aiScore >= 70 && !['won', 'lost'].includes(l.status))
  const callsToday = todayActivities.filter(a => a.type === 'call').length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{user?.name} — Business Development</p>
        </div>
        <Button onClick={() => navigate('/leads')} icon={<Plus className="w-4 h-4" />}>
          New Lead
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="My Active Leads"
          value={activeLeads.length}
          icon={<Users2 className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Follow-Ups Today"
          value={followUpsDueToday.length}
          subValue={followUpsDueToday.length > 0 ? 'Action needed' : 'All done'}
          icon={<Calendar className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          trend={followUpsDueToday.length > 0 ? { value: 'Due now', up: false } : undefined}
        />
        <StatCard
          label="Calls Today"
          value={callsToday}
          icon={<Phone className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
        />
        <StatCard
          label="Hot Leads"
          value={hotLeads.length}
          subValue="Score ≥ 70"
          icon={<TrendingUp className="w-5 h-5 text-red-400" />}
          iconBg="bg-red-900/40"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Follow-Ups */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">Follow-Ups Due Today</h2>
            <button onClick={() => navigate('/leads')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              All leads <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-800">
            {followUpsDueToday.length === 0 && (
              <p className="p-5 text-sm text-gray-600 text-center">No follow-ups due today 🎉</p>
            )}
            {followUpsDueToday.map(lead => (
              <div
                key={lead.id}
                onClick={() => navigate(`/leads/${lead.id}`)}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-800/50 cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-900/50 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
                  {lead.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.phone}</p>
                </div>
                <div className="text-right shrink-0">
                  <Badge color={LEAD_STATUS_CONFIG[lead.status]?.color} bg={LEAD_STATUS_CONFIG[lead.status]?.bg}>
                    {LEAD_STATUS_CONFIG[lead.status]?.label}
                  </Badge>
                  <p className={`text-xs font-bold mt-1 ${getScoreColor(lead.aiScore)}`}>
                    {lead.aiScore}/100
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* My Pipeline */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800">
            <h2 className="section-header">My Pipeline</h2>
          </div>
          <div className="p-5 space-y-3">
            {(['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent'] as const).map(status => {
              const count = myLeads.filter(l => l.status === status).length
              const cfg = LEAD_STATUS_CONFIG[status]
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-24 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: myLeads.length ? `${(count / myLeads.length) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-6 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Recent Leads */}
      <Card padding="none">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="section-header">Recent Leads</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/leads')}>View all</Button>
        </div>
        <div className="divide-y divide-gray-800">
          {loading && <p className="p-5 text-sm text-gray-600 text-center">Loading…</p>}
          {myLeads.slice(0, 8).map(lead => (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="flex items-center gap-4 px-5 py-3 hover:bg-gray-800/50 cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200">{lead.name}</p>
                <p className="text-xs text-gray-500">{lead.phone} · {lead.source}</p>
              </div>
              <Badge color={LEAD_STATUS_CONFIG[lead.status]?.color} bg={LEAD_STATUS_CONFIG[lead.status]?.bg}>
                {LEAD_STATUS_CONFIG[lead.status]?.label}
              </Badge>
              <span className={`text-xs font-bold ${getScoreColor(lead.aiScore)}`}>{lead.aiScore}</span>
              <span className="text-xs text-gray-600">{formatRelative(lead.updatedAt)}</span>
            </div>
          ))}
          {!loading && myLeads.length === 0 && (
            <p className="p-5 text-sm text-gray-600 text-center">No leads assigned yet</p>
          )}
        </div>
      </Card>
    </div>
  )
}
