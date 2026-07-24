import type { VercelRequest, VercelResponse } from '@vercel/node'

const TURSO_URL = (process.env.TURSO_URL ?? '').replace('libsql://', 'https://')
const TURSO_TOKEN = process.env.TURSO_TOKEN ?? ''

type Val = string | number | null

function arg(v: Val) {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: String(v) }
  return { type: 'text', value: String(v) }
}

async function sql(query: string, args: Val[] = []) {
  const r = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: query, args: args.map(arg) } }, { type: 'close' }] }),
  })
  const data = await r.json() as any
  if (data.results?.[0]?.type === 'error') throw new Error(data.results[0].error?.message)
  const res = data.results?.[0]?.response?.result
  if (!res) return []
  const cols: string[] = res.cols.map((c: any) => c.name)
  return res.rows.map((row: any[]) => {
    const o: Record<string, any> = {}
    row.forEach((cell: any, i: number) => { o[cols[i]] = cell.type === 'null' ? null : cell.value })
    return o
  })
}

async function init() {
  await sql(`CREATE TABLE IF NOT EXISTS topz_rate_overrides (id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', updatedAt TEXT)`)
}

// Team-shared vehicle rate overrides. A single row (id='global') holds the whole
// { vehicleName: { field: value } } map as JSON — mirroring the client-side shape
// so it can seamlessly replace the old localStorage-only store.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await init()

  if (req.method === 'GET') {
    const rows = await sql(`SELECT data FROM topz_rate_overrides WHERE id='global'`)
    let overrides: unknown = {}
    if (rows[0]?.data) { try { overrides = JSON.parse(rows[0].data) } catch { overrides = {} } }
    return res.status(200).json({ overrides })
  }

  if (req.method === 'POST') {
    // Body is the full overrides map — { overrides: {...} } — which replaces the stored one.
    const overrides = req.body?.overrides ?? {}
    const json = JSON.stringify(overrides ?? {})
    await sql(
      `INSERT INTO topz_rate_overrides (id, data, updatedAt) VALUES ('global', ?, ?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`,
      [json, new Date().toISOString()]
    )
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
