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
        { type: 'execute', stmt: { sql: `CREATE TABLE IF NOT EXISTS topz_bookings (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, quoteNo TEXT NOT NULL DEFAULT '', clientName TEXT NOT NULL DEFAULT '', clientPhone TEXT NOT NULL DEFAULT '', vehicleName TEXT NOT NULL DEFAULT '', pickupDate TEXT NOT NULL DEFAULT '', dropDate TEXT NOT NULL DEFAULT '', pickupLocation TEXT NOT NULL DEFAULT '', dropLocation TEXT NOT NULL DEFAULT '', totalAmount REAL NOT NULL DEFAULT 0, advancePaid REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT NOT NULL DEFAULT '', tripType TEXT NOT NULL DEFAULT 'outstation', supplier TEXT, commission REAL NOT NULL DEFAULT 0)`, args: [] } },
        // Migration for pre-existing tables: fails silently (duplicate column) once the column exists — this handler ignores response errors.
        { type: 'execute', stmt: { sql: `ALTER TABLE topz_bookings ADD COLUMN commission REAL NOT NULL DEFAULT 0`, args: [] } },
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
    const rows = await sql('SELECT * FROM topz_bookings ORDER BY createdAt DESC')
    return res.status(200).json(rows.map(r => ({ ...r, totalAmount: Number(r.totalAmount), advancePaid: Number(r.advancePaid), commission: Number(r.commission ?? 0), supplier: r.supplier ?? undefined })))
  }

  if (req.method === 'POST') {
    const b = req.body
    await sql(
      `INSERT INTO topz_bookings (id,createdAt,quoteNo,clientName,clientPhone,vehicleName,pickupDate,dropDate,pickupLocation,dropLocation,totalAmount,advancePaid,status,notes,tripType,supplier,commission)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET quoteNo=excluded.quoteNo,clientName=excluded.clientName,clientPhone=excluded.clientPhone,vehicleName=excluded.vehicleName,pickupDate=excluded.pickupDate,dropDate=excluded.dropDate,pickupLocation=excluded.pickupLocation,dropLocation=excluded.dropLocation,totalAmount=excluded.totalAmount,advancePaid=excluded.advancePaid,status=excluded.status,notes=excluded.notes,tripType=excluded.tripType,supplier=excluded.supplier,commission=excluded.commission`,
      [b.id, new Date().toISOString(), b.quoteNo ?? '', b.clientName ?? '', b.clientPhone ?? '', b.vehicleName ?? '', b.pickupDate ?? '', b.dropDate ?? '', b.pickupLocation ?? '', b.dropLocation ?? '', b.totalAmount ?? 0, b.advancePaid ?? 0, b.status ?? 'confirmed', b.notes ?? '', b.tripType ?? 'outstation', b.supplier ?? null, b.commission ?? 0]
    )
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    await sql('DELETE FROM topz_bookings WHERE id=?', [req.query.id as string])
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
