import { useEffect, useRef } from 'react'
import { getAllContent } from '../lib/content-studio/queries'
import { createNotificationIfNew } from '../lib/notifyHelpers'

const CHECK_INTERVAL_MS = 60_000
const WINDOW_MS = 60 * 60 * 1000 // one hour

/**
 * The Calendar plots each piece by publish_date, falling back to due_date —
 * see CalendarBoard.tsx. Neither field stores a time, only a date, so "one
 * hour before" needs an assumed cutoff; end of that day (23:59) is the one
 * that matches what "due" means on a day-only field. If a real due TIME gets
 * added to content later, swap that in here instead of the assumption.
 *
 * Polls every minute rather than checking once on load, since the exact
 * moment a piece enters its last hour can happen at any time while the app
 * is open on an unrelated page — this hook is mounted globally in Layout,
 * not on the Calendar page itself, so it fires no matter where you are.
 * createNotificationIfNew's own "already sent today" check is what stops the
 * 60-second poll from writing the same reminder 60 times inside that hour.
 */
export function useContentDueReminders(userId: string | undefined, enabled: boolean) {
  const itemsRef = useRef<{ id: number; title: string; brand_name: string; publish_date: string | null; due_date: string | null }[]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled || !userId) return
    loadedRef.current = false
    itemsRef.current = []

    async function load() {
      try {
        const rows = await getAllContent()
        itemsRef.current = rows
          .filter((r) => r.stage !== 'Published' && (r.publish_date || r.due_date))
          .map((r) => ({ id: r.id, title: r.title, brand_name: r.brand_name, publish_date: r.publish_date, due_date: r.due_date }))
        loadedRef.current = true
      } catch {
        // Silent — this is a background convenience, not a page the user is waiting on.
      }
    }

    async function check() {
      if (!loadedRef.current) return
      const now = Date.now()
      for (const item of itemsRef.current) {
        const dateStr = item.publish_date || item.due_date
        if (!dateStr) continue
        const dueMs = new Date(`${dateStr}T23:59:59`).getTime()
        const msLeft = dueMs - now
        if (msLeft <= 0 || msLeft > WINDOW_MS) continue

        await createNotificationIfNew({
          recipientId: userId!,
          type: 'content_studio_publish_due',
          title: 'Video Due Soon',
          body: `"${item.title}"${item.brand_name ? ` (${item.brand_name})` : ''} is due today — under an hour left.`,
          relatedEntityType: 'content-studio-content',
          relatedEntityId: String(item.id),
        }).catch(() => {})
      }
    }

    load().then(check)
    const t = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(t)
  }, [enabled, userId])
}
