/**
 * Turns a Firestore/Firebase failure into something worth showing a user.
 *
 * A blanket "Failed to create lead" tells nobody anything: the operator cannot
 * act on it and support cannot diagnose it without asking for a console dump.
 * Known error codes get a plain-English instruction; anything else keeps its
 * original message so at least the real fault is visible and reportable.
 */
function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : ''
}

export function describeFirestoreError(err: unknown, fallback: string): string {
  switch (errorCode(err)) {
    case 'permission-denied':
      return 'You do not have permission to do this. Sign out and back in; if it persists, ask an admin to check your role.'
    case 'unauthenticated':
      return 'Your session expired. Sign in again and retry.'
    case 'unavailable':
      return 'Could not reach the database. Check your internet connection and try again.'
    case 'deadline-exceeded':
      return 'The database took too long to respond. Try again in a moment.'
    case 'already-exists':
      return 'That record already exists.'
    case 'resource-exhausted':
      return 'The database quota has been reached. Contact an admin.'
  }

  // Firestore rejects any document containing `undefined` and says which field,
  // which is the single most useful thing to put in front of whoever hit it.
  if (err instanceof Error && err.message.includes('Unsupported field value: undefined')) {
    const field = err.message.match(/found in field ([\w.]+)/)?.[1]
    return field
      ? `${fallback}: the "${field}" field was empty when it should not be. Refresh the page and try again.`
      : `${fallback}: a required field was empty. Refresh the page and try again.`
  }

  if (err instanceof Error && err.message) return `${fallback}: ${err.message}`
  return fallback
}

/**
 * Drops keys whose value is `undefined`.
 *
 * Firestore throws on `undefined` anywhere in a document, and a single missed
 * fallback several fields deep fails the whole write. Running the payload
 * through this means one overlooked field degrades to "absent" rather than
 * taking down the entire save.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}
