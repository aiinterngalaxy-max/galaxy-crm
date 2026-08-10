/**
 * Serves a reference post's cover image through our own domain.
 *
 * Instagram's CDN inspects the Referer and serves nothing to a page it doesn't
 * recognise, so an <img src> pointing straight at scontent.cdninstagram.com
 * shows an empty box even though the URL is perfectly valid. Fetching it
 * server-side has no Referer problem, and the browser only ever sees our own
 * origin.
 *
 * Deliberately not a general proxy: it will only fetch from the CDNs those
 * covers actually live on. An image proxy that fetches any URL a caller names
 * is an SSRF hole and a bandwidth bill.
 */

const ALLOWED_HOSTS = [
  'cdninstagram.com',
  'fbcdn.net',
  'ytimg.com',
  'ggpht.com',
  'licdn.com',
]

function allowed(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return null
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u : null
  } catch {
    return null
  }
}

interface Req { query?: Record<string, string | string[] | undefined> }
interface Res {
  status: (code: number) => Res
  setHeader: (name: string, value: string) => void
  send: (body: unknown) => void
}

export default async function handler(req: Req, res: Res) {
  const raw = Array.isArray(req.query?.u) ? req.query?.u[0] : req.query?.u
  const url = allowed(String(raw ?? ''))
  if (!url) { res.status(400).send('Not an allowed image host'); return }

  try {
    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GalaxyCRM/1.0)' },
    })
    if (!upstream.ok) { res.status(502).send(`Upstream ${upstream.status}`); return }

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    // These URLs are signed and expire, so a long cache would serve broken
    // images later. An hour covers a working session and no more.
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).send(err instanceof Error ? err.message : 'Fetch failed')
  }
}
