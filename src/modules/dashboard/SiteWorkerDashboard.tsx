import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardHat, Camera, Mic, CheckCircle2, MapPin } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, getDocs } from '../../lib/firebase'
import type { Task } from '../../types'

export function SiteWorkerDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    // In a real app, we'd query tasks assigned to this worker across all projects
    // For now, show a placeholder
    setLoading(false)
  }, [user])

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="text-center py-4">
        <div className="w-12 h-12 bg-yellow-900/40 rounded-full flex items-center justify-center mx-auto mb-3">
          <HardHat className="w-6 h-6 text-yellow-400" />
        </div>
        <h1 className="text-lg font-bold text-gray-50">{user?.name}</h1>
        <p className="text-sm text-gray-500">Site Worker — Today's Assignments</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/site-ops')}
          className="bg-indigo-900/30 border border-indigo-800/50 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-indigo-900/50 transition-colors"
        >
          <HardHat className="w-6 h-6 text-indigo-400" />
          <span className="text-xs font-medium text-indigo-300">My Jobs</span>
        </button>
        <button className="bg-green-900/30 border border-green-800/50 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-green-900/50 transition-colors">
          <Camera className="w-6 h-6 text-green-400" />
          <span className="text-xs font-medium text-green-300">Upload Photo</span>
        </button>
        <button className="bg-violet-900/30 border border-violet-800/50 rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-violet-900/50 transition-colors">
          <Mic className="w-6 h-6 text-violet-400" />
          <span className="text-xs font-medium text-violet-300">Voice Report</span>
        </button>
      </div>

      {/* Today's Assignment */}
      <Card padding="none">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">Today's Tasks</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-gray-600 text-center">Loading…</p>
        ) : tasks.length === 0 ? (
          <div className="p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-300">No tasks assigned today</p>
            <p className="text-xs text-gray-600 mt-1">Check with your project manager</p>
          </div>
        ) : tasks.map(task => (
          <div key={task.id} onClick={() => navigate('/site-ops')}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 cursor-pointer">
            <span className={`w-2 h-2 rounded-full ${task.status === 'done' ? 'bg-green-500' : task.status === 'in_progress' ? 'bg-indigo-500' : 'bg-gray-600'}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-200">{task.title}</p>
            </div>
            <Badge
              color={task.status === 'done' ? 'text-green-400' : 'text-indigo-400'}
              bg={task.status === 'done' ? 'bg-green-900/30' : 'bg-indigo-900/30'}
            >
              {task.status}
            </Badge>
          </div>
        ))}
      </Card>

      {/* Report */}
      <Button
        className="w-full justify-center py-3"
        onClick={() => navigate('/daily-reports')}
        icon={<CheckCircle2 className="w-4 h-4" />}
      >
        Submit Daily Report
      </Button>
    </div>
  )
}
