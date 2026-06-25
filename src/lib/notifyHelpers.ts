import { db, collection, getDocs, addDoc, serverTimestamp, query, where } from './firebase'
import type { NotificationType } from '../types'

/**
 * Creates a notification for a user only if one of the same type+entity
 * hasn't already been created today. Returns true if a new one was created.
 */
export async function createNotificationIfNew({
  recipientId,
  type,
  title,
  body,
  relatedEntityType,
  relatedEntityId,
}: {
  recipientId: string
  type: NotificationType
  title: string
  body: string
  relatedEntityType?: 'lead' | 'project' | 'invoice' | 'quotation' | 'customer'
  relatedEntityId?: string
}): Promise<boolean> {
  // Check if we already sent this notification for this entity today
  if (relatedEntityId) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const existing = await getDocs(
      query(
        collection(db, 'notifications'),
        where('recipientId', '==', recipientId),
        where('relatedEntityId', '==', relatedEntityId),
        where('type', '==', type),
      )
    )
    // Client-side filter for today (avoids needing a composite index on createdAt)
    const alreadySentToday = existing.docs.some(d => {
      const ts = d.data().createdAt
      const date = ts?.toDate ? ts.toDate() : new Date(ts)
      return date >= todayStart
    })
    if (alreadySentToday) return false
  }

  await addDoc(collection(db, 'notifications'), {
    recipientId,
    type,
    title,
    body,
    relatedEntityType: relatedEntityType ?? null,
    relatedEntityId: relatedEntityId ?? null,
    isRead: false,
    createdAt: serverTimestamp(),
  })
  return true
}

/**
 * Check and fire follow-up due notifications for BD exec.
 * Call on dashboard load.
 */
export async function checkFollowUpNotifications(userId: string, leads: Array<{ id: string; name: string; nextFollowUp?: any; status: string }>) {
  const now = new Date()
  const overdue = leads.filter(l => {
    if (!l.nextFollowUp || ['won', 'lost'].includes(l.status)) return false
    const d = l.nextFollowUp?.toDate ? l.nextFollowUp.toDate() : new Date(l.nextFollowUp)
    return d <= now
  })

  await Promise.all(overdue.map(lead =>
    createNotificationIfNew({
      recipientId: userId,
      type: 'follow_up_due',
      title: 'Follow-up Due',
      body: `Your follow-up with ${lead.name} is due. Don't let this lead go cold.`,
      relatedEntityType: 'lead',
      relatedEntityId: lead.id,
    })
  ))

  return overdue.length
}

/**
 * Check and fire overdue project notifications for PM.
 * Call on dashboard load.
 */
export async function checkProjectOverdueNotifications(userId: string, projects: Array<{ id: string; title: string; expectedEndDate?: any; status: string }>) {
  const now = new Date()
  const overdue = projects.filter(p => {
    if (!p.expectedEndDate || p.status === 'completed' || p.status === 'cancelled') return false
    const d = p.expectedEndDate?.toDate ? p.expectedEndDate.toDate() : new Date(p.expectedEndDate)
    return d < now
  })

  await Promise.all(overdue.map(project =>
    createNotificationIfNew({
      recipientId: userId,
      type: 'milestone_overdue',
      title: 'Project Overdue',
      body: `"${project.title}" has passed its deadline and is still in progress.`,
      relatedEntityType: 'project',
      relatedEntityId: project.id,
    })
  ))

  return overdue.length
}
