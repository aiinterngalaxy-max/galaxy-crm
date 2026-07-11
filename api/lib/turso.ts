const TURSO_URL = (process.env.TURSO_URL ?? '').replace('libsql://', 'https://')
const TURSO_TOKEN = process.env.TURSO_TOKEN ?? ''

type ArgValue = string | number | null

interface TursoArg {
  type: 'text' | 'integer' | 'float' | 'null'
  value?: string
}

function toArg(v: ArgValue): TursoArg {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: String(v) }
  }
  return { type: 'text', value: String(v) }
}

export interface Row {
  [col: string]: string | number | null
}

export async function tursoQuery(sql: string, args: ArgValue[] = []): Promise<Row[]> {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: args.map(toArg) } },
        { type: 'close' },
      ],
    }),
  })

  const data = await res.json() as any
  if (data.results?.[0]?.type === 'error') {
    throw new Error(data.results[0].error?.message ?? 'Turso query error')
  }

  const result = data.results?.[0]?.response?.result
  if (!result) return []

  const cols: string[] = result.cols.map((c: any) => c.name)
  return result.rows.map((row: any[]) => {
    const obj: Row = {}
    row.forEach((cell: any, i: number) => {
      obj[cols[i]] = cell.type === 'null' ? null : cell.value
    })
    return obj
  })
}

export async function tursoExec(sql: string, args: ArgValue[] = []): Promise<void> {
  await tursoQuery(sql, args)
}

export async function initTables(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS topz_quotations (
      id TEXT PRIMARY KEY,
      quoteNo TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      tripType TEXT NOT NULL,
      isRoundTrip INTEGER NOT NULL DEFAULT 0,
      clientName TEXT NOT NULL,
      clientPhone TEXT NOT NULL DEFAULT '',
      clientEmail TEXT NOT NULL DEFAULT '',
      pickupDate TEXT NOT NULL DEFAULT '',
      pickupLocation TEXT NOT NULL DEFAULT '',
      dropDate TEXT NOT NULL DEFAULT '',
      dropLocation TEXT NOT NULL DEFAULT '',
      passengers TEXT NOT NULL DEFAULT '',
      estimatedKm TEXT NOT NULL DEFAULT '',
      vehicleName TEXT NOT NULL DEFAULT '',
      vehicleCategory TEXT NOT NULL DEFAULT '',
      days INTEGER NOT NULL DEFAULT 1,
      totalAmount REAL NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS topz_bookings (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      quoteNo TEXT NOT NULL DEFAULT '',
      clientName TEXT NOT NULL,
      clientPhone TEXT NOT NULL DEFAULT '',
      vehicleName TEXT NOT NULL DEFAULT '',
      pickupDate TEXT NOT NULL DEFAULT '',
      dropDate TEXT NOT NULL DEFAULT '',
      pickupLocation TEXT NOT NULL DEFAULT '',
      dropLocation TEXT NOT NULL DEFAULT '',
      totalAmount REAL NOT NULL DEFAULT 0,
      advancePaid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT NOT NULL DEFAULT '',
      tripType TEXT NOT NULL DEFAULT 'outstation',
      supplier TEXT
    )`,
  ]

  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        ...statements.map(sql => ({ type: 'execute', stmt: { sql, args: [] } })),
        { type: 'close' },
      ],
    }),
  })
  const data = await res.json() as any
  for (const r of data.results ?? []) {
    if (r?.type === 'error') throw new Error(r.error?.message ?? 'initTables error')
  }
}
