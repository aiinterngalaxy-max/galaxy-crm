import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, CheckSquare, AlertTriangle, FileText, Plus, ChevronRight } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, getDocs } from '../../lib/firebase'
import { PROJECT_STATUS_CONFIG, RISK_CONFIG, formatCurrency } from '../../lib/utils'
import type { Project } from '../../types'

export function PMDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    getDocs(query(collection(db, 'projects'), orderBy('updatedAt', 'desc')))
      .then(snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const active = projects.filter(p => p.status === 'in_progress')
  const atRisk = projects.filter(p => p.riskLevel === 'high')
  const totalValue = projects.filter(p => p.status === 'in_progress').reduce((s, p) => s + (p.projectValue ?? p.totalValue ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Project Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">{user?.name} — Project Manager</p>
        </div>
        <Button onClick={() => navigate('/quotations/new')} icon={<Plus className="w-4 h-4" />}>New Quotation</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Active Projects" value={active.length} icon={<FolderKanban className="w-5 h-5 text-indigo-400" />} iconBg="bg-indigo-900/40" onClick={() => navigate('/projects')} />
        <StatCard label="At Risk" value={atRisk.length} icon={<AlertTriangle className="w-5 h-5 text-red-400" />} iconBg="bg-red-900/40" trend={atRisk.length > 0 ? { value: 'Needs attention', up: false } : undefined} />
        <StatCard label="Pending Quotes" value={0} icon={<FileText className="w-5 h-5 text-yellow-400" />} iconBg="bg-yellow-900/40" onClick={() => navigate('/quotations')} />
        <StatCard label="Portfolio Value" value={formatCurrency(totalValue)} icon={<CheckSquare className="w-5 h-5 text-green-400" />} iconBg="bg-green-900/40" />
      </div>

      <Card padding="none">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="section-header">My Projects</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>View all</Button>
        </div>
        <div className="divide-y divide-gray-800">
          {loading && <p className="p-5 text-sm text-gray-600 text-center">Loading…</p>}
          {projects.map(p => (
            <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${RISK_CONFIG[p.riskLevel]?.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">{p.title}</p>
                <p className="text-xs text-gray-500">{p.projectCode} · {formatCurrency(p.projectValue)}</p>
              </div>
              <Badge color={PROJECT_STATUS_CONFIG[p.status]?.color} bg={PROJECT_STATUS_CONFIG[p.status]?.bg}>
                {PROJECT_STATUS_CONFIG[p.status]?.label}
              </Badge>
              <div className="text-right shrink-0 hidden sm:block">
                <p className="text-xs text-gray-500">{p.completionPercent ?? 0}%</p>
                <div className="w-16 h-1.5 bg-gray-800 rounded-full mt-1">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p.completionPercent ?? 0}%` }} />
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-700 shrink-0" />
            </div>
          ))}
          {!loading && projects.length === 0 && (
            <p className="p-5 text-sm text-gray-600 text-center">No projects yet</p>
          )}
        </div>
      </Card>
    </div>
  )
}
