import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, Users2, FolderKanban, Receipt, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, ChevronRight, Trophy,
  CalendarCheck, Target, ThumbsUp, ThumbsDown,
} from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useNavigate } from 'react-router-dom'
import { db, collection, query, where, orderBy, limit, getDocs, onSnapshot } from '../../lib/firebase'
import { Timestamp } from 'firebase/firestore'
import { formatCurrencyShort, formatCurrency, PROJECT_STATUS_CONFIG, LEAD_STATUS_CONFIG, cn } from '../../lib/utils'
import type { Lead, Project, Invoice } from '../../types'
import { useAuth } from '../../contexts/AuthContext'

export function ManagementDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let done = 0
    const check = () => { if (++done === 3) setLoading(false) }

    // Real-time leads
    const leadsUnsub = onSnapshot(
      query(collection(db, 'leads'), orderBy('createdAt', 'desc'), limit(300)),
      snap => { setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead).filter(l => (l as any).businessType !== 'b2b')); check() },
      () => check()
    )

    // Projects
    getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(50)))
      .then(snap => { setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)); check() })
      .catch(() => check())

    // Overdue invoices
    getDocs(query(collection(db, 'invoices'), where('status', 'in', ['sent', 'partially_paid', 'overdue']), limit(20)))
      .then(snap => { setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice)); check() })
      .catch(() => check())

    return () => leadsUnsub()
  }, [])

  // ── Computed metrics ──────────────────────────────────────────────────────

  const now     = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const activeLeads    = leads.filter(l => !['won', 'lost'].includes(l.status))
  const hotLeads       = leads.filter(l => l.aiScore >= 70 && !['won', 'lost'].includes(l.status))
  const pipelineValue  = activeLeads.reduce((s, l) => s + (l.estimatedBudget || 0), 0)
  const activeProjects = projects.filter(p => p.status === 'in_progress')
  const atRiskProjects = projects.filter(p => p.riskLevel === 'high' && p.status === 'in_progress')
  const overdueInvoices = invoices.filter(i => i.status === 'overdue')
  const totalOutstanding = invoices.reduce((s, i) => s + (i.balance || 0), 0)

  const leadsThisWeek = useMemo(() => leads.filter(l => {
    const ts = l.createdAt as any
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
    return d >= weekAgo
  }), [leads])

  const wonThisMonth  = useMemo(() => leads.filter(l => {
    if (l.status !== 'won') return false
    const ts = l.updatedAt as any
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
    return d >= monthStart
  }), [leads])

  const lostThisMonth = useMemo(() => leads.filter(l => {
    if (l.status !== 'lost') return false
    const ts = l.updatedAt as any
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
    return d >= monthStart
  }), [leads])

  // Top BD exec by contacted + won leads
  const bdLeaderboard = useMemo(() => {
    const map: Record<string, { name: string; contacted: number; won: number }> = {}
    leads.forEach(l => {
      if (!l.assignedToName) return
      if (!map[l.assignedToName]) map[l.assignedToName] = { name: l.assignedToName, contacted: 0, won: 0 }
      if (l.status !== 'new' && l.status !== 'lost') map[l.assignedToName].contacted++
      if (l.status === 'won') map[l.assignedToName].won++
    })
    return Object.values(map).sort((a, b) => b.won - a.won || b.contacted - a.contacted).slice(0, 5)
  }, [leads])

  // Follow-ups due today or overdue
  const followUpsDue = useMemo(() => leads.filter(l => {
    const fu = (l as any).nextFollowUp as Timestamp | undefined
    if (!fu) return false
    const d: Date = fu?.toDate ? fu.toDate() : new Date(fu as any)
    return d <= now && !['won', 'lost'].includes(l.status)
  }), [leads])

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'Sir'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  const winRate = wonThisMonth.length + lostThisMonth.length > 0
    ? Math.round(wonThisMonth.length / (wonThisMonth.length + lostThisMonth.length) * 100)
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">{greeting()}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Live company snapshot · {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Follow-up alert banner */}
      {followUpsDue.length > 0 && (
        <div onClick={() => navigate('/leads')}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-800 bg-yellow-900/20 cursor-pointer hover:bg-yellow-900/30 transition-colors">
          <CalendarCheck className="w-4 h-4 text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300 font-medium">
            {followUpsDue.length} follow-up{followUpsDue.length > 1 ? 's' : ''} due today or overdue
          </p>
          <span className="ml-auto text-xs text-yellow-600 flex items-center gap-1">View leads <ChevronRight className="w-3 h-3" /></span>
        </div>
      )}

      {/* KPI Row */}
      <div data-tour="stat-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pipeline Value"
          value={formatCurrencyShort(pipelineValue)}
          subValue={`${activeLeads.length} active leads`}
          icon={<TrendingUp className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Leads This Week"
          value={leadsThisWeek.length}
          subValue={`${hotLeads.length} hot (score ≥ 70)`}
          icon={<Users2 className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Active Projects"
          value={activeProjects.length}
          subValue={atRiskProjects.length > 0 ? `${atRiskProjects.length} at risk` : 'All on track'}
          icon={<FolderKanban className="w-5 h-5 text-violet-400" />}
          iconBg="bg-violet-900/40"
          trend={atRiskProjects.length > 0 ? { value: `${atRiskProjects.length} at risk`, up: false } : undefined}
          onClick={() => navigate('/projects')}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrencyShort(totalOutstanding)}
          subValue={`${overdueInvoices.length} overdue`}
          icon={<Receipt className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          trend={overdueInvoices.length > 0 ? { value: `${overdueInvoices.length} overdue`, up: false } : undefined}
          onClick={() => navigate('/projects')}
        />
      </div>

      {/* Won / Lost this month + BD Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Won vs Lost */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header flex items-center gap-2"><Target className="w-4 h-4 text-gold-400" /> This Month</h2>
            <span className="text-xs text-gray-600">{now.toLocaleString('en-IN', { month: 'long' })}</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-900/30 flex items-center justify-center">
                  <ThumbsUp className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Deals Won</p>
                  <p className="text-2xl font-bold text-green-400">{wonThisMonth.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-900/30 flex items-center justify-center">
                  <ThumbsDown className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Deals Lost</p>
                  <p className="text-2xl font-bold text-red-400">{lostThisMonth.length}</p>
                </div>
              </div>
            </div>

            {winRate !== null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500">Win Rate</p>
                  <p className="text-xs font-bold text-white">{winRate}%</p>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{ width: `${winRate}%` }} />
                </div>
              </div>
            )}

            {wonThisMonth.length === 0 && lostThisMonth.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-2">No closed deals yet this month</p>
            )}

            {/* Recent wins */}
            {wonThisMonth.slice(0, 3).map(l => (
              <div key={l.id} onClick={() => navigate(`/leads/${l.id}`)}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-800/40 -mx-2 px-2 py-1 rounded-lg transition-colors">
                <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                <p className="text-xs text-gray-300 truncate">{l.name}</p>
                {l.estimatedBudget ? <span className="text-xs text-green-400 ml-auto shrink-0">{formatCurrencyShort(l.estimatedBudget)}</span> : null}
              </div>
            ))}
          </div>
        </Card>

        {/* BD Leaderboard */}
        <Card padding="none" className="lg:col-span-2">
          <div className="p-5 border-b border-gray-800">
            <h2 className="section-header flex items-center gap-2"><Trophy className="w-4 h-4 text-gold-400" /> BD Leaderboard</h2>
          </div>
          {loading ? (
            <div className="p-5 text-sm text-gray-600 text-center">Loading…</div>
          ) : bdLeaderboard.length === 0 ? (
            <div className="p-5 text-sm text-gray-600 text-center">No data yet — assign leads to team members</div>
          ) : (
            <div className="divide-y divide-gray-800">
              {bdLeaderboard.map((exec, i) => (
                <div key={exec.name} className="flex items-center gap-4 px-5 py-3">
                  <span className={cn('text-sm font-bold w-5 text-center shrink-0',
                    i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-600'
                  )}>#{i + 1}</span>
                  <div className="w-7 h-7 rounded-full bg-indigo-900/40 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-indigo-400">{exec.name[0]}</span>
                  </div>
                  <p className="text-sm text-gray-200 font-medium flex-1 truncate">{exec.name}</p>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[10px] text-gray-600">Active</p>
                      <p className="text-sm font-bold text-gray-300">{exec.contacted}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-600">Won</p>
                      <p className="text-sm font-bold text-green-400">{exec.won}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Lead Pipeline + Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">Lead Pipeline</h2>
            <button onClick={() => navigate('/leads')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-5 space-y-3">
            {(['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent'] as const).map(status => {
              const count = leads.filter(l => l.status === status).length
              const cfg = LEAD_STATUS_CONFIG[status]
              const pct = activeLeads.length ? Math.round((count / activeLeads.length) * 100) : 0
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-24 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-6 text-right shrink-0">{count}</span>
                </div>
              )
            })}
            <div className="pt-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-600">
              <span>{leads.filter(l => l.status === 'won').length} won all time</span>
              <span>{leads.filter(l => l.status === 'lost').length} lost all time</span>
            </div>
          </div>
        </Card>

        <Card padding="none">
          <div className="p-5 border-b border-gray-800">
            <h2 className="section-header flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-400" /> Action Required</h2>
          </div>
          <div className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
            {followUpsDue.slice(0, 4).map(l => (
              <div key={l.id} onClick={() => navigate(`/leads/${l.id}`)}
                className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer">
                <CalendarCheck className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{l.name}</p>
                  <p className="text-xs text-gray-500">Follow-up overdue · {l.assignedToName || 'Unassigned'}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700 ml-auto mt-0.5 shrink-0" />
              </div>
            ))}
            {atRiskProjects.map(p => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{p.title}</p>
                  <p className="text-xs text-gray-500">{p.riskFlags?.join(' · ')}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700 ml-auto mt-0.5 shrink-0" />
              </div>
            ))}
            {overdueInvoices.map(inv => (
              <div key={inv.id} onClick={() => navigate('/projects')}
                className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer">
                <Clock className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{inv.customerName || inv.invoiceCode}</p>
                  <p className="text-xs text-gray-500">Invoice overdue — {formatCurrency(inv.balance)}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700 ml-auto mt-0.5 shrink-0" />
              </div>
            ))}
            {followUpsDue.length === 0 && atRiskProjects.length === 0 && overdueInvoices.length === 0 && (
              <div className="flex items-center gap-3 px-5 py-6 text-sm text-gray-600">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                All clear — no urgent actions needed.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Project Health */}
      <Card padding="none">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="section-header">Project Health</h2>
          <button onClick={() => navigate('/projects')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            All <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="divide-y divide-gray-800">
          {loading ? (
            <div className="p-5 text-center text-sm text-gray-600">Loading…</div>
          ) : projects.slice(0, 6).map(project => (
            <div key={project.id} onClick={() => navigate(`/projects/${project.id}`)}
              className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                project.riskLevel === 'high' ? 'bg-red-500' : project.riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">{project.title}</p>
                <p className="text-xs text-gray-600">{project.projectCode}</p>
              </div>
              <Badge color={PROJECT_STATUS_CONFIG[project.status]?.color} bg={PROJECT_STATUS_CONFIG[project.status]?.bg} className="shrink-0">
                {PROJECT_STATUS_CONFIG[project.status]?.label}
              </Badge>
            </div>
          ))}
          {!loading && projects.length === 0 && <div className="p-5 text-sm text-gray-600 text-center">No projects yet</div>}
        </div>
      </Card>
    </div>
  )
}
