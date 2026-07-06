import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, CheckCircle2, Circle, Lock, ChevronDown, ChevronUp,
  Camera, Copy, RefreshCw, MapPin, Phone, User, Upload, Trash2, AlertTriangle,
  ExternalLink
} from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Select } from '../../components/ui/Select'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, Timestamp, storage
} from '../../lib/firebase'
import { uploadFile } from '../../lib/firebase'
import {
  PROJECT_STATUS_CONFIG, MILESTONE_STATUS_CONFIG,
  formatCurrency, formatDate, canManageProjects
} from '../../lib/utils'
import type { Project, Milestone, MilestoneStatus, SiteReport, User as AppUser } from '../../types'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { ProjectMaterials } from './ProjectMaterials'
import toast from 'react-hot-toast'

// ─── Workflow Types ────────────────────────────────────────────────────────────

interface WorkflowTask {
  id: string
  label: string
  completed: boolean
}

interface WorkflowStage {
  id: string
  title: string
  orderIndex: number
  paymentPercent: number
  paymentAmount: number
  tasks: WorkflowTask[]
  notes: string
  deadline: string
  status: 'locked' | 'in_progress' | 'completed'
}

// ─── Default Galaxy Stages ─────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW_STAGES: Omit<WorkflowStage, 'id' | 'paymentAmount' | 'status'>[] = [
  {
    title: 'Advance Received',
    orderIndex: 0,
    paymentPercent: 40,
    tasks: [
      { id: 't1', label: 'Advance payment received', completed: false },
      { id: 't2', label: 'Agreement/Documentation signed', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Material Procurement',
    orderIndex: 1,
    paymentPercent: 0,
    tasks: [
      { id: 't1', label: 'Materials ordered', completed: false },
      { id: 't2', label: 'Materials delivered to site', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Conduit & Civil Work',
    orderIndex: 2,
    paymentPercent: 30,
    tasks: [
      { id: 't1', label: 'Conduit laying complete', completed: false },
      { id: 't2', label: 'Civil patches approved by client', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Backbox & Wiring',
    orderIndex: 3,
    paymentPercent: 0,
    tasks: [
      { id: 't1', label: 'Backboxes fixed', completed: false },
      { id: 't2', label: 'Wiring complete in all rooms', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Switch & Device Fitting',
    orderIndex: 4,
    paymentPercent: 20,
    tasks: [
      { id: 't1', label: 'Switches fitted', completed: false },
      { id: 't2', label: 'Sensors installed', completed: false },
      { id: 't3', label: 'Devices tested individually', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Icon & Panel Work',
    orderIndex: 5,
    paymentPercent: 0,
    tasks: [
      { id: 't1', label: 'LCD panels installed', completed: false },
      { id: 't2', label: 'Icon colours finalised', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Programming & Commissioning',
    orderIndex: 6,
    paymentPercent: 0,
    tasks: [
      { id: 't1', label: 'App configured for client', completed: false },
      { id: 't2', label: 'Scenes & automations set', completed: false },
      { id: 't3', label: 'Full system tested', completed: false },
    ],
    notes: '',
    deadline: '',
  },
  {
    title: 'Handover',
    orderIndex: 7,
    paymentPercent: 10,
    tasks: [
      { id: 't1', label: 'Client walkthrough completed', completed: false },
      { id: 't2', label: 'Final payment received', completed: false },
      { id: 't3', label: 'Handover document signed', completed: false },
    ],
    notes: '',
    deadline: '',
  },
]

// ─── Access Code Generator ─────────────────────────────────────────────────────

function generateAccessCode(): string {
  const year = String(new Date().getFullYear()).slice(-2)
  const num = String(Math.floor(Math.random() * 900) + 100)
  return `GHA-${year}-${num}`
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [workflowStages, setWorkflowStages] = useState<WorkflowStage[]>([])
  const [reports, setReports] = useState<SiteReport[]>([])
  const [workers, setWorkers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [savingStage, setSavingStage] = useState<string | null>(null)

  // Site details edit mode
  const [editingSiteDetails, setEditingSiteDetails] = useState(false)
  const [siteFields, setSiteFields] = useState({
    clientContact: '',
    city: '',
    landmark: '',
    siteAddress: '',
    mapsLink: '',
    architectContact: '',
    electricianContact: '',
  })
  const [savingSite, setSavingSite] = useState(false)

  // File uploads
  const sopInputRef = useRef<HTMLInputElement>(null)
  const layoutInputRef = useRef<HTMLInputElement>(null)
  const imagesInputRef = useRef<HTMLInputElement>(null)
  const dwgInputRef = useRef<HTMLInputElement>(null)
  const [uploadingSop, setUploadingSop] = useState(false)
  const [uploadingLayout, setUploadingLayout] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [uploadingDwg, setUploadingDwg] = useState(false)

  // Access code
  const [regeneratingCode, setRegeneratingCode] = useState(false)

  // Report form
  const [showReportForm, setShowReportForm] = useState(false)
  const [rWorkDone, setRWorkDone] = useState('')
  const [rIssues, setRIssues] = useState('')
  const [rMaterials, setRMaterials] = useState('')
  const [rNextSteps, setRNextSteps] = useState('')
  const [rSaving, setRSaving] = useState(false)

  // Project value edit
  const [editingValue, setEditingValue] = useState(false)
  const [editValueInput, setEditValueInput] = useState(0)

  // Add stage form
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStageTitle, setNewStageTitle] = useState('')
  const [newStagePayAmt, setNewStagePayAmt] = useState(0)

  const canManage = role ? canManageProjects(role) : false

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const [projSnap, stagesSnap, repSnap, workersSnap] = await Promise.all([
          getDoc(doc(db, 'projects', id!)),
          getDocs(query(collection(db, 'projects', id!, 'workflow'), orderBy('orderIndex'))),
          getDocs(query(collection(db, 'projects', id!, 'siteReports'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'users')),
        ])
        if (projSnap.exists()) {
          const p = { id: projSnap.id, ...projSnap.data() } as Project & {
            clientContact?: string; city?: string; landmark?: string
            siteAddress?: string; mapsLink?: string; architectContact?: string
            electricianContact?: string; sopUrls?: string[]; layoutUrls?: string[]
            siteImages?: string[]; accessCode?: string
          }
          setProject(p as Project)
          setSiteFields({
            clientContact: p.clientContact || '',
            city: p.city || '',
            landmark: p.landmark || '',
            siteAddress: p.siteAddress || '',
            mapsLink: p.mapsLink || '',
            architectContact: p.architectContact || '',
            electricianContact: p.electricianContact || '',
          })
        }
        setWorkflowStages(stagesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as WorkflowStage))
        setReports(repSnap.docs.map(d => ({ id: d.id, ...d.data() }) as SiteReport))
        const allUsers = workersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as AppUser)
        setWorkers(allUsers.filter(u => u.role === 'project_manager'))
      } catch (err) {
        console.error(err)
        toast.error('Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // ── Overall progress ─────────────────────────────────────────────────────────

  const completedCount = workflowStages.filter(s => s.status === 'completed').length
  const progressPercent = workflowStages.length
    ? Math.round((completedCount / workflowStages.length) * 100)
    : (project as any)?.completionPercent ?? 0

  // ── Stage locking logic ──────────────────────────────────────────────────────

  function getEffectiveStatus(stages: WorkflowStage[], idx: number): 'locked' | 'in_progress' | 'completed' {
    if (idx === 0) return stages[0]?.status === 'completed' ? 'completed' : 'in_progress'
    const prev = stages[idx - 1]
    if (!prev) return 'locked'
    const prevDone = prev.status === 'completed'
    if (!prevDone) return 'locked'
    return stages[idx].status === 'completed' ? 'completed' : 'in_progress'
  }

  // ── Stage reorder ────────────────────────────────────────────────────────────

  async function reorderStage(idx: number, direction: 'up' | 'down') {
    if (!id) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= workflowStages.length) return

    const a = workflowStages[idx]
    const b = workflowStages[swapIdx]

    const newStages = [...workflowStages]
    newStages[idx] = { ...b, orderIndex: a.orderIndex }
    newStages[swapIdx] = { ...a, orderIndex: b.orderIndex }
    newStages.sort((x, y) => x.orderIndex - y.orderIndex)
    setWorkflowStages(newStages)

    await Promise.all([
      updateDoc(doc(db, 'projects', id, 'workflow', a.id), { orderIndex: b.orderIndex }),
      updateDoc(doc(db, 'projects', id, 'workflow', b.id), { orderIndex: a.orderIndex }),
    ])
  }

  // ── Task toggle ──────────────────────────────────────────────────────────────

  async function toggleTask(stage: WorkflowStage, taskId: string) {
    if (!id) return
    const stageIdx = workflowStages.findIndex(s => s.id === stage.id)
    const effectiveStatus = getEffectiveStatus(workflowStages, stageIdx)
    if (effectiveStatus === 'locked') return

    const newTasks = stage.tasks.map(t =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    )
    const allDone = newTasks.every(t => t.completed)
    const newStatus: WorkflowStage['status'] = allDone ? 'completed' : 'in_progress'

    const updated = workflowStages.map(s =>
      s.id === stage.id ? { ...s, tasks: newTasks, status: newStatus } : s
    )
    setWorkflowStages(updated)

    try {
      await updateDoc(doc(db, 'projects', id, 'workflow', stage.id), {
        tasks: newTasks,
        status: newStatus,
        updatedAt: serverTimestamp(),
      })
      // Update project completion
      const newCompleted = updated.filter(s => s.status === 'completed').length
      const pct = updated.length ? Math.round((newCompleted / updated.length) * 100) : 0
      await updateDoc(doc(db, 'projects', id), { completionPercent: pct, updatedAt: serverTimestamp() })
    } catch {
      toast.error('Failed to update task')
    }
  }

  // ── Stage field save ─────────────────────────────────────────────────────────

  async function saveStageFields(stage: WorkflowStage, fields: Partial<WorkflowStage>) {
    if (!id) return
    setSavingStage(stage.id)
    try {
      await updateDoc(doc(db, 'projects', id, 'workflow', stage.id), {
        ...fields,
        updatedAt: serverTimestamp(),
      })
      setWorkflowStages(prev => prev.map(s => s.id === stage.id ? { ...s, ...fields } : s))
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingStage(null)
    }
  }

  // ── Delete stage ─────────────────────────────────────────────────────────────

  async function deleteStage(stageId: string) {
    if (!id || !window.confirm('Delete this stage?')) return
    try {
      await deleteDoc(doc(db, 'projects', id, 'workflow', stageId))
      setWorkflowStages(prev => prev.filter(s => s.id !== stageId))
      toast.success('Stage deleted')
    } catch {
      toast.error('Failed to delete stage')
    }
  }

  // ── Add custom stage ─────────────────────────────────────────────────────────

  async function addCustomStage() {
    if (!newStageTitle.trim() || !id) return
    const orderIndex = workflowStages.length
    const totalValue = (project as any)?.totalValue || (project as any)?.projectValue || 0
    const newStage = {
      title: newStageTitle,
      orderIndex,
      paymentPercent: 0,
      paymentAmount: newStagePayAmt,
      tasks: [{ id: 't1', label: 'Task 1', completed: false }],
      notes: '',
      deadline: '',
      status: 'locked' as const,
    }
    try {
      const ref = await addDoc(collection(db, 'projects', id, 'workflow'), {
        ...newStage,
        createdAt: serverTimestamp(),
      })
      setWorkflowStages(prev => [...prev, { ...newStage, id: ref.id }])
      setNewStageTitle('')
      setNewStagePayAmt(0)
      setShowAddStage(false)
      toast.success('Stage added')
    } catch {
      toast.error('Failed to add stage')
    }
  }

  // ── Site details save ────────────────────────────────────────────────────────

  async function saveSiteDetails() {
    if (!id) return
    setSavingSite(true)
    try {
      await updateDoc(doc(db, 'projects', id), {
        ...siteFields,
        updatedAt: serverTimestamp(),
      })
      setProject(prev => prev ? { ...prev, ...siteFields } as Project : null)
      setEditingSiteDetails(false)
      toast.success('Site details saved')
    } catch {
      toast.error('Failed to save site details')
    } finally {
      setSavingSite(false)
    }
  }

  // ── Access code ──────────────────────────────────────────────────────────────

  async function regenerateAccessCode() {
    if (!id) return
    setRegeneratingCode(true)
    try {
      const code = generateAccessCode()
      await updateDoc(doc(db, 'projects', id), { accessCode: code, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, accessCode: code } as Project : null)
      toast.success('New access code generated')
    } catch {
      toast.error('Failed to regenerate code')
    } finally {
      setRegeneratingCode(false)
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`))
  }

  // ── File uploads ─────────────────────────────────────────────────────────────

  async function handleSopUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setUploadingSop(true)
    try {
      const url = await uploadFile(`projects/${id}/sop/${Date.now()}_${file.name}`, file)
      const current: string[] = (project as any)?.sopUrls || []
      const sopUrls = [...current, url]
      await updateDoc(doc(db, 'projects', id), { sopUrls, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, sopUrls } as Project : null)
      toast.success('SOP uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploadingSop(false)
      if (sopInputRef.current) sopInputRef.current.value = ''
    }
  }

  async function handleDwgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setUploadingDwg(true)
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out — check Firebase Storage is enabled in your Firebase console')), 15000)
      )
      const url = await Promise.race([
        uploadFile(`projects/${id}/zip/${Date.now()}_${file.name}`, file),
        timeout,
      ])
      const current: string[] = (project as any)?.dwgUrls || []
      const dwgUrls = [...current, url]
      await updateDoc(doc(db, 'projects', id), { dwgUrls, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, dwgUrls } as Project : null)
      toast.success('ZIP file uploaded')
    } catch (err: any) {
      console.error('ZIP upload error:', err)
      toast.error(err?.message || 'Upload failed')
    } finally {
      setUploadingDwg(false)
      if (dwgInputRef.current) dwgInputRef.current.value = ''
    }
  }

  async function handleLayoutUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setUploadingLayout(true)
    try {
      const url = await uploadFile(`projects/${id}/layout/${Date.now()}_${file.name}`, file)
      const current: string[] = (project as any)?.layoutUrls || []
      const layoutUrls = [...current, url]
      await updateDoc(doc(db, 'projects', id), { layoutUrls, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, layoutUrls } as Project : null)
      toast.success('Layout uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploadingLayout(false)
      if (layoutInputRef.current) layoutInputRef.current.value = ''
    }
  }

  async function handleImagesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !id) return
    setUploadingImages(true)
    try {
      const urls = await Promise.all(
        files.map(f => uploadFile(`projects/${id}/images/${Date.now()}_${f.name}`, f))
      )
      const current: string[] = (project as any)?.siteImages || []
      const siteImages = [...current, ...urls]
      await updateDoc(doc(db, 'projects', id), { siteImages, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, siteImages } as Project : null)
      toast.success(`${urls.length} image(s) uploaded`)
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploadingImages(false)
      if (imagesInputRef.current) imagesInputRef.current.value = ''
    }
  }

  // ── Site report ──────────────────────────────────────────────────────────────

  const saveReport = async () => {
    if (!rWorkDone.trim() || !id) return
    setRSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const ref = await addDoc(collection(db, 'projects', id, 'siteReports'), {
        projectId: id,
        date: today,
        submittedBy: user?.id,
        submittedByName: user?.name,
        structured: { workDone: rWorkDone, issuesFound: rIssues, materialsNeeded: rMaterials, nextSteps: rNextSteps },
        photos: [],
        createdAt: serverTimestamp(),
      })
      setReports(prev => [{
        id: ref.id, projectId: id, date: today,
        submittedBy: user?.id || '', submittedByName: user?.name,
        structured: { workDone: rWorkDone, issuesFound: rIssues, materialsNeeded: rMaterials, nextSteps: rNextSteps },
        photos: [], createdAt: Timestamp.now(),
      }, ...prev])
      toast.success('Report submitted')
      setShowReportForm(false)
      setRWorkDone(''); setRIssues(''); setRMaterials(''); setRNextSteps('')
    } catch {
      toast.error('Failed to submit report')
    } finally {
      setRSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader />
  if (!project) return <div className="text-center py-16 text-gray-500">Project not found</div>

  const p = project as Project & {
    accessCode?: string; siteAddress?: string; clientContact?: string
    city?: string; landmark?: string; mapsLink?: string
    architectContact?: string; electricianContact?: string
    sopUrls?: string[]; layoutUrls?: string[]; siteImages?: string[]
    totalValue?: number
  }

  const statusCfg = PROJECT_STATUS_CONFIG[project.status]
  const totalValue = p.totalValue || p.projectValue || 0
  const accessCode = p.accessCode || ''
  const clientLink = `${window.location.origin}/client/${accessCode}`

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/projects')} className="text-gray-500 hover:text-gray-300 mt-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{project.title}</h1>
            <Badge color={statusCfg?.color} bg={statusCfg?.bg}>{statusCfg?.label}</Badge>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {(project as any).projectCode} · {project.customerName} · PM: {project.assignedPMName}
            {project.createdAt && ` · Created ${formatDate(project.createdAt)}`}
            {project.startDate && ` · Start ${formatDate(project.startDate)}`}
            {project.expectedEndDate && ` · Due ${formatDate(project.expectedEndDate)}`}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button size="sm" variant="secondary" icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => setShowReportForm(true)}>
              Report
            </Button>
          )}
        </div>
      </div>

      {/* ── Progress Bar ── */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-200">Overall Progress</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {completedCount} of {workflowStages.length} stages completed
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-indigo-400">{progressPercent}%</p>
            {canManage && editingValue ? (
              <input
                type="number"
                autoFocus
                value={editValueInput}
                onChange={e => setEditValueInput(Number(e.target.value))}
                onBlur={async () => {
                  await updateDoc(doc(db, 'projects', id!), { totalValue: editValueInput, updatedAt: serverTimestamp() })
                  setProject(prev => prev ? { ...prev, totalValue: editValueInput } as any : prev)
                  setEditingValue(false)
                  toast.success('Project value updated')
                }}
                onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-xs text-yellow-400 font-medium w-32 text-right focus:outline-none"
              />
            ) : (
              <button
                onClick={() => { if (canManage) { setEditValueInput(totalValue); setEditingValue(true) } }}
                className={`text-xs text-yellow-400 font-medium ${canManage ? 'hover:underline cursor-pointer' : ''}`}
                title={canManage ? 'Click to edit project value' : undefined}
              >
                {formatCurrency(totalValue)}
              </button>
            )}
          </div>
        </div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </Card>

      {/* ── Site & Client Details ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-200">Site &amp; Client Details</h2>
          {canManage && !editingSiteDetails && (
            <Button size="sm" variant="ghost" onClick={() => setEditingSiteDetails(true)}>Edit</Button>
          )}
        </div>
        {editingSiteDetails ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Client Contact" placeholder="+91 98765 43210"
                value={siteFields.clientContact}
                onChange={e => setSiteFields(f => ({ ...f, clientContact: e.target.value }))} />
              <Input label="City" placeholder="Ahmedabad"
                value={siteFields.city}
                onChange={e => setSiteFields(f => ({ ...f, city: e.target.value }))} />
              <Input label="Landmark" placeholder="Near XYZ"
                value={siteFields.landmark}
                onChange={e => setSiteFields(f => ({ ...f, landmark: e.target.value }))} />
              <Input label="Google Maps Link" placeholder="https://maps.google.com/..."
                value={siteFields.mapsLink}
                onChange={e => setSiteFields(f => ({ ...f, mapsLink: e.target.value }))} />
              <Input label="Architect Contact" placeholder="+91 98765 43210"
                value={siteFields.architectContact}
                onChange={e => setSiteFields(f => ({ ...f, architectContact: e.target.value }))} />
              <Input label="Electrician Contact" placeholder="+91 98765 43210"
                value={siteFields.electricianContact}
                onChange={e => setSiteFields(f => ({ ...f, electricianContact: e.target.value }))} />
            </div>
            <Input label="Site Address" placeholder="Full site address"
              value={siteFields.siteAddress}
              onChange={e => setSiteFields(f => ({ ...f, siteAddress: e.target.value }))} />
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={saveSiteDetails} loading={savingSite}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingSiteDetails(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="Client Contact" value={p.clientContact} />
            <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="City" value={p.city} />
            <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Landmark" value={p.landmark} />
            <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Architect" value={p.architectContact} />
            <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Electrician" value={p.electricianContact} />
            {p.mapsLink && (
              <div className="flex items-start gap-2">
                <ExternalLink className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Maps Link</p>
                  <a href={p.mapsLink} target="_blank" rel="noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 text-xs">
                    Open in Maps
                  </a>
                </div>
              </div>
            )}
            {p.siteAddress && (
              <div className="sm:col-span-2 flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Site Address</p>
                  <p className="text-gray-300 text-xs">{p.siteAddress}</p>
                </div>
              </div>
            )}
            {!p.clientContact && !p.city && !p.siteAddress && (
              <p className="text-gray-600 text-xs sm:col-span-2">No site details added yet.</p>
            )}
          </div>
        )}
      </Card>

      {/* ── File Sections: SOP, Layout & DWG ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* ZIP Files */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-200">ZIP Files</h2>
            {canManage && (
              <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />}
                loading={uploadingDwg}
                onClick={() => dwgInputRef.current?.click()}>
                Upload
              </Button>
            )}
            <input ref={dwgInputRef} type="file" accept=".zip,.rar,.7z" className="hidden" onChange={handleDwgUpload} />
          </div>
          {((project as any)?.dwgUrls?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-600">No ZIP files uploaded.</p>
          ) : (
            <div className="space-y-1.5">
              {((project as any)?.dwgUrls || []).map((url: string, i: number) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                  <ExternalLink className="w-3 h-3" />
                  ZIP File {i + 1}
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* Site SOP */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-200">Site SOP</h2>
            {canManage && (
              <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />}
                loading={uploadingSop}
                onClick={() => sopInputRef.current?.click()}>
                Upload
              </Button>
            )}
            <input ref={sopInputRef} type="file" className="hidden" onChange={handleSopUpload} />
          </div>
          {(p.sopUrls?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-600">No SOP files uploaded.</p>
          ) : (
            <div className="space-y-1.5">
              {(p.sopUrls || []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                  <ExternalLink className="w-3 h-3" />
                  SOP File {i + 1}
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* Site Layout */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-200">Site Layout</h2>
            {canManage && (
              <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />}
                loading={uploadingLayout}
                onClick={() => layoutInputRef.current?.click()}>
                Upload
              </Button>
            )}
            <input ref={layoutInputRef} type="file" className="hidden" onChange={handleLayoutUpload} />
          </div>
          {(p.layoutUrls?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-600">No layout files uploaded.</p>
          ) : (
            <div className="space-y-1.5">
              {(p.layoutUrls || []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300">
                  <ExternalLink className="w-3 h-3" />
                  Layout File {i + 1}
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Client Access ── */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-200 mb-4">Client Access</h2>
        {!accessCode ? (
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500">No access code generated yet.</p>
            {canManage && (
              <Button size="sm" variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" />}
                loading={regeneratingCode} onClick={regenerateAccessCode}>
                Generate Code
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Access Code</p>
              <p className="text-lg font-bold text-indigo-400 font-mono tracking-wider">{accessCode}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" icon={<Copy className="w-3.5 h-3.5" />}
                onClick={() => copyToClipboard(accessCode, 'Access code')}>
                Copy Code
              </Button>
              <Button size="sm" variant="secondary" icon={<Copy className="w-3.5 h-3.5" />}
                onClick={() => copyToClipboard(clientLink, 'Client link')}>
                Copy Client Link
              </Button>
              {canManage && (
                <Button size="sm" variant="ghost" icon={<RefreshCw className="w-3.5 h-3.5" />}
                  loading={regeneratingCode} onClick={regenerateAccessCode}>
                  Regenerate
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Site Images ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Site Images</h2>
            <p className="text-xs text-gray-500 mt-0.5">{(p.siteImages?.length ?? 0)} photos</p>
          </div>
          <Button size="sm" variant="secondary" icon={<Camera className="w-3.5 h-3.5" />}
            loading={uploadingImages}
            onClick={() => imagesInputRef.current?.click()}>
            Choose from Gallery
          </Button>
          <input ref={imagesInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={handleImagesUpload} />
        </div>
        {(p.siteImages?.length ?? 0) === 0 ? (
          <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center">
            <Camera className="w-8 h-8 mx-auto mb-2 text-gray-700" />
            <p className="text-xs text-gray-600">No site photos uploaded yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {(p.siteImages || []).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`Site ${i + 1}`}
                  className="w-full aspect-square object-cover rounded-lg border border-gray-800 hover:border-indigo-500 transition-colors" />
              </a>
            ))}
          </div>
        )}
      </Card>

      {/* ── Workflow ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-header">Workflow</h2>
          {canManage && (
            <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAddStage(true)}>
              Add Stage
            </Button>
          )}
        </div>

        {workflowStages.length === 0 && (
          <Card className="py-8 text-center">
            <p className="text-sm text-gray-600">No workflow stages yet.</p>
            <p className="text-xs text-gray-700 mt-1">Create a project from a quotation to auto-generate Galaxy stages.</p>
          </Card>
        )}

        <div className="space-y-3">
          {workflowStages.map((stage, idx) => {
            const effectiveStatus = getEffectiveStatus(workflowStages, idx)
            const isLocked = effectiveStatus === 'locked'
            const isDone = effectiveStatus === 'completed'
            const isExpanded = expandedStage === stage.id
            const completedTasks = stage.tasks.filter(t => t.completed).length
            const taskPct = stage.tasks.length ? Math.round((completedTasks / stage.tasks.length) * 100) : 0
            const payAmt = stage.paymentAmount || Math.round((totalValue * (stage.paymentPercent || 0)) / 100)

            return (
              <Card key={stage.id} padding="none" className={`overflow-hidden transition-opacity ${isLocked ? 'opacity-60' : ''}`}>
                {/* Stage Header */}
                <div
                  className={`flex items-center gap-3 p-4 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-800/30'}`}
                  onClick={() => !isLocked && setExpandedStage(isExpanded ? null : stage.id)}
                >
                  {/* Badge */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    isDone ? 'bg-green-900/50 text-green-400' :
                    isLocked ? 'bg-gray-800 text-gray-600' :
                    'bg-indigo-900/50 text-indigo-400'
                  }`}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : isLocked ? <Lock className="w-3.5 h-3.5" /> : idx + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${isDone ? 'text-gray-500' : isLocked ? 'text-gray-600' : 'text-gray-200'}`}>
                        {stage.title}
                      </p>
                      {stage.paymentPercent > 0 && (
                        <span className="text-xs text-yellow-400 font-medium">{stage.paymentPercent}% · {formatCurrency(payAmt)}</span>
                      )}
                    </div>
                    {/* Mini progress bar */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isDone ? 'bg-green-500' : 'bg-indigo-500'}`}
                          style={{ width: `${taskPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{completedTasks}/{stage.tasks.length}</span>
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex flex-col gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        disabled={idx === 0}
                        onClick={() => reorderStage(idx, 'up')}
                        className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={idx === workflowStages.length - 1}
                        onClick={() => reorderStage(idx, 'down')}
                        className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {!isLocked && (
                    isExpanded ? <ChevronUp className="w-4 h-4 text-gray-600 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-600 shrink-0" />
                  )}
                </div>

                {/* Stage Body */}
                {isExpanded && !isLocked && (
                  <div className="border-t border-gray-800 p-4 space-y-4 bg-gray-800/20">
                    {/* Stage Title */}
                    {canManage && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500 shrink-0">Stage Title</label>
                        <input
                          type="text"
                          value={stage.title}
                          onChange={e => setWorkflowStages(prev => prev.map(s => s.id === stage.id ? { ...s, title: e.target.value } : s))}
                          onBlur={() => saveStageFields(stage, { title: stage.title })}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 flex-1 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}

                    {/* Payment Amount */}
                    {canManage && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500 shrink-0">Payment Amount (₹)</label>
                        <input
                          type="number"
                          value={stage.paymentAmount}
                          onChange={e => setWorkflowStages(prev => prev.map(s => s.id === stage.id ? { ...s, paymentAmount: Number(e.target.value) } : s))}
                          onBlur={() => saveStageFields(stage, { paymentAmount: stage.paymentAmount })}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-yellow-400 font-medium w-40 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}

                    {/* Tasks */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tasks</p>
                      {stage.tasks.map(task => (
                        <label key={task.id} className="flex items-center gap-3 cursor-pointer group">
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              task.completed
                                ? 'bg-green-600 border-green-600'
                                : 'border-gray-600 group-hover:border-indigo-400'
                            }`}
                            onClick={() => toggleTask(stage, task.id)}
                          >
                            {task.completed && <CheckCircle2 className="w-3 h-3 text-white" />}
                          </div>
                          <span className={`text-sm ${task.completed ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                            {task.label}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Notes */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Notes</p>
                      <textarea
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 resize-none focus:outline-none focus:border-indigo-500"
                        rows={2}
                        placeholder="Stage notes…"
                        value={stage.notes}
                        onChange={e => setWorkflowStages(prev => prev.map(s => s.id === stage.id ? { ...s, notes: e.target.value } : s))}
                        onBlur={() => saveStageFields(stage, { notes: stage.notes })}
                      />
                    </div>

                    {/* Deadline */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-gray-500 shrink-0">Deadline</label>
                      <input
                        type="date"
                        value={stage.deadline}
                        onChange={e => setWorkflowStages(prev => prev.map(s => s.id === stage.id ? { ...s, deadline: e.target.value } : s))}
                        onBlur={() => saveStageFields(stage, { deadline: stage.deadline })}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Delete */}
                    {canManage && (
                      <div className="pt-1">
                        <Button size="sm" variant="ghost"
                          icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />}
                          onClick={() => deleteStage(stage.id)}
                          className="text-red-400 hover:text-red-300">
                          Delete Step
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* ── Materials & Delivery ── */}
      {user && (
        <ProjectMaterials
          projectId={id!}
          projectCode={(project as any).projectCode || project.title}
          canManage={canManage}
          userId={user.id}
          userName={user.name}
        />
      )}

      {/* ── Site Reports sidebar-style list ── */}
      <Card padding="none">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Site Reports</h3>
          {canManage && (
            <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowReportForm(true)}>
              Add Report
            </Button>
          )}
        </div>
        {reports.length === 0 ? (
          <p className="p-4 text-xs text-gray-600 text-center">No reports submitted yet</p>
        ) : reports.slice(0, 10).map(r => (
          <div key={r.id} className="px-4 py-3 border-b border-gray-800 last:border-0">
            <div className="flex justify-between items-start mb-1">
              <p className="text-xs font-medium text-gray-300">{r.submittedByName || 'Site Worker'}</p>
              <p className="text-xs text-gray-600">{r.date}</p>
            </div>
            <p className="text-xs text-gray-500 line-clamp-2">{r.structured.workDone}</p>
            {r.structured.issuesFound && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {r.structured.issuesFound}
              </p>
            )}
          </div>
        ))}
      </Card>

      {/* ── Add Stage Modal ── */}
      <Modal open={showAddStage} onClose={() => setShowAddStage(false)} title="Add Custom Stage" size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddStage(false)}>Cancel</Button>
            <Button onClick={addCustomStage} disabled={!newStageTitle.trim()}>Add Stage</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Stage Title *" placeholder="e.g., Extra Cabling" value={newStageTitle}
            onChange={e => setNewStageTitle(e.target.value)} />
          <Input label="Payment Amount (₹)" type="number" min={0} value={newStagePayAmt}
            onChange={e => setNewStagePayAmt(Number(e.target.value))} />
        </div>
      </Modal>

      {/* ── Site Report Modal ── */}
      <Modal open={showReportForm} onClose={() => setShowReportForm(false)} title="Submit Site Report" size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowReportForm(false)}>Cancel</Button>
            <Button onClick={saveReport} loading={rSaving}>Submit Report</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textarea label="Work Done Today *" placeholder="Describe what was completed…"
            value={rWorkDone} onChange={e => setRWorkDone(e.target.value)} rows={3} />
          <Textarea label="Issues Found" placeholder="Any problems encountered?"
            value={rIssues} onChange={e => setRIssues(e.target.value)} rows={2} />
          <Textarea label="Materials Needed" placeholder="What materials are required?"
            value={rMaterials} onChange={e => setRMaterials(e.target.value)} rows={2} />
          <Textarea label="Next Steps" placeholder="What will be done next visit?"
            value={rNextSteps} onChange={e => setRNextSteps(e.target.value)} rows={2} />
        </div>
      </Modal>
    </div>
  )
}

// ── Helper component ──────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-gray-300 text-xs">{value}</p>
      </div>
    </div>
  )
}
