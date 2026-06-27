import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardHat, CheckCircle2, Clock, MapPin, ChevronRight, Camera, AlertTriangle } from 'lucide-react'
import { Card, StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, getDocs, orderBy } from '../../lib/firebase'
import { MILESTONE_STATUS_CONFIG } from '../../lib/utils'
import { formatDate } from '../../lib/utils'
import type { Milestone, Project } from '../../types'
import { PageLoader } from '../../components/ui/LoadingSpinner'

interface MilestoneWithProject extends Milestone {
  project: Project
}

export function SiteWorkerDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [assignments, setAssignments] = useState<MilestoneWithProject[]>([])
  const [loading, setLoading] = useState(true)

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'there'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  useEffect(() => {
    if (!user) return
    async function load() {
      try {
        if (!user) return
        const projSnap = await getDocs(
          query(collection(db, 'projects'),
            where('status', 'in', ['planning', 'in_progress']),
            orderBy('updatedAt', 'desc')
          )
        )
        const allProjects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)

        const milestonePromises = allProjects.map(async project => {
          const milSnap = await getDocs(
            query(collection(db, 'projects', project.id, 'milestones'), orderBy('orderIndex'))
          )
          return milSnap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            project,
          }) as MilestoneWithProject)
        })

        const all = (await Promise.all(milestonePromises)).flat()
        const mine = all.filter(m =>
          m.assignedWorkers?.includes(user.id) && m.status !== 'completed'
        )
        setAssignments(mine)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  if (loading) return <PageLoader />

  const inProgress = assignments.filter(m => m.status === 'in_progress')
  const upcoming   = assignments.filter(m => m.status === 'pending')
  const overdue    = assignments.filter(m => m.status === 'overdue')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{greeting()}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your site assignments and active tasks.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="In Progress"
          value={inProgress.length}
          icon={<Clock className="w-5 h-5 text-blue-400" />}
          iconBg="bg-blue-900/30"
        />
        <StatCard
          label="Upcoming"
          value={upcoming.length}
          icon={<HardHat className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/30"
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
          iconBg="bg-red-900/30"
        />
      </div>

      {/* Active tasks */}
      <Card padding="none">
        <div className="p-5 border-b border-gray-800">
          <h2 className="section-header">My Assignments</h2>
        </div>
        {assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm text-gray-400 font-medium">All caught up!</p>
            <p className="text-xs text-gray-600">No active assignments right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {assignments.map(m => {
              const cfg = MILESTONE_STATUS_CONFIG[m.status]
              const isOver = m.status === 'overdue'
              return (
                <div
                  key={m.id}
                  onClick={() => navigate(`/projects/${m.project.id}`)}
                  className="flex items-start gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
                  <div className="w-9 h-9 bg-orange-900/20 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                    <HardHat className="w-4 h-4 text-orange-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-200 truncate">{m.title}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {m.project.title}
                      </span>
                      {m.project.siteAddress && (
                        <span className="truncate max-w-40">{m.project.siteAddress}</span>
                      )}
                    </div>
                    {m.expectedDate && (
                      <p className={`text-xs mt-1 ${isOver ? 'text-red-400' : 'text-gray-600'}`}>
                        Expected: {formatDate(m.expectedDate)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-700 shrink-0 mt-1" />
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Quick actions */}
      <Card padding="sm">
        <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Quick Actions</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/site-ops')}
            className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/60 hover:bg-gray-800 transition-colors text-left"
          >
            <Camera className="w-4 h-4 text-indigo-400" />
            <span className="text-sm text-gray-300">Upload Site Photo</span>
          </button>
          <button
            onClick={() => navigate('/daily-reports')}
            className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/60 hover:bg-gray-800 transition-colors text-left"
          >
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-sm text-gray-300">Daily Report</span>
          </button>
        </div>
      </Card>
    </div>
  )
}
