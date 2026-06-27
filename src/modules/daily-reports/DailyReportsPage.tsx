import { useState, useEffect } from 'react'
import {
  ClipboardList, CheckCircle2, AlertCircle, Plus, Phone, UserPlus, FileText, TrendingUp, Trash2,
  ChevronDown, ChevronRight, Search, Sparkles, Building2, Lightbulb, Video, Workflow, Link2,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from '../../lib/firebase'
import { formatDate, formatDateTime, canAccess } from '../../lib/utils'
import type { DailyReport, Lead, LeadActivity, UserRole } from '../../types'
import { format, startOfDay, endOfDay } from 'date-fns'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { getActivity } from '../../lib/content-studio/queries'
import type { ActivityEntry } from '../../types/content-studio'

interface TodayStats {
  // BD
  leadsCreated: Lead[]
  callsMade: LeadActivity[]
  leadsProgressed: Lead[]
  // PM
  quotationsCreated: number
  quotationsSentToCustomer: number
  activeProjects: number
  // Content Studio
  contentStudioActivity: ActivityEntry[]
}

const CS_GROUP_META: Record<ActivityEntry['entity_type'], { label: string; icon: React.ReactNode; color: string }> = {
  content:  { label: 'Content',  icon: <Workflow className="w-3.5 h-3.5" />,    color: 'text-sky-400' },
  script:   { label: 'Scripts',  icon: <FileText className="w-3.5 h-3.5" />,    color: 'text-amber-400' },
  brand:    { label: 'Brands',   icon: <Building2 className="w-3.5 h-3.5" />,   color: 'text-emerald-400' },
  idea:     { label: 'Ideas',    icon: <Lightbulb className="w-3.5 h-3.5" />,   color: 'text-purple-400' },
  shoot:    { label: 'Shoots',   icon: <Video className="w-3.5 h-3.5" />,       color: 'text-rose-400' },
  sync:     { label: 'Sync',     icon: <Link2 className="w-3.5 h-3.5" />,       color: 'text-indigo-400' },
}
const CS_GROUP_ORDER: ActivityEntry['entity_type'][] = ['content', 'script', 'idea', 'shoot', 'brand', 'sync']

function csGroup(entries: ActivityEntry[]): { type: ActivityEntry['entity_type']; entries: ActivityEntry[] }[] {
  return CS_GROUP_ORDER
    .map(type => ({ type, entries: entries.filter(e => e.entity_type === type) }))
    .filter(g => g.entries.length > 0)
}

function csTime(entry: ActivityEntry): string {
  const d = new Date(entry.created_at.replace(' ', 'T'))
  return isNaN(d.getTime()) ? '' : format(d, 'h:mm a')
}

const DEPARTMENTS = ['All', 'business_development', 'project_management', 'management']
const DEPT_LABELS: Record<string, string> = {
  business_development: 'BD',
  project_management: 'PM',
  management: 'Management',
}

export function DailyReportsPage() {
  const { user, role, isManagement } = useAuth()
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)
  const userDept = (user as any)?.department as string | undefined
  const isDeptHead = role === 'dept_head'
  const [deptFilter, setDeptFilter] = useState(isDeptHead && userDept ? userDept : 'All')
  const [empSearch, setEmpSearch] = useState('')
  const [todayStats, setTodayStats] = useState<TodayStats>({
    leadsCreated: [],
    callsMade: [],
    leadsProgressed: [],
    quotationsCreated: 0,
    quotationsSentToCustomer: 0,
    activeProjects: 0,
    contentStudioActivity: [],
  })
  const canSeeContentStudio = isManagement || (role ? canAccess(role as UserRole, 'content-studio') : false)
  const [csExpanded, setCsExpanded] = useState(false)

  // Task table state
  interface TaskRow { id: string; details: string; status: 'pending' | 'done'; duration: string }
  const newRow = (): TaskRow => ({ id: crypto.randomUUID(), details: '', status: 'pending', duration: '' })
  const [tasks, setTasks] = useState<TaskRow[]>([newRow()])

  const updateTask = (id: string, field: keyof TaskRow, value: string) =>
    setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  const addTask = () => setTasks(prev => [...prev, newRow()])
  const removeTask = (id: string) => setTasks(prev => prev.length > 1 ? prev.filter(t => t.id !== id) : prev)

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayReport = reports.find(r => r.date === today && r.employeeId === user?.id)

  // Load reports
  useEffect(() => {
    if (!user) return
    const constraints: Parameters<typeof query>[1][] = [orderBy('date', 'desc')]
    if (!isManagement) {
      constraints.unshift(where('employeeId', '==', user.id))
    }
    getDocs(query(collection(db, 'dailyReports'), ...constraints))
      .then(snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DailyReport)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user, isManagement])

  // Auto-fetch today's activity — dept-aware
  useEffect(() => {
    if (!user || isManagement) return
    const dept = (user as any).department as string | undefined
    const isBD = role === 'bd_exec' || role === 'dept_head' || dept === 'business_development'
    const isPM = role === 'project_manager' || dept === 'project_management'

    const toDate = (ts: any): Date => {
      if (!ts) return new Date(0)
      if (ts?.toDate) return ts.toDate()
      return new Date(ts)
    }
    const todayStart = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())
    const inToday = (ts: any) => { const d = toDate(ts); return d >= todayStart && d <= todayEnd }

    async function fetchBD() {
      const allLeadsSnap = await getDocs(collection(db, 'leads'))
      const allLeadsData = allLeadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)
      const myLeads = allLeadsData.filter(l => l.createdBy === user!.id)

      const leadsCreated = allLeadsData.filter(l => {
        if (l.createdBy !== user!.id && l.assignedTo !== user!.id) return false
        return inToday(l.createdAt) || inToday(l.updatedAt)
      })
      const leadsProgressed = myLeads.filter(l => inToday(l.updatedAt) && !inToday(l.createdAt))

      const activityResults = await Promise.all(
        myLeads.slice(0, 20).map(lead =>
          getDocs(collection(db, 'leads', lead.id, 'activities'))
            .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
        )
      )
      const callsMade = activityResults.flat().filter(a =>
        (a.type === 'call' || a.type === 'meeting') && inToday((a as any).createdAt)
      )

      setTodayStats(prev => ({ ...prev, leadsCreated, leadsProgressed, callsMade }))
    }

    async function fetchPM() {
      const [quotSnap, projSnap] = await Promise.all([
        getDocs(collection(db, 'quotations')),
        getDocs(collection(db, 'projects')),
      ])
      const quotationsCreated = quotSnap.docs.filter(d => {
        const data = d.data()
        return data.createdBy === user!.id && inToday(data.createdAt)
      }).length
      const quotationsSentToCustomer = quotSnap.docs.filter(d => {
        const data = d.data()
        return data.createdBy === user!.id && inToday(data.sentAt)
      }).length
      const activeProjects = projSnap.docs.filter(d => d.data().status === 'in_progress').length

      setTodayStats(prev => ({ ...prev, quotationsCreated, quotationsSentToCustomer, activeProjects }))
    }

    if (isBD) fetchBD().catch(console.error)
    if (isPM) fetchPM().catch(console.error)
    if (!isBD && !isPM) {
      // fallback: fetch both
      Promise.all([fetchBD(), fetchPM()]).catch(console.error)
    }
  }, [user, isManagement, role])

  // Auto-fetch today's Content Studio activity (Turso-backed, separate from the Firestore fetch above)
  useEffect(() => {
    if (!user || !canSeeContentStudio) return
    const todayStart = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())

    getActivity()
      .then(entries => {
        const todays = entries.filter(e => {
          const d = new Date(e.created_at.replace(' ', 'T'))
          return d >= todayStart && d <= todayEnd
        })
        setTodayStats(prev => ({ ...prev, contentStudioActivity: todays }))
      })
      .catch(console.error)
  }, [user, canSeeContentStudio])

  const submitReport = async () => {
    if (tasks.every(t => !t.details.trim())) { toast.error('Add at least one task'); return }
    setSubmitting(true)
    try {
      const systemStats = {
        leadsCreated: todayStats.leadsCreated.length,
        callsMade: todayStats.callsMade.length,
        leadsProgressed: todayStats.leadsProgressed.length,
        quotationsCreated: todayStats.quotationsCreated,
        quotationsSentToCustomer: todayStats.quotationsSentToCustomer,
        activeProjects: todayStats.activeProjects,
        contentStudioActivity: todayStats.contentStudioActivity.length,
      }
      const data = {
        date: today,
        employeeId: user?.id,
        employeeName: user?.name,
        department: user?.department,
        tasks: tasks.filter(t => t.details.trim()).map((t, i) => ({ ...t, no: i + 1 })),
        systemStats,
        status: 'submitted',
        submittedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'dailyReports'), data)
      const newReport = { id: ref.id, ...data } as unknown as DailyReport
      setReports(prev => [newReport, ...prev])
      toast.success('Daily report submitted!')
      setShowForm(false)
      setTasks([newRow()])
    } catch {
      toast.error('Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  const dept = (user as any)?.department as string | undefined
  const isBDUser = role === 'bd_exec' || role === 'dept_head' || dept === 'business_development'
  const isPMUser = role === 'project_manager' || dept === 'project_management'
  const totalActivity = todayStats.leadsCreated.length + todayStats.callsMade.length +
    todayStats.leadsProgressed.length + todayStats.quotationsCreated + todayStats.activeProjects +
    todayStats.contentStudioActivity.length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Daily Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isManagement ? 'Team-wide daily activity reports' : 'Your daily activity log'}
          </p>
        </div>
        {!todayReport && (
          <Button onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>
            Submit Today's Report
          </Button>
        )}
        {todayReport && (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            Today's report submitted
          </div>
        )}
      </div>

      {/* Today's prompt */}
      {!todayReport && !isManagement && (
        <Card className="border-yellow-800/50 bg-yellow-900/10">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-300">Daily report due by 6:30 PM</p>
              <p className="text-xs text-yellow-700 mt-0.5">
                Please submit your daily report before end of day. It helps management track team progress.
              </p>
            </div>
            <Button size="sm" variant="warning" onClick={() => setShowForm(true)}>Submit Now</Button>
          </div>
        </Card>
      )}

      {/* Today's auto-tracked activity (BD/PM only) */}
      {!isManagement && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-header"><TrendingUp className="w-4 h-4 text-indigo-400" /> Today's Activity (Auto-tracked)</h2>
            <span className="text-xs text-gray-600">{format(new Date(), 'dd MMM yyyy')}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* BD stats */}
            {(isBDUser || (!isBDUser && !isPMUser)) && (<>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
                  <p className="text-xs text-gray-500">Leads Added</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.leadsCreated.length}</p>
                {todayStats.leadsCreated.slice(0, 3).map(l => (
                  <p key={l.id} className="text-xs text-gray-600 truncate mt-0.5">• {l.name}</p>
                ))}
              </div>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Phone className="w-3.5 h-3.5 text-green-400" />
                  <p className="text-xs text-gray-500">Calls / Visits</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.callsMade.length}</p>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                  <p className="text-xs text-gray-500">Leads Advanced</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.leadsProgressed.length}</p>
                {todayStats.leadsProgressed.slice(0, 3).map(l => (
                  <p key={l.id} className="text-xs text-gray-600 truncate mt-0.5">• {l.name}</p>
                ))}
              </div>
            </>)}
            {/* PM stats */}
            {(isPMUser || (!isBDUser && !isPMUser)) && (<>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-3.5 h-3.5 text-yellow-400" />
                  <p className="text-xs text-gray-500">Quotations Created</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.quotationsCreated}</p>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <p className="text-xs text-gray-500">Sent to Customer</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.quotationsSentToCustomer}</p>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <p className="text-xs text-gray-500">Active Projects</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{todayStats.activeProjects}</p>
              </div>
            </>)}
          </div>
          {totalActivity === 0 && (
            <p className="text-xs text-gray-600 mt-3 text-center">No activity logged yet today. Data updates as you work.</p>
          )}

          {/* Content Studio — full pipeline activity */}
          {canSeeContentStudio && todayStats.contentStudioActivity.length > 0 && (() => {
            const sorted = [...todayStats.contentStudioActivity].sort(
              (a, b) => new Date(b.created_at.replace(' ', 'T')).getTime() - new Date(a.created_at.replace(' ', 'T')).getTime()
            )
            const visible = csExpanded ? sorted : sorted.slice(0, 10)
            const groups = csGroup(visible)

            return (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Content Studio Activity
                  </h3>
                  <span className="text-xs text-gray-600">{sorted.length} {sorted.length === 1 ? 'action' : 'actions'} today</span>
                </div>

                <div className="space-y-3">
                  {groups.map(g => {
                    const meta = CS_GROUP_META[g.type]
                    return (
                      <div key={g.type}>
                        <div className={`flex items-center gap-1.5 mb-1.5 ${meta.color}`}>
                          {meta.icon}
                          <p className="text-xs font-medium">{meta.label} <span className="text-gray-600">({g.entries.length})</span></p>
                        </div>
                        <div className="space-y-1 pl-5">
                          {g.entries.map(entry => (
                            <div key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                              <p className="text-gray-400 truncate">{entry.detail}</p>
                              <span className="text-gray-600 shrink-0">{csTime(entry)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {sorted.length > 10 && (
                  <button
                    onClick={() => setCsExpanded(e => !e)}
                    className="mt-3 text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    {csExpanded ? 'Show less' : `View all ${sorted.length}`}
                  </button>
                )}
              </div>
            )
          })()}
        </Card>
      )}

      {/* ── MANAGEMENT VIEW ── */}
      {isManagement ? (
        <Card padding="none">
          {/* Toolbar */}
          <div className="p-4 border-b border-gray-800 flex flex-wrap gap-3 items-center">
            <h2 className="section-header flex items-center gap-2 mr-auto">
              <ClipboardList className="w-4 h-4 text-indigo-400" /> Team Reports
            </h2>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none w-44"
                placeholder="Search employee…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
              />
            </div>
            {/* Department filter — only super admin / management can switch */}
            {!isDeptHead && (
              <select
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 outline-none"
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
              >
                {DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d === 'All' ? 'All Departments' : DEPT_LABELS[d] ?? d}</option>
                ))}
              </select>
            )}
            {isDeptHead && userDept && (
              <span className="text-xs px-3 py-1.5 rounded-lg bg-indigo-900/30 border border-indigo-800/40 text-indigo-400">
                {DEPT_LABELS[userDept] ?? userDept} only
              </span>
            )}
          </div>

          {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}

          {/* Group by employee, show latest report per employee for today */}
          {(() => {
            const today = format(new Date(), 'yyyy-MM-dd')
            // Get all unique employees who submitted today
            const todayReports = reports.filter(r => r.date === today)
            // Also show history grouped by employee
            const employeeIds = [...new Set(reports.map(r => r.employeeId))]

            const filtered = employeeIds.filter(empId => {
              const rep = reports.find(r => r.employeeId === empId)
              if (!rep) return false
              const nameMatch = !empSearch || (rep.employeeName || '').toLowerCase().includes(empSearch.toLowerCase())
              const deptMatch = deptFilter === 'All' || (rep as any).department === deptFilter
              return nameMatch && deptMatch
            })

            if (!loading && filtered.length === 0) return (
              <div className="p-8 text-center text-sm text-gray-600">No reports found</div>
            )

            return (
              <div className="divide-y divide-gray-800">
                {filtered.map(empId => {
                  const empReports = reports.filter(r => r.employeeId === empId).sort((a, b) => b.date.localeCompare(a.date))
                  const latest = empReports[0]
                  const submittedToday = todayReports.some(r => r.employeeId === empId)
                  const isOpen = expandedEmployee === empId

                  return (
                    <div key={empId}>
                      {/* Employee row */}
                      <button
                        className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-800/40 transition-colors text-left"
                        onClick={() => setExpandedEmployee(isOpen ? null : empId)}
                      >
                        <div className="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {(latest.employeeName || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-200">{latest.employeeName}</p>
                          <p className="text-xs text-gray-500">
                            {DEPT_LABELS[(latest as any).department] ?? (latest as any).department ?? '—'} · {empReports.length} report{empReports.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <Badge
                          color={submittedToday ? 'text-green-400' : 'text-gray-500'}
                          bg={submittedToday ? 'bg-green-900/30' : 'bg-gray-800'}
                        >
                          {submittedToday ? 'Submitted today' : 'Not submitted'}
                        </Badge>
                        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />}
                      </button>

                      {/* Expanded: show all their reports */}
                      {isOpen && (
                        <div className="bg-gray-900/60 border-t border-gray-800 divide-y divide-gray-800/60 px-5">
                          {empReports.map(report => (
                            <div key={report.id} className="py-4">
                              <div className="flex items-center gap-3 mb-2">
                                <p className="text-xs font-semibold text-gray-400">{formatDate(report.date, 'dd MMM yyyy')}</p>
                                <Badge
                                  color={report.status === 'submitted' ? 'text-green-400' : 'text-yellow-400'}
                                  bg={report.status === 'submitted' ? 'bg-green-900/30' : 'bg-yellow-900/30'}
                                >{report.status}</Badge>
                                {report.systemStats && (
                                  <div className="flex gap-3 ml-2">
                                    {(report.systemStats.leadsCreated ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-indigo-400 font-semibold">{report.systemStats.leadsCreated}</span> leads</span>}
                                    {(report.systemStats.callsMade ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.callsMade}</span> calls</span>}
                                    {(report.systemStats.leadsProgressed ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-purple-400 font-semibold">{report.systemStats.leadsProgressed}</span> advanced</span>}
                                    {(report.systemStats.quotationsCreated ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-yellow-400 font-semibold">{report.systemStats.quotationsCreated}</span> quotes</span>}
                                    {(report.systemStats.quotationsSentToCustomer ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-orange-400 font-semibold">{report.systemStats.quotationsSentToCustomer}</span> sent</span>}
                                    {(report.systemStats.activeProjects ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.activeProjects}</span> active proj</span>}
                                    {(report.systemStats.contentStudioActivity ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-pink-400 font-semibold">{report.systemStats.contentStudioActivity}</span> content studio</span>}
                                  </div>
                                )}
                                <span className="ml-auto text-xs text-gray-600">{formatDateTime(report.submittedAt)}</span>
                              </div>
                              {(report as any).tasks?.length > 0 ? (
                                <div className="rounded-lg border border-gray-800 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-gray-800/60">
                                      <tr>
                                        <th className="text-left px-3 py-1.5 text-gray-500 w-8">#</th>
                                        <th className="text-left px-3 py-1.5 text-gray-500">Task</th>
                                        <th className="text-left px-3 py-1.5 text-gray-500 w-20">Status</th>
                                        <th className="text-left px-3 py-1.5 text-gray-500 w-20">Duration</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/60">
                                      {(report as any).tasks.map((t: any) => (
                                        <tr key={t.id}>
                                          <td className="px-3 py-1.5 text-gray-600">{t.no}</td>
                                          <td className="px-3 py-1.5 text-gray-300">{t.details}</td>
                                          <td className="px-3 py-1.5">
                                            <span className={t.status === 'done' ? 'text-green-400' : 'text-yellow-400'}>
                                              {t.status === 'done' ? 'Done' : 'Pending'}
                                            </span>
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-500">{t.duration || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-600 italic">No task table in this report</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </Card>
      ) : (
      /* ── EMPLOYEE VIEW: own report history ── */
      <Card padding="none">
        <div className="p-5 border-b border-gray-800">
          <h2 className="section-header"><ClipboardList className="w-4 h-4 text-indigo-400" /> Report History</h2>
        </div>
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && reports.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-600">No reports submitted yet</div>
        )}
        <div className="divide-y divide-gray-800">
          {reports.map(report => (
            <div key={report.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-200">{formatDate(report.date, 'dd MMM yyyy')}</p>
                    <Badge
                      color={report.status === 'submitted' ? 'text-green-400' : 'text-yellow-400'}
                      bg={report.status === 'submitted' ? 'bg-green-900/30' : 'bg-yellow-900/30'}
                    >{report.status}</Badge>
                  </div>
                  {report.systemStats && Object.values(report.systemStats).some(v => (v as number) > 0) && (
                    <div className="flex gap-4 mt-2 flex-wrap">
                      {(report.systemStats.leadsCreated ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-indigo-400 font-semibold">{report.systemStats.leadsCreated}</span> leads</span>}
                      {(report.systemStats.callsMade ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.callsMade}</span> calls</span>}
                      {(report.systemStats.leadsProgressed ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-purple-400 font-semibold">{report.systemStats.leadsProgressed}</span> advanced</span>}
                      {(report.systemStats.quotationsCreated ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-yellow-400 font-semibold">{report.systemStats.quotationsCreated}</span> quotes</span>}
                      {(report.systemStats.quotationsSentToCustomer ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-orange-400 font-semibold">{report.systemStats.quotationsSentToCustomer}</span> sent to customer</span>}
                      {(report.systemStats.activeProjects ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.activeProjects}</span> active projects</span>}
                      {(report.systemStats.contentStudioActivity ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-pink-400 font-semibold">{report.systemStats.contentStudioActivity}</span> content studio</span>}
                    </div>
                  )}
                  {(report as any).tasks?.length > 0 && (
                    <div className="mt-3 rounded-lg border border-gray-800 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-800/60">
                          <tr>
                            <th className="text-left px-3 py-1.5 text-gray-500 w-8">#</th>
                            <th className="text-left px-3 py-1.5 text-gray-500">Task</th>
                            <th className="text-left px-3 py-1.5 text-gray-500 w-20">Status</th>
                            <th className="text-left px-3 py-1.5 text-gray-500 w-20">Duration</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                          {(report as any).tasks.map((t: any) => (
                            <tr key={t.id}>
                              <td className="px-3 py-1.5 text-gray-600">{t.no}</td>
                              <td className="px-3 py-1.5 text-gray-300">{t.details}</td>
                              <td className="px-3 py-1.5">
                                <span className={t.status === 'done' ? 'text-green-400' : 'text-yellow-400'}>
                                  {t.status === 'done' ? 'Done' : 'Pending'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-gray-500">{t.duration || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {report.submittedAt && <p className="text-xs text-gray-600 shrink-0">{formatDateTime(report.submittedAt)}</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>
      )}

      {/* Submit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={`Daily Report — ${format(new Date(), 'dd MMM yyyy')}`}
        description="Auto-tracked stats are filled in. Log your tasks below."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={submitReport} loading={submitting}>Submit Report</Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Auto-stats */}
          <div className="bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-2 font-medium">Auto-tracked today</p>
            <div className="flex gap-4 flex-wrap">
              {(isBDUser || (!isBDUser && !isPMUser)) && (<>
                <span className="text-xs text-gray-400"><span className="text-indigo-400 font-bold">{todayStats.leadsCreated.length}</span> leads added</span>
                <span className="text-xs text-gray-400"><span className="text-green-400 font-bold">{todayStats.callsMade.length}</span> calls/visits</span>
                <span className="text-xs text-gray-400"><span className="text-purple-400 font-bold">{todayStats.leadsProgressed.length}</span> leads advanced</span>
              </>)}
              {(isPMUser || (!isBDUser && !isPMUser)) && (<>
                <span className="text-xs text-gray-400"><span className="text-yellow-400 font-bold">{todayStats.quotationsCreated}</span> quotations created</span>
                <span className="text-xs text-gray-400"><span className="text-indigo-400 font-bold">{todayStats.quotationsSentToCustomer}</span> sent to customer</span>
                <span className="text-xs text-gray-400"><span className="text-green-400 font-bold">{todayStats.activeProjects}</span> active projects</span>
              </>)}
              {canSeeContentStudio && (
                <span className="text-xs text-gray-400"><span className="text-pink-400 font-bold">{todayStats.contentStudioActivity.length}</span> content studio actions</span>
              )}
            </div>
          </div>

          {/* Task table */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Task Report</p>
            <div className="rounded-xl border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/80">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 w-10">#</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500">Task Details</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 w-28">Status</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 w-24">Duration</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {tasks.map((task, i) => (
                    <tr key={task.id} className="bg-gray-900/40">
                      <td className="px-3 py-2 text-xs text-gray-600">{i + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
                          placeholder="What did you work on?"
                          value={task.details}
                          onChange={e => updateTask(task.id, 'details', e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="bg-gray-800 text-xs text-gray-300 rounded px-2 py-1 border border-gray-700 outline-none w-full"
                          value={task.status}
                          onChange={e => updateTask(task.id, 'status', e.target.value)}
                        >
                          <option value="done">Done</option>
                          <option value="pending">Pending</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
                          placeholder="e.g. 2h 30m"
                          value={task.duration}
                          onChange={e => updateTask(task.id, 'duration', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => removeTask(task.id)} className="text-gray-700 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={addTask}
              className="mt-2 flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
            >
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
