// @ts-nocheck
let _client: any | undefined

function buildUrl(raw: string): string {
  return raw.startsWith('libsql://') ? raw.replace('libsql://', 'https://') : raw
}

export const isTursoConfigured = !!import.meta.env.VITE_TURSO_DATABASE_URL

async function getClient() {
  if (_client) return _client
  const url = import.meta.env.VITE_TURSO_DATABASE_URL as string | undefined
  const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN as string | undefined
  if (!url) throw new Error('VITE_TURSO_DATABASE_URL is not set.')
  const { createClient } = await import('@libsql/client/web')
  _client = createClient({ url: buildUrl(url), authToken })
  return _client
}

export async function db() {
  return getClient()
}

export async function all<T = any>(sql: string, args: any[] = []): Promise<T[]> {
  const client = await db()
  const rs = await client.execute({ sql, args })
  return rs.rows as unknown as T[]
}

export async function one<T = any>(sql: string, args: any[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args)
  return rows.length ? rows[0] : null
}

export async function run(sql: string, args: any[] = []) {
  const client = await db()
  return client.execute({ sql, args })
}

export async function batch(statements: { sql: string; args?: any[] }[]) {
  const client = await db()
  return client.batch(
    statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    'write',
  )
}

export function resetClient() {
  try {
    _client?.close()
  } catch {
    // ignore
  }
  _client = undefined
}
