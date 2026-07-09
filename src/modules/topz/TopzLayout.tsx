import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { FileText, LayoutDashboard, ArrowLeft, Settings, CalendarCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getTopzTheme } from './TopzSettings'

export function TopzLayout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useState(getTopzTheme())
  useEffect(() => {
    const handler = () => setTheme(getTopzTheme())
    window.addEventListener('topz-theme-change', handler)
    return () => window.removeEventListener('topz-theme-change', handler)
  }, [])
  const isLight = theme === 'light'
  const sidebarBg = isLight ? 'rgba(255,255,255,0.95)' : 'var(--sidebar-bg)'
  const sidebarBorder = isLight ? 'rgba(0,0,0,0.08)' : 'var(--sidebar-border)'
  const appBg = isLight ? '#f0f0f5' : 'var(--app-bg)'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: appBg }}>
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col h-screen" style={{
        background: sidebarBg,
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        borderRight: `1px solid ${sidebarBorder}`,
      }}>
        {/* Brand */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0" style={{ background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.3)' }}>
              TC
            </div>
            <div>
              <p className="font-bold text-sm leading-none" style={{ color: '#f0c040' }}>Topz Cab</p>
              <p className="text-xs text-gray-500 mt-0.5">Travel Management</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          <NavItem to="/topz" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" end />
          <NavItem to="/topz/quotations" icon={<FileText className="w-4 h-4" />} label="Quotations" />
          <NavItem to="/topz/bookings" icon={<CalendarCheck className="w-4 h-4" />} label="Bookings" />
          <NavItem to="/topz/settings" icon={<Settings className="w-4 h-4" />} label="Settings" />
        </nav>

        {/* Switch back */}
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Galaxy CRM
          </button>
          <p className="text-xs text-gray-600 mt-2 px-1 truncate">{user?.name}</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function NavItem({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'font-semibold'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
        }`
      }
      style={({ isActive }) => isActive ? { background: 'rgba(240,192,64,0.12)', color: '#f0c040' } : {}}
    >
      {icon}
      {label}
    </NavLink>
  )
}
