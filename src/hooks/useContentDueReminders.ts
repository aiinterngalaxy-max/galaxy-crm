import { useEffect, useRef } from 'react'
import { getAllContent } from '../lib/content-studio/queries'
import { createNotificationIfNew } from '../lib/notifyHelpers'

const CHECK_INTERVAL_MS = 60_000

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The Calendar plots each piece by publish_date, falling back to due_date —
 * see CalendarBoard.tsx. Neither field stores a TIME, only a date, so a
 * clock-precise "one hour before" doesn't actually mean anything — the
 * first version of this hook assumed the cutoff was end-of-day (23:59) and
 * only fired inside the hour before that, which meant checking at, say,
 * 11am on the due date found nothing due for another 13 hours and stayed
 * silent all day. Comparing DATES rather than exact times fixes that
 * category of bug outright: due today fires as soon as today starts, no
 * clock-time assumption to get wrong.
 *
 * Polls every minute rather than checking once on load, since a piece's due
 * date can roll over to "today" at any point while the app is open on an
 * unrelated page — this hook is mounted globally in Layout, not on the
 * Calendar page itself, so it fires no matter where you are.
 * createNotificationIfNew's own "already sent today" check is what stops the
 * 60-second poll from writing the same reminder 60 times over.
 *
 * Also flags anything already overdue (due date before today), re-flagging
 * once a day until it's actually published or its date changes — otherwise
 * a piece that's overdue when nobody has the app open would go silent
 * forever, since there's no later moment where it "becomes" due again.
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
      const today = todayStr()
      for (const item of itemsRef.current) {
        const dateStr = item.publish_date || item.due_date
        if (!dateStr) continue
        if (dateStr > today) continue // still in the future — nothing to say yet
        const overdue = dateStr < today

        await createNotificationIfNew({
          recipientId: userId!,
          type: 'content_studio_publish_due',
          title: overdue ? 'Video Overdue' : 'Video Due Today',
          body: overdue
            ? `"${item.title}"${item.brand_name ? ` (${item.brand_name})` : ''} was due ${dateStr} and still isn't published.`
            : `"${item.title}"${item.brand_name ? ` (${item.brand_name})` : ''} is due today.`,
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
