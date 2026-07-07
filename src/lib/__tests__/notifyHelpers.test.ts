import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Firebase before importing the module under test ──────────────────────
vi.mock('../firebase', () => ({
  db: {},
  collection: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  query: vi.fn(),
  where: vi.fn(),
}))

import { getDocs, addDoc } from '../firebase'
import { checkFollowUpNotifications, checkProjectOverdueNotifications } from '../notifyHelpers'

const mockGetDocs = getDocs as ReturnType<typeof vi.fn>
const mockAddDoc = addDoc as ReturnType<typeof vi.fn>

function makeExistingSnap(relatedEntityIds: string[]) {
  return {
    docs: relatedEntityIds.map(id => ({
      data: () => ({
        relatedEntityId: id,
        createdAt: new Date(), // real Date so toDate() in utils recognises it
      }),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no existing notifications
  mockGetDocs.mockResolvedValue(makeExistingSnap([]))
})

// ─── checkFollowUpNotifications ───────────────────────────────────────────────

describe('checkFollowUpNotifications', () => {
  it('returns 0 and writes nothing when no leads are overdue', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24)
    const leads = [{ id: 'L1', name: 'Raj', nextFollowUp: future, status: 'new' }]
    const count = await checkFollowUpNotifications('user-1', leads)
    expect(count).toBe(0)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('returns 0 and writes nothing when lead is won/lost', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [
      { id: 'L1', name: 'Raj', nextFollowUp: past, status: 'won' },
      { id: 'L2', name: 'Priya', nextFollowUp: past, status: 'lost' },
    ]
    const count = await checkFollowUpNotifications('user-1', leads)
    expect(count).toBe(0)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('returns 0 and writes nothing when nextFollowUp is missing', async () => {
    const leads = [{ id: 'L1', name: 'Raj', status: 'new' }]
    const count = await checkFollowUpNotifications('user-1', leads)
    expect(count).toBe(0)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('creates a notification for each overdue lead', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [
      { id: 'L1', name: 'Raj', nextFollowUp: past, status: 'new' },
      { id: 'L2', name: 'Priya', nextFollowUp: past, status: 'contacted' },
    ]
    const count = await checkFollowUpNotifications('user-1', leads)
    expect(count).toBe(2)
    expect(mockAddDoc).toHaveBeenCalledTimes(2)
  })

  it('skips leads already notified today', async () => {
    mockGetDocs.mockResolvedValue(makeExistingSnap(['L1']))
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [{ id: 'L1', name: 'Raj', nextFollowUp: past, status: 'new' }]
    const count = await checkFollowUpNotifications('user-1', leads)
    expect(count).toBe(1)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('notifies for leads not yet notified, skips already notified ones', async () => {
    // createNotificationIfNew runs getDocs once per lead — L1 already exists, L2 does not
    mockGetDocs
      .mockResolvedValueOnce(makeExistingSnap(['L1'])) // check for L1 → skip
      .mockResolvedValueOnce(makeExistingSnap([]))     // check for L2 → create
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [
      { id: 'L1', name: 'Raj', nextFollowUp: past, status: 'new' },
      { id: 'L2', name: 'Priya', nextFollowUp: past, status: 'new' },
    ]
    await checkFollowUpNotifications('user-1', leads)
    expect(mockAddDoc).toHaveBeenCalledTimes(1)
    expect(mockAddDoc.mock.calls[0][1]).toMatchObject({ relatedEntityId: 'L2' })
  })

  it('notification body mentions the lead name', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [{ id: 'L1', name: 'Arjun Mehta', nextFollowUp: past, status: 'new' }]
    await checkFollowUpNotifications('user-1', leads)
    const payload = mockAddDoc.mock.calls[0][1]
    expect(payload.body).toContain('Arjun Mehta')
  })

  it('sets correct notification type and recipientId', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const leads = [{ id: 'L1', name: 'Raj', nextFollowUp: past, status: 'new' }]
    await checkFollowUpNotifications('user-42', leads)
    const payload = mockAddDoc.mock.calls[0][1]
    expect(payload.type).toBe('follow_up_due')
    expect(payload.recipientId).toBe('user-42')
  })
})

// ─── checkProjectOverdueNotifications ────────────────────────────────────────

describe('checkProjectOverdueNotifications', () => {
  it('returns 0 and writes nothing when no projects are overdue', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24)
    const projects = [{ id: 'P1', title: 'Villa A', expectedEndDate: future, status: 'in_progress' }]
    const count = await checkProjectOverdueNotifications('user-1', projects)
    expect(count).toBe(0)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('returns 0 for completed projects even if past deadline', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [{ id: 'P1', title: 'Villa A', expectedEndDate: past, status: 'completed' }]
    const count = await checkProjectOverdueNotifications('user-1', projects)
    expect(count).toBe(0)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('returns 0 for cancelled projects', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [{ id: 'P1', title: 'Villa A', expectedEndDate: past, status: 'cancelled' }]
    const count = await checkProjectOverdueNotifications('user-1', projects)
    expect(count).toBe(0)
  })

  it('returns 0 when expectedEndDate is missing', async () => {
    const projects = [{ id: 'P1', title: 'Villa A', status: 'in_progress' }]
    const count = await checkProjectOverdueNotifications('user-1', projects)
    expect(count).toBe(0)
  })

  it('creates a notification for each overdue in-progress project', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [
      { id: 'P1', title: 'Villa A', expectedEndDate: past, status: 'in_progress' },
      { id: 'P2', title: 'Apt B', expectedEndDate: past, status: 'planning' },
    ]
    const count = await checkProjectOverdueNotifications('user-1', projects)
    expect(count).toBe(2)
    expect(mockAddDoc).toHaveBeenCalledTimes(2)
  })

  it('skips projects already notified today', async () => {
    mockGetDocs.mockResolvedValue(makeExistingSnap(['P1']))
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [{ id: 'P1', title: 'Villa A', expectedEndDate: past, status: 'in_progress' }]
    await checkProjectOverdueNotifications('user-1', projects)
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('notification body mentions project title', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [{ id: 'P1', title: 'Sunset Villa', expectedEndDate: past, status: 'in_progress' }]
    await checkProjectOverdueNotifications('user-1', projects)
    const payload = mockAddDoc.mock.calls[0][1]
    expect(payload.body).toContain('Sunset Villa')
  })

  it('sets correct notification type', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const projects = [{ id: 'P1', title: 'Villa A', expectedEndDate: past, status: 'in_progress' }]
    await checkProjectOverdueNotifications('user-1', projects)
    expect(mockAddDoc.mock.calls[0][1].type).toBe('milestone_overdue')
  })
})
