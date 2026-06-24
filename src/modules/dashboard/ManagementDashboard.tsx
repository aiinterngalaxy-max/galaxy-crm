import { useState, useEffect } from 'react'
import {
  TrendingUp, Users2, FolderKanban, Receipt, AlertTriangle,
  Zap, ArrowRight, CheckCircle2, Clock, ChevronRight
} from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { db, collection, query, where, orderBy, limit, getDocs } from '../../lib/firebase'
import { formatCurrencyShort, formatCurrency, formatRelative, PROJECT_STATUS_CONFIG, LEAD_STATUS_CONFIG } from '../../lib/utils'
import type { Lead, Project, Invoice } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

const MOCK_REVENUE_DATA = [
  { month: 'Jan', collected: 420000, projected: 500000 },
  { month: 'Feb', collected: 380000, projected: 480000 },
  { month: 'Mar', collected: 510000, projected: 520000 },
  { month: 'Apr', collected: 670000, projected: 600000 },
  { month: 'May', collected: 590000, projected: 650000 },
  { month: 'Jun', collected: 720000, projected: 700000 },
]

export function ManagementDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [leadsSnap, projectsSnap, invoicesSnap] = await Promise.all([
          getDocs(query(collection(db, 'leads'), orderBy('createdAt', 'desc'), limit(20))),
          getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(20))),
          getDocs(query(collection(db, 'invoices'), where('status', 'in', ['sent', 'partially_paid', 'overdue']), limit(20))),
        ])
        setLeads(leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
        setProjects(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Project))
        setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const activeProjects = projects.filter(p => p.status === 'in_progress')
  const atRiskProjects = projects.filter(p => p.riskLevel === 'high' && p.status === 'in_progress')
  const hotLeads = leads.filter(l => l.aiScore >= 70 && !['won', 'lost'].includes(l.status))
  const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.balance || 0), 0)
  const overdueInvoices = invoices.filter(i => i.status === 'overdue')
  const pipelineValue = leads
    .filter(l => !['won', 'lost'].includes(l.status))
    .reduce((sum, l) => sum + (l.estimatedBudget || 0), 0)

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'Sir'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">{greeting()}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Here's your company snapshot for today.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Zap className="w-3.5 h-3.5 text-yellow-400" />}
          onClick={() => {}}
        >
          AI Digest
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pipeline Value"
          value={formatCurrencyShort(pipelineValue)}
          subValue={`${leads.filter(l => !['won','lost'].includes(l.status)).length} active leads`}
          icon={<TrendingUp className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
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
          subValue={`${overdueInvoices.length} overdue invoices`}
          icon={<Receipt className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          trend={overdueInvoices.length > 0 ? { value: `${overdueInvoices.length} overdue`, up: false } : undefined}
          onClick={() => navigate('/accounts')}
        />
        <StatCard
          label="Hot Leads"
          value={hotLeads.length}
          subValue="Score ≥ 70"
          icon={<Users2 className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
          onClick={() => navigate('/leads')}
        />
      </div>

      {/* Revenue Chart + Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue Chart */}
        <Card className="lg:col-span-2" padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">Revenue Overview</h2>
            <span className="text-xs text-gray-500">MTD 2026</span>
          </div>
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK_REVENUE_DATA} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="collected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `₹${(v/100000).toFixed(0)}L`} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#d1d5db' }}
                  formatter={(v: number) => [formatCurrency(v), '']}
                />
                <Area type="monotone" dataKey="projected" stroke="#4b5563" strokeWidth={1.5}
                  fill="none" strokeDasharray="4 2" name="Projected" />
                <Area type="monotone" dataKey="collected" stroke="#6366f1" strokeWidth={2}
                  fill="url(#collected)" name="Collected" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

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
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  project.riskLevel === 'high' ? 'bg-red-500' :
                  project.riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{project.title}</p>
                  <p className="text-xs text-gray-600">{project.projectCode}</p>
                </div>
                <Badge
                  color={PROJECT_STATUS_CONFIG[project.status]?.color}
                  bg={PROJECT_STATUS_CONFIG[project.status]?.bg}
                  className="shrink-0"
                >
                  {PROJECT_STATUS_CONFIG[project.status]?.label}
                </Badge>
              </div>
            ))}
            {!loading && projects.length === 0 && (
              <div className="p-5 text-sm text-gray-600 text-center">No projects yet</div>
            )}
          </div>
        </Card>
      </div>

      {/* Leads Pipeline + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Pipeline */}
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
              const pct = leads.length ? Math.round((count / leads.length) * 100) : 0
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-24 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-6 text-right shrink-0">{count}</span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Alerts / Action Items */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800">
            <h2 className="section-header"><AlertTriangle className="w-4 h-4 text-yellow-400" /> Action Required</h2>
          </div>
          <div className="divide-y divide-gray-800">
            {atRiskProjects.map(p => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-gray-200">{p.title}</p>
                  <p className="text-xs text-gray-500">{p.riskFlags?.join(' · ')}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700 ml-auto mt-0.5 shrink-0" />
              </div>
            ))}
            {overdueInvoices.map(inv => (
              <div key={inv.id} onClick={() => navigate('/accounts')}
                className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer">
                <Clock className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-gray-200">{inv.customerName || inv.invoiceCode}</p>
                  <p className="text-xs text-gray-500">Invoice overdue — {formatCurrency(inv.balance)}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700 ml-auto mt-0.5 shrink-0" />
              </div>
            ))}
            {atRiskProjects.length === 0 && overdueInvoices.length === 0 && (
              <div className="flex items-center gap-3 px-5 py-6 text-sm text-gray-600">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                All clear — no urgent actions needed.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
