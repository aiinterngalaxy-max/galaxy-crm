import { db, collection, getDocs, addDoc, serverTimestamp, query, where } from './firebase'
import type { NotificationType, AppNotification } from '../types'

type RelatedEntityType = AppNotification['relatedEntityType']

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
  relatedEntityType?: RelatedEntityType
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

/**
 * Fetch every user with role super_admin. Shared by all Content Studio
 * approval notifications below.
 */
export async function getSuperAdmins() {
  const usersSnap = await getDocs(collection(db, 'users'))
  return usersSnap.docs.filter(d => d.data().role === 'super_admin')
}

async function notifySuperAdmins(notif: {
  type: NotificationType
  title: string
  body: string
  relatedEntityType: 'content-studio-idea' | 'content-studio-script'
  relatedEntityId: string
}) {
  const superAdmins = await getSuperAdmins()
  await Promise.all(superAdmins.map(d =>
    addDoc(collection(db, 'notifications'), {
      recipientId: d.id,
      ...notif,
      isRead: false,
      createdAt: serverTimestamp(),
    })
  ))
}

/**
 * Notify all super_admin users that a new Content Studio idea was pitched
 * and needs their approval before it becomes a content piece.
 */
export async function notifySuperAdminsOfNewIdea({
  ideaId,
  title,
  brandName,
  creatorName,
}: {
  ideaId: number
  title: string
  brandName?: string
  creatorName?: string
}) {
  await notifySuperAdmins({
    type: 'content_studio_idea',
    title: 'New Content Idea Pitched',
    body: `${creatorName || 'Someone'} pitched "${title}"${brandName ? ` for ${brandName}` : ''} — needs your approval.`,
    relatedEntityType: 'content-studio-idea',
    relatedEntityId: String(ideaId),
  })
}

/**
 * Notify all super_admin users that a script was submitted for review and
 * needs their approval before the content piece can advance past Script Review.
 */
export async function notifySuperAdminsOfScriptSubmitted({
  scriptId,
  contentTitle,
  brandName,
}: {
  scriptId: number
  contentTitle: string
  brandName?: string
}) {
  await notifySuperAdmins({
    type: 'content_studio_script',
    title: 'Script Submitted for Review',
    body: `"${contentTitle}"${brandName ? ` (${brandName})` : ''} script was submitted — needs your review and approval.`,
    relatedEntityType: 'content-studio-script',
    relatedEntityId: String(scriptId),
  })
}

/**
 * Fetch everyone on the marketing/content team (role marketing or dept_head)
 * — cmo_ideas has no per-idea creator to notify individually, so an approval
 * broadcasts to whoever handles content production.
 */
async function getMarketingTeam() {
  const usersSnap = await getDocs(collection(db, 'users'))
  return usersSnap.docs.filter(d => ['marketing', 'dept_head'].includes(d.data().role))
}

async function notifyMarketingTeam(notif: {
  type: NotificationType
  title: string
  body: string
  relatedEntityType: RelatedEntityType
  relatedEntityId: string
}) {
  const team = await getMarketingTeam()
  await Promise.all(team.map(d =>
    addDoc(collection(db, 'notifications'), {
      recipientId: d.id,
      ...notif,
      isRead: false,
      createdAt: serverTimestamp(),
    })
  ))
}

/**
 * Notify the marketing team that a pitched idea was approved and is now
 * ready for scripting (the content piece lands at the Script Writing stage).
 */
export async function notifyTeamOfIdeaApproved({
  ideaId,
  title,
  brandName,
}: {
  ideaId: number
  title: string
  brandName?: string
}) {
  await notifyMarketingTeam({
    type: 'content_studio_idea_approved',
    title: 'Idea Approved — Ready for Scripting',
    body: `"${title}"${brandName ? ` (${brandName})` : ''} was approved and moved to Script Writing.`,
    relatedEntityType: 'content-studio-script',
    relatedEntityId: String(ideaId),
  })
}

/**
 * Notify the marketing team that a pitched idea was rejected, so whoever
 * pitched it knows not to expect it to move forward.
 */
export async function notifyTeamOfIdeaRejected({
  ideaId,
  title,
  brandName,
  reviewNote,
}: {
  ideaId: number
  title: string
  brandName?: string
  reviewNote?: string
}) {
  await notifyMarketingTeam({
    type: 'content_studio_idea_rejected',
    title: 'Idea Rejected',
    body: `"${title}"${brandName ? ` (${brandName})` : ''} was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
    relatedEntityType: 'content-studio-idea',
    relatedEntityId: String(ideaId),
  })
}

/**
 * Notify the marketing team that a script needs changes before it can be
 * approved — surfaces the reviewer's feedback so the writer can act on it.
 */
export async function notifyTeamOfScriptChangesRequired({
  scriptId,
  contentTitle,
  brandName,
}: {
  scriptId: number
  contentTitle: string
  brandName?: string
}) {
  await notifyMarketingTeam({
    type: 'content_studio_script_changes',
    title: 'Script Needs Changes',
    body: `"${contentTitle}"${brandName ? ` (${brandName})` : ''} script needs revisions before it can be approved.`,
    relatedEntityType: 'content-studio-script',
    relatedEntityId: String(scriptId),
  })
}

/**
 * Notify the marketing team that a content piece went live, closing the loop
 * on the pipeline.
 */
export async function notifyTeamOfContentPublished({
  contentId,
  title,
  brandName,
}: {
  contentId: number
  title: string
  brandName?: string
}) {
  await notifyMarketingTeam({
    type: 'content_studio_content_published',
    title: 'Content Published',
    body: `"${title}"${brandName ? ` (${brandName})` : ''} is now live.`,
    relatedEntityType: 'content-studio-content',
    relatedEntityId: String(contentId),
  })
}
