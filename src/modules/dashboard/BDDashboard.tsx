import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Phone, Calendar, Users2, TrendingUp, Plus, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, Filter, Search,
} from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, getDocs } from '../../lib/firebase'
import { formatRelative, LEAD_STATUS_CONFIG, getScoreColor, formatCurrency } from '../../lib/utils'
import type { Lead } from '../../types'
import { startOfDay, endOfDay, addDays, isBefore } from 'date-fns'
import { checkFollowUpNotifications } from '../../lib/notifyHelpers'
import { cn } from '../../lib/utils'

const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent'] as const

export function BDDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [allLeads, setAllLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterDemo, setFilterDemo] = useState<string>('all') // all | yes | no
  const [filterScore, setFilterScore] = useState<string>('all') // all | hot | warm | cold

  useEffect(() => {
    if (!user) return
    getDocs(query(collection(db, 'leads'), orderBy('updatedAt', 'desc')))
      .then(snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)
        const mine = all.filter(l => l.assignedTo === user!.id || l.createdBy === user!.id)
        setAllLeads(mine)
        checkFollowUpNotifications(user!.id, mine).catch(console.warn)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const today = new Date()
  const myLeads = allLeads.filter(l => !['won', 'lost'].includes(l.status))
  const overdueFollowUps = myLeads.filter(l => {
    if (!l.nextFollowUp) return false
    return isBefore(l.nextFollowUp.toDate(), startOfDay(today))
  })
  const followUpsToday = myLeads.filter(l => {
    if (!l.nextFollowUp) return false
    const d = l.nextFollowUp.toDate()
    return d >= startOfDay(today) && d <= endOfDay(today)
  })
  const followUpsThisWeek = myLeads.filter(l => {
    if (!l.nextFollowUp) return false
    const d = l.nextFollowUp.toDate()
    return d > endOfDay(today) && d <= endOfDay(addDays(today, 7))
  })
  const hotLeads = myLeads.filter(l => l.aiScore >= 70)
  const wonLeads = allLeads.filter(l => l.status === 'won')
  const demoGivenCount = allLeads.filter(l => l.demoGiven).length

  // Source breakdown
  const sourceMap: Record<string, number> = {}
  allLeads.forEach(l => { const s = l.source || 'other'; sourceMap[s] = (sourceMap[s] || 0) + 1 })
  const topSources = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 4)

  // Filtered leads for the table
  const filtered = allLeads.filter(l => {
    const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.phone || '').includes(search)
    const matchStatus = filterStatus === 'all' || l.status === filterStatus
    const matchDemo = filterDemo === 'all' || (filterDemo === 'yes' ? !!l.demoGiven : !l.demoGiven)
    const matchScore = filterScore === 'all'
      || (filterScore === 'hot' && l.aiScore >= 70)
      || (filterScore === 'warm' && l.aiScore >= 40 && l.aiScore < 70)
      || (filterScore === 'cold' && l.aiScore < 40)
    return matchSearch && matchStatus && matchDemo && matchScore
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">BD Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{user?.name} — Business Development</p>
        </div>
        <Button onClick={() => navigate('/leads')} icon={<Plus className="w-4 h-4" />}>New Lead</Button>
      </div>

      {/* Overdue alert banner */}
      {overdueFollowUps.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-900/20 border border-red-800/50">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300 flex-1">
            <span className="font-bold">{overdueFollowUps.length} overdue follow-up{overdueFollowUps.length > 1 ? 's' : ''}</span>
            {' '}— {overdueFollowUps.map(l => l.name).slice(0, 3).join(', ')}{overdueFollowUps.length > 3 ? ` +${overdueFollowUps.length - 3} more` : ''}
          </p>
          <button onClick={() => navigate('/leads')} className="text-xs text-red-400 hover:text-red-300 shrink-0 flex items-center gap-1">
            View <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Leads" value={myLeads.length}
          icon={<Users2 className="w-5 h-5 text-indigo-400" />} iconBg="bg-indigo-900/40"
          onClick={() => navigate('/leads')} />
        <StatCard label="Overdue Follow-ups" value={overdueFollowUps.length}
          subValue={overdueFollowUps.length > 0 ? 'Needs attention!' : 'All clear'}
          icon={<AlertTriangle className="w-5 h-5 text-red-400" />} iconBg="bg-red-900/40" />
        <StatCard label="Hot Leads" value={hotLeads.length}
          subValue="Score ≥ 70"
          icon={<TrendingUp className="w-5 h-5 text-gold-400" />} iconBg="bg-gold-500/20" />
        <StatCard label="Demos Given" value={demoGivenCount}
          subValue={`${wonLeads.length} converted`}
          icon={<CheckCircle2 className="w-5 h-5 text-green-400" />} iconBg="bg-green-900/40" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Follow-up timeline */}
        <Card padding="none" className="lg:col-span-1">
          <div className="p-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-400" /> Follow-up Timeline
            </h3>
          </div>
          <div className="divide-y divide-gray-800">
            {/* Overdue */}
            {overdueFollowUps.length > 0 && (
              <div className="p-3">
                <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Overdue</p>
                {overdueFollowUps.map(lead => (
                  <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                    className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg px-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                    <span className="text-xs text-gray-200 flex-1 truncate">{lead.name}</span>
                    <span className="text-xs text-red-400 shrink-0">{formatRelative(lead.nextFollowUp!)}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Today */}
            {followUpsToday.length > 0 && (
              <div className="p-3">
                <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-2">Today</p>
                {followUpsToday.map(lead => (
                  <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                    className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg px-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                    <span className="text-xs text-gray-200 flex-1 truncate">{lead.name}</span>
                    <Badge color={LEAD_STATUS_CONFIG[lead.status]?.color} bg={LEAD_STATUS_CONFIG[lead.status]?.bg}>
                      {LEAD_STATUS_CONFIG[lead.status]?.label}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            {/* This week */}
            {followUpsThisWeek.length > 0 && (
              <div className="p-3">
                <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">This Week</p>
                {followUpsThisWeek.slice(0, 5).map(lead => (
                  <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                    className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg px-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    <span className="text-xs text-gray-200 flex-1 truncate">{lead.name}</span>
                    <span className="text-xs text-gray-500 shrink-0">{formatRelative(lead.nextFollowUp!)}</span>
                  </div>
                ))}
              </div>
            )}
            {overdueFollowUps.length === 0 && followUpsToday.length === 0 && followUpsThisWeek.length === 0 && (
              <p className="p-5 text-xs text-gray-600 text-center">No upcoming follow-ups 🎉</p>
            )}
          </div>
        </Card>

        {/* Pipeline funnel + source */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-200 mb-4">My Pipeline</h3>
            <div className="space-y-2">
              {PIPELINE_STAGES.map(status => {
                const count = allLeads.filter(l => l.status === status).length
                const cfg = LEAD_STATUS_CONFIG[status]
                const pct = allLeads.length > 0 ? Math.round((count / allLeads.length) * 100) : 0
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className={`text-xs font-medium w-24 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{count}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-800 flex gap-4 text-xs text-gray-500">
              <span className="text-green-400 font-medium">Won: {wonLeads.length}</span>
              <span className="text-red-400 font-medium">Lost: {allLeads.filter(l => l.status === 'lost').length}</span>
              {allLeads.length > 0 && <span>Conversion: {Math.round((wonLeads.length / allLeads.length) * 100)}%</span>}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Lead Sources</h3>
            <div className="space-y-2">
              {topSources.map(([source, count]) => {
                const pct = allLeads.length > 0 ? Math.round((count / allLeads.length) * 100) : 0
                return (
                  <div key={source} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-28 capitalize shrink-0">{source.replace(/_/g, ' ')}</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gold-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{count}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* All leads table with filters */}
      <Card padding="none">
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">All My Leads</h3>
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-40">
              <Input placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />} />
            </div>
            {/* Status filter */}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none">
              <option value="all">All Status</option>
              {[...PIPELINE_STAGES, 'won', 'lost'].map(s => (
                <option key={s} value={s}>{LEAD_STATUS_CONFIG[s as keyof typeof LEAD_STATUS_CONFIG]?.label || s}</option>
              ))}
            </select>
            {/* Demo filter */}
            <select value={filterDemo} onChange={e => setFilterDemo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none">
              <option value="all">All Demo</option>
              <option value="yes">Demo Given</option>
              <option value="no">No Demo</option>
            </select>
            {/* Score filter */}
            <select value={filterScore} onChange={e => setFilterScore(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none">
              <option value="all">All Scores</option>
              <option value="hot">Hot (≥70)</option>
              <option value="warm">Warm (40–69)</option>
              <option value="cold">Cold (&lt;40)</option>
            </select>
          </div>
        </div>
        {loading && <div className="p-6 text-sm text-gray-500 text-center">Loading…</div>}
        <div className="divide-y divide-gray-800">
          {filtered.map(lead => {
            const isOverdue = lead.nextFollowUp && isBefore(lead.nextFollowUp.toDate(), startOfDay(today))
            const isDueToday = lead.nextFollowUp && !isOverdue &&
              lead.nextFollowUp.toDate() <= endOfDay(today)
            return (
              <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/40 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-200 truncate">{lead.name}</p>
                    {lead.demoGiven && <span className="text-[10px] text-indigo-400 bg-indigo-900/30 px-1.5 py-0.5 rounded shrink-0">Demo ✓</span>}
                  </div>
                  <p className="text-xs text-gray-500">{lead.phone} · {lead.source?.replace(/_/g, ' ')}</p>
                </div>
                <Badge color={LEAD_STATUS_CONFIG[lead.status]?.color} bg={LEAD_STATUS_CONFIG[lead.status]?.bg} className="shrink-0 hidden sm:flex">
                  {LEAD_STATUS_CONFIG[lead.status]?.label}
                </Badge>
                <span className={`text-xs font-bold shrink-0 ${getScoreColor(lead.aiScore)}`}>{lead.aiScore}</span>
                {lead.nextFollowUp ? (
                  <div className={cn('flex items-center gap-1 text-xs shrink-0', isOverdue ? 'text-red-400' : isDueToday ? 'text-yellow-400' : 'text-gray-500')}>
                    {isOverdue ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {formatRelative(lead.nextFollowUp)}
                  </div>
                ) : (
                  <span className="text-xs text-gray-700 shrink-0">No follow-up</span>
                )}
                <ChevronRight className="w-4 h-4 text-gray-700 shrink-0" />
              </div>
            )
          })}
          {!loading && filtered.length === 0 && (
            <p className="p-6 text-sm text-gray-600 text-center">No leads match your filters</p>
          )}
        </div>
      </Card>
    </div>
  )
}
