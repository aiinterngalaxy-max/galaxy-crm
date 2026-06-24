import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, CheckCircle2, Circle, Clock, AlertTriangle,
  Camera, Mic, ChevronDown, ChevronUp, User
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
  db, doc, getDoc, collection, getDocs, addDoc, updateDoc,
  query, orderBy, serverTimestamp, Timestamp
} from '../../lib/firebase'
import {
  PROJECT_STATUS_CONFIG, MILESTONE_STATUS_CONFIG, RISK_CONFIG,
  formatCurrency, formatDate, canManageProjects
} from '../../lib/utils'
import type { Project, Milestone, MilestoneStatus, SiteReport, User as AppUser } from '../../types'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [reports, setReports] = useState<SiteReport[]>([])
  const [workers, setWorkers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null)

  // Milestone form
  const [mTitle, setMTitle] = useState('')
  const [mDesc, setMDesc] = useState('')
  const [mDate, setMDate] = useState('')
  const [mWorkers, setMWorkers] = useState<string[]>([])
  const [mPayPercent, setMPayPercent] = useState(0)
  const [mSaving, setMSaving] = useState(false)

  // Report form
  const [rWorkDone, setRWorkDone] = useState('')
  const [rIssues, setRIssues] = useState('')
  const [rMaterials, setRMaterials] = useState('')
  const [rNextSteps, setRNextSteps] = useState('')
  const [rMilestoneId, setRMilestoneId] = useState('')
  const [rSaving, setRSaving] = useState(false)

  const canManage = role ? canManageProjects(role) : false
  const isSiteWorker = role === 'site_worker'

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const [projSnap, milSnap, repSnap, workersSnap] = await Promise.all([
          getDoc(doc(db, 'projects', id!)),
          getDocs(query(collection(db, 'projects', id!, 'milestones'), orderBy('orderIndex'))),
          getDocs(query(collection(db, 'projects', id!, 'siteReports'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'users')),
        ])
        if (projSnap.exists()) setProject({ id: projSnap.id, ...projSnap.data() } as Project)
        setMilestones(milSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Milestone))
        setReports(repSnap.docs.map(d => ({ id: d.id, ...d.data() }) as SiteReport))
        const allUsers = workersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as AppUser)
        setWorkers(allUsers.filter(u => u.role === 'site_worker' || u.role === 'project_manager'))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const saveMilestone = async () => {
    if (!mTitle.trim() || !id) return
    setMSaving(true)
    try {
      const selectedWorkers = workers.filter(w => mWorkers.includes(w.id))
      const ref = await addDoc(collection(db, 'projects', id, 'milestones'), {
        projectId: id,
        title: mTitle,
        description: mDesc,
        assignedWorkers: mWorkers,
        assignedWorkerNames: selectedWorkers.map(w => w.name),
        expectedDate: mDate ? Timestamp.fromDate(new Date(mDate)) : null,
        status: 'pending' as MilestoneStatus,
        linkedPaymentPercent: mPayPercent,
        orderIndex: milestones.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const newM: Milestone = {
        id: ref.id,
        projectId: id,
        title: mTitle,
        description: mDesc,
        assignedWorkers: mWorkers,
        assignedWorkerNames: selectedWorkers.map(w => w.name),
        expectedDate: mDate ? Timestamp.fromDate(new Date(mDate)) : undefined,
        status: 'pending',
        linkedPaymentPercent: mPayPercent,
        orderIndex: milestones.length,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }
      setMilestones(prev => [...prev, newM])
      toast.success('Milestone added')
      setShowMilestoneForm(false)
      setMTitle(''); setMDesc(''); setMDate(''); setMWorkers([]); setMPayPercent(0)
    } catch {
      toast.error('Failed to add milestone')
    } finally {
      setMSaving(false)
    }
  }

  const updateMilestoneStatus = async (milestoneId: string, newStatus: MilestoneStatus) => {
    if (!id) return
    try {
      await updateDoc(doc(db, 'projects', id, 'milestones', milestoneId), {
        status: newStatus,
        completionDate: newStatus === 'completed' ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      })
      setMilestones(prev => prev.map(m =>
        m.id === milestoneId ? { ...m, status: newStatus } : m
      ))

      // Update project completion %
      const newCompleted = milestones.filter(m => m.id === milestoneId ? newStatus === 'completed' : m.status === 'completed').length
      const pct = Math.round((newCompleted / milestones.length) * 100)
      await updateDoc(doc(db, 'projects', id), { completionPercent: pct, updatedAt: serverTimestamp() })
      setProject(prev => prev ? { ...prev, completionPercent: pct } : null)

      toast.success('Milestone updated')
    } catch {
      toast.error('Update failed')
    }
  }

  const saveReport = async () => {
    if (!rWorkDone.trim() || !id) return
    setRSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const ref = await addDoc(collection(db, 'projects', id, 'siteReports'), {
        projectId: id,
        milestoneId: rMilestoneId || null,
        date: today,
        submittedBy: user?.id,
        submittedByName: user?.name,
        structured: {
          workDone: rWorkDone,
          issuesFound: rIssues,
          materialsNeeded: rMaterials,
          nextSteps: rNextSteps,
        },
        photos: [],
        createdAt: serverTimestamp(),
      })
      const newReport: SiteReport = {
        id: ref.id,
        projectId: id,
        milestoneId: rMilestoneId || undefined,
        date: today,
        submittedBy: user?.id || '',
        submittedByName: user?.name,
        structured: { workDone: rWorkDone, issuesFound: rIssues, materialsNeeded: rMaterials, nextSteps: rNextSteps },
        photos: [],
        createdAt: Timestamp.now(),
      }
      setReports(prev => [newReport, ...prev])
      toast.success('Report submitted')
      setShowReportForm(false)
      setRWorkDone(''); setRIssues(''); setRMaterials(''); setRNextSteps(''); setRMilestoneId('')
    } catch {
      toast.error('Failed to submit report')
    } finally {
      setRSaving(false)
    }
  }

  if (loading) return <PageLoader />
  if (!project) return <div className="text-center py-16 text-gray-500">Project not found</div>

  const statusCfg = PROJECT_STATUS_CONFIG[project.status]
  const riskCfg = RISK_CONFIG[project.riskLevel]
  const completedMilestones = milestones.filter(m => m.status === 'completed').length
  const workerOptions = workers.map(w => ({ value: w.id, label: w.name }))
  const milestoneOptions = [
    { value: '', label: 'No milestone (general report)' },
    ...milestones.map(m => ({ value: m.id, label: m.title }))
  ]

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/projects')} className="text-gray-500 hover:text-gray-300 mt-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{project.title}</h1>
            <Badge color={statusCfg?.color} bg={statusCfg?.bg}>{statusCfg?.label}</Badge>
            <span className={`text-xs font-medium flex items-center gap-1 ${riskCfg?.color}`}>
              <span className={`w-2 h-2 rounded-full ${riskCfg?.dot}`} />
              {riskCfg?.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {project.projectCode} · {project.customerName} · PM: {project.assignedPMName}
          </p>
        </div>
        <div className="flex gap-2">
          {(canManage || isSiteWorker) && (
            <Button size="sm" variant="secondary" icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => setShowReportForm(true)}>
              Report
            </Button>
          )}
          {canManage && (
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowMilestoneForm(true)}>
              Milestone
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-200">Overall Progress</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {completedMilestones} of {milestones.length} milestones · Due {formatDate(project.expectedEndDate)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-indigo-400">{project.completionPercent ?? 0}%</p>
            <p className="text-xs text-gray-500">{formatCurrency(project.projectValue)}</p>
          </div>
        </div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-500"
            style={{ width: `${project.completionPercent ?? 0}%` }}
          />
        </div>
        {project.riskFlags?.length > 0 && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{project.riskFlags.join(' · ')}</span>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Milestones */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="section-header">Milestones</h2>
          {milestones.length === 0 && (
            <Card className="py-8 text-center">
              <p className="text-sm text-gray-600">No milestones yet</p>
              {canManage && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => setShowMilestoneForm(true)}>
                  Add First Milestone
                </Button>
              )}
            </Card>
          )}
          {milestones.map(milestone => {
            const mCfg = MILESTONE_STATUS_CONFIG[milestone.status]
            const isExpanded = expandedMilestone === milestone.id
            return (
              <Card key={milestone.id} padding="none" className="overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-800/30"
                  onClick={() => setExpandedMilestone(isExpanded ? null : milestone.id)}
                >
                  {/* Status Icon */}
                  {milestone.status === 'completed'
                    ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    : milestone.status === 'in_progress'
                    ? <Circle className="w-5 h-5 text-indigo-400 shrink-0" />
                    : milestone.status === 'overdue'
                    ? <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                    : <Circle className="w-5 h-5 text-gray-700 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${milestone.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                      {milestone.title}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                      {milestone.expectedDate && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(milestone.expectedDate)}
                        </span>
                      )}
                      {(milestone.assignedWorkerNames?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {(milestone.assignedWorkerNames ?? []).join(', ')}
                        </span>
                      )}
                      {(milestone.linkedPaymentPercent ?? 0) > 0 && (
                        <span className="text-green-500">{milestone.linkedPaymentPercent}% payment</span>
                      )}
                    </div>
                  </div>
                  <Badge color={mCfg?.color} bg="bg-gray-800" dot dotColor={mCfg?.dot}>
                    {mCfg?.label}
                  </Badge>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-600" /> : <ChevronDown className="w-4 h-4 text-gray-600" />}
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-800 p-4 bg-gray-800/20">
                    {milestone.description && (
                      <p className="text-sm text-gray-400 mb-3">{milestone.description}</p>
                    )}
                    {canManage && (
                      <div className="flex gap-2 flex-wrap">
                        {(['pending', 'in_progress', 'completed', 'overdue'] as MilestoneStatus[]).map(s => (
                          <button
                            key={s}
                            disabled={milestone.status === s}
                            onClick={() => updateMilestoneStatus(milestone.id, s)}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${
                              milestone.status === s
                                ? `${MILESTONE_STATUS_CONFIG[s].color} border-current bg-gray-800`
                                : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            {MILESTONE_STATUS_CONFIG[s].label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>

        {/* Side Panel: Info + Reports */}
        <div className="space-y-4">
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Project Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Value</span><span className="text-gray-200 font-semibold">{formatCurrency(project.projectValue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Collected</span><span className="text-green-400">{formatCurrency(project.totalPaid)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Balance</span><span className="text-yellow-400">{formatCurrency(project.projectValue - project.totalPaid)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Start</span><span className="text-gray-300">{formatDate(project.startDate)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Due</span><span className="text-gray-300">{formatDate(project.expectedEndDate)}</span></div>
            </div>
          </Card>

          {/* Recent Reports */}
          <Card padding="none">
            <div className="p-4 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-200">Site Reports</h3>
            </div>
            {reports.length === 0 ? (
              <p className="p-4 text-xs text-gray-600 text-center">No reports submitted yet</p>
            ) : reports.slice(0, 5).map(r => (
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
        </div>
      </div>

      {/* Add Milestone Modal */}
      <Modal
        open={showMilestoneForm}
        onClose={() => setShowMilestoneForm(false)}
        title="Add Milestone"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowMilestoneForm(false)}>Cancel</Button>
            <Button onClick={saveMilestone} loading={mSaving}>Save Milestone</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Milestone Title *" placeholder="e.g., Phase 1 — Wiring" value={mTitle} onChange={e => setMTitle(e.target.value)} />
          <Textarea label="Description" placeholder="What will be done in this milestone?" value={mDesc} onChange={e => setMDesc(e.target.value)} rows={2} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Expected Date" type="date" value={mDate} onChange={e => setMDate(e.target.value)} />
            <Input label="Payment %" type="number" min={0} max={100} value={mPayPercent} onChange={e => setMPayPercent(Number(e.target.value))} hint="% of total due on this milestone" />
          </div>
          <div>
            <p className="form-label">Assign Workers</p>
            <div className="space-y-1.5">
              {workers.map(w => (
                <label key={w.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mWorkers.includes(w.id)}
                    onChange={e => setMWorkers(prev =>
                      e.target.checked ? [...prev, w.id] : prev.filter(id => id !== w.id)
                    )}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-300">{w.name}</span>
                  <span className="text-xs text-gray-600 capitalize">{w.role.replace('_', ' ')}</span>
                </label>
              ))}
              {workers.length === 0 && <p className="text-xs text-gray-600">No site workers in system</p>}
            </div>
          </div>
        </div>
      </Modal>

      {/* Site Report Modal */}
      <Modal
        open={showReportForm}
        onClose={() => setShowReportForm(false)}
        title="Submit Site Report"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowReportForm(false)}>Cancel</Button>
            <Button onClick={saveReport} loading={rSaving}>Submit Report</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Milestone" options={milestoneOptions} value={rMilestoneId} onChange={e => setRMilestoneId(e.target.value)} />
          <Textarea label="Work Done Today *" placeholder="Describe what was completed…" value={rWorkDone} onChange={e => setRWorkDone(e.target.value)} rows={3} />
          <Textarea label="Issues Found" placeholder="Any problems encountered?" value={rIssues} onChange={e => setRIssues(e.target.value)} rows={2} />
          <Textarea label="Materials Needed" placeholder="What materials are required?" value={rMaterials} onChange={e => setRMaterials(e.target.value)} rows={2} />
          <Textarea label="Next Steps" placeholder="What will be done next visit?" value={rNextSteps} onChange={e => setRNextSteps(e.target.value)} rows={2} />
          <div className="border-2 border-dashed border-gray-700 rounded-xl p-4 text-center text-sm text-gray-600">
            <Camera className="w-6 h-6 mx-auto mb-2" />
            Photo upload coming soon
          </div>
        </div>
      </Modal>
    </div>
  )
}
