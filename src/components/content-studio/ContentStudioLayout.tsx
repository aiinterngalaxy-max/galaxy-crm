import { useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { CmoSidebar } from './CmoSidebar'
import { GlobalSearch } from './GlobalSearch'
import { NotificationBell, type NotifSection } from './NotificationBell'
import { ViewerContext } from '@/lib/content-studio/viewer-context'
import { getTeam } from '@/lib/content-studio/queries'
import { useAuth } from '@/contexts/AuthContext'
import type { TeamMember } from '@/types/content-studio'

const COLLAPSE_KEY = 'cs-sidebar-collapsed'
// Roles allowed to approve/reject Content Studio ideas — mirrors the CRM's
// existing approval gates elsewhere (quotations, etc).
const IDEA_APPROVER_ROLES = new Set(['super_admin', 'management'])

export function ContentStudioLayout() {
  const { user, role } = useAuth()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [sections] = useState<NotifSection[]>([])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

useEffect(() => {
    getTeam().then(setTeam).catch(console.error)
  }, [])

  // The "viewer" is the logged-in CRM user, mapped onto the Content Studio
  // team-member shape used for activity attribution and the idea approval
  // gate. is_owner reflects the CRM's own super_admin/management roles
  // rather than the legacy cmo_team.is_owner flag, since that flag has no
  // connection to Firebase auth roles.
  const viewer = useMemo<TeamMember | null>(() => {
    if (!user) return null
    const matched = team.find((t) => t.name.toLowerCase() === user.name.toLowerCase())
    return {
      id: matched?.id ?? 0,
      name: user.name,
      role: matched?.role ?? '',
      capacity: matched?.capacity ?? 0,
      is_owner: role && IDEA_APPROVER_ROLES.has(role) ? 1 : 0,
    }
  }, [user, role, team])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <ViewerContext.Provider value={{ viewer, setViewer: () => {}, team }}>
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
