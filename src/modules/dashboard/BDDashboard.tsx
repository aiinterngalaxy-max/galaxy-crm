import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users2, Building2, ClipboardList, Bell, ArrowRight, TrendingUp } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, limit, onSnapshot, where } from '../../lib/firebase'
import { LEAD_STATUS_CONFIG } from '../../lib/utils'
import type { Lead, Partner } from '../../types'

export function BDDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let done = 0
    const check = () => { if (++done === 2) setLoading(false) }

    const unsubLeads = onSnapshot(
      query(collection(db, 'leads'), where('assignedTo', '==', user?.id ?? ''), orderBy('createdAt', 'desc'), limit(100)),
      snap => { setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)); check() }
    )
    const unsubPartners = onSnapshot(
      query(collection(db, 'partners'), orderBy('createdAt', 'desc'), limit(100)),
      snap => { setPartners(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Partner)); check() }
    )
    return () => { unsubLeads(); unsubPartners() }
  }, [user?.id])

  const activeLeads  = leads.filter(l => !['won', 'lost'].includes(l.status))
  const hotLeads     = leads.filter(l => l.aiScore >= 70 && !['won', 'lost'].includes(l.status))
  const wonLeads     = leads.filter(l => l.status === 'won')
  const activePartners = partners.filter(p => p.status === 'active')

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'there'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{greeting()}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your BD pipeline at a glance.</p>
      </div>

      <div data-tour="dashboard-stats" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="My Active Leads"
          value={activeLeads.length}
          icon={<Users2 className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Hot Leads"
          value={hotLeads.length}
          subValue="Score ≥ 70"
          icon={<TrendingUp className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Won"
          value={wonLeads.length}
          icon={<TrendingUp className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Active Partners"
          value={activePartners.length}
          icon={<Building2 className="w-5 h-5 text-violet-400" />}
          iconBg="bg-violet-900/40"
          onClick={() => navigate('/partners')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Pipeline */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">My Lead Pipeline</h2>
            <button onClick={() => navigate('/leads')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              All <ArrowRight className="w-3 h-3" />
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
                    <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-6 text-right shrink-0">{count}</span>
                </div>
              )
            })}
            {!loading && leads.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-2">No leads assigned yet</p>
            )}
          </div>
        </Card>

        {/* Recent Leads */}
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">Recent Leads</h2>
            <button onClick={() => navigate('/leads')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-800">
            {loading ? (
              <div className="p-5 text-center text-sm text-gray-600">Loading…</div>
            ) : leads.slice(0, 6).map(lead => {
              const cfg = LEAD_STATUS_CONFIG[lead.status]
              return (
                <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate">{lead.name}</p>
                    <p className="text-xs text-gray-600">{lead.phone}</p>
                  </div>
                  <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>
                </div>
              )
            })}
            {!loading && leads.length === 0 && (
              <div className="p-5 text-sm text-gray-600 text-center">No leads yet</div>
            )}
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-4">
        <Card hover onClick={() => navigate('/daily-reports')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
            <ClipboardList className="w-4 h-4 text-indigo-400" />
          </div>
          <span className="text-sm font-medium text-gray-300">Daily Reports</span>
        </Card>
        <Card hover onClick={() => navigate('/notifications')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4 text-yellow-400" />
          </div>
          <span className="text-sm font-medium text-gray-300">Notifications</span>
        </Card>
      </div>
    </div>
  )
}
