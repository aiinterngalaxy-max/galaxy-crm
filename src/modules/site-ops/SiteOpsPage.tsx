import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardHat, MapPin, Calendar, ChevronRight, Camera, CheckCircle2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, getDocs, orderBy } from '../../lib/firebase'
import { MILESTONE_STATUS_CONFIG, formatDate } from '../../lib/utils'
import type { Milestone, Project } from '../../types'
import { PageLoader } from '../../components/ui/LoadingSpinner'

interface MilestoneWithProject extends Milestone {
  project?: Project
}

export function SiteOpsPage() {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const [assignments, setAssignments] = useState<MilestoneWithProject[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

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
        setProjects(allProjects)

        // Load milestones for these projects
        const milestonePromises = allProjects.map(async (project) => {
          const milSnap = await getDocs(
            query(collection(db, 'projects', project.id, 'milestones'),
              orderBy('orderIndex')
            )
          )
          return milSnap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            project,
          }) as MilestoneWithProject)
        })

        const allMilestones = (await Promise.all(milestonePromises)).flat()

        // Filter to current user's assignments if site worker
        const mine = role === 'site_worker'
          ? allMilestones.filter(m => m.assignedWorkers?.includes(user.id))
          : allMilestones

        setAssignments(mine.filter(m => m.status !== 'completed'))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, role])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Site Operations</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {assignments.length} active assignments across {projects.filter(p => p.status === 'in_progress').length} projects
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm"><p className="text-xs text-gray-500">Active Projects</p><p className="text-xl font-bold text-gray-100 mt-1">{projects.filter(p => p.status === 'in_progress').length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Open Milestones</p><p className="text-xl font-bold text-indigo-400 mt-1">{assignments.filter(a => a.status === 'in_progress').length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Pending Start</p><p className="text-xl font-bold text-gray-400 mt-1">{assignments.filter(a => a.status === 'pending').length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Overdue</p><p className="text-xl font-bold text-red-400 mt-1">{assignments.filter(a => a.status === 'overdue').length}</p></Card>
      </div>

      {/* Active Projects with Milestones */}
      {projects.filter(p => p.status === 'in_progress').map(project => {
        const projectMilestones = assignments.filter(a => a.project?.id === project.id)
        if (projectMilestones.length === 0) return null
        return (
          <Card key={project.id} padding="none">
            {/* Project header */}
            <div
              className="flex items-center gap-3 p-4 border-b border-gray-800 cursor-pointer hover:bg-gray-800/30"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="w-8 h-8 bg-indigo-900/40 rounded-lg flex items-center justify-center">
                <HardHat className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-200">{project.title}</p>
                <p className="text-xs text-gray-500">{project.customerName} · {project.projectCode}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{project.completionPercent ?? 0}% complete</p>
                <div className="w-20 h-1.5 bg-gray-800 rounded-full mt-1">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${project.completionPercent ?? 0}%` }} />
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-700" />
            </div>

            {/* Milestones */}
            <div className="divide-y divide-gray-800">
              {projectMilestones.map(milestone => {
                const mCfg = MILESTONE_STATUS_CONFIG[milestone.status]
                return (
                  <div key={milestone.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${mCfg?.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200">{milestone.title}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                        {milestone.expectedDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(milestone.expectedDate)}
                          </span>
                        )}
                        {(milestone.assignedWorkerNames?.length ?? 0) > 0 && (
                          <span>{(milestone.assignedWorkerNames ?? []).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={mCfg?.color} bg="bg-gray-800">{mCfg?.label}</Badge>
                      <button
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Report
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}

      {assignments.length === 0 && !loading && (
        <Card className="py-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-base font-medium text-gray-300">No active assignments</p>
          <p className="text-sm text-gray-600 mt-1">All milestones are up to date</p>
        </Card>
      )}
    </div>
  )
}
