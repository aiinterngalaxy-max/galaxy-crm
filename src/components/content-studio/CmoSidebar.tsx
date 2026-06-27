import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Workflow, Lightbulb, FileText, Scissors,
  Calendar, Video, TrendingUp, BarChart3, FileBarChart, Link2, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  icon: React.ReactNode
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" />, path: '/content-studio' },
  { label: 'Brands', icon: <Building2 className="w-4 h-4" />, path: '/content-studio/brands' },
  { label: 'Pipeline', icon: <Workflow className="w-4 h-4" />, path: '/content-studio/pipeline' },
  { label: 'Ideas', icon: <Lightbulb className="w-4 h-4" />, path: '/content-studio/ideas' },
  { label: 'Scripts', icon: <FileText className="w-4 h-4" />, path: '/content-studio/scripts' },
  { label: 'Editing', icon: <Scissors className="w-4 h-4" />, path: '/content-studio/editing' },
  { label: 'Calendar', icon: <Calendar className="w-4 h-4" />, path: '/content-studio/calendar' },
  { label: 'Shoots', icon: <Video className="w-4 h-4" />, path: '/content-studio/shoots' },
  { label: 'Performance', icon: <TrendingUp className="w-4 h-4" />, path: '/content-studio/performance' },
  { label: 'Insights', icon: <BarChart3 className="w-4 h-4" />, path: '/content-studio/insights' },
  { label: 'Reports', icon: <FileBarChart className="w-4 h-4" />, path: '/content-studio/reports' },
  { label: 'Connections', icon: <Link2 className="w-4 h-4" />, path: '/content-studio/connections' },
  { label: 'Activity', icon: <Activity className="w-4 h-4" />, path: '/content-studio/activity' },
]

interface CmoSidebarProps {
  collapsed?: boolean
}

export function CmoSidebar({ collapsed = false }: CmoSidebarProps) {
  const location = useLocation()

  return (
    <aside
      className={cn(
        'h-screen flex flex-col shrink-0 transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{
        background: 'rgba(10,10,15,0.7)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className={cn('flex items-center gap-3 px-4 py-4 border-b border-gray-800', collapsed && 'justify-center px-0')}>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500 text-gray-950 font-extrabold shrink-0">
          G
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold leading-none" style={{ color: '#C9A840' }}>Content Studio</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">Marketing Command Center</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.path === '/content-studio'
              ? location.pathname === '/content-studio'
              : location.pathname === item.path

          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={cn(
                'sidebar-item',
                isActive ? 'sidebar-item-active' : 'sidebar-item-inactive',
                collapsed && 'justify-center px-0'
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
