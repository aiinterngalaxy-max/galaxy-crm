// Content Studio previously used Turso/libsql. That dependency has been removed.
// These stubs preserve the module interface so the app compiles.
// Content Studio data should be migrated to Firestore.

type InValue = string | number | boolean | null
type StubResult = { rows: unknown[]; lastInsertRowid: number }

const STUB: StubResult = { rows: [], lastInsertRowid: 0 }

export function db(): never {
  throw new Error('Content Studio DB not configured. Migrate to Firestore.')
}

export async function all<T = Record<string, unknown>>(_sql: string, _args: InValue[] = []): Promise<T[]> {
  console.warn('Content Studio DB not configured.')
  return []
}

export async function one<T = Record<string, unknown>>(_sql: string, _args: InValue[] = []): Promise<T | null> {
  console.warn('Content Studio DB not configured.')
  return null
}

export async function run(_sql: string, _args: InValue[] = []): Promise<StubResult> {
  console.warn('Content Studio DB not configured.')
  return STUB
}

export async function batch(_statements: { sql: string; args?: InValue[] }[]): Promise<StubResult[]> {
  console.warn('Content Studio DB not configured.')
  return [STUB]
}

export function resetClient() {}
