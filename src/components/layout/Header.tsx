import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search, Bell, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/':               'Dashboard',
  '/leads':          'Lead Management',
  '/partners':       'B2B Partners',
  '/customers':      'Customers',
  '/quotations':     'Quotations',
  '/projects':       'Projects',
  '/daily-reports':  'Daily Reports',
  '/content-studio': 'Content Studio',
  '/notifications':  'Notifications',
  '/inventory':      'Inventory',
  '/settings':       'Settings',
}

interface HeaderProps {
  collapsed: boolean
  onToggle: () => void
  notificationCount?: number
}

export function Header({ collapsed, onToggle, notificationCount = 0 }: HeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)

  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path)
  )?.[1] ?? 'Galaxy OS'

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-gray-950 border-b border-gray-800 shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
        <div>
          <h1 className="text-sm font-semibold text-gray-100">{title}</h1>
          <p className="text-xs text-gray-600 hidden sm:block">{today}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className={cn('flex items-center transition-all duration-200', searchOpen ? 'w-56' : 'w-8')}>
          {searchOpen && (
            <input
              autoFocus
              placeholder="Search…"
              onBlur={() => setSearchOpen(false)}
              className="form-input py-1.5 text-xs w-full mr-1"
            />
          )}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {/* Notifications */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative text-gray-500 hover:text-gray-300 transition-colors p-1"
        >
          <Bell className="w-4 h-4" />
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold leading-none">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

        {/* User greeting */}
        <div className="hidden md:block pl-2 border-l border-gray-800">
          <p className="text-xs text-gray-400">
            {getGreeting()}, <span className="text-gray-200 font-medium">{user?.name?.split(' ')[0]}</span>
          </p>
        </div>
      </div>
    </header>
  )
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
