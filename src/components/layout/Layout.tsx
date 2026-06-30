import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { Toaster } from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useFollowUpNotifier } from '../../hooks/useFollowUpNotifier'

export function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, role } = useAuth()

  const isBD = ['super_admin', 'management', 'bd_exec', 'dept_head'].includes(role ?? '')
  useFollowUpNotifier(user?.id, isBD)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar — desktop only */}
      <div className="hidden md:block shrink-0">
        <Sidebar collapsed={collapsed} />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <Sidebar onNavClick={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          collapsed={collapsed}
          onToggle={() => {
            if (window.innerWidth < 768) setMobileOpen(o => !o)
            else setCollapsed(c => !c)
          }}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="p-5 md:p-6 max-w-screen-2xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1f2937',
            color: '#f9fafb',
            border: '1px solid #374151',
            borderRadius: '10px',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#1f2937' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#1f2937' } },
        }}
      />
    </div>
  )
}
