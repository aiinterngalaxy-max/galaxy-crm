import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock the Turso client before importing the module under test ─────────────
vi.mock('../content-studio/db', () => ({
  all: vi.fn().mockResolvedValue([]),
  one: vi.fn(),
  run: vi.fn(),
  batch: vi.fn(),
  resetClient: vi.fn(),
}))

vi.mock('../content-studio/integrations', () => ({
  connectionStatus: vi.fn(() => []),
  syncAll: vi.fn(),
  lastSync: vi.fn().mockResolvedValue([]),
}))

import { one, run } from '../content-studio/db'
import { updateIdea, updateScript, updateShoot, updateContent } from '../content-studio/queries'

const mockOne = one as ReturnType<typeof vi.fn>
const mockRun = run as ReturnType<typeof vi.fn>

/**
 * The queries layer talks to SQLite through one()/run(). Rather than emulate a
 * database, route each SELECT by the fragment that identifies it and let the
 * test declare the world it wants. Assertions then read the UPDATE statements
 * that came back out.
 */
interface World {
  contentStage?: string
  ideaContentId?: number | null
  scriptContentId?: number
  scriptExists?: boolean
  shootExists?: boolean
  shootContentId?: number | null
}

function stubDb(world: World) {
  mockRun.mockResolvedValue({ lastInsertRowid: 99 })
  mockOne.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT stage FROM cmo_content')) {
      return world.contentStage ? { stage: world.contentStage } : null
    }
    if (sql.includes('SELECT approved FROM cmo_content')) return { approved: 1 }
    if (sql.includes('SELECT publish_date FROM cmo_content')) return { publish_date: null }
    if (sql.includes('SELECT writer, due_date, title FROM cmo_content')) {
      return { writer: '', due_date: null, title: 'Reel' }
    }
    if (sql.includes('SELECT brand_id, title FROM cmo_content')) return { brand_id: 1, title: 'Reel' }
    if (sql.includes('SELECT title FROM cmo_content')) return { title: 'Reel' }
    if (sql.includes('FROM cmo_content ct')) return { id: 7, title: 'Reel', stage: world.contentStage }

    if (sql.includes('SELECT id FROM cmo_scripts WHERE content_id')) {
      return world.scriptExists ? { id: 5 } : null
    }
    if (sql.includes('SELECT content_id FROM cmo_scripts WHERE id')) {
      return { content_id: world.scriptContentId ?? 7 }
    }
    if (sql.includes('FROM cmo_scripts WHERE content_id')) return { status: 'Approved' }
    if (sql.includes('FROM cmo_scripts WHERE id')) return { id: 5, content_id: world.scriptContentId ?? 7 }

    if (sql.includes('SELECT id FROM cmo_shoots WHERE content_id')) {
      return world.shootExists ? { id: 3 } : null
    }
    if (sql.includes('FROM cmo_shoots WHERE id')) {
      return { id: 3, title: 'Shoot', content_id: world.shootContentId ?? 7 }
    }

    if (sql.includes('FROM cmo_ideas WHERE id')) {
      return { id: 4, brand_id: 1, title: 'Reel', content_id: world.ideaContentId ?? null }
    }
    return null
  })
}

/** The stage a `UPDATE cmo_content SET stage=?` call was given, if any. */
function stageWrites(): string[] {
  return mockRun.mock.calls
    .filter(([sql]) => /UPDATE cmo_content SET stage=\?/.test(sql))
    .map(([, args]) => args[0] as string)
}

/** Content rows inserted, as [stage] — used for the idea-with-no-content path. */
function insertedContentStages(): string[] {
  return mockRun.mock.calls
    .filter(([sql]) => sql.includes('INSERT INTO cmo_content'))
    .map(([sql]) => (sql.match(/'([A-Za-z ]+)', 'idea'/)?.[1] ?? ''))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── ideas ───────────────────────────────────────────────────────────────────

describe('approving an idea', () => {
  it('moves its already-linked content from Idea to Approved', async () => {
    stubDb({ contentStage: 'Idea', ideaContentId: 7, scriptExists: true })
    await updateIdea(4, { approved: 1, rejected: 0 })
    expect(stageWrites()).toContain('Approved')
  })

  it('creates the content piece at Approved when the idea has none', async () => {
    stubDb({ ideaContentId: null })
    await updateIdea(4, { approved: 1, rejected: 0 })
    expect(insertedContentStages()).toContain('Approved')
  })

  it('opens a script for the writer to pick up, not one already in progress', async () => {
    stubDb({ contentStage: 'Idea', ideaContentId: 7, scriptExists: false })
    await updateIdea(4, { approved: 1, rejected: 0 })
    const scriptInsert = mockRun.mock.calls.find(([sql]) => sql.includes('INSERT INTO cmo_scripts'))
    expect(scriptInsert?.[1]).toContain('Pending')
  })

  it('leaves content alone when it has already moved past Approved', async () => {
    stubDb({ contentStage: 'Editing', ideaContentId: 7, scriptExists: true })
    await updateIdea(4, { approved: 1, rejected: 0 })
    expect(stageWrites()).toEqual([])
  })

  it('sends content back to Idea when the approval is withdrawn', async () => {
    stubDb({ contentStage: 'Approved', ideaContentId: 7, scriptExists: true })
    await updateIdea(4, { approved: 0, rejected: 1 })
    expect(stageWrites()).toEqual(['Idea'])
  })

  it('will not undo real work — withdrawal is ignored once scripting has begun', async () => {
    stubDb({ contentStage: 'Script Writing', ideaContentId: 7, scriptExists: true })
    await updateIdea(4, { approved: 0, rejected: 1 })
    expect(stageWrites()).toEqual([])
  })
})

// ─── scripts ─────────────────────────────────────────────────────────────────

describe('script status', () => {
  it('starting the script moves content to Script Writing', async () => {
    stubDb({ contentStage: 'Approved', scriptExists: true })
    await updateScript(5, { status: 'In Progress', approved: 0 })
    expect(stageWrites()).toContain('Script Writing')
  })

  it('submitting moves content to Script Review', async () => {
    stubDb({ contentStage: 'Script Writing', scriptExists: true })
    await updateScript(5, { status: 'Submitted', approved: 0 })
    expect(stageWrites()).toContain('Script Review')
  })

  it('submitting still works when content skipped straight from Approved', async () => {
    stubDb({ contentStage: 'Approved', scriptExists: true })
    await updateScript(5, { status: 'Submitted', approved: 0 })
    expect(stageWrites()).toContain('Script Review')
  })

  it('requesting changes pulls content back to Revisions', async () => {
    stubDb({ contentStage: 'Script Review', scriptExists: true })
    await updateScript(5, { status: 'Changes Required', approved: 0 })
    expect(stageWrites()).toContain('Revisions')
  })

  it('approving moves content to Shoot Planning and opens a shoot', async () => {
    stubDb({ contentStage: 'Script Review', scriptExists: true, shootExists: false })
    await updateScript(5, { status: 'Approved', approved: 1 })
    expect(stageWrites()).toContain('Shoot Planning')
    expect(mockRun.mock.calls.some(([sql]) => sql.includes('INSERT INTO cmo_shoots'))).toBe(true)
  })
})

// ─── shoots ──────────────────────────────────────────────────────────────────

describe('shoot status', () => {
  it('scheduling moves content to Shoot Scheduled', async () => {
    stubDb({ contentStage: 'Shoot Planning', shootExists: true, scriptExists: true })
    await updateShoot(3, { status: 'Scheduled' })
    expect(stageWrites()).toContain('Shoot Scheduled')
  })

  it('starting to shoot moves content to Shooting', async () => {
    stubDb({ contentStage: 'Shoot Scheduled', shootExists: true, scriptExists: true })
    await updateShoot(3, { status: 'Shooting' })
    expect(stageWrites()).toContain('Shooting')
  })

  it('wrapping the shoot moves content to Editing', async () => {
    stubDb({ contentStage: 'Shooting', shootExists: true, scriptExists: true })
    await updateShoot(3, { status: 'Completed' })
    expect(stageWrites()).toContain('Editing')
  })

  it('does not drag content backwards when a wrapped shoot is re-marked Planned', async () => {
    stubDb({ contentStage: 'Editing', shootExists: true, scriptExists: true })
    await updateShoot(3, { status: 'Planned' })
    expect(stageWrites()).toEqual([])
  })

  it('ignores cancelled shoots', async () => {
    stubDb({ contentStage: 'Shoot Scheduled', shootExists: true, scriptExists: true })
    await updateShoot(3, { status: 'Cancelled' })
    expect(stageWrites()).toEqual([])
  })
})

// ─── final sign-off ──────────────────────────────────────────────────────────

describe('content approval', () => {
  it('signing off in Review moves the piece to Ready To Publish', async () => {
    stubDb({ contentStage: 'Review', scriptExists: true })
    await updateContent(7, { approved: 1 })
    expect(stageWrites()).toContain('Ready To Publish')
  })

  it('signing off earlier does not skip the piece ahead', async () => {
    stubDb({ contentStage: 'Editing', scriptExists: true })
    await updateContent(7, { approved: 1 })
    expect(stageWrites()).toEqual([])
  })
})
