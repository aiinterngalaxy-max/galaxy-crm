import { auth } from '../firebase'

// Content Studio database access.
//
// This used to build a libSQL client in the browser from VITE_TURSO_AUTH_TOKEN.
// Vite inlines any VITE_-prefixed value into the shipped bundle, so that
// read-write token was extractable from the deployed JavaScript by any visitor.
//
// All queries now go through /api/content-studio-db, which holds the token in a
// server-only env var and requires a Firebase ID token from an approved user.
// The exported helpers below keep the same shapes they had before, so callers
// (queries.ts, integrations/) did not need to change.

const ENDPOINT = '/api/content-studio-db'

// The database URL is not a credential, and is still the flag the UI uses to decide
// whether Content Studio is set up at all. Only the auth token moved server-side.
export const isTursoConfigured = !!import.meta.env.VITE_TURSO_DATABASE_URL

export interface ExecResult<T = any> {
  rows: T[]
  rowsAffected: number
  lastInsertRowid: string | null
}

interface Statement {
  sql: string
  args?: any[]
}

async function idToken(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('You must be signed in to use Content Studio.')
  return user.getIdToken()
}

async function execute(statements: Statement[]): Promise<ExecResult[]> {
  const token = await idToken()

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      statements: statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    }),
  })

  if (!res.ok) {
    // Surface the failure rather than resolving to an empty result set — an empty
    // array here is indistinguishable from "no rows" and hides auth/config errors.
    let detail = `Content Studio request failed (HTTP ${res.status})`
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {
      // response had no JSON body — keep the status-based message
    }
    throw new Error(detail)
  }

  const body = (await res.json()) as { results?: ExecResult[] }
  return body.results ?? []
}

export async function all<T = any>(sql: string, args: any[] = []): Promise<T[]> {
  const [result] = await execute([{ sql, args }])
  return (result?.rows ?? []) as T[]
}

export async function one<T = any>(sql: string, args: any[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args)
  return rows.length ? rows[0] : null
}

export async function run(sql: string, args: any[] = []): Promise<ExecResult> {
  const [result] = await execute([{ sql, args }])
  return result ?? { rows: [], rowsAffected: 0, lastInsertRowid: null }
}

export async function batch(statements: Statement[]): Promise<ExecResult[]> {
  if (!statements.length) return []
  return execute(statements)
}

// Kept for API compatibility with the old libSQL client, which held a live
// connection that needed disposing between schema rebuilds. There is no
// persistent client any more, so there is nothing to reset.
export function resetClient() {
  /* no-op */
}
