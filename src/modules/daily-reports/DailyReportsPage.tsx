import { useState, useEffect } from 'react'
import { ClipboardList, CheckCircle2, AlertCircle, Plus, Phone, UserPlus, FileText, TrendingUp } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Textarea } from '../../components/ui/Textarea'
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

export function DailyReportsPage() {
  const { user, role, isManagement } = useAuth()
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [todayStats, setTodayStats] = useState<TodayStats>({
    leadsCreated: [],
    callsMade: [],
    quotationsSent: 0,
    leadsProgressed: [],
  })

  // Form state
  const [topWin, setTopWin] = useState('')
  const [challenge, setChallenge] = useState('')
  const [tomorrow, setTomorrow] = useState('')

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
        // Leads created today by this user
        const leadsSnap = await getDocs(
          query(
            collection(db, 'leads'),
            where('createdBy', '==', user!.id),
            where('createdAt', '>=', todayStart),
            where('createdAt', '<=', todayEnd)
          )
        )
        const leadsCreated = leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)

        // All leads created by or assigned to user — check for status changes today
        const allLeadsSnap = await getDocs(
          query(collection(db, 'leads'), where('createdBy', '==', user!.id))
        )
        const allLeads = allLeadsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead)

        // Leads progressed today (updatedAt today, not newly created)
        const progressed = allLeads.filter(l => {
          if (!l.updatedAt) return false
          const updated = l.updatedAt instanceof Timestamp ? l.updatedAt.toDate() : new Date(l.updatedAt as string)
          return updated >= startOfDay(new Date()) && !leadsCreated.find(lc => lc.id === l.id)
        })

        // Calls/activities logged today across all leads
        const activityPromises = allLeads.slice(0, 20).map(lead =>
          getDocs(
            query(
              collection(db, 'leads', lead.id, 'activities'),
              where('createdAt', '>=', todayStart),
              where('createdAt', '<=', todayEnd)
            )
          ).then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
        )
        const allActivities = (await Promise.all(activityPromises)).flat()
        const callsMade = allActivities.filter(a => a.type === 'call' || a.type === 'meeting')

        // Quotations created today
        const quotSnap = await getDocs(
          query(
            collection(db, 'quotations'),
            where('createdBy', '==', user!.id),
            where('createdAt', '>=', todayStart),
            where('createdAt', '<=', todayEnd)
          )
        )

        setTodayStats({
          leadsCreated,
          callsMade,
          quotationsSent: quotSnap.size,
          leadsProgressed: progressed,
        })
      } catch (err) {
        console.error('Failed to load today stats', err)
      }
    }
    fetchTodayActivity()
  }, [user, isManagement])

  const submitReport = async () => {
    if (!topWin.trim()) { toast.error('Fill in your top win for today'); return }
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
        topWin,
        mainChallenge: challenge,
        tomorrowPlan: tomorrow,
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
      setTopWin(''); setChallenge(''); setTomorrow('')
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

      {/* Reports list */}
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
                    <p className="text-sm font-semibold text-gray-200">
                      {isManagement ? report.employeeName : formatDate(report.date, 'dd MMM yyyy')}
                    </p>
                    {isManagement && (
                      <span className="text-xs text-gray-500">{report.date}</span>
                    )}
                    <Badge
                      color={report.status === 'submitted' ? 'text-green-400' : report.status === 'late' ? 'text-yellow-400' : 'text-red-400'}
                      bg={report.status === 'submitted' ? 'bg-green-900/30' : report.status === 'late' ? 'bg-yellow-900/30' : 'bg-red-900/30'}
                    >
                      {report.status}
                    </Badge>
                  </div>

                  {/* System stats snapshot */}
                  {report.systemStats && Object.values(report.systemStats).some(v => (v as number) > 0) && (
                    <div className="flex gap-4 mt-2">
                      {(report.systemStats.leadsCreated ?? 0) > 0 && (
                        <span className="text-xs text-gray-500"><span className="text-indigo-400 font-semibold">{report.systemStats.leadsCreated}</span> leads</span>
                      )}
                      {(report.systemStats.callsMade ?? 0) > 0 && (
                        <span className="text-xs text-gray-500"><span className="text-green-400 font-semibold">{report.systemStats.callsMade}</span> calls</span>
                      )}
                      {(report.systemStats.quotationsSent ?? 0) > 0 && (
                        <span className="text-xs text-gray-500"><span className="text-yellow-400 font-semibold">{report.systemStats.quotationsSent}</span> quotes</span>
                      )}
                      {(report.systemStats.leadsProgressed ?? 0) > 0 && (
                        <span className="text-xs text-gray-500"><span className="text-purple-400 font-semibold">{report.systemStats.leadsProgressed}</span> advanced</span>
                      )}
                    </div>
                  )}

                  {report.topWin && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-500">🏆 <span className="text-gray-300">{report.topWin}</span></p>
                      {report.mainChallenge && (
                        <p className="text-xs text-gray-500">⚡ <span className="text-gray-400">{report.mainChallenge}</span></p>
                      )}
                      {report.tomorrowPlan && (
                        <p className="text-xs text-gray-500">→ <span className="text-gray-400">{report.tomorrowPlan}</span></p>
                      )}
                    </div>
                  )}
                </div>
                {report.submittedAt && (
                  <p className="text-xs text-gray-600 shrink-0">
                    {formatDateTime(report.submittedAt)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Submit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={`Daily Report — ${format(new Date(), 'dd MMM yyyy')}`}
        description="Your system activity is auto-tracked. Just add your personal notes below."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={submitReport} loading={submitting}>Submit Report</Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Auto-stats preview inside modal */}
          <div className="bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-2 font-medium">Auto-tracked today</p>
            <div className="flex gap-4 flex-wrap">
              <span className="text-xs text-gray-400"><span className="text-indigo-400 font-bold">{todayStats.leadsCreated.length}</span> leads added</span>
              <span className="text-xs text-gray-400"><span className="text-green-400 font-bold">{todayStats.callsMade.length}</span> calls/visits</span>
              <span className="text-xs text-gray-400"><span className="text-yellow-400 font-bold">{todayStats.quotationsSent}</span> quotations</span>
              <span className="text-xs text-gray-400"><span className="text-purple-400 font-bold">{todayStats.leadsProgressed.length}</span> leads advanced</span>
            </div>
          </div>

          <Textarea
            label="🏆 Top Win Today *"
            placeholder="What was your biggest win today? Closed a lead? Completed a milestone?"
            value={topWin}
            onChange={e => setTopWin(e.target.value)}
            rows={2}
          />
          <Textarea
            label="⚡ Main Challenge"
            placeholder="What slowed you down or needs help?"
            value={challenge}
            onChange={e => setChallenge(e.target.value)}
            rows={2}
          />
          <Textarea
            label="→ Plan for Tomorrow"
            placeholder="What are your top 3 priorities tomorrow?"
            value={tomorrow}
            onChange={e => setTomorrow(e.target.value)}
            rows={2}
          />
        </div>
      </Modal>
    </div>
  )
}
