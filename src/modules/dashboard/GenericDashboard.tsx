import { useNavigate } from 'react-router-dom'
import { ClipboardList, Bell, Sparkles } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../contexts/AuthContext'
import { ROLE_LABELS } from '../../lib/utils'

export function GenericDashboard() {
  const navigate = useNavigate()
  const { user, role } = useAuth()

  const shortcuts = [
    { label: 'Daily Reports', icon: <ClipboardList className="w-5 h-5 text-indigo-400" />, path: '/daily-reports' },
    { label: 'Notifications', icon: <Bell className="w-5 h-5 text-yellow-400" />, path: '/notifications' },
    { label: 'Content Studio', icon: <Sparkles className="w-5 h-5 text-pink-400" />, path: '/content-studio', roles: ['marketing', 'ai_team'] },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Welcome, {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {role ? ROLE_LABELS[role] : 'Team Member'} — Galaxy Home Automation
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {shortcuts
          .filter(s => !s.roles || (role && s.roles.includes(role)))
          .map(s => (
            <Card key={s.path} hover onClick={() => navigate(s.path)} className="flex flex-col items-center gap-3 py-6 cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                {s.icon}
              </div>
              <span className="text-sm font-medium text-gray-300">{s.label}</span>
            </Card>
          ))}
      </div>
    </div>
  )
}
