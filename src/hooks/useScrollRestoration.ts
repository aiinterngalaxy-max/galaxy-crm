import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Remembers how far down a scroll container was for each history entry and puts
 * it back when the user navigates *back* to that entry.
 *
 * The app scrolls an inner `<main>`, not the window, so the browser's own scroll
 * restoration never kicks in: when a route swaps its content out the container
 * shrinks, the browser clamps scrollTop to 0, and coming back from a detail page
 * dumps you at the top of the list. This restores it.
 *
 * Keyed by `location.key` (unique per history entry), so a *forward* navigation
 * to the same path — clicking "Customers" in the sidebar — still starts at the
 * top, while browser-back / `navigate(-1)` returns you where you were.
 */

// Module-level so positions survive the unmount/remount of every routed page.
const positions = new Map<string, number>()
const MAX_ENTRIES = 50

// How long to keep re-applying the position while the page's data loads in.
const RESTORE_TIMEOUT_MS = 3000
const RESTORE_POLL_MS = 50

function remember(key: string, top: number) {
  if (!positions.has(key) && positions.size >= MAX_ENTRIES) {
    // Map iterates in insertion order — drop the oldest entry.
    const oldest = positions.keys().next().value
    if (oldest !== undefined) positions.delete(oldest)
  }
  positions.set(key, top)
}

export function useScrollRestoration(ref: React.RefObject<HTMLElement>) {
  const { key } = useLocation()
  const navigationType = useNavigationType()

  // Track the current entry's position. Layout effects (not passive ones) so the
  // listener is rebound to the new key before the browser can fire the scroll
  // event that clamping-on-shrink produces — otherwise that 0 would overwrite
  // the position we just navigated away from.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => remember(key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref, key])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const target = navigationType === 'POP' ? positions.get(key) ?? 0 : 0
    if (target <= 0) {
      el.scrollTop = 0
      return
    }

    // The page we're returning to renders its rows only once Firestore answers,
    // so the container is still short right now. Keep re-applying the position
    // until the content is tall enough to hold it (or the user takes over).
    // Timer-driven rather than rAF-driven: rAF is frozen while the tab is in the
    // background, which would strand a restore that started just before a switch.
    let timer = 0
    let done = false
    const deadline = Date.now() + RESTORE_TIMEOUT_MS

    const stop = () => {
      done = true
      if (timer) clearTimeout(timer)
      timer = 0
    }

    const attempt = () => {
      timer = 0
      if (done) return
      const max = el.scrollHeight - el.clientHeight
      el.scrollTop = Math.min(target, max)
      if (max >= target || Date.now() > deadline) {
        stop()
        return
      }
      timer = window.setTimeout(attempt, RESTORE_POLL_MS)
    }

    // Any manual scroll input means the user has taken over — stop fighting them.
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchmove', stop, { passive: true })
    el.addEventListener('keydown', stop)

    attempt()

    return () => {
      stop()
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchmove', stop)
      el.removeEventListener('keydown', stop)
    }
  }, [ref, key, navigationType])
}
