import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireStaff } from './lib/verify-auth'

// Server-side proxy for the Content Studio social integrations.
//
// The integration modules used to read VITE_IG_ACCESS_TOKEN / VITE_FB_ACCESS_TOKEN /
// VITE_YT_API_KEY / VITE_LI_ACCESS_TOKEN in the browser. They did so through a dynamic
// `import.meta.env[key]` lookup, which forces Vite to inline the *entire* env object
// into the bundle — so every one of those credentials shipped to visitors.
//
// The browser now sends only a provider name and an API path; this function attaches
// the credential and forwards the call. Tokens never reach the client.
//
// Env vars are read without the VITE_ prefix first, falling back to the VITE_ names so
// existing Vercel projects keep working before the vars are renamed. Nothing here is
// bundled either way — this file runs only on the server.

function env(...names: string[]): string {
  for (const name of names) {
    const v = process.env[name]
    if (v) return v.trim()
  }
  return ''
}

const YT_KEY = () => env('YT_API_KEY', 'VITE_YT_API_KEY')
const YT_CHANNEL = () => env('YT_CHANNEL_ID', 'VITE_YT_CHANNEL_ID')
const IG_TOKEN = () => env('IG_ACCESS_TOKEN', 'VITE_IG_ACCESS_TOKEN')
const IG_USER = () => env('IG_USER_ID', 'VITE_IG_USER_ID')
const FB_TOKEN = () => env('FB_ACCESS_TOKEN', 'VITE_FB_ACCESS_TOKEN')
const FB_PAGE = () => env('FB_PAGE_ID', 'VITE_FB_PAGE_ID')
const FB_APP_ID = () => env('FB_APP_ID', 'VITE_FB_APP_ID')
const FB_APP_SECRET = () => env('FB_APP_SECRET', 'VITE_FB_APP_SECRET')
const LI_TOKEN = () => env('LI_ACCESS_TOKEN', 'VITE_LI_ACCESS_TOKEN')
const LI_ORG = () => env('LI_ORG_ID', 'VITE_LI_ORG_ID')
const LI_VERSION = () => env('LI_VERSION', 'VITE_LI_VERSION') || '202405'

const brandId = (...names: string[]) => Number(env(...names) || 1)

const GRAPH = 'https://graph.facebook.com/v21.0'
const YOUTUBE = 'https://www.googleapis.com/youtube/v3'
const LINKEDIN = 'https://api.linkedin.com/rest'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

type ProviderKey = 'youtube' | 'instagram' | 'facebook' | 'linkedin'

const BASES: Record<ProviderKey, string> = {
  youtube: YOUTUBE,
  instagram: GRAPH,
  facebook: GRAPH,
  linkedin: LINKEDIN,
}

function statusPayload() {
  return {
    youtube: {
      configured: !!(YT_KEY() && YT_CHANNEL()),
      brandId: brandId('YT_BRAND_ID', 'VITE_YT_BRAND_ID'),
      accountId: YT_CHANNEL(),
    },
    instagram: {
      configured: !!(IG_TOKEN() && IG_USER()),
      brandId: brandId('IG_BRAND_ID', 'VITE_IG_BRAND_ID'),
      accountId: IG_USER(),
    },
    facebook: {
      configured: !!(FB_TOKEN() && FB_PAGE()),
      brandId: brandId('FB_BRAND_ID', 'VITE_FB_BRAND_ID'),
      accountId: FB_PAGE(),
    },
    linkedin: {
      configured: !!(LI_TOKEN() && LI_ORG()),
      brandId: brandId('LI_BRAND_ID', 'VITE_LI_BRAND_ID'),
      accountId: LI_ORG().replace(/\D/g, ''),
    },
  }
}

// ─── Facebook token resolution ────────────────────────────────────────────────
// Exchanges the configured user token for a long-lived token, then for a page
// token, memoised for the lifetime of the warm function instance. Previously this
// lived in the browser and cached tokens in the Turso `cmo_settings` table.

let fbPageToken: { value: string; seed: string; expiresAt: number } | undefined

async function facebookPageToken(): Promise<string> {
  const userToken = FB_TOKEN()
  const pageId = FB_PAGE()
  if (!userToken || !pageId) throw new Error('Facebook is not configured')

  if (fbPageToken && fbPageToken.seed === userToken && fbPageToken.expiresAt > Date.now()) {
    return fbPageToken.value
  }

  let token = userToken
  const appId = FB_APP_ID()
  const appSecret = FB_APP_SECRET()

  if (appId && appSecret) {
    try {
      const res = await fetch(
        `${GRAPH.replace('/v21.0', '')}/oauth/access_token?grant_type=fb_exchange_token` +
          `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}` +
          `&fb_exchange_token=${encodeURIComponent(userToken)}`,
      )
      const data = (await res.json()) as { access_token?: string }
      if (res.ok && data.access_token) token = data.access_token
    } catch {
      // exchange failed — fall back to the user token
    }
  }

  try {
    const res = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`)
    const data = (await res.json()) as { access_token?: string }
    if (res.ok && data.access_token) token = data.access_token
  } catch {
    // no page token — use whatever we have
  }

  // Long-lived tokens last ~60 days; re-resolve well before that.
  fbPageToken = { value: token, seed: userToken, expiresAt: Date.now() + 30 * 60 * 1000 }
  return token
}

// ─── Path safety ──────────────────────────────────────────────────────────────
// `path` is caller-supplied, so make sure it cannot escape the provider's origin
// (protocol-relative URLs, traversal, or an absolute URL would all be SSRF).

function buildUrl(provider: ProviderKey, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('path must be origin-relative')
  }
  if (path.includes('..') || path.includes('\\')) {
    throw new Error('path contains illegal segments')
  }

  const base = BASES[provider]
  const url = new URL(base + path)
  if (url.origin !== new URL(base).origin) {
    throw new Error('path escapes the provider origin')
  }
  return url
}

/** Recursively strips any access_token field so a token can never reach the client. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'access_token') continue
      out[k] = scrub(v)
    }
    return out
  }
  return value
}

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await requireStaff(req)
  } catch (e) {
    return res.status(401).json({ error: e instanceof Error ? e.message : 'Unauthorized' })
  }

  if (req.query.action === 'status') {
    return res.status(200).json(statusPayload())
  }

  const provider = String(req.query.provider ?? '') as ProviderKey
  const path = String(req.query.path ?? '')

  if (!(provider in BASES)) return res.status(400).json({ error: 'Unknown provider' })
  if (!path) return res.status(400).json({ error: 'Missing path' })

  let url: URL
  try {
    url = buildUrl(provider, path)
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid path' })
  }

  const headers: Record<string, string> = {}

  try {
    if (provider === 'youtube') {
      if (!YT_KEY()) return res.status(400).json({ error: 'YouTube is not configured' })
      url.searchParams.set('key', YT_KEY())
    } else if (provider === 'instagram') {
      if (!IG_TOKEN()) return res.status(400).json({ error: 'Instagram is not configured' })
      url.searchParams.set('access_token', IG_TOKEN())
    } else if (provider === 'facebook') {
      url.searchParams.set('access_token', await facebookPageToken())
    } else {
      if (!LI_TOKEN()) return res.status(400).json({ error: 'LinkedIn is not configured' })
      headers.Authorization = `Bearer ${LI_TOKEN()}`
      headers['LinkedIn-Version'] = LI_VERSION()
      headers['X-Restli-Protocol-Version'] = '2.0.0'
    }

    const upstream = await fetch(url.toString(), { headers, cache: 'no-store' })
    const data = await upstream.json().catch(() => ({}))

    // Pass the provider's status through so callers can distinguish "not found"
    // from "rate limited", but never leak the outbound URL (it holds the token).
    return res.status(upstream.status).json(scrub(data))
  } catch (e) {
    console.error(`social-proxy ${provider} failed:`, e)
    return res.status(502).json({ error: `Upstream ${provider} request failed` })
  }
}
