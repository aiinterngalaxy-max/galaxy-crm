import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FolderKanban, ChevronRight, AlertTriangle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, onSnapshot, where } from '../../lib/firebase'
import {
  PROJECT_STATUS_CONFIG, RISK_CONFIG, formatCurrency, formatDate, canManageProjects
} from '../../lib/utils'
import type { Project, ProjectStatus } from '../../types'
import { cn } from '../../lib/utils'

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Planning', value: 'planning' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'On Hold', value: 'on_hold' },
  { label: 'Completed', value: 'completed' },
]

export function ProjectsPage() {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')

  const canCreate = role ? canManageProjects(role) : false

  useEffect(() => {
    if (!user || !role) return
    const unsub = onSnapshot(
      query(collection(db, 'projects'), orderBy('createdAt', 'desc')),
      snap => { setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)); setLoading(false) },
      err => { console.error(err); setLoading(false) }
    )
    return unsub
  }, [user, role])

  const filtered = projects.filter(p => {
    const matchSearch = !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.projectCode.toLowerCase().includes(search.toLowerCase()) ||
      (p.customerName || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const active = projects.filter(p => p.status === 'in_progress')
  const atRisk = projects.filter(p => p.riskLevel === 'high' && p.status === 'in_progress')
  const portfolioValue = projects.filter(p => p.status === 'in_progress').reduce((s, p) => s + p.projectValue, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {active.length} active · {atRisk.length} at risk · {formatCurrency(portfolioValue)} portfolio
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => navigate('/quotations')} icon={<Plus className="w-4 h-4" />}>
            New Project
          </Button>
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm"><p className="text-xs text-gray-500">Active</p><p className="text-xl font-bold text-gray-100 mt-1">{active.length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">At Risk</p><p className="text-xl font-bold text-red-400 mt-1">{atRisk.length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Completed (total)</p><p className="text-xl font-bold text-green-400 mt-1">{projects.filter(p => p.status === 'completed').length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Active Portfolio</p><p className="text-xl font-bold text-indigo-400 mt-1">{formatCurrency(portfolioValue)}</p></Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48 max-w-80">
          <Input
            placeholder="Search project, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn('text-xs px-3 py-1.5 rounded-full border transition-colors',
                statusFilter === f.value
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'border-gray-700 text-gray-400 hover:text-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<FolderKanban className="w-6 h-6" />}
            title="No projects found"
            description="Projects are created from approved quotations."
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map(project => {
            const statusCfg = PROJECT_STATUS_CONFIG[project.status]
            const riskCfg = RISK_CONFIG[project.riskLevel]
            return (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
              >
                {/* Risk dot */}
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${riskCfg?.dot}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-200">{project.title}</p>
                    {project.riskLevel === 'high' && (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    <span>{project.projectCode}</span>
                    <span>{project.customerName}</span>
                    <span>{project.assignedPMName}</span>
                  </div>
                </div>

                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-sm font-semibold text-gray-200">{formatCurrency(project.projectValue)}</p>
                  <div className="flex items-center gap-1.5 justify-end mt-1">
                    <div className="w-20 h-1.5 bg-gray-800 rounded-full">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${project.completionPercent ?? 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600">{project.completionPercent ?? 0}%</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge color={statusCfg?.color} bg={statusCfg?.bg}>{statusCfg?.label}</Badge>
                  <span className="text-xs text-gray-600">{formatDate(project.expectedEndDate)}</span>
                </div>

                <ChevronRight className="w-4 h-4 text-gray-700 shrink-0" />
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
