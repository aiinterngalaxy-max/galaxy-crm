import { db, doc, getDoc, updateDoc, serverTimestamp, increment } from './firebase'
import { calculateLeadScore } from './utils'
import type { Lead } from '../types'

/**
 * Recalculates a lead's aiScore from its current stored fields and writes it back.
 *
 * The score used to be frozen at creation, so adding a budget or completing a demo
 * never moved it. Every path that changes a scoring input should call this.
 *
 * `patch` lets a caller fold in values written in the same breath as this call,
 * which would otherwise not be visible in the document read below.
 */
export async function recalcLeadScore(leadId: string, patch: Partial<Lead> = {}): Promise<number | null> {
  const snap = await getDoc(doc(db, 'leads', leadId))
  if (!snap.exists()) return null

  const lead = { ...(snap.data() as Lead), ...patch }
  const aiScore = calculateLeadScore({
    source: lead.source,
    estimatedBudget: lead.estimatedBudget,
    floorPlanUrl: lead.floorPlanUrl,
    demoGiven: lead.demoGiven,
    quoteCount: lead.quoteDocuments?.length ?? 0,
    callCount: lead.callCount ?? 0,
  })

  if (aiScore !== lead.aiScore) {
    await updateDoc(doc(db, 'leads', leadId), {
      aiScore,
      aiScoreNote: 'Auto-scored from source, budget, demo, quotes and calls.',
      updatedAt: serverTimestamp(),
    })
  }
  return aiScore
}

/**
 * Bumps the denormalised call counter, then rescores. Call this after logging a
 * 'call' activity — only calls count as a "connect" for scoring.
 */
export async function registerLeadCall(leadId: string): Promise<void> {
  await updateDoc(doc(db, 'leads', leadId), {
    callCount: increment(1),
    updatedAt: serverTimestamp(),
  })
  await recalcLeadScore(leadId)
}
