import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, TrendingUp, IndianRupee, AlertCircle, ChevronRight } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, getDocs, query, orderBy } from '../../lib/firebase'
import { formatCurrency, PROJECT_STATUS_CONFIG } from '../../lib/utils'
import type { Project } from '../../types'

export function AccountsDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'projects'), orderBy('updatedAt', 'desc')))
      .then(snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const activeProjects = projects.filter(p => !['completed', 'cancelled'].includes(p.status))
  const totalProjectValue = projects.reduce((s, p) => s + ((p as any).totalValue || 0), 0)
  const totalCollected = projects.reduce((s, p) => s + ((p as any).collectedAmount || 0), 0)
  const totalPending = totalProjectValue - totalCollected
  const overdueProjects = activeProjects.filter(p => {
    if (!(p as any).expectedEndDate) return false
    return new Date((p as any).expectedEndDate) < new Date()
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Accounts Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">{user?.name} — Accounts</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Project Value"
          value={formatCurrency(totalProjectValue)}
          icon={<IndianRupee className="w-5 h-5 text-gold-400" />}
          iconBg="bg-gold-500/20"
        />
        <StatCard
          label="Amount Collected"
          value={formatCurrency(totalCollected)}
          icon={<TrendingUp className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-500/20"
        />
        <StatCard
          label="Amount Pending"
          value={formatCurrency(totalPending)}
          icon={<Receipt className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-500/20"
        />
        <StatCard
          label="Overdue Projects"
          value={overdueProjects.length}
          icon={<AlertCircle className="w-5 h-5 text-red-400" />}
          iconBg="bg-red-500/20"
        />
      </div>

      <Card padding="none">
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">All Projects — Payment Status</h3>
        </div>
        {loading && <div className="p-6 text-sm text-gray-500 text-center">Loading…</div>}
        <div className="divide-y divide-gray-800">
          {projects.map(p => {
            const total = (p as any).totalValue || 0
            const collected = (p as any).collectedAmount || 0
            const pending = total - collected
            const pct = total > 0 ? Math.round((collected / total) * 100) : 0
            const cfg = PROJECT_STATUS_CONFIG[p.status]
            return (
              <div
                key={p.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/40 cursor-pointer"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{p.title}</p>
                  <p className="text-xs text-gray-500">{(p as any).customerName || '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-green-400 font-medium">{formatCurrency(collected)} collected</p>
                  <p className="text-xs text-yellow-400">{formatCurrency(pending)} pending</p>
                </div>
                <div className="w-16 text-right shrink-0">
                  <p className="text-sm font-bold text-gray-200">{pct}%</p>
                  <div className="h-1 bg-gray-800 rounded-full mt-1">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <Badge color={cfg?.color} bg={cfg?.bg} className="shrink-0 hidden sm:flex">
                  {cfg?.label}
                </Badge>
                <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
