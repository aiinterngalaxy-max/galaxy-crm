import { useEffect, useRef } from 'react'
import { db, collection, query, where, getDocs } from '../lib/firebase'
import type { Lead } from '../types'

const FIRED_KEY = 'galaxy_crm_fired_followups'
const CHECK_INTERVAL_MS = 60_000

function getFired(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FIRED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function markFired(leadId: string) {
  try {
    const s = getFired()
    s.add(leadId)
    sessionStorage.setItem(FIRED_KEY, JSON.stringify([...s]))
  } catch { /* ignore */ }
}

export function useFollowUpNotifier(userId: string | undefined, enabled: boolean) {
  const permissionRef = useRef<NotificationPermission>('default')
  // Cache leads so we only fetch once per session, not every minute
  const leadsRef = useRef<Lead[]>([])
  const loadedRef = useRef(false)

  // Request browser notification permission once
  useEffect(() => {
    if (!enabled || !userId) return
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      permissionRef.current = 'granted'
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        permissionRef.current = p
      })
    } else {
      permissionRef.current = Notification.permission
    }
  }, [enabled, userId])

  useEffect(() => {
    if (!enabled || !userId) return

    // Reset cache on each userId change so User B doesn't see User A's leads
    loadedRef.current = false
    leadsRef.current = []

    // Load leads with nextFollowUp for this user (single query, no compound index needed)
    async function loadLeads() {
      if (loadedRef.current) return
      try {
        const snap = await getDocs(
          query(collection(db, 'leads'), where('assignedTo', '==', userId))
        )
        leadsRef.current = snap.docs
          .map(d => ({ id: d.id, ...d.data() }) as Lead)
          .filter(l => l.nextFollowUp && !['won', 'lost'].includes(l.status))
        loadedRef.current = true
      } catch { /* silent */ }
    }

    function check() {
      if (permissionRef.current !== 'granted') return
      const now = Date.now()
      const fired = getFired()

      leadsRef.current.forEach(lead => {
        if (fired.has(lead.id)) return
        const ts = lead.nextFollowUp as any
        const dueMs: number = ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime()
        // Fire if due time is within the last 5 minutes (i.e. just became due)
        if (dueMs <= now && dueMs >= now - 5 * 60_000) {
          new Notification('Galaxy CRM — Follow-up Due', {
            body: `Time to follow up with ${lead.name}`,
            icon: '/galaxy-logo.png',
            tag: `followup-${lead.id}`,
          })
          markFired(lead.id)
        }
      })
    }

    loadLeads().then(() => check())
    const t = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(t)
  }, [enabled, userId])
}
