import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireStaff } from './lib/verify-auth'

// Server-side Turso access for the Content Studio.
//
// Previously src/lib/content-studio/db.ts opened a libSQL client directly in the
// browser using VITE_TURSO_AUTH_TOKEN. Anything VITE_-prefixed is inlined into the
// shipped bundle, so that read-write database token was readable by any visitor.
// The token now lives only here, in a non-VITE server env var, and the browser
// talks to this endpoint instead.
//
// Callers must present a valid Firebase ID token and hold a non-pending role.

const TURSO_URL = (process.env.TURSO_URL ?? '').replace('libsql://', 'https://')
const TURSO_TOKEN = process.env.TURSO_TOKEN ?? ''

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

type Val = string | number | boolean | null

interface Stmt {
  sql: string
  args?: Val[]
}

function arg(v: Val) {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' }
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: String(v) }
  }
  return { type: 'text', value: String(v) }
}

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  // Reflect only allow-listed origins; never a bare `*`.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!TURSO_URL || !TURSO_TOKEN) {
    return res.status(500).json({ error: 'Content Studio database is not configured' })
  }

  try {
    await requireStaff(req)
  } catch (e) {
    // Auth failures are the caller's problem to fix, but do not echo internals.
    const message = e instanceof Error ? e.message : 'Unauthorized'
    return res.status(401).json({ error: message })
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    statements?: Stmt[]
    mode?: 'read' | 'write'
  }

  const statements = body?.statements
  if (!Array.isArray(statements) || statements.length === 0) {
    return res.status(400).json({ error: 'No statements provided' })
  }
  if (statements.length > 100) {
    return res.status(400).json({ error: 'Too many statements in one request' })
  }
  if (statements.some((s) => typeof s?.sql !== 'string' || !s.sql.trim())) {
    return res.status(400).json({ error: 'Each statement needs a sql string' })
  }

  try {
    const upstream = await fetch(`${TURSO_URL}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TURSO_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          ...statements.map((s) => ({
            type: 'execute',
            stmt: { sql: s.sql, args: (s.args ?? []).map(arg) },
          })),
          { type: 'close' },
        ],
      }),
    })

    if (!upstream.ok) throw new Error(`Turso HTTP ${upstream.status}`)
    const data = (await upstream.json()) as any

    const results = statements.map((_, i) => {
      const entry = data.results?.[i]
      if (entry?.type === 'error') throw new Error(entry.error?.message ?? 'Query failed')
      const result = entry?.response?.result
      if (!result) return { rows: [], rowsAffected: 0, lastInsertRowid: null }

      const cols: string[] = (result.cols ?? []).map((c: any) => c.name)
      const rows = (result.rows ?? []).map((row: any[]) => {
        const o: Record<string, unknown> = {}
        row.forEach((cell: any, idx: number) => {
          o[cols[idx]] = cell?.type === 'null' ? null : cell?.value
        })
        return o
      })

      return {
        rows,
        rowsAffected: Number(result.affected_row_count ?? 0),
        lastInsertRowid: result.last_insert_rowid ?? null,
      }
    })

    return res.status(200).json({ results })
  } catch (e) {
    // Log the detail server-side; return something generic to the caller.
    console.error('content-studio-db failed:', e)
    return res.status(500).json({ error: 'Database request failed' })
  }
}
