import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CmoSidebar } from './CmoSidebar'
import { GlobalSearch } from './GlobalSearch'
import { NotificationBell, type NotifSection } from './NotificationBell'
import { ViewerContext } from '@/lib/content-studio/viewer-context'
import type { TeamMember } from '@/types/content-studio'

export function ContentStudioLayout() {
  const [viewer, setViewer] = useState<TeamMember | null>(null)
  const [team] = useState<TeamMember[]>([])
  const [sections] = useState<NotifSection[]>([])

  return (
    <ViewerContext.Provider value={{ viewer, setViewer, team }}>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        <CmoSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/90 backdrop-blur px-4 sm:px-6 lg:px-8">
            <GlobalSearch />
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
