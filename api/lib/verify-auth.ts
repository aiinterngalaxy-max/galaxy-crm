import { createPublicKey, createVerify } from 'node:crypto'
import type { VercelRequest } from '@vercel/node'

// Verifies a Firebase Auth ID token server-side.
//
// Done by hand against Google's published x509 certs rather than via firebase-admin
// so that no new dependency (and no service-account key) is needed. This is the same
// check firebase-admin's verifyIdToken() performs: RS256 signature, plus iss/aud/exp/iat/sub.

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

// Vercel injects every project env var into the function runtime, so the VITE_-prefixed
// project id is readable here. Prefer a non-VITE var when one is configured.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? ''

let certCache: { keys: Record<string, string>; expiresAt: number } | undefined

async function googleCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.keys

  const res = await fetch(CERT_URL)
  if (!res.ok) throw new Error(`Could not fetch Google signing certs (HTTP ${res.status})`)
  const keys = (await res.json()) as Record<string, string>

  // Respect Cache-Control so we are not refetching on every invocation.
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600)
  certCache = { keys, expiresAt: Date.now() + maxAge * 1000 }
  return keys
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(b64urlToBuffer(part).toString('utf8'))
}

export interface VerifiedUser {
  uid: string
  email?: string
}

/**
 * Verifies the `Authorization: Bearer <idToken>` header on a request.
 * Throws if the token is missing, malformed, expired, or not signed by Google
 * for this Firebase project.
 */
export async function requireUser(req: VercelRequest): Promise<VerifiedUser> {
  if (!PROJECT_ID) {
    throw new Error('Server misconfigured: FIREBASE_PROJECT_ID is not set')
  }

  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new Error('Missing Authorization bearer token')

  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed ID token')
  const [rawHeader, rawPayload, rawSignature] = parts

  const head = decodeJson(rawHeader) as { alg?: string; kid?: string }
  if (head.alg !== 'RS256') throw new Error('Unexpected token algorithm')
  if (!head.kid) throw new Error('ID token has no key id')

  const certs = await googleCerts()
  const cert = certs[head.kid]
  if (!cert) throw new Error('ID token signed by an unknown key')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${rawHeader}.${rawPayload}`)
  verifier.end()
  const signatureOk = verifier.verify(createPublicKey(cert), b64urlToBuffer(rawSignature))
  if (!signatureOk) throw new Error('ID token signature is invalid')

  const claims = decodeJson(rawPayload) as {
    iss?: string
    aud?: string
    sub?: string
    email?: string
    exp?: number
    iat?: number
  }

  const now = Math.floor(Date.now() / 1000)
  const skew = 60 // tolerate a minute of clock drift

  if (claims.aud !== PROJECT_ID) throw new Error('ID token audience mismatch')
  if (claims.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error('ID token issuer mismatch')
  if (!claims.sub) throw new Error('ID token has no subject')
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new Error('ID token has expired')
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) throw new Error('ID token used before issue time')

  return { uid: claims.sub, email: claims.email }
}

/**
 * Reads the caller's `users/{uid}` doc through the Firestore REST API, using the
 * caller's own ID token, and returns their role. Because it goes through REST with
 * the user's credentials, firestore.rules still applies.
 */
export async function roleOf(uid: string, idToken: string): Promise<string> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!res.ok) throw new Error('Could not read user profile')
  const doc = (await res.json()) as { fields?: { role?: { stringValue?: string } } }
  return doc.fields?.role?.stringValue ?? 'pending'
}

/** Verifies the token and asserts the caller is an approved (non-pending) staff member. */
export async function requireStaff(req: VercelRequest): Promise<VerifiedUser & { role: string }> {
  const user = await requireUser(req)
  const idToken = (req.headers.authorization ?? '').slice(7).trim()
  const role = await roleOf(user.uid, idToken)
  if (role === 'pending') throw new Error('Account is pending approval')
  return { ...user, role }
}
