import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MapPin, Phone, FolderKanban, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, onSnapshot, deleteDocument,
  addDoc, getDocs, serverTimestamp, limit
} from '../../lib/firebase'
import { nextProjectCode } from '../../lib/counters'
import { formatDate, canManageProjects } from '../../lib/utils'
import type { Project, ProjectStatus } from '../../types'
import { cn } from '../../lib/utils'
import toast from 'react-hot-toast'

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
  const { user, role, isAdmin } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [workflowCounts, setWorkflowCounts] = useState<Record<string, { total: number; done: number }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', customerName: '', clientContact: '', city: '',
    siteAddress: '', landmark: '', startDate: '', expectedEndDate: '',
    projectValue: '', status: 'planning' as ProjectStatus,
  })

  const canCreate = role ? canManageProjects(role) : false

  function resetForm() {
    setForm({ title: '', customerName: '', clientContact: '', city: '', siteAddress: '', landmark: '', startDate: '', expectedEndDate: '', projectValue: '', status: 'planning' })
  }

  async function handleCreateProject() {
    if (!form.title.trim() || !form.customerName.trim()) {
      toast.error('Project title and client name are required')
      return
    }
    setSaving(true)
    try {
      const code = await nextProjectCode()

      // Create customer record
      const custRef = await addDoc(collection(db, 'customers'), {
        name: form.customerName.trim(),
        phone: form.clientContact || '',
        address: form.siteAddress || '',
        type: 'residential',
        tags: [],
        totalProjectValue: Number(form.projectValue) || 0,
        totalPaid: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const projectData: Record<string, unknown> = {
        projectCode: code,
        title: form.title.trim(),
        customerId: custRef.id,
        customerName: form.customerName.trim(),
        quotationId: 'direct_entry',
        assignedPM: user?.id || '',
        assignedPMName: user?.name || '',
        status: form.status,
        completionPercent: 0,
        riskLevel: 'low',
        riskFlags: [],
        city: form.city,
        siteAddress: form.siteAddress,
        landmark: form.landmark,
        clientContact: form.clientContact,
        projectValue: Number(form.projectValue) || 0,
        totalValue: Number(form.projectValue) || 0,
        totalPaid: 0,
        collectedAmount: 0,
        createdBy: user?.id || '',
      }
      if (form.startDate) projectData.startDate = new Date(form.startDate)
      if (form.expectedEndDate) projectData.expectedEndDate = new Date(form.expectedEndDate)

      await addDoc(collection(db, 'projects'), {
        ...projectData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      toast.success(`Project ${code} created`)
      setShowNewProject(false)
      resetForm()
    } catch (e) {
      console.error(e)
      toast.error('Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDelete === id) {
      await deleteDocument('projects', id)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  useEffect(() => {
    if (!user || !role) return
    const unsub = onSnapshot(
      query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(100)),
      async snap => {
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)
        setProjects(loaded)
        setLoading(false)
        // Fetch workflow stage counts for all projects
        const counts: Record<string, { total: number; done: number }> = {}
        await Promise.all(loaded.map(async p => {
          try {
            const wSnap = await getDocs(collection(db, 'projects', p.id, 'workflow'))
            const total = wSnap.size
            const done = wSnap.docs.filter(d => d.data().status === 'completed').length
            counts[p.id] = { total, done }
          } catch { counts[p.id] = { total: 0, done: 0 } }
        }))
        setWorkflowCounts(counts)
      },
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
      (p.city || '').toLowerCase().includes(q) ||
      (p.siteAddress || '').toLowerCase().includes(q)
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
          <Button onClick={() => setShowNewProject(true)} icon={<Plus className="w-4 h-4" />} variant="warning">
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
          const wf = workflowCounts[project.id]
          const pct = wf && wf.total > 0
            ? Math.round((wf.done / wf.total) * 100)
            : (project.completionPercent ?? 0)
          const sd = startDate(project)
          const city = project.city || ''
          const phone = project.clientContact || ''
          const overdue = isOverdue(project)
          const stageCount = wf?.total

          return (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-gray-700 hover:bg-gray-800/60 transition-all"
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-base font-bold text-gray-100 leading-snug">{project.title}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', STATUS_BADGE[project.status])}>
                    {STATUS_LABEL[project.status]}
                  </span>
                  {isAdmin && (
                    confirmDelete === project.id ? (
                      <button
                        onClick={e => handleDelete(project.id, e)}
                        className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                      >
                        Confirm?
                      </button>
                    ) : (
                      <button
                        onClick={e => handleDelete(project.id, e)}
                        className="p-1 text-gray-700 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
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
                  {wf !== undefined && wf.total > 0 && (
                    <p className="text-gray-600">{wf.done}/{wf.total} stages</p>
                  )}
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

      {/* ── New Project Modal ── */}
      <Modal
        open={showNewProject}
        onClose={() => { setShowNewProject(false); resetForm() }}
        title="New Project"
        description="Enter project details for direct data entry."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowNewProject(false); resetForm() }}>Cancel</Button>
            <Button onClick={handleCreateProject} loading={saving} disabled={!form.title.trim() || !form.customerName.trim()}>
              Create Project
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Project Title *"
              placeholder="e.g., Raj Shah - Bandra"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
            <Input
              label="Client Name *"
              placeholder="e.g., Raj Shah"
              value={form.customerName}
              onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
            />
            <Input
              label="Client Phone"
              placeholder="+91 98765 43210"
              value={form.clientContact}
              onChange={e => setForm(f => ({ ...f, clientContact: e.target.value }))}
            />
            <Input
              label="Project Value (₹)"
              type="number"
              placeholder="0"
              value={form.projectValue}
              onChange={e => setForm(f => ({ ...f, projectValue: e.target.value }))}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as ProjectStatus }))}
              options={[
                { value: 'planning', label: 'Planning' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'on_hold', label: 'On Hold' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
            <Input
              label="City"
              placeholder="Mumbai"
              value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
            />
            <Input
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
            />
            <Input
              label="Expected End Date"
              type="date"
              value={form.expectedEndDate}
              onChange={e => setForm(f => ({ ...f, expectedEndDate: e.target.value }))}
            />
          </div>
          <Input
            label="Site Address"
            placeholder="Full site address"
            value={form.siteAddress}
            onChange={e => setForm(f => ({ ...f, siteAddress: e.target.value }))}
          />
          <Input
            label="Landmark"
            placeholder="Near XYZ"
            value={form.landmark}
            onChange={e => setForm(f => ({ ...f, landmark: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  )
}
