import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MapPin, Phone, FolderKanban } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, onSnapshot } from '../../lib/firebase'
import { formatDate, canManageProjects } from '../../lib/utils'
import type { Project, ProjectStatus } from '../../types'
import { cn } from '../../lib/utils'

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Planning', value: 'planning' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'On Hold', value: 'on_hold' },
  { label: 'Completed', value: 'completed' },
]

const STATUS_BADGE: Record<string, string> = {
  planning:    'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  in_progress: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  on_hold:     'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  completed:   'bg-green-500/20 text-green-400 border border-green-500/30',
}
const STATUS_LABEL: Record<string, string> = {
  planning: 'Planning', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed',
}

function isOverdue(p: Project) {
  if (!p.expectedEndDate || p.status === 'completed') return false
  const d = (p.expectedEndDate as any)?.toDate ? (p.expectedEndDate as any).toDate() : new Date(p.expectedEndDate as any)
  return d < new Date()
}

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
    const q = search.toLowerCase()
    const matchSearch = !search ||
      p.title.toLowerCase().includes(q) ||
      p.projectCode.toLowerCase().includes(q) ||
      (p.customerName || '').toLowerCase().includes(q) ||
      (p.assignedPMName || '').toLowerCase().includes(q) ||
      ((p as any).city || '').toLowerCase().includes(q) ||
      ((p as any).siteAddress || '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const stats = {
    total:      projects.length,
    planning:   projects.filter(p => p.status === 'planning').length,
    inProgress: projects.filter(p => p.status === 'in_progress').length,
    completed:  projects.filter(p => p.status === 'completed').length,
    overdue:    projects.filter(isOverdue).length,
  }

  const startDate = (p: Project) => {
    const ts = (p as any).createdAt
    if (!ts) return null
    const d = ts?.toDate ? ts.toDate() : new Date(ts)
    return d
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track home automation projects and workflows in real time</p>
        </div>
        {canCreate && (
          <Button onClick={() => navigate('/quotations')} icon={<Plus className="w-4 h-4" />} variant="warning">
            New Project
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Projects', value: stats.total, active: statusFilter === 'all', onClick: () => setStatusFilter('all'), color: 'text-yellow-400', border: 'border-yellow-500/40' },
          { label: 'Planning',       value: stats.planning,   active: statusFilter === 'planning',    onClick: () => setStatusFilter('planning'),    color: 'text-blue-400',   border: '' },
          { label: 'In Progress',    value: stats.inProgress, active: statusFilter === 'in_progress', onClick: () => setStatusFilter('in_progress'), color: 'text-yellow-400', border: '' },
          { label: 'Completed',      value: stats.completed,  active: statusFilter === 'completed',   onClick: () => setStatusFilter('completed'),   color: 'text-green-400',  border: '' },
          { label: 'Overdue',        value: stats.overdue,    active: false,                          onClick: () => {},                             color: 'text-red-400',    border: '' },
        ].map(s => (
          <button
            key={s.label}
            onClick={s.onClick}
            className={cn(
              'bg-gray-900 rounded-xl p-4 text-left border transition-colors hover:border-gray-600',
              s.active ? `border ${s.border || 'border-indigo-500/40'}` : 'border-gray-800'
            )}
          >
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </button>
        ))}
      </div>

      {/* Projects header + search */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-200">Projects</h2>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{filtered.length}</span>
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-10 pr-4 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500"
            placeholder="Search by name, client, code, manager, address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap -mt-2">
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

      {/* Cards grid */}
      {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<FolderKanban className="w-6 h-6" />}
          title="No projects found"
          description="Projects are created from approved quotations."
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(project => {
          const pct = project.completionPercent ?? 0
          const sd = startDate(project)
          const city = (project as any).city || ''
          const phone = (project as any).clientContact || ''
          const overdue = isOverdue(project)

          return (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-gray-700 hover:bg-gray-800/60 transition-all"
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-base font-bold text-gray-100 leading-snug">{project.title}</p>
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium shrink-0', STATUS_BADGE[project.status])}>
                  {STATUS_LABEL[project.status]}
                </span>
              </div>
              <p className="text-sm text-gray-500 mb-4">{project.customerName}</p>

              {/* Progress */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-gray-300 w-10 text-right">{pct}%</span>
              </div>

              {/* Meta */}
              <div className="space-y-1.5 text-xs text-gray-500">
                {sd && <p>Start {sd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
                {project.assignedPMName && <p>Site Manager: <span className="text-gray-300 font-medium">{project.assignedPMName}</span></p>}
                <div className="flex items-center justify-between">
                  <p>{project.expectedEndDate ? `Deadline ${formatDate(project.expectedEndDate)}` : 'No deadline'}{overdue ? <span className="text-red-400 ml-1">· Overdue</span> : null}</p>
                  <p className="text-gray-600">8 workflow items</p>
                </div>
              </div>

              {/* City + Phone */}
              {(city || phone) && (
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800 text-xs text-gray-600">
                  {city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{city}</span>}
                  {phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{phone}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
