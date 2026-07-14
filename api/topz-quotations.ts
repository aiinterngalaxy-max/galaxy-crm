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
  await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql: `CREATE TABLE IF NOT EXISTS topz_quotations (id TEXT PRIMARY KEY, quoteNo TEXT NOT NULL, createdAt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', tripType TEXT NOT NULL DEFAULT 'outstation', isRoundTrip INTEGER NOT NULL DEFAULT 0, clientName TEXT NOT NULL DEFAULT '', clientPhone TEXT NOT NULL DEFAULT '', clientEmail TEXT NOT NULL DEFAULT '', pickupDate TEXT NOT NULL DEFAULT '', pickupLocation TEXT NOT NULL DEFAULT '', dropDate TEXT NOT NULL DEFAULT '', dropLocation TEXT NOT NULL DEFAULT '', passengers TEXT NOT NULL DEFAULT '', estimatedKm TEXT NOT NULL DEFAULT '', vehicleName TEXT NOT NULL DEFAULT '', vehicleCategory TEXT NOT NULL DEFAULT '', days INTEGER NOT NULL DEFAULT 1, totalAmount REAL NOT NULL DEFAULT 0, sentBy TEXT)`, args: [] } },
        // Migration for pre-existing tables: fails silently (duplicate column) once the column exists — this handler ignores response errors.
        { type: 'execute', stmt: { sql: `ALTER TABLE topz_quotations ADD COLUMN sentBy TEXT`, args: [] } },
        { type: 'close' },
      ],
    }),
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  await init()

  if (req.method === 'GET') {
    const rows = await sql('SELECT * FROM topz_quotations ORDER BY createdAt DESC')
    return res.status(200).json(rows.map(r => ({ ...r, isRoundTrip: r.isRoundTrip === '1' || r.isRoundTrip === 1, days: Number(r.days), totalAmount: Number(r.totalAmount), sentBy: r.sentBy ?? undefined })))
  }

  if (req.method === 'POST') {
    const q = req.body
    await sql(
      `INSERT INTO topz_quotations (id,quoteNo,createdAt,status,tripType,isRoundTrip,clientName,clientPhone,clientEmail,pickupDate,pickupLocation,dropDate,dropLocation,passengers,estimatedKm,vehicleName,vehicleCategory,days,totalAmount,sentBy)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET quoteNo=excluded.quoteNo,status=excluded.status,tripType=excluded.tripType,isRoundTrip=excluded.isRoundTrip,clientName=excluded.clientName,clientPhone=excluded.clientPhone,clientEmail=excluded.clientEmail,pickupDate=excluded.pickupDate,pickupLocation=excluded.pickupLocation,dropDate=excluded.dropDate,dropLocation=excluded.dropLocation,passengers=excluded.passengers,estimatedKm=excluded.estimatedKm,vehicleName=excluded.vehicleName,vehicleCategory=excluded.vehicleCategory,days=excluded.days,totalAmount=excluded.totalAmount,sentBy=excluded.sentBy`,
      [q.id, q.quoteNo, new Date().toISOString(), q.status ?? 'draft', q.tripType ?? 'outstation', q.isRoundTrip ? 1 : 0, q.clientName ?? '', q.clientPhone ?? '', q.clientEmail ?? '', q.pickupDate ?? '', q.pickupLocation ?? '', q.dropDate ?? '', q.dropLocation ?? '', q.passengers ?? '', q.estimatedKm ?? '', q.vehicleName ?? '', q.vehicleCategory ?? '', q.days ?? 1, q.totalAmount ?? 0, q.sentBy ?? null]
    )
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'PUT') {
    await sql('UPDATE topz_quotations SET status=? WHERE id=?', [req.query.status as string, req.query.id as string])
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    await sql('DELETE FROM topz_quotations WHERE id=?', [req.query.id as string])
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
