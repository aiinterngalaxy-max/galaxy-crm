/**
 * Per-user Google Drive access, layered on the CRM's existing Google sign-in.
 *
 * The previous design used one shared, server-side refresh token — a single
 * secret, manually generated once via OAuth Playground, stored in Vercel. In
 * practice that turned out to be fragile: easy to regenerate against a stale
 * Client Secret, no way to verify it was right without a live test, and a
 * single point of failure for the whole feature.
 *
 * This replaces it with nothing to store at all. The CRM already signs
 * everyone in with GoogleAuthProvider (src/lib/firebase.ts); this asks that
 * same signed-in Google account to also grant Drive access — one extra
 * consent popup, shown once per browser session, using the exact mechanism
 * that's already reliably running your login. No server-held secret, so
 * nothing to mistype and nothing to expire independently of the user's own
 * session.
 *
 * Trade-off worth knowing: uploads now land in whichever Google account
 * granted access, not one fixed shared account. If a document goes into a
 * shared Drive folder that account doesn't have Editor access to, Drive
 * itself will reject the write — the fix is sharing that folder with the
 * account in question via Drive's own Share button, not more OAuth setup.
 */
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import { auth } from './firebase'

export class DriveAuthError extends Error {}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

let cachedToken: { value: string; expiresAt: number } | null = null

function newDriveProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  provider.addScope(DRIVE_SCOPE)
  return provider
}

/**
 * Returns a Drive-scoped access token for whoever is currently signed in.
 * The first call in a browser session shows a Google consent popup asking to
 * extend the existing sign-in with Drive access; after that the token is
 * cached in memory for the rest of the session (Google tokens last ~1 hour,
 * refreshed a few minutes early here to avoid failing right at the edge).
 */
export async function getDriveAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const user = auth.currentUser
  if (!user) throw new DriveAuthError('Not signed in')

  let result
  try {
    result = await reauthenticateWithPopup(user, newDriveProvider())
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new DriveAuthError('Google Drive access was not granted — the popup was closed before finishing.')
    }
    if (code === 'auth/popup-blocked') {
      throw new DriveAuthError('Your browser blocked the Google sign-in popup — allow popups for this site and try again.')
    }
    throw new DriveAuthError('Could not get Google Drive access. Please try again.')
  }

  const credential = GoogleAuthProvider.credentialFromResult(result)
  const accessToken = credential?.accessToken
  if (!accessToken) {
    throw new DriveAuthError('Google did not grant Drive access — please try again.')
  }

  cachedToken = { value: accessToken, expiresAt: Date.now() + 50 * 60 * 1000 }
  return accessToken
}

/**
 * Clears the cached token, forcing the next getDriveAccessToken() call to
 * reprompt. Call this after Drive itself rejects a token as expired/invalid
 * (401), so the user gets a fresh consent prompt instead of a stuck error.
 */
export function clearCachedDriveToken(): void {
  cachedToken = null
}
