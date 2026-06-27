import { createClient, type Client as LibsqlClient, type InValue } from '@libsql/client/web'

let _client: LibsqlClient | undefined

function buildUrl(raw: string): string {
  return raw.startsWith('libsql://') ? raw.replace('libsql://', 'https://') : raw
}

export function db(): LibsqlClient {
  if (_client) return _client
  const url = import.meta.env.VITE_TURSO_DATABASE_URL as string | undefined
  const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN as string | undefined
  if (!url) {
    throw new Error('VITE_TURSO_DATABASE_URL is not set. Add it (and VITE_TURSO_AUTH_TOKEN) to .env.local.')
  }
  _client = createClient({ url: buildUrl(url), authToken })
  return _client
}

export async function all<T = any>(sql: string, args: InValue[] = []): Promise<T[]> {
  const rs = await db().execute({ sql, args })
  return rs.rows as unknown as T[]
}

export async function one<T = any>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args)
  return rows.length ? rows[0] : null
}

export async function run(sql: string, args: InValue[] = []) {
  return db().execute({ sql, args })
}

export async function batch(statements: { sql: string; args?: InValue[] }[]) {
  return db().batch(
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
