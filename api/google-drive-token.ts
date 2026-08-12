export const config = { runtime: 'edge' }

/**
 * Mints a short-lived Google Drive access token for a verified CRM user.
 *
 * File bytes are never proxied through this function, or through Vercel at all
 * — the browser uploads directly to Google using the token this returns. That
 * is what lets Documents Upload accept files of any size: Vercel's own
 * request-body limit never enters the picture, because Vercel never sees the
 * file.
 *
 * The refresh token behind this belongs to one Google account — the CRM's own
 * Drive — obtained once via a manual OAuth consent (see ARCHITECTURE.md). It is
 * never sent to the client, only used server-side to mint access tokens.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_DRIVE_REFRESH_TOKEN
 *   GOOGLE_DRIVE_FOLDER_ID     the Drive folder uploads are scoped to
 *
 * With any of these unset this returns 501, so deploying the endpoint before
 * the Google Cloud setup is finished cannot break anything else.
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

/**
 * Confirms the caller is a real, currently-valid CRM user.
 *
 * Uses Google's identitytoolkit lookup rather than verifying the JWT locally:
 * the edge runtime has no Firebase Admin SDK, and this also catches a user who
 * has been disabled or deleted since their token was minted.
 */
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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  // Reuse the web API key the client already ships; it is public by design and
  // is only used here to call Google's token lookup.
  const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU'

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    // Not configured yet — let the client show a clear "set this up" message
    // instead of a generic failure.
    return json({ error: 'drive-not-configured' }, 501)
  }

  let idToken = ''
  try {
    idToken = (await req.json())?.idToken ?? ''
  } catch {
    return json({ error: 'bad request body' }, 400)
  }
  if (!idToken) return json({ error: 'missing idToken' }, 401)

  if (!(await verifyFirebaseUser(idToken, firebaseApiKey))) {
    return json({ error: 'not signed in' }, 403)
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenRes.ok) {
    // Forward Google's own error/error_description (e.g. "invalid_client":
    // "The provided client secret is invalid.") rather than a flat generic
    // message — that detail is what actually tells whoever is debugging this
    // whether the Client ID, Client Secret, or the refresh token itself is
    // wrong, instead of leaving them to guess by trial and error.
    let googleError: unknown = null
    try { googleError = await tokenRes.json() } catch { /* body wasn't JSON */ }
    console.error('Drive token refresh failed:', tokenRes.status, googleError)
    return json({ error: 'drive-auth-failed', googleStatus: tokenRes.status, googleError }, 502)
  }
  const tokenData = await tokenRes.json()

  return json({
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
    folderId,
  })
}
