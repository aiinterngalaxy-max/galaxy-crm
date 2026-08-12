export const config = { runtime: 'edge' }

/**
 * Trashes, restores, or permanently deletes one file in the CRM's Google Drive
 * folder, on behalf of a verified user.
 *
 * Called from src/lib/trash.ts so a Documents Upload record's lifecycle (delete
 * → recycle bin → restore, or → permanently delete) stays in step on the Drive
 * side, not just in Firestore. Mirrors google-drive-token.ts's auth pattern and
 * required environment variables.
 */

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS })
}

async function verifyFirebaseUser(idToken: string, apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    )
    if (!r.ok) return false
    const data = await r.json()
    const user = data?.users?.[0]
    return Boolean(user && user.disabled !== true)
  } catch {
    return false
  }
}

interface TokenOutcome {
  accessToken: string | null
  /** Google's own error/error_description on failure — see google-drive-token.ts
   *  for why this is forwarded rather than swallowed into a flat message. */
  googleStatus?: number
  googleError?: unknown
}

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<TokenOutcome> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    let googleError: unknown = null
    try { googleError = await res.json() } catch { /* body wasn't JSON */ }
    console.error('Drive token refresh failed:', res.status, googleError)
    return { accessToken: null, googleStatus: res.status, googleError }
  }
  const data = await res.json()
  return { accessToken: data.access_token ?? null }
}

type Action = 'trash' | 'restore' | 'delete'

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU'

  if (!clientId || !clientSecret || !refreshToken) {
    return json({ error: 'drive-not-configured' }, 501)
  }

  let body: { idToken?: string; driveFileId?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad request body' }, 400)
  }

  const { idToken, driveFileId, action } = body
  if (!idToken || !driveFileId || !['trash', 'restore', 'delete'].includes(action ?? '')) {
    return json({ error: 'bad request' }, 400)
  }

  if (!(await verifyFirebaseUser(idToken, firebaseApiKey))) {
    return json({ error: 'not signed in' }, 403)
  }

  const tokenOutcome = await getAccessToken(clientId, clientSecret, refreshToken)
  if (!tokenOutcome.accessToken) {
    return json({ error: 'drive-auth-failed', googleStatus: tokenOutcome.googleStatus, googleError: tokenOutcome.googleError }, 502)
  }
  const accessToken = tokenOutcome.accessToken

  const act = action as Action
  const driveRes = act === 'delete'
    ? await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    : await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: act === 'trash' }),
      })

  // A DELETE on a file already gone (e.g. someone emptied Drive's own trash
  // separately) returns 404. Treat that as success — the end state the caller
  // wants (file not present) is already true.
  if (!driveRes.ok && !(act === 'delete' && driveRes.status === 404)) {
    return json({ error: 'drive-request-failed', status: driveRes.status }, 502)
  }

  return json({ ok: true })
}
