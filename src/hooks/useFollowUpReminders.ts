import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { toDate } from '../lib/utils'
import type { Lead } from '../types'

export function useFollowUpReminders() {
  const { user } = useAuth()
  const ran = useRef(false)

  useEffect(() => {
    if (!user || ran.current) return
    ran.current = true
    const currentUser = user

    async function checkFollowUps() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'leads'),
            where('status', 'not-in', ['won', 'lost'])
          )
        )

        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        const overdue = snap.docs
          .map(d => ({ id: d.id, ...d.data() }) as Lead & { id: string })
          .filter(l => {
            if (!l.nextFollowUp) return false
            const fu = toDate(l.nextFollowUp)
            return fu !== null && fu <= now
          })

        if (overdue.length === 0) return

        const existingSnap = await getDocs(
          query(
            collection(db, 'notifications'),
            where('recipientId', '==', currentUser.id),
            where('type', '==', 'follow_up_due'),
            where('createdAt', '>=', today)
          )
        )
        const alreadyNotified = new Set(existingSnap.docs.map(d => d.data().relatedEntityId as string))

        const toNotify = overdue.filter(l => !alreadyNotified.has(l.id))

        for (const lead of toNotify) {
          const fu = toDate(lead.nextFollowUp)!
          const daysOverdue = Math.floor((now.getTime() - fu.getTime()) / (1000 * 60 * 60 * 24))
          const body = daysOverdue > 0
            ? `Follow-up with ${lead.name} was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`
            : `Follow-up with ${lead.name} is due today`

          await addDoc(collection(db, 'notifications'), {
            recipientId: currentUser.id,
            type: 'follow_up_due',
            title: 'Follow-up Due',
            body,
            relatedEntityType: 'lead',
            relatedEntityId: lead.id,
            isRead: false,
            createdAt: serverTimestamp(),
          })
        }
      } catch (err) {
        console.warn('[useFollowUpReminders] Failed to check follow-ups:', err)
      }
    }

    checkFollowUps()
  }, [user])
}
