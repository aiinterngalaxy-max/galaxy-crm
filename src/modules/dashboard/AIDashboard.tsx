import { useNavigate } from 'react-router-dom'
import { Sparkles, Bell, ClipboardList, FolderKanban, Users2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../contexts/AuthContext'

export function AIDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const greeting = () => {
    const h = new Date().getHours()
    const name = user?.name?.split(' ')[0] || 'there'
    if (h < 12) return `Good morning, ${name}`
    if (h < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  }

  const shortcuts = [
    { label: 'Content Studio', icon: <Sparkles className="w-5 h-5 text-pink-400" />, path: '/content-studio', desc: 'Generate & manage content' },
    { label: 'Projects',       icon: <FolderKanban className="w-5 h-5 text-violet-400" />, path: '/projects',       desc: 'View all projects' },
    { label: 'Leads',          icon: <Users2 className="w-5 h-5 text-indigo-400" />,       path: '/leads',          desc: 'Browse lead pipeline' },
    { label: 'Daily Reports',  icon: <ClipboardList className="w-5 h-5 text-green-400" />, path: '/daily-reports',  desc: 'Submit EOD report' },
    { label: 'Notifications',  icon: <Bell className="w-5 h-5 text-yellow-400" />,         path: '/notifications',  desc: 'Check your alerts' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{greeting()}</h1>
        <p className="text-sm text-gray-500 mt-0.5">AI Team — Galaxy Home Automation</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {shortcuts.map(s => (
          <Card key={s.path} hover onClick={() => navigate(s.path)} className="flex items-center gap-3 cursor-pointer">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
              {s.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-300">{s.label}</p>
              <p className="text-xs text-gray-600 truncate">{s.desc}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
