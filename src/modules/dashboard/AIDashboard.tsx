import { useEffect, useState } from 'react'
import { Bot, Users2, FolderKanban, FileText, Building2, TrendingUp } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, getDocs } from '../../lib/firebase'
import { formatCurrency } from '../../lib/utils'
import type { Lead, Project, Quotation, Partner } from '../../types'

export function AIDashboard() {
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'leads')),
      getDocs(collection(db, 'projects')),
      getDocs(collection(db, 'quotations')),
      getDocs(collection(db, 'partners')),
    ]).then(([l, p, q, b]) => {
      setLeads(l.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
      setProjects(p.docs.map(d => ({ id: d.id, ...d.data() }) as Project))
      setQuotations(q.docs.map(d => ({ id: d.id, ...d.data() }) as Quotation))
      setPartners(b.docs.map(d => ({ id: d.id, ...d.data() }) as Partner))
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const wonLeads = leads.filter(l => l.status === 'won')
  const conversionRate = leads.length > 0 ? Math.round((wonLeads.length / leads.length) * 100) : 0
  const activeProjects = projects.filter(p => !['completed', 'cancelled'].includes(p.status))
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + (l.aiScore || 0), 0) / leads.length) : 0
  const totalPipelineValue = quotations.reduce((s, q) => s + (q.total || 0), 0)

  // Lead source breakdown
  const sourceMap: Record<string, number> = {}
  leads.forEach(l => { const src = l.source || 'unknown'; sourceMap[src] = (sourceMap[src] || 0) + 1 })
  const topSources = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Lead status funnel
  const statusOrder = ['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent', 'won', 'lost']
  const funnelData = statusOrder.map(s => ({ status: s, count: leads.filter(l => l.status === s).length }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">AI & Analytics Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">{user?.name} — AI Team</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={leads.length} icon={<Users2 className="w-5 h-5 text-blue-400" />} iconBg="bg-blue-500/20"
          subValue={`${conversionRate}% conversion`} />
        <StatCard label="Avg AI Score" value={avgScore} icon={<Bot className="w-5 h-5 text-gold-400" />} iconBg="bg-gold-500/20"
          subValue="across all leads" />
        <StatCard label="Active Projects" value={activeProjects.length} icon={<FolderKanban className="w-5 h-5 text-indigo-400" />} iconBg="bg-indigo-500/20" />
        <StatCard label="Pipeline Value" value={formatCurrency(totalPipelineValue)} icon={<TrendingUp className="w-5 h-5 text-green-400" />} iconBg="bg-green-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Funnel */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Lead Funnel</h3>
          <div className="space-y-2">
            {funnelData.map(({ status, count }) => {
              const pct = leads.length > 0 ? Math.round((count / leads.length) * 100) : 0
              const colors: Record<string, string> = {
                new: 'bg-gray-500', contacted: 'bg-blue-500', qualified: 'bg-indigo-500',
                floor_plan: 'bg-violet-500', quote_sent: 'bg-yellow-500', won: 'bg-green-500', lost: 'bg-red-500'
              }
              return (
                <div key={status} className="flex items-center gap-3">
                  <p className="text-xs text-gray-400 w-24 capitalize shrink-0">{status.replace('_', ' ')}</p>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[status] || 'bg-gray-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 w-8 text-right shrink-0">{count}</p>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Lead Sources */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Top Lead Sources</h3>
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          <div className="space-y-3">
            {topSources.map(([source, count]) => {
              const pct = leads.length > 0 ? Math.round((count / leads.length) * 100) : 0
              return (
                <div key={source} className="flex items-center gap-3">
                  <p className="text-xs text-gray-400 w-28 capitalize shrink-0">{source.replace(/_/g, ' ')}</p>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gold-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 w-8 text-right shrink-0">{count}</p>
                </div>
              )
            })}
            {topSources.length === 0 && !loading && <p className="text-xs text-gray-500">No lead data yet</p>}
          </div>
        </Card>
      </div>

      {/* B2B Partners overview */}
      <Card padding="none">
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-gray-200">B2B Partner Overview</h3>
          <span className="ml-auto text-xs text-gray-500">{partners.length} partners</span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xl font-bold text-gray-100">{partners.filter(p => p.status === 'active').length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Active</p>
          </div>
          <div>
            <p className="text-xl font-bold text-gray-100">{leads.filter(l => l.businessType === 'b2b').length}</p>
            <p className="text-xs text-gray-500 mt-0.5">B2B Leads</p>
          </div>
          <div>
            <p className="text-xl font-bold text-green-400">{leads.filter(l => l.businessType === 'b2b' && l.status === 'won').length}</p>
            <p className="text-xs text-gray-500 mt-0.5">B2B Won</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
