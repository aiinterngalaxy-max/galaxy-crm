// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Content Studio not yet migrated to Firestore; suppressed until migration complete
import { all, one, run, batch, resetClient } from './db'
import { STAGES, STAGE_INDEX, PLATFORMS } from './stages'
import { todayISO } from './format'
import { SCHEMA, DROP, MIGRATE } from './schema'
import { buildSeed, validateSeed } from './seed'
import { connectionStatus, syncAll, lastSync } from './integrations'
import type {
  ActivityEntry,
  Brand,
  Channel,
  ContentComment,
  ContentRow,
  Idea,
  Insights,
  PerfRow,
  ScriptRow,
  ShootRow,
  Stats,
  SyncLogEntry,
  SyncStatusEntry,
  TeamMember,
} from '@/types/content-studio'

const PLATFORM_SET = new Set<string>(PLATFORMS)

async function logActivity(
  entity_type: string,
  entity_id: number,
  action: string,
  detail: string,
  actor: string = 'System',
): Promise<void> {
  try {
    await run(
      `INSERT INTO cmo_activity_log (entity_type, entity_id, action, detail, actor) VALUES (?, ?, ?, ?, ?)`,
      [entity_type, entity_id, action, detail.slice(0, 200), actor.slice(0, 80)],
    )
  } catch {
    // logging must never break the calling operation
  }
}

function applyEditable<T extends Record<string, any>>(body: T, editable: Set<string>) {
  const sets: string[] = []
  const args: any[] = []
  for (const [k, v] of Object.entries(body)) {
    if (!editable.has(k)) continue
    sets.push(`${k}=?`)
    args.push(typeof v === 'string' ? v : v)
  }
  return { sets, args }
}

// ---------- brands ----------
export function getBrands(): Promise<Brand[]> {
  return all<Brand>(
    "SELECT id, name, category, status, monthly_target, lead, notes, created_at FROM cmo_brands ORDER BY CASE WHEN status='Active' THEN 0 ELSE 1 END, name",
  )
}

export function getBrand(id: number): Promise<Brand | null> {
  return one<Brand>('SELECT * FROM cmo_brands WHERE id=?', [id])
}

const BRAND_STATUSES = new Set(['Active', 'Onboarding', 'Paused', 'Retired'])

export async function createBrand(data: Partial<Brand>): Promise<Brand> {
  const name = String(data.name || '').trim()
  if (!name) throw new Error('name is required')

  const existing = await one('SELECT id FROM cmo_brands WHERE LOWER(name)=LOWER(?)', [name])
  if (existing) throw new Error(`A brand named "${name}" already exists.`)

  const status = data.status || 'Active'
  if (!BRAND_STATUSES.has(status)) throw new Error('invalid status')

  const monthly_target = data.monthly_target != null ? Number(data.monthly_target) : 8
  if (isNaN(monthly_target) || monthly_target < 0) throw new Error('monthly_target must be a non-negative number')

  const rs = await run(
    `INSERT INTO cmo_brands (name, category, status, monthly_target, lead, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, String(data.category || '').trim(), status, monthly_target, String(data.lead || '').trim(), String(data.notes || '').trim()],
  )
  const id = Number(rs.lastInsertRowid ?? 0)
  const row = await one<Brand>('SELECT * FROM cmo_brands WHERE id=?', [id])
  await logActivity('brand', id, 'created', `Brand created: ${name}`)
  return row as Brand
}

const BRAND_EDITABLE = new Set(['name', 'category', 'status', 'monthly_target', 'lead', 'notes'])

export async function updateBrand(id: number, data: Partial<Brand>): Promise<Brand> {
  const body: Record<string, any> = { ...data }
  if ('name' in body && !String(body.name || '').trim()) throw new Error('name is required')
  if ('status' in body && !BRAND_STATUSES.has(body.status)) throw new Error('invalid status')
  if ('monthly_target' in body) {
    const n = Number(body.monthly_target)
    if (isNaN(n) || n < 0) throw new Error('monthly_target must be a non-negative number')
    body.monthly_target = n
  }
  const { sets, args } = applyEditable(body, BRAND_EDITABLE)
  if (!sets.length) throw new Error('no editable fields')
  args.push(id)
  await run(`UPDATE cmo_brands SET ${sets.join(', ')} WHERE id=?`, args)
  const row = await one<Brand>('SELECT * FROM cmo_brands WHERE id=?', [id])
  await logActivity('brand', id, 'updated', `Brand updated: ${row!.name}`)
  return row as Brand
}

export async function deleteBrand(id: number): Promise<void> {
  const [content, ideas, shoots] = await Promise.all([
    all<{ n: number }>('SELECT COUNT(*) AS n FROM cmo_content WHERE brand_id=?', [id]),
    all<{ n: number }>('SELECT COUNT(*) AS n FROM cmo_ideas WHERE brand_id=?', [id]),
    all<{ n: number }>('SELECT COUNT(*) AS n FROM cmo_shoots WHERE brand_id=?', [id]),
  ])
  const nContent = Number(content[0]?.n ?? 0)
  const nIdeas = Number(ideas[0]?.n ?? 0)
  const nShoots = Number(shoots[0]?.n ?? 0)
  if (nContent > 0 || nIdeas > 0 || nShoots > 0) {
    const parts: string[] = []
    if (nContent > 0) parts.push(`${nContent} content ${nContent === 1 ? 'piece' : 'pieces'}`)
    if (nIdeas > 0) parts.push(`${nIdeas} ${nIdeas === 1 ? 'idea' : 'ideas'}`)
    if (nShoots > 0) parts.push(`${nShoots} ${nShoots === 1 ? 'shoot' : 'shoots'}`)
    throw new Error(`Can't delete — this brand has ${parts.join(', ')}. Reassign or delete those first.`)
  }
  const brand = await one<{ name: string }>('SELECT name FROM cmo_brands WHERE id=?', [id])
  await run('DELETE FROM cmo_channels WHERE brand_id=?', [id])
  await run('DELETE FROM cmo_brands WHERE id=?', [id])
  await logActivity('brand', id, 'deleted', `Brand deleted: ${brand?.name ?? `#${id}`}`)
}

// ---------- channels ----------
const CHANNEL_COLS = 'id, brand_id, platform, handle, account_id, follower_count, last_synced'

export function getChannels(brandId?: number): Promise<Channel[]> {
  if (brandId) return all<Channel>(`SELECT ${CHANNEL_COLS} FROM cmo_channels WHERE brand_id=? ORDER BY platform`, [brandId])
  return all<Channel>(`SELECT ${CHANNEL_COLS} FROM cmo_channels ORDER BY brand_id, platform`)
}

export async function createChannel(data: {
  brand_id: number
  platform: string
  handle?: string
  account_id?: string
  follower_count?: number
}): Promise<Channel> {
  const brand_id = Number(data.brand_id)
  if (!brand_id) throw new Error('brand_id is required')
  const platform = String(data.platform || '').trim()
  if (!PLATFORM_SET.has(platform)) throw new Error('invalid platform')
  const follower_count = data.follower_count != null ? Number(data.follower_count) : 0
  if (isNaN(follower_count) || follower_count < 0) throw new Error('follower_count must be a non-negative number')

  try {
    const rs = await run(
      `INSERT INTO cmo_channels (brand_id, platform, handle, account_id, follower_count) VALUES (?, ?, ?, ?, ?)`,
      [brand_id, platform, String(data.handle || '').trim(), String(data.account_id || '').trim(), follower_count],
    )
    const id = Number(rs.lastInsertRowid ?? 0)
    const row = await one<Channel>(`SELECT ${CHANNEL_COLS} FROM cmo_channels WHERE id=?`, [id])
    return row as Channel
  } catch (err: any) {
    const msg: string = err?.message || ''
    if (msg.toLowerCase().includes('unique')) {
      throw new Error(`This brand already has a ${platform} channel — edit it instead of creating a new one.`)
    }
    throw new Error(msg || 'Database error')
  }
}

export async function updateChannel(id: number, data: { handle?: string; follower_count?: number }): Promise<Channel> {
  const sets: string[] = []
  const args: any[] = []
  if ('handle' in data) {
    sets.push('handle=?')
    args.push(String(data.handle || '').trim())
  }
  if ('follower_count' in data) {
    const n = Number(data.follower_count)
    if (isNaN(n) || n < 0) throw new Error('follower_count must be a non-negative number')
    sets.push('follower_count=?')
    args.push(n)
  }
  if (!sets.length) throw new Error('no editable fields')
  args.push(id)
  await run(`UPDATE cmo_channels SET ${sets.join(', ')} WHERE id=?`, args)
  const row = await one<Channel>(`SELECT ${CHANNEL_COLS} FROM cmo_channels WHERE id=?`, [id])
  return row as Channel
}

// ---------- team ----------
export function getTeam(): Promise<TeamMember[]> {
  return all<TeamMember>('SELECT id, name, role, capacity, is_owner FROM cmo_team ORDER BY role, name')
}

// ---------- content ----------
const CONTENT_COLS = `ct.id, ct.brand_id, ct.title, ct.format, ct.platform, ct.stage,
  ct.priority, ct.writer, ct.editor, ct.talent, ct.start_date, ct.due_date,
  ct.publish_date, ct.shoot_date, ct.location, ct.revision_rounds, ct.approved,
  ct.notes, ct.ext_platform, ct.ext_id, ct.ext_url, ct.source, ct.created_at,
  br.name AS brand_name`

const CONTENT_JOIN = `SELECT ${CONTENT_COLS} FROM cmo_content ct JOIN cmo_brands br ON br.id = ct.brand_id`

export function getAllContent(): Promise<ContentRow[]> {
  return all<ContentRow>(CONTENT_JOIN + ' ORDER BY ct.due_date IS NULL, ct.due_date')
}

export function getContentForBrand(brandId: number): Promise<ContentRow[]> {
  return all<ContentRow>(CONTENT_JOIN + ' WHERE ct.brand_id=? ORDER BY ct.due_date', [brandId])
}

export function getContent(id: number): Promise<ContentRow | null> {
  return one<ContentRow>(CONTENT_JOIN + ' WHERE ct.id=?', [id])
}

export async function createContent(data: Partial<ContentRow>, actor?: string): Promise<ContentRow> {
  const b: any = data
  if (!b.brand_id || !b.title) throw new Error('brand_id and title required')
  const rs = await run(
    `INSERT INTO cmo_content
       (brand_id,title,format,platform,stage,priority,writer,editor,talent,start_date,due_date,publish_date,shoot_date,location,revision_rounds,approved,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(b.brand_id),
      String(b.title),
      b.format || 'Reel',
      b.platform || 'Instagram',
      b.stage || 'Idea',
      b.priority || 'Normal',
      b.writer || '',
      b.editor || '',
      b.talent || '',
      b.start_date || null,
      b.due_date || null,
      b.publish_date || null,
      b.shoot_date || null,
      b.location || '',
      Number(b.revision_rounds || 0),
      Number(b.approved || 0),
      b.notes || '',
    ],
  )
  const id = Number(rs.lastInsertRowid ?? 0)
  const row = await one<ContentRow>(CONTENT_JOIN + ' WHERE ct.id=?', [id])
  await logActivity('content', id, 'created', `Content created: ${String(b.title).slice(0, 60)}`, actor)
  return row as ContentRow
}

const CONTENT_EDITABLE = new Set([
  'title', 'format', 'platform', 'stage', 'priority', 'writer', 'editor', 'talent',
  'start_date', 'due_date', 'publish_date', 'shoot_date', 'location',
  'revision_rounds', 'approved', 'notes',
])

export async function updateContent(id: number, data: Partial<ContentRow>, actor?: string): Promise<ContentRow> {
  const body: Record<string, any> = { ...data }
  const sets: string[] = []
  const args: any[] = []
  for (const [k, v] of Object.entries(body)) {
    if (!CONTENT_EDITABLE.has(k)) continue
    if (k === 'stage' && !STAGES.includes(v as any)) throw new Error(`unknown stage: ${v}`)
    sets.push(`${k}=?`)
    args.push(v)
  }

  if (body.stage === 'Published' && !('publish_date' in body)) {
    const cur = await one<{ publish_date: string | null }>('SELECT publish_date FROM cmo_content WHERE id=?', [id])
    if (cur && !cur.publish_date) {
      sets.push('publish_date=?')
      args.push(todayISO())
    }
  }

  if (!sets.length) throw new Error('no editable fields')

  if (body.stage) {
    const newIdx = STAGE_INDEX[body.stage as string]
    if (newIdx > STAGE_INDEX['Script Review']) {
      const script = await one<{ status: string }>('SELECT status FROM cmo_scripts WHERE content_id=? LIMIT 1', [id])
      if (!script || script.status !== 'Approved') throw new Error("Can't advance — script isn't approved yet.")
    }
    if (newIdx > STAGE_INDEX['Review']) {
      const cur = await one<{ approved: number }>('SELECT approved FROM cmo_content WHERE id=?', [id])
      if (!cur?.approved) throw new Error("Can't advance — content isn't approved yet.")
    }
  }

  args.push(id)
  await run(`UPDATE cmo_content SET ${sets.join(', ')} WHERE id=?`, args)

  if (body.stage === 'Shoot Planning') {
    await maybeCreateShootForContent(id)
  }

  const row = await one<ContentRow>(CONTENT_JOIN + ' WHERE ct.id=?', [id])
  const title = row?.title ?? `#${id}`
  if (body.stage === 'Published') {
    await logActivity('content', id, 'published', `Content published: ${title}`, actor)
  } else if (body.stage) {
    await logActivity('content', id, 'stage-change', `Content moved to ${body.stage}: ${title}`, actor)
  } else if (body.publish_date) {
    await logActivity('content', id, 'updated', `Content rescheduled: ${title} → ${body.publish_date}`, actor)
  } else {
    await logActivity('content', id, 'updated', `Content updated: ${title}`, actor)
  }
  return row as ContentRow
}

export async function deleteContent(id: number, actor?: string): Promise<void> {
  const perf = await one<{ n: number }>('SELECT COUNT(*) AS n FROM cmo_performance WHERE content_id=?', [id])
  if (Number(perf?.n ?? 0) > 0) {
    throw new Error("Can't delete — this content piece has performance data. Remove the performance records first.")
  }
  const content = await one<{ title: string }>('SELECT title FROM cmo_content WHERE id=?', [id])
  await run('DELETE FROM cmo_content WHERE id=?', [id])
  await logActivity('content', id, 'deleted', `Content deleted: ${content?.title ?? `#${id}`}`, actor)
}

// ---------- comments ----------
const COMMENT_COLS = 'id, content_id, author, text, created_at'

export function getComments(contentId: number): Promise<ContentComment[]> {
  return all<ContentComment>(`SELECT ${COMMENT_COLS} FROM cmo_comments WHERE content_id=? ORDER BY id ASC`, [contentId])
}

export async function createComment(contentId: number, text: string, author?: string): Promise<ContentComment> {
  const trimmed = String(text || '').trim()
  if (!trimmed) throw new Error('text is required')
  const rs = await run(`INSERT INTO cmo_comments (content_id, author, text) VALUES (?, ?, ?)`, [
    contentId,
    String(author || '').trim() || 'Anonymous',
    trimmed,
  ])
  const id = Number(rs.lastInsertRowid ?? 0)
  const row = await one<ContentComment>(`SELECT ${COMMENT_COLS} FROM cmo_comments WHERE id=?`, [id])
  return row as ContentComment
}

// ---------- ideas ----------
const IDEA_COLS = 'id, brand_id, month, title, pitched, pitch_due, approved, rejected, review_note, content_id, created_at'

export function getIdeas(brandId?: number): Promise<Idea[]> {
  if (brandId) return all<Idea>(`SELECT ${IDEA_COLS} FROM cmo_ideas WHERE brand_id=? ORDER BY pitched, pitch_due`, [brandId])
  return all<Idea>(`SELECT ${IDEA_COLS} FROM cmo_ideas ORDER BY brand_id, pitched, pitch_due`)
}

export async function createIdea(data: { brand_id: number; month?: string; title: string }): Promise<Idea> {
  const brand_id = Number(data.brand_id)
  if (!brand_id) throw new Error('brand_id is required')
  const title = String(data.title || '').trim()
  if (!title) throw new Error('title is required')
  const month = String(data.month || new Date().toISOString().slice(0, 7))
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM')

  const rs = await run(`INSERT INTO cmo_ideas (brand_id, month, title) VALUES (?, ?, ?)`, [brand_id, month, title])
  const id = Number(rs.lastInsertRowid ?? 0)
  const row = await one<Idea>(`SELECT ${IDEA_COLS} FROM cmo_ideas WHERE id=?`, [id])
  await logActivity('idea', id, 'created', `Idea added: ${title}`)
  return row as Idea
}

const IDEA_EDITABLE = new Set(['title', 'pitched', 'pitch_due', 'approved', 'rejected', 'review_note', 'month'])

export async function updateIdea(id: number, data: Partial<Idea>): Promise<Idea> {
  const body: Record<string, any> = { ...data }
  const { sets, args } = applyEditable(body, IDEA_EDITABLE)
  if (!sets.length) throw new Error('no editable fields')
  args.push(id)
  await run(`UPDATE cmo_ideas SET ${sets.join(', ')} WHERE id=?`, args)

  if (Number(body.approved) === 1) {
    const idea = await one<{ brand_id: number; title: string; content_id: number | null }>(
      'SELECT brand_id, title, content_id FROM cmo_ideas WHERE id=?',
      [id],
    )
    if (idea && !idea.content_id) {
      const rs = await run(`INSERT INTO cmo_content (brand_id, title, stage, source) VALUES (?, ?, 'Idea', 'idea')`, [
        idea.brand_id,
        idea.title,
      ])
      const contentId = Number(rs.lastInsertRowid ?? 0)
      if (contentId) await run('UPDATE cmo_ideas SET content_id=? WHERE id=?', [contentId, id])
    }
  }

  const row = await one<Idea>(`SELECT ${IDEA_COLS} FROM cmo_ideas WHERE id=?`, [id])
  const title = row?.title ?? `#${id}`
  const status =
    Number(body.approved) === 1 ? 'approved' : Number(body.rejected) === 1 ? 'rejected' : Number(body.pitched) === 1 ? 'pitched' : null
  if (status) {
    await logActivity('idea', id, status === 'pitched' ? 'updated' : status, `Idea ${status}: ${title}`)
  } else {
    await logActivity('idea', id, 'updated', `Idea updated: ${title}`)
  }
  return row as Idea
}

export async function deleteIdea(id: number): Promise<void> {
  const idea = await one<{ title: string }>('SELECT title FROM cmo_ideas WHERE id=?', [id])
  await run('DELETE FROM cmo_ideas WHERE id=?', [id])
  await logActivity('idea', id, 'deleted', `Idea deleted: ${idea?.title ?? `#${id}`}`)
}

// ---------- scripts ----------
const SCRIPT_COLS = 'id, content_id, writer, status, deadline, revision_count, review_comments, approved, approved_at, created_at'
const SCRIPT_STATUSES = new Set(['Pending', 'In Progress', 'Submitted', 'Changes Required', 'Approved'])

export function getScripts(): Promise<ScriptRow[]> {
  return all<ScriptRow>(
    `SELECT sc.id, sc.content_id, sc.writer, sc.status, sc.deadline,
            sc.revision_count, sc.review_comments, sc.approved, sc.approved_at, sc.created_at,
            ct.title, br.name AS brand_name
     FROM cmo_scripts sc
     JOIN cmo_content ct ON ct.id = sc.content_id
     JOIN cmo_brands br ON br.id = ct.brand_id
     ORDER BY sc.deadline IS NULL, sc.deadline`,
  )
}

export async function createScript(data: {
  content_id: number
  writer?: string
  status?: string
  deadline?: string | null
  revision_count?: number
  review_comments?: string
}): Promise<ScriptRow> {
  const content_id = Number(data.content_id)
  if (!content_id) throw new Error('content_id is required')
  const status = String(data.status || 'Pending')
  if (!SCRIPT_STATUSES.has(status)) throw new Error('invalid status')

  try {
    const rs = await run(
      `INSERT INTO cmo_scripts (content_id, writer, status, deadline, revision_count, review_comments) VALUES (?, ?, ?, ?, ?, ?)`,
      [content_id, String(data.writer || '').trim(), status, data.deadline || null, Number(data.revision_count || 0), String(data.review_comments || '').trim()],
    )
    const id = Number(rs.lastInsertRowid ?? 0)
    const row = await one(`SELECT ${SCRIPT_COLS} FROM cmo_scripts WHERE id=?`, [id])
    const content = await one<{ title: string }>('SELECT title FROM cmo_content WHERE id=?', [content_id])
    await logActivity('script', id, 'created', `Script created: ${content?.title ?? `content #${content_id}`}`)
    return row as ScriptRow
  } catch (err: any) {
    const msg: string = err?.message || ''
    if (msg.toLowerCase().includes('unique')) {
      throw new Error('A script already exists for that content piece — edit it instead.')
    }
    throw new Error(msg || 'Database error')
  }
}

export async function updateScript(id: number, data: Record<string, any>): Promise<ScriptRow> {
  const body = { ...data }
  if (body.status && !SCRIPT_STATUSES.has(body.status)) throw new Error('bad status')

  const editable = new Set(['writer', 'status', 'deadline', 'revision_count', 'review_comments', 'approved'])
  const { sets, args } = applyEditable(body, editable)

  if (body.approved && !('approved_at' in body)) {
    sets.push('approved_at=?')
    args.push(todayISO())
  }
  if (!sets.length) throw new Error('no editable fields')
  args.push(id)
  await run(`UPDATE cmo_scripts SET ${sets.join(', ')} WHERE id=?`, args)

  if (body.status) {
    const script = await one<{ content_id: number }>('SELECT content_id FROM cmo_scripts WHERE id=?', [id])
    if (script?.content_id) {
      const content = await one<{ stage: string }>('SELECT stage FROM cmo_content WHERE id=?', [script.content_id])
      if (content) {
        const stage = content.stage
        let targetStage: string | null = null
        if (body.status === 'Submitted' && stage === 'Script Writing') targetStage = 'Script Review'
        else if (body.status === 'Changes Required' && stage !== 'Revisions') targetStage = 'Revisions'
        else if (body.status === 'Approved' && (stage === 'Script Review' || stage === 'Revisions')) targetStage = 'Shoot Planning'

        if (targetStage) {
          await run('UPDATE cmo_content SET stage=? WHERE id=?', [targetStage, script.content_id])
          if (targetStage === 'Shoot Planning') await maybeCreateShootForContent(script.content_id)
        }
      }
    }
  }

  const row = await one(`SELECT ${SCRIPT_COLS} FROM cmo_scripts WHERE id=?`, [id])
  const content = row?.content_id
    ? await one<{ title: string }>('SELECT title FROM cmo_content WHERE id=?', [row.content_id])
    : null
  const title = content?.title ?? `content #${row?.content_id ?? id}`

  if (body.status === 'Submitted') {
    await logActivity('script', id, 'status-change', `Script submitted for review: ${title}`)
  } else if (body.status === 'Approved') {
    await logActivity('script', id, 'approved', `Script approved: ${title}`)
  } else if (body.status === 'Changes Required') {
    await logActivity('script', id, 'status-change', `Script rejected: ${title}`)
  } else if (body.status) {
    await logActivity('script', id, 'status-change', `Script status changed to ${body.status}: ${title}`)
  } else {
    await logActivity('script', id, 'updated', `Script updated: ${title}`)
  }
  return row as ScriptRow
}

// ---------- shoots ----------
const SHOOT_COLS = 'id, brand_id, content_id, title, shoot_date, shoot_time, location, talent, team, equipment, status, notes'
const SHOOT_STATUSES = new Set(['Planned', 'Scheduled', 'Completed', 'Cancelled'])

export function getShoots(): Promise<ShootRow[]> {
  return all<ShootRow>(
    `SELECT s.id, s.brand_id, s.content_id, s.title, s.shoot_date, s.shoot_time,
            s.location, s.talent, s.team, s.equipment, s.status, s.notes,
            br.name AS brand_name
     FROM cmo_shoots s
     JOIN cmo_brands br ON br.id = s.brand_id
     ORDER BY s.shoot_date IS NULL, s.shoot_date`,
  )
}

export async function createShoot(data: Record<string, any>): Promise<ShootRow> {
  const brand_id = Number(data.brand_id)
  if (!brand_id) throw new Error('brand_id is required')
  const title = String(data.title || '').trim()
  if (!title) throw new Error('title is required')
  const status = String(data.status || 'Planned')
  if (!SHOOT_STATUSES.has(status)) throw new Error('invalid status')

  const rs = await run(
    `INSERT INTO cmo_shoots (brand_id, title, shoot_date, shoot_time, location, talent, team, equipment, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      brand_id,
      title,
      data.shoot_date || null,
      String(data.shoot_time || '').trim() || null,
      String(data.location || '').trim() || null,
      String(data.talent || '').trim() || null,
      String(data.team || '').trim() || null,
      String(data.equipment || '').trim() || null,
      status,
      String(data.notes || '').trim() || null,
    ],
  )
  const id = Number(rs.lastInsertRowid ?? 0)
  const row = await one(`SELECT ${SHOOT_COLS} FROM cmo_shoots WHERE id=?`, [id])
  await logActivity('shoot', id, 'created', `Shoot scheduled: ${title}${data.shoot_date ? ` on ${data.shoot_date}` : ''}`)
  return row as ShootRow
}

export async function updateShoot(id: number, data: Record<string, any>): Promise<ShootRow> {
  const body = { ...data }
  if (body.status && !SHOOT_STATUSES.has(body.status)) throw new Error('bad status')
  const editable = new Set(['title', 'shoot_date', 'shoot_time', 'location', 'talent', 'team', 'equipment', 'status', 'notes'])
  const { sets, args } = applyEditable(body, editable)
  if (!sets.length) throw new Error('no editable fields')
  args.push(id)
  await run(`UPDATE cmo_shoots SET ${sets.join(', ')} WHERE id=?`, args)
  const row = await one(`SELECT ${SHOOT_COLS} FROM cmo_shoots WHERE id=?`, [id])
  const title = row?.title ?? `#${id}`

  if (body.status === 'Completed') {
    await logActivity('shoot', id, 'status-change', `Shoot completed: ${title}`)
  } else if (body.status === 'Cancelled') {
    await logActivity('shoot', id, 'status-change', `Shoot cancelled: ${title}`)
  } else if (body.status) {
    await logActivity('shoot', id, 'status-change', `Shoot ${String(body.status).toLowerCase()}: ${title}`)
  } else {
    await logActivity('shoot', id, 'updated', `Shoot updated: ${title}`)
  }
  return row as ShootRow
}

export async function deleteShoot(id: number): Promise<void> {
  const shoot = await one<{ title: string }>('SELECT title FROM cmo_shoots WHERE id=?', [id])
  await run('DELETE FROM cmo_shoots WHERE id=?', [id])
  await logActivity('shoot', id, 'deleted', `Shoot deleted: ${shoot?.title ?? `#${id}`}`)
}

// ---------- performance ----------
export function getPerformance(): Promise<PerfRow[]> {
  return all<PerfRow>(
    `SELECT p.id, p.content_id, p.views, p.reach, p.likes, p.comments,
            p.shares, p.saves, p.watch_time_sec, p.clicks, p.follower_growth, p.captured_at,
            ct.title, ct.platform, br.name AS brand_name
     FROM cmo_performance p
     JOIN cmo_content ct ON ct.id = p.content_id
     JOIN cmo_brands br ON br.id = ct.brand_id
     ORDER BY p.views DESC`,
  )
}

// ---------- derived helpers ----------
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function isOverdue(row: { due_date: string | null; stage: string }): boolean {
  if (row.stage === 'Published') return false
  const du = daysUntil(row.due_date)
  return du !== null && du < 0
}

// ---------- stats / insights ----------
export async function getStats(): Promise<Stats> {
  const [brands, content, shoots, ideas, perf] = await Promise.all([
    getBrands(),
    getAllContent(),
    getShoots(),
    getIdeas(),
    getPerformance(),
  ])

  const activeBrands = brands.filter((b) => b.status === 'Active').length
  const inProduction = content.filter((c) => c.stage !== 'Published').length

  const month = new Date().toISOString().slice(0, 7)
  const publishedThisMonth = content.filter((c) => c.stage === 'Published' && (c.publish_date || '').startsWith(month)).length

  const overdue = content.filter((c) => isOverdue(c))
  const upcomingShoots = shoots.filter((s) => {
    const du = daysUntil(s.shoot_date)
    return s.status !== 'Cancelled' && s.status !== 'Completed' && du !== null && du >= 0 && du <= 14
  })

  const pendingApprovals = content.filter(
    (c) => (c.stage === 'Script Review' || c.stage === 'Review' || c.stage === 'Revisions') && !c.approved,
  )

  const byStage = STAGES.map((s) => ({ stage: s, count: content.filter((c) => c.stage === s).length }))

  const ideasRequired = ideas.length
  const ideasPitched = ideas.filter((i) => i.pitched).length

  const totals = perf.reduce(
    (a, p) => ({
      views: a.views + p.views,
      reach: a.reach + p.reach,
      engagement: a.engagement + p.likes + p.comments + p.shares + p.saves,
      followers: a.followers + p.follower_growth,
    }),
    { views: 0, reach: 0, engagement: 0, followers: 0 },
  )

  const monthlyTargetTotal = brands.reduce((s, b) => s + (b.monthly_target || 0), 0)
  const monthlyCompletionPct = monthlyTargetTotal ? (publishedThisMonth / monthlyTargetTotal) * 100 : 0

  const turnaroundDays = content
    .filter((c) => c.stage === 'Published' && c.start_date && c.publish_date)
    .map((c) => {
      const s = new Date(c.start_date! + 'T00:00:00').getTime()
      const p = new Date(c.publish_date! + 'T00:00:00').getTime()
      return Math.round((p - s) / 86400000)
    })
  const avgTurnaround = turnaroundDays.length ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length) : null

  return {
    activeBrands,
    totalBrands: brands.length,
    inProduction,
    publishedThisMonth,
    overdueCount: overdue.length,
    overdue,
    upcomingShoots,
    pendingApprovals,
    byStage,
    ideasRequired,
    ideasPitched,
    totals,
    perf,
    monthlyTargetTotal,
    monthlyCompletionPct,
    avgTurnaround,
  }
}

export async function getInsights(): Promise<Insights> {
  const [perf, content] = await Promise.all([getPerformance(), getAllContent()])

  function engRate(p: { likes: number; comments: number; shares: number; saves: number; reach: number }) {
    const eng = p.likes + p.comments + p.shares + p.saves
    return p.reach ? eng / p.reach : 0
  }

  const byFormat = new Map<string, { sum: number; n: number }>()
  for (const p of perf) {
    const c = content.find((x) => x.id === p.content_id)
    const fmt = c?.format || 'Unknown'
    const e = byFormat.get(fmt) || { sum: 0, n: 0 }
    e.sum += engRate(p)
    e.n += 1
    byFormat.set(fmt, e)
  }
  const bestFormats = [...byFormat.entries()]
    .map(([format, v]) => ({ format, avgEngRate: v.n ? v.sum / v.n : 0, n: v.n }))
    .sort((a, b) => b.avgEngRate - a.avgEngRate)

  const byPlatform = new Map<string, { views: number; n: number }>()
  for (const p of perf) {
    const e = byPlatform.get(p.platform) || { views: 0, n: 0 }
    e.views += p.views
    e.n += 1
    byPlatform.set(p.platform, e)
  }
  const bestPlatforms = [...byPlatform.entries()]
    .map(([platform, v]) => ({ platform, avgViews: v.n ? Math.round(v.views / v.n) : 0, n: v.n }))
    .sort((a, b) => b.avgViews - a.avgViews)

  const byDay = new Map<string, { views: number; n: number }>()
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (const p of perf) {
    const c = content.find((x) => x.id === p.content_id)
    if (!c?.publish_date) continue
    const day = DOW[new Date(c.publish_date + 'T00:00:00').getDay()]
    const e = byDay.get(day) || { views: 0, n: 0 }
    e.views += p.views
    e.n += 1
    byDay.set(day, e)
  }
  const bestDays = [...byDay.entries()]
    .map(([day, v]) => ({ day, avgViews: v.n ? Math.round(v.views / v.n) : 0, n: v.n }))
    .sort((a, b) => b.avgViews - a.avgViews)

  const stageAge = new Map<string, number[]>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const c of content) {
    if (c.stage === 'Published' || !c.start_date) continue
    const age = Math.round((today.getTime() - new Date(c.start_date + 'T00:00:00').getTime()) / 86400000)
    const arr = stageAge.get(c.stage) || []
    arr.push(age)
    stageAge.set(c.stage, arr)
  }
  const bottlenecks = [...stageAge.entries()]
    .map(([stage, ages]) => ({ stage, avgAge: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length), count: ages.length }))
    .sort((a, b) => b.avgAge - a.avgAge)

  const published = content.filter((c) => c.stage === 'Published')
  const byPerson = new Map<string, { rev: number; n: number }>()
  for (const c of published) {
    for (const person of [c.writer, c.editor].filter(Boolean)) {
      const e = byPerson.get(person) || { rev: 0, n: 0 }
      e.rev += c.revision_rounds
      e.n += 1
      byPerson.set(person, e)
    }
  }
  const teamEfficiency = [...byPerson.entries()]
    .map(([person, v]) => ({ person, avgRevisions: v.n ? v.rev / v.n : 0, n: v.n }))
    .sort((a, b) => a.avgRevisions - b.avgRevisions)

  return { bestFormats, bestPlatforms, bestDays, bottlenecks, teamEfficiency }
}

// ---------- activity ----------
const ACTIVITY_COLS = 'id, entity_type, entity_id, action, detail, actor, created_at'
const VALID_ACTIVITY_TYPES = new Set(['content', 'brand', 'idea', 'script', 'shoot'])

export function getActivity(type?: string): Promise<ActivityEntry[]> {
  if (type && VALID_ACTIVITY_TYPES.has(type)) {
    return all<ActivityEntry>(`SELECT ${ACTIVITY_COLS} FROM cmo_activity_log WHERE entity_type=? ORDER BY id DESC LIMIT 200`, [type])
  }
  return all<ActivityEntry>(`SELECT ${ACTIVITY_COLS} FROM cmo_activity_log ORDER BY id DESC LIMIT 200`)
}

// ---------- search ----------
export interface SearchResultRow {
  id: number
  type: 'Content' | 'Idea' | 'Script' | 'Shoot' | 'Brand'
  title: string
  meta: string
  href: string
}

export async function search(query: string): Promise<{ results: SearchResultRow[] }> {
  const q = query.trim()
  if (q.length < 2) return { results: [] }
  const like = `%${q}%`

  const [content, ideas, scripts, shoots, brands] = await Promise.all([
    all<{ id: number; title: string; platform: string; stage: string; brand_name: string }>(
      `SELECT c.id, c.title, c.platform, c.stage, b.name AS brand_name
       FROM cmo_content c JOIN cmo_brands b ON b.id = c.brand_id
       WHERE c.title LIKE ? COLLATE NOCASE ORDER BY c.id DESC LIMIT 5`,
      [like],
    ),
    all<{ id: number; title: string; brand_name: string; month: string }>(
      `SELECT i.id, i.title, b.name AS brand_name, i.month
       FROM cmo_ideas i JOIN cmo_brands b ON b.id = i.brand_id
       WHERE i.title LIKE ? COLLATE NOCASE ORDER BY i.id DESC LIMIT 5`,
      [like],
    ),
    all<{ id: number; content_id: number; title: string; status: string; brand_name: string }>(
      `SELECT s.id, s.content_id, c.title, s.status, b.name AS brand_name
       FROM cmo_scripts s
       JOIN cmo_content c ON c.id = s.content_id
       JOIN cmo_brands b ON b.id = c.brand_id
       WHERE c.title LIKE ? COLLATE NOCASE ORDER BY s.id DESC LIMIT 5`,
      [like],
    ),
    all<{ id: number; title: string; brand_name: string; shoot_date: string | null }>(
      `SELECT sh.id, sh.title, b.name AS brand_name, sh.shoot_date
       FROM cmo_shoots sh JOIN cmo_brands b ON b.id = sh.brand_id
       WHERE sh.title LIKE ? COLLATE NOCASE ORDER BY sh.id DESC LIMIT 5`,
      [like],
    ),
    all<{ id: number; name: string; category: string; status: string }>(
      `SELECT id, name, category, status FROM cmo_brands WHERE name LIKE ? COLLATE NOCASE ORDER BY id LIMIT 5`,
      [like],
    ),
  ])

  const results: SearchResultRow[] = [
    ...content.map((r) => ({ id: r.id, type: 'Content' as const, title: r.title, meta: `${r.brand_name} · ${r.platform} · ${r.stage}`, href: `/content-studio/pipeline?edit=${r.id}` })),
    ...ideas.map((r) => ({ id: r.id, type: 'Idea' as const, title: r.title, meta: `${r.brand_name} · ${r.month}`, href: `/content-studio/ideas` })),
    ...scripts.map((r) => ({ id: r.id, type: 'Script' as const, title: r.title, meta: `${r.brand_name} · ${r.status}`, href: `/content-studio/scripts` })),
    ...shoots.map((r) => ({ id: r.id, type: 'Shoot' as const, title: r.title, meta: `${r.brand_name}${r.shoot_date ? ` · ${r.shoot_date}` : ''}`, href: `/content-studio/shoots` })),
    ...brands.map((r) => ({ id: r.id, type: 'Brand' as const, title: r.name, meta: `${r.category} · ${r.status}`, href: `/content-studio/brands` })),
  ]

  return { results }
}

// ---------- side-effect helpers ----------
export async function maybeCreateShootForContent(contentId: number): Promise<void> {
  const existing = await one<{ id: number }>('SELECT id FROM cmo_shoots WHERE content_id=?', [contentId])
  if (existing) return

  const content = await one<{ brand_id: number; title: string }>('SELECT brand_id, title FROM cmo_content WHERE id=?', [contentId])
  if (!content) return

  await run("INSERT INTO cmo_shoots (brand_id, content_id, title, status) VALUES (?, ?, ?, 'Planned')", [
    content.brand_id,
    contentId,
    content.title,
  ])
}

// ---------- sync / connections ----------
export async function getSyncStatus(): Promise<{ ok: boolean; anyConnected: boolean; status: SyncStatusEntry[]; log: SyncLogEntry[] }> {
  const [status, log] = await Promise.all([Promise.resolve(connectionStatus()), lastSync()])
  const anyConnected = status.some((s) => s.connected)
  return { ok: true, anyConnected, status, log: log as unknown as SyncLogEntry[] }
}

export async function syncNow(limit?: number): Promise<{ ok: boolean; summary?: any[]; error?: string }> {
  const connected = connectionStatus().filter((s) => s.connected)
  if (!connected.length) {
    return {
      ok: false,
      error: 'No platforms connected. Add the API credentials (VITE_ env vars) for YouTube / Instagram / LinkedIn / Facebook, then sync.',
    }
  }
  await logActivity('sync', 0, 'triggered', `Social sync triggered for ${connected.map((s) => s.label).join(', ')}`)

  const summary = await syncAll(Math.max(1, Math.min(100, limit || 100)))
  for (const s of summary) {
    if (s.ok) {
      await logActivity('sync', 0, 'synced', `Social sync completed for ${s.platform}: ${s.posts} posts fetched`)
    } else {
      await logActivity('sync', 0, 'sync-failed', `Social sync failed for ${s.platform}: ${s.error ?? 'unknown error'}`)
    }
  }
  return { ok: true, summary }
}

// ---------- init ----------
export async function initDb(opts?: { reset?: boolean; seed?: boolean }): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = []
  if (opts?.reset) {
    await batch(DROP.map((sql) => ({ sql })))
    log.push(`dropped: ${DROP.map((d) => d.replace('DROP TABLE IF EXISTS ', '')).join(', ')}`)
    resetClient()
  }
  await batch(SCHEMA.map((sql) => ({ sql })))
  log.push('ensured cmo_* tables exist')

  let migrated = 0
  for (const m of MIGRATE) {
    try {
      await run(m)
      migrated++
    } catch (e: any) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e
    }
  }
  if (migrated) log.push(`applied ${migrated} migration(s)`)

  if (opts?.seed) {
    const existing = await all<{ n: number }>('SELECT COUNT(*) as n FROM cmo_brands')
    const count = Number((existing[0] as any)?.n ?? 0)
    if (count > 0) {
      log.push(`skipped seed — cmo_brands already has ${count} rows (use reset to wipe & reseed)`)
    } else {
      const bundle = buildSeed()
      const errs = validateSeed(bundle)
      if (errs.length) throw new Error('seed validation failed: ' + errs.join('; '))

      await batch(
        bundle.brands.map((b) => ({
          sql: `INSERT INTO cmo_brands (name,category,status,monthly_target,lead,notes) VALUES (?,?,?,?,?,?)`,
          args: [b.name, b.category, b.status, b.monthly_target, b.lead, b.notes],
        })),
      )
      for (const ch of bundle.channels) {
        await run(`INSERT INTO cmo_channels (brand_id,platform,handle,follower_count) VALUES (?,?,?,?)`, [
          ch.brand,
          ch.platform,
          ch.handle,
          ch.follower_count,
        ])
      }
      for (const t of bundle.team) {
        await run(`INSERT INTO cmo_team (name,role,capacity,is_owner) VALUES (?,?,?,?)`, [t.name, t.role, t.capacity, t.is_owner])
      }
      for (const c of bundle.content) {
        await run(
          `INSERT INTO cmo_content
           (brand_id,title,format,platform,stage,priority,writer,editor,talent,start_date,due_date,publish_date,shoot_date,location,revision_rounds,approved,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            c.brand_id, c.title, c.format, c.platform, c.stage, c.priority, c.writer, c.editor, c.talent,
            c.start_date, c.due_date, c.publish_date, c.shoot_date, c.location, c.revision_rounds, c.approved, c.notes,
          ],
        )
      }
      for (const s of bundle.scripts) {
        await run(
          `INSERT INTO cmo_scripts (content_id,writer,status,deadline,revision_count,review_comments,approved,approved_at) VALUES (?,?,?,?,?,?,?,?)`,
          [s.content_id, s.writer, s.status, s.deadline, s.revision_count, s.review_comments, s.approved, s.approved_at],
        )
      }
      for (const i of bundle.ideas) {
        await run(
          `INSERT INTO cmo_ideas (brand_id,month,title,pitched,pitch_due,approved,rejected,review_note,content_id) VALUES (?,?,?,?,?,?,?,?,?)`,
          [i.brand_id, i.month, i.title, i.pitched, i.pitch_due, i.approved, i.rejected, i.review_note ?? '', i.content_id ?? null],
        )
      }
      for (const s of bundle.shoots) {
        await run(
          `INSERT INTO cmo_shoots (brand_id,content_id,title,shoot_date,shoot_time,location,talent,team,equipment,status,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [s.brand_id, s.content_id, s.title, s.shoot_date, s.shoot_time, s.location, s.talent, s.team, s.equipment, s.status, s.notes],
        )
      }
      for (const p of bundle.performance) {
        await run(
          `INSERT INTO cmo_performance
           (content_id,views,reach,likes,comments,shares,saves,watch_time_sec,clicks,follower_growth)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [p.content_id, p.views, p.reach, p.likes, p.comments, p.shares, p.saves, p.watch_time_sec, p.clicks, p.follower_growth],
        )
      }
      log.push(`seeded ${bundle.brands.length} brands, ${bundle.channels.length} channels, ${bundle.team.length} team, ${bundle.content.length} content`)
    }
  }

  return { ok: true, log }
}

export { STAGES, STAGE_INDEX }
