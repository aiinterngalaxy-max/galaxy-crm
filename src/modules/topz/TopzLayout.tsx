import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { FileText, LayoutDashboard, ArrowLeft, CalendarCheck, ScrollText, Users, BarChart2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export function TopzLayout() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const sidebarBg = '#13131f'
  const sidebarBorder = 'rgba(255,255,255,0.07)'
  const appBg = '#0d0d1a'

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
        <div className="px-4 py-4 border-b border-gray-800 flex flex-col items-center gap-2">
          <img src="/topz-logo.png" alt="Topz Cab" className="w-24 h-24 object-contain" />
          <p className="text-xs text-gray-500">Travel Management</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          <NavItem to="/topz" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" end />
          <NavItem to="/topz/quotations" icon={<FileText className="w-4 h-4" />} label="Quotations" />
          <NavItem to="/topz/bookings" icon={<CalendarCheck className="w-4 h-4" />} label="Bookings" />
          <NavItem to="/topz/suppliers" icon={<Users className="w-4 h-4" />} label="Suppliers" />
          <NavItem to="/topz/rate-chart" icon={<BarChart2 className="w-4 h-4" />} label="Rate Chart" />
          <NavItem to="/topz/terms" icon={<ScrollText className="w-4 h-4" />} label="Terms & Conditions" />
        </nav>

        {/* Switch back */}
        <div className="p-3 border-t border-gray-800">
          {role === 'super_admin' && (
            <button
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Galaxy CRM
            </button>
          )}
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
