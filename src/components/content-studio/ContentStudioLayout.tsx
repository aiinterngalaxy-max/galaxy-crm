import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { CmoSidebar } from './CmoSidebar'
import { GlobalSearch } from './GlobalSearch'
import { NotificationBell, type NotifSection, type NotifItem } from './NotificationBell'
import { ViewerContext } from '@/lib/content-studio/viewer-context'
import { getTeam, getAllContent, getIdeas, getScripts } from '@/lib/content-studio/queries'
import { useAuth } from '@/contexts/AuthContext'
import type { TeamMember } from '@/types/content-studio'

const COLLAPSE_KEY = 'cs-sidebar-collapsed'
// Roles allowed to approve/reject Content Studio ideas — mirrors the CRM's
// existing approval gates elsewhere (quotations, etc).
const IDEA_APPROVER_ROLES = new Set(['super_admin', 'management'])
const SECTIONS_REFRESH_MS = 60_000

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * This bell was wired up with an empty, never-updated `sections` array from
 * the start — `const [sections] = useState([])`, no setter ever called
 * anywhere. It has shown "Nothing needs attention" regardless of what was
 * actually happening in the pipeline. This is the real computation: not-yet-
 * published content past or at its due date, scripts sitting Submitted
 * awaiting approval, and ideas pitched awaiting approval — the three things
 * elsewhere in Content Studio already treat as "needs a human to act."
 */
async function computeSections(): Promise<NotifSection[]> {
  const [content, ideas, scripts] = await Promise.all([getAllContent(), getIdeas(), getScripts()])
  const today = todayStr()

  const overdue: NotifItem[] = []
  const dueToday: NotifItem[] = []
  for (const c of content) {
    if (c.stage === 'Published') continue
    const dateStr = c.publish_date || c.due_date
    if (!dateStr || dateStr > today) continue
    const item: NotifItem = {
      id: `content-${c.id}`,
      tone: dateStr < today ? 'bad' : 'warn',
      icon: dateStr < today ? '⏰' : '📅',
      text: c.title,
      meta: `${c.brand_name} · ${dateStr < today ? `was due ${dateStr}` : 'due today'}`,
      href: `/content-studio/pipeline?edit=${c.id}`,
    }
    ;(dateStr < today ? overdue : dueToday).push(item)
  }

  const scriptsAwaiting: NotifItem[] = scripts
    .filter((s) => s.status === 'Submitted')
    .map((s) => ({
      id: `script-${s.id}`,
      tone: 'warn',
      icon: '📝',
      text: s.title,
      meta: `${s.brand_name} · script submitted, needs approval`,
      href: '/content-studio/scripts',
    }))

  const ideasAwaiting: NotifItem[] = ideas
    .filter((i) => i.pitched && !i.approved && !i.rejected)
    .map((i) => ({
      id: `idea-${i.id}`,
      tone: 'warn',
      icon: '💡',
      text: i.title,
      meta: 'pitched, needs approval',
      href: '/content-studio/ideas',
    }))

  return [
    { title: 'Overdue — not published', items: overdue },
    { title: 'Due today — not published', items: dueToday },
    { title: 'Scripts awaiting approval', items: scriptsAwaiting },
    { title: 'Ideas awaiting approval', items: ideasAwaiting },
  ]
}

export function ContentStudioLayout() {
  const { user, role } = useAuth()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [sections, setSections] = useState<NotifSection[]>([])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  useEffect(() => {
    getTeam().then(setTeam).catch(console.error)
  }, [])

  const refreshSections = useCallback(() => {
    computeSections().then(setSections).catch(console.error)
  }, [])

  // This layout persists across every Content Studio page, so a fetch on
  // mount alone would go stale the moment someone approves a script or an
  // idea elsewhere without ever navigating back through here. Polling is
  // the right tool since Turso has no realtime subscription the way
  // Firestore does — same tradeoff already made for the due-date reminders.
  useEffect(() => {
    refreshSections()
    const t = setInterval(refreshSections, SECTIONS_REFRESH_MS)
    return () => clearInterval(t)
  }, [refreshSections])

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
