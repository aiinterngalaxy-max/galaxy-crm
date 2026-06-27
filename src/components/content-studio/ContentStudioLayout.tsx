import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { CmoSidebar } from './CmoSidebar'
import { GlobalSearch } from './GlobalSearch'
import { NotificationBell, type NotifSection } from './NotificationBell'
import { ViewerContext } from '@/lib/content-studio/viewer-context'
import type { TeamMember } from '@/types/content-studio'

const COLLAPSE_KEY = 'cs-sidebar-collapsed'

export function ContentStudioLayout() {
  const [viewer, setViewer] = useState<TeamMember | null>(null)
  const [team] = useState<TeamMember[]>([])
  const [sections] = useState<NotifSection[]>([])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <ViewerContext.Provider value={{ viewer, setViewer, team }}>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        <CmoSidebar collapsed={collapsed} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/90 backdrop-blur px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleCollapsed}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
              </button>
              <GlobalSearch />
            </div>
            <NotificationBell sections={sections} />
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="p-5 md:p-6 max-w-screen-2xl mx-auto animate-fade-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ViewerContext.Provider>
  )
}
