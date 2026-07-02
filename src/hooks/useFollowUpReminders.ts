import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'

export function useFollowUpReminders() {
  const { user } = useAuth()
  const ran = useRef(false)

  useEffect(() => {
    if (!user || ran.current) return
    ran.current = true

    async function checkFollowUps() {
      try {
        // Get leads with nextFollowUp set and not closed
        const snap = await getDocs(
          query(
            collection(db, 'leads'),
            where('status', 'not-in', ['won', 'lost'])
          )
        )

        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        const overdue = snap.docs
          .map(d => ({ id: d.id, ...d.data() }) as any)
          .filter(l => {
            if (!l.nextFollowUp) return false
            const fu: Date = l.nextFollowUp?.toDate ? l.nextFollowUp.toDate() : new Date(l.nextFollowUp)
            return fu <= now
          })

        if (overdue.length === 0) return

        // For each overdue lead, check if we already created a notification today
        const existingSnap = await getDocs(
          query(
            collection(db, 'notifications'),
            where('recipientId', '==', user!.id),
            where('type', '==', 'follow_up_due'),
            where('createdAt', '>=', today)
          )
        )
        const alreadyNotified = new Set(existingSnap.docs.map(d => d.data().relatedEntityId))

        const toNotify = overdue.filter((l: any) => !alreadyNotified.has(l.id))

        for (const lead of toNotify) {
          const fu: Date = lead.nextFollowUp?.toDate ? lead.nextFollowUp.toDate() : new Date(lead.nextFollowUp)
          const daysOverdue = Math.floor((now.getTime() - fu.getTime()) / (1000 * 60 * 60 * 24))
          const body = daysOverdue > 0
            ? `Follow-up with ${lead.name} was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`
            : `Follow-up with ${lead.name} is due today`

          await addDoc(collection(db, 'notifications'), {
            recipientId: user!.id,
            type: 'follow_up_due',
            title: 'Follow-up Due',
            body,
            relatedEntityType: 'lead',
            relatedEntityId: lead.id,
            isRead: false,
            createdAt: serverTimestamp(),
          })
        }
      } catch {
        // silently fail — reminders are non-critical
      }
    }

    checkFollowUps()
  }, [user])
}
