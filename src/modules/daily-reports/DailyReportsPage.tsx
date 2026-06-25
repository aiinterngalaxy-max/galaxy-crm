import { useState, useEffect } from 'react'
import { ClipboardList, CheckCircle2, AlertCircle, Plus, Phone, UserPlus, FileText, TrendingUp, Trash2, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp
} from '../../lib/firebase'
import { formatDate, formatDateTime } from '../../lib/utils'
import type { DailyReport, Lead, LeadActivity } from '../../types'
import { format, startOfDay, endOfDay } from 'date-fns'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'

interface TodayStats {
  leadsCreated: Lead[]
  callsMade: LeadActivity[]
  quotationsSent: number
  leadsProgressed: Lead[]
}

const DEPARTMENTS = ['All', 'business_development', 'project_management', 'accounts', 'management']
const DEPT_LABELS: Record<string, string> = {
  business_development: 'BD',
  project_management: 'PM',
  accounts: 'Accounts',
  management: 'Management',
}

export function DailyReportsPage() {
  const { user, role, isManagement } = useAuth()
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)
  const [deptFilter, setDeptFilter] = useState('All')
  const [empSearch, setEmpSearch] = useState('')
  const [todayStats, setTodayStats] = useState<TodayStats>({
    leadsCreated: [],
    callsMade: [],
    quotationsSent: 0,
    leadsProgressed: [],
  })

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

  // Auto-fetch today's activity for BD/PM roles
  useEffect(() => {
    if (!user || isManagement) return
    const todayStart = Timestamp.fromDate(startOfDay(new Date()))
    const todayEnd = Timestamp.fromDate(endOfDay(new Date()))

    async function fetchTodayActivity() {
      try {
        // Fetch all leads, filter entirely in JS — no index required
        const allLeadsSnap = await getDocs(collection(db, 'leads'))
        const allLeadsData = allLeadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)

        const toDate = (ts: any): Date => {
          if (!ts) return new Date(0)
          if (ts?.toDate) return ts.toDate()
          return new Date(ts)
        }

        const todayStart = startOfDay(new Date())
        const todayEnd = endOfDay(new Date())

        // All leads created by this user
        const allLeads = allLeadsData.filter(l => l.createdBy === user!.id)

        // "Leads Added" = leads where this user is createdBy AND (created today OR assigned/updated today)
        const leadsCreated = allLeadsData.filter(l => {
          const isMyLead = l.createdBy === user!.id || l.assignedTo === user!.id
          if (!isMyLead) return false
          const created = toDate(l.createdAt)
          const updated = toDate(l.updatedAt)
          return (created >= todayStart && created <= todayEnd) ||
                 (updated >= todayStart && updated <= todayEnd)
        })

        // Leads progressed today (status updated today, not newly created)
        const progressed = allLeads.filter(l => {
          const updated = toDate(l.updatedAt)
          const created = toDate(l.createdAt)
          const touchedToday = updated >= todayStart && updated <= todayEnd
          const createdToday = created >= todayStart && created <= todayEnd
          return touchedToday && !createdToday
        })

        // Calls/activities logged today across all leads (client-side filter)
        const activityPromises = allLeads.slice(0, 20).map(lead =>
          getDocs(collection(db, 'leads', lead.id, 'activities'))
            .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
        )
        const allActivities = (await Promise.all(activityPromises)).flat()
        const callsMade = allActivities.filter(a => {
          const d = toDate((a as any).createdAt)
          return (a.type === 'call' || a.type === 'meeting') && d >= todayStart && d <= todayEnd
        })

        // Quotations created today — client-side filter, no composite index needed
        const quotSnap = await getDocs(collection(db, 'quotations'))
        const quotToday = quotSnap.docs.filter(d => {
          const data = d.data()
          return data.createdBy === user!.id && toDate(data.createdAt) >= todayStart && toDate(data.createdAt) <= todayEnd
        })

        setTodayStats({
          leadsCreated,
          callsMade,
          quotationsSent: quotToday.length,
          leadsProgressed: progressed,
        })
      } catch (err) {
        console.error('Failed to load today stats', err)
      }
    }
    fetchTodayActivity()
  }, [user, isManagement])

  const submitReport = async () => {
    if (tasks.every(t => !t.details.trim())) { toast.error('Add at least one task'); return }
    setSubmitting(true)
    try {
      const systemStats = {
        leadsCreated: todayStats.leadsCreated.length,
        callsMade: todayStats.callsMade.length,
        quotationsSent: todayStats.quotationsSent,
        leadsProgressed: todayStats.leadsProgressed.length,
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

  const totalActivity = todayStats.leadsCreated.length + todayStats.callsMade.length +
    todayStats.quotationsSent + todayStats.leadsProgressed.length

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
            <div className="bg-gray-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
                <p className="text-xs text-gray-500">Leads Added</p>
              </div>
              <p className="text-2xl font-bold text-gray-100">{todayStats.leadsCreated.length}</p>
              {todayStats.leadsCreated.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {todayStats.leadsCreated.slice(0, 3).map(l => (
                    <p key={l.id} className="text-xs text-gray-600 truncate">• {l.name}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-gray-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Phone className="w-3.5 h-3.5 text-green-400" />
                <p className="text-xs text-gray-500">Calls / Visits</p>
              </div>
              <p className="text-2xl font-bold text-gray-100">{todayStats.callsMade.length}</p>
              {todayStats.callsMade.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {todayStats.callsMade.slice(0, 3).map(a => (
                    <p key={a.id} className="text-xs text-gray-600 truncate">• {a.type} — {a.outcome ?? 'logged'}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-gray-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-3.5 h-3.5 text-yellow-400" />
                <p className="text-xs text-gray-500">Quotations Sent</p>
              </div>
              <p className="text-2xl font-bold text-gray-100">{todayStats.quotationsSent}</p>
            </div>

            <div className="bg-gray-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                <p className="text-xs text-gray-500">Leads Advanced</p>
              </div>
              <p className="text-2xl font-bold text-gray-100">{todayStats.leadsProgressed.length}</p>
              {todayStats.leadsProgressed.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {todayStats.leadsProgressed.slice(0, 3).map(l => (
                    <p key={l.id} className="text-xs text-gray-600 truncate">• {l.name}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          {totalActivity === 0 && (
            <p className="text-xs text-gray-600 mt-3 text-center">No activity logged yet today. Data updates as you work.</p>
          )}
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
            {/* Department filter */}
            <select
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 outline-none"
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
            >
              {DEPARTMENTS.map(d => (
                <option key={d} value={d}>{d === 'All' ? 'All Departments' : DEPT_LABELS[d] ?? d}</option>
              ))}
            </select>
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
                                    {(report.systemStats.quotationsSent ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-yellow-400 font-semibold">{report.systemStats.quotationsSent}</span> quotes</span>}
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
                    <div className="flex gap-4 mt-2">
                      {(report.systemStats.leadsCreated ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-indigo-400 font-semibold">{report.systemStats.leadsCreated}</span> leads</span>}
                      {(report.systemStats.callsMade ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.callsMade}</span> calls</span>}
                      {(report.systemStats.quotationsSent ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-yellow-400 font-semibold">{report.systemStats.quotationsSent}</span> quotes</span>}
                      {(report.systemStats.leadsProgressed ?? 0) > 0 && <span className="text-xs text-gray-500"><span className="text-purple-400 font-semibold">{report.systemStats.leadsProgressed}</span> advanced</span>}
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
              <span className="text-xs text-gray-400"><span className="text-indigo-400 font-bold">{todayStats.leadsCreated.length}</span> leads added</span>
              <span className="text-xs text-gray-400"><span className="text-green-400 font-bold">{todayStats.callsMade.length}</span> calls/visits</span>
              <span className="text-xs text-gray-400"><span className="text-yellow-400 font-bold">{todayStats.quotationsSent}</span> quotations</span>
              <span className="text-xs text-gray-400"><span className="text-purple-400 font-bold">{todayStats.leadsProgressed.length}</span> leads advanced</span>
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
