export const config = { runtime: 'edge' }

/**
 * Issues a short-lived Cloudinary upload signature to signed-in CRM users.
 *
 * The unsigned preset this replaces was readable in the app bundle, so anyone
 * who opened DevTools could upload into the account and burn the 25-credit free
 * tier. Signed uploads move the secret server-side: the browser can no longer
 * upload on its own, it has to ask, and it only gets an answer if it presents a
 * valid Firebase ID token.
 *
 * The signature is scoped to a fixed folder and a timestamp, so even a leaked
 * one is good for a few minutes of uploads into quotes/ and nothing else.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   CLOUDINARY_API_SECRET   from Cloudinary → Settings → API Keys
 *   CLOUDINARY_API_KEY      same page
 *   CLOUDINARY_CLOUD_NAME   optional, defaults to the known cloud
 *
 * With the secret unset this returns 501 and the client falls back to the
 * unsigned preset, so deploying the endpoint cannot break uploads on its own.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'tjez7kaf'
const FOLDER = 'galaxy-quotes'

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

/** Cloudinary signs the SHA-1 of the sorted params plus the API secret. */
async function sign(params: Record<string, string>, secret: string): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')

  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign + secret))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = process.env.CLOUDINARY_API_SECRET
  const apiKey = process.env.CLOUDINARY_API_KEY
  // Reuse the web API key the client already ships; it is public by design and
  // is only used here to call Google's token lookup.
  const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU'

  if (!secret || !apiKey) {
    // Not configured yet — tell the client to use the unsigned path rather than
    // failing the upload outright.
    return json({ error: 'signing-not-configured' }, 501)
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

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const params = { folder: FOLDER, timestamp }
  const signature = await sign(params, secret)

  return json({ signature, timestamp, apiKey, cloudName: CLOUD_NAME, folder: FOLDER })
}
