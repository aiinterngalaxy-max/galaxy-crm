import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users2, UserSquare2, FileText, FolderKanban,
  HardHat, ClipboardList, Receipt, Sparkles, Bell, Settings,
  ChevronRight, LogOut,
} from 'lucide-react'
import { cn, canAccess, ROLE_LABELS, getInitials } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'
import { signOut } from '../../lib/firebase'
import toast from 'react-hot-toast'

interface NavItem {
  label: string
  icon: React.ReactNode
  path: string
  module: string
  badge?: number
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',      icon: <LayoutDashboard className="w-4 h-4" />, path: '/',                module: 'dashboard' },
  { label: 'Leads',          icon: <Users2 className="w-4 h-4" />,          path: '/leads',           module: 'leads' },
  { label: 'Customers',      icon: <UserSquare2 className="w-4 h-4" />,     path: '/customers',       module: 'customers' },
  { label: 'Quotations',     icon: <FileText className="w-4 h-4" />,        path: '/quotations',      module: 'quotations' },
  { label: 'Projects',       icon: <FolderKanban className="w-4 h-4" />,    path: '/projects',        module: 'projects' },
  { label: 'Site Operations',icon: <HardHat className="w-4 h-4" />,         path: '/site-ops',        module: 'site-ops' },
  { label: 'Daily Reports',  icon: <ClipboardList className="w-4 h-4" />,   path: '/daily-reports',   module: 'daily-reports' },
  { label: 'Accounts',       icon: <Receipt className="w-4 h-4" />,         path: '/accounts',        module: 'accounts' },
  { label: 'Content Studio', icon: <Sparkles className="w-4 h-4" />,        path: '/content-studio',  module: 'content-studio' },
  { label: 'Notifications',  icon: <Bell className="w-4 h-4" />,            path: '/notifications',   module: 'notifications' },
  { label: 'Settings',       icon: <Settings className="w-4 h-4" />,        path: '/settings',        module: 'settings' },
]

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
  onNavClick?: () => void
}

export function Sidebar({ collapsed = false, onNavClick }: SidebarProps) {
  const { user, role } = useAuth()
  const location = useLocation()

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.module === 'dashboard') return true
    if (item.module === 'notifications') return true
    if (!role) return false
    if (role === 'super_admin' || role === 'management' || role === 'ai_team') return true
    return canAccess(role, item.module)
  })

  const handleSignOut = async () => {
    try {
      await signOut()
      toast.success('Signed out')
    } catch {
      toast.error('Sign out failed')
    }
  }

  return (
    <aside
      className={cn(
        'h-screen flex flex-col transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{
        background: 'rgba(10,10,15,0.7)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo */}
      <div className={cn('flex items-center gap-3 px-4 py-4 border-b border-gray-800', collapsed && 'justify-center px-0')}>
        <img
          src="/galaxy-logo.png"
          alt="Galaxy"
          className={cn('shrink-0 object-contain', collapsed ? 'w-9 h-9' : 'w-10 h-10')}
        />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold leading-none" style={{ color: '#C9A840' }}>Galaxy</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">Home Automation CRM</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map((item) => {
          const isActive =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path)

          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              onClick={onNavClick}
              className={cn(
                'sidebar-item',
                isActive ? 'sidebar-item-active' : 'sidebar-item-inactive',
                collapsed && 'justify-center px-0'
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="ml-auto text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold" style={{ background: '#C9A840', color: '#0A0A0F' }}>
                      {item.badge}
                    </span>
                  ) : isActive ? (
                    <ChevronRight className="w-3.5 h-3.5 opacity-60 ml-auto" />
                  ) : null}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className={cn('border-t border-gray-800 p-3', collapsed && 'flex justify-center')}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#C9A84033', color: '#C9A840', border: '1px solid #C9A84055' }}>
              {user ? getInitials(user.name) : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-200 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{role ? ROLE_LABELS[role] : ''}</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-600 hover:text-gray-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  )
}
