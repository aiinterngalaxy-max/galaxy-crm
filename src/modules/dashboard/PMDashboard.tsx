import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, UserSquare2, FileText, ClipboardList, Bell, ArrowRight } from 'lucide-react'
import { StatCard, Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, limit, onSnapshot, where } from '../../lib/firebase'
import { PROJECT_STATUS_CONFIG } from '../../lib/utils'
import type { Project, Customer } from '../../types'

export function PMDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let done = 0
    const check = () => { if (++done === 2) setLoading(false) }

    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('assignedPM', '==', user?.id ?? ''), orderBy('createdAt', 'desc'), limit(100)),
      snap => { setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)); check() }
    )
    const unsubCustomers = onSnapshot(
      query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(100)),
      snap => { setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Customer)); check() }
    )
    return () => { unsubProjects(); unsubCustomers() }
  }, [user?.id])

  const active    = projects.filter(p => p.status === 'in_progress')
  const atRisk    = projects.filter(p => p.riskLevel === 'high' && p.status === 'in_progress')
  const completed = projects.filter(p => p.status === 'completed')

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'there'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{greeting()}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your project portfolio at a glance.</p>
      </div>

      <div data-tour="stat-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Projects"
          value={active.length}
          subValue={atRisk.length > 0 ? `${atRisk.length} at risk` : 'All on track'}
          icon={<FolderKanban className="w-5 h-5 text-violet-400" />}
          iconBg="bg-violet-900/40"
          trend={atRisk.length > 0 ? { value: `${atRisk.length} at risk`, up: false } : undefined}
          onClick={() => navigate('/projects')}
        />
        <StatCard
          label="Completed"
          value={completed.length}
          icon={<FolderKanban className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
          onClick={() => navigate('/projects')}
        />
        <StatCard
          label="Customers"
          value={customers.length}
          icon={<UserSquare2 className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
          onClick={() => navigate('/customers')}
        />
        <StatCard
          label="Total Projects"
          value={projects.length}
          icon={<FileText className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          onClick={() => navigate('/projects')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none">
          <div className="p-5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="section-header">My Projects</h2>
            <button onClick={() => navigate('/projects')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-800">
            {loading ? (
              <div className="p-5 text-center text-sm text-gray-600">Loading…</div>
            ) : projects.slice(0, 7).map(p => {
              const cfg = PROJECT_STATUS_CONFIG[p.status]
              return (
                <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.riskLevel === 'high' ? 'bg-red-500' : p.riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate">{p.title}</p>
                    <p className="text-xs text-gray-600">{p.projectCode}</p>
                  </div>
                  <Badge color={cfg?.color} bg={cfg?.bg}>{cfg?.label}</Badge>
                </div>
              )
            })}
            {!loading && projects.length === 0 && (
              <div className="p-5 text-sm text-gray-600 text-center">No projects assigned yet</div>
            )}
          </div>
        </Card>

        <div className="grid grid-rows-2 gap-4">
          <Card hover onClick={() => navigate('/daily-reports')} className="flex items-center gap-3 cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300">Daily Reports</p>
              <p className="text-xs text-gray-600">Submit your EOD report</p>
            </div>
          </Card>
          <Card hover onClick={() => navigate('/notifications')} className="flex items-center gap-3 cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300">Notifications</p>
              <p className="text-xs text-gray-600">Check your alerts</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
