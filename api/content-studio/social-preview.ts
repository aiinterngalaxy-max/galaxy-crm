/**
 * getSocialPreview(url) — a real cover image + title/description for a
 * pasted social/video link, used by the Video Studio "Reference Link"
 * field. Self-contained (no imports from sibling api/ files) for the same
 * reason video-plan.ts is: Vercel treats each file under api/ as its own
 * serverless function, and importing one handler from another has broken
 * the function outright in this project before (FUNCTION_INVOCATION_FAILED).
 *
 * Fallback order per platform, in priority:
 *   Instagram — official oEmbed (Meta Graph API, reuses this project's
 *               existing FB_APP_ID/FB_APP_SECRET — no new credential) →
 *               og:image → twitter:image → none.
 *   YouTube   — YouTube's own official oEmbed (public, no API key needed) →
 *               og:image → twitter:image → none.
 *   Everything else — og:image → twitter:image → none.
 *
 * Never bypasses login, CAPTCHAs, rate limits, or bot-detection — when a
 * platform blocks plain HTTP access entirely (Instagram/TikTok reels
 * without oEmbed access, e.g. a private post), this returns a clean
 * "no image available" result rather than trying to work around the block.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type SocialPlatform = 'instagram' | 'youtube' | 'tiktok' | 'facebook' | 'twitter' | 'linkedin' | 'generic'
export type SocialPreviewType = 'reel' | 'post' | 'video' | 'short' | 'profile' | 'link'

export interface SocialPreview {
  platform: SocialPlatform
  title: string
  description: string
  image: string
  url: string
  type: SocialPreviewType
  /** Set only when the image genuinely couldn't be found, with the SPECIFIC
   *  reason — never a generic "something went wrong". Not a secret leak: it
   *  states whether a credential is configured, never its value. */
  note?: string
}

interface NormalizedUrl {
  platform: SocialPlatform
  type: SocialPreviewType
  url: string
}

/**
 * Detects platform and produces a canonical URL for it — stripping tracking
 * params (igsh, si, utm_*, feature, etc.) without changing what content the
 * URL actually points at. Two links to the same reel/video normalize to the
 * same canonical form regardless of which tracking params they arrived with.
 */
export function normalizeSocialUrl(raw: string): NormalizedUrl {
  const trimmed = raw.trim()
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { platform: 'generic', type: 'link', url: trimmed }
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '')

  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') {
    const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
    if (m) {
      const kind = m[1] === 'reels' ? 'reel' : (m[1] as 'p' | 'reel' | 'tv')
      const type: SocialPreviewType = kind === 'p' ? 'post' : kind === 'tv' ? 'video' : 'reel'
      return { platform: 'instagram', type, url: `https://www.instagram.com/${kind}/${m[2]}/` }
    }
    // No /p|reel|tv/ segment — a bare profile URL (e.g. instagram.com/someone).
    const profile = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0]
    return {
      platform: 'instagram',
      type: 'profile',
      url: profile ? `https://www.instagram.com/${profile}/` : trimmed,
    }
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const shorts = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/)
    if (shorts) return { platform: 'youtube', type: 'short', url: `https://www.youtube.com/shorts/${shorts[1]}` }
    const id = u.searchParams.get('v')
    if (id) return { platform: 'youtube', type: 'video', url: `https://www.youtube.com/watch?v=${id}` }
    return { platform: 'youtube', type: 'video', url: trimmed }
  }
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\//, '').split('/')[0]
    return { platform: 'youtube', type: 'video', url: id ? `https://www.youtube.com/watch?v=${id}` : trimmed }
  }

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    return { platform: 'tiktok', type: 'video', url: `${u.origin}${u.pathname}` }
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') {
    return { platform: 'facebook', type: 'video', url: `${u.origin}${u.pathname}` }
  }
  if (host === 'twitter.com' || host === 'x.com') {
    return { platform: 'twitter', type: 'post', url: `${u.origin}${u.pathname}` }
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    return { platform: 'linkedin', type: 'post', url: `${u.origin}${u.pathname}` }
  }

  return { platform: 'generic', type: 'link', url: `${u.origin}${u.pathname}` }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

interface ScrapedTags { title: string; description: string; image: string }

/** Reads a page's own og:/twitter: preview tags — item 2-4 of the fallback
 *  chain. Never throws; a page that can't be read just yields empty tags. */
async function scrapeTags(url: string): Promise<ScrapedTags> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GalaxyCRM/1.0; +https://galaxy-home-automation-crm.vercel.app)' },
    })
    if (!res.ok) return { title: '', description: '', image: '' }
    const html = await res.text()
    const meta = (prefix: string, prop: string) =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prefix}:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prefix}:${prop}["']`, 'i'))?.[1]
      ?? ''
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ''
    const og = { title: meta('og', 'title'), description: meta('og', 'description'), image: meta('og', 'image') }
    const twitter = { title: meta('twitter', 'title'), description: meta('twitter', 'description'), image: meta('twitter', 'image') }
    return {
      title: decodeHtmlEntities(og.title || twitter.title || titleTag),
      description: decodeHtmlEntities(og.description || twitter.description),
      image: decodeHtmlEntities(og.image || twitter.image),
    }
  } catch (err) {
    console.error(`scrapeTags failed for ${url}:`, err instanceof Error ? err.message : err)
    return { title: '', description: '', image: '' }
  }
}

/** Instagram's official route — needs an app id/secret, which this project
 *  already has for the existing Facebook Graph sync. No scraping, nothing
 *  that touches login or bot-detection. Returns null (never throws) on
 *  anything short of success, so the caller can fall through to og:image. */
async function instagramOEmbed(url: string): Promise<ScrapedTags | null> {
  const appId = process.env.VITE_FB_APP_ID || process.env.FB_APP_ID
  const appSecret = process.env.VITE_FB_APP_SECRET || process.env.FB_APP_SECRET
  if (!appId || !appSecret) return null
  try {
    const endpoint = `${GRAPH}/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true&fields=author_name,thumbnail_url,title&access_token=${appId}|${appSecret}`
    const res = await fetch(endpoint)
    if (!res.ok) {
      console.error('instagram_oembed failed:', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const j = await res.json()
    if (!j?.thumbnail_url && !j?.title) return null
    return { title: j.author_name || '', description: j.title || '', image: j.thumbnail_url || '' }
  } catch (err) {
    console.error('instagram_oembed threw:', err instanceof Error ? err.message : err)
    return null
  }
}

/** YouTube's own official oEmbed — public, needs no API key at all, and is
 *  the documented sanctioned way to get a video's title/thumbnail from a
 *  URL (as opposed to scraping youtube.com's HTML). */
async function youtubeOEmbed(url: string): Promise<ScrapedTags | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const j = await res.json()
    if (!j?.thumbnail_url && !j?.title) return null
    return { title: j.title || '', description: j.author_name ? `by ${j.author_name}` : '', image: j.thumbnail_url || '' }
  } catch (err) {
    console.error('youtube oembed threw:', err instanceof Error ? err.message : err)
    return null
  }
}

// Platforms known to serve a content-free, login-walled shell to any plain
// HTTP request — verified directly (a fetch to a live instagram.com/reel/…
// URL returns <title>Instagram</title> with zero real tags, no matter the
// User-Agent). Not something to route around; oEmbed is the one legitimate
// door for Instagram, tried first above regardless of this list.
const SCRAPE_BLOCKED_HOSTS = ['instagram.com', 'tiktok.com']

function isScrapeBlocked(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return SCRAPE_BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export async function getSocialPreview(rawUrl: string): Promise<SocialPreview> {
  if (!/^https?:\/\//i.test(rawUrl.trim())) throw new Error('Paste a full link starting with https://')
  const { platform, type, url } = normalizeSocialUrl(rawUrl)

  let tags: ScrapedTags | null = null

  let note: string | undefined

  if (platform === 'instagram') {
    const hasCreds = !!((process.env.VITE_FB_APP_ID || process.env.FB_APP_ID) && (process.env.VITE_FB_APP_SECRET || process.env.FB_APP_SECRET))
    tags = await instagramOEmbed(url)
    if (!tags?.image && !isScrapeBlocked(url)) tags = { ...(tags ?? { title: '', description: '', image: '' }), ...(await scrapeTags(url)) }
    if (!tags?.image) {
      note = hasCreds
        ? 'Instagram oEmbed did not return a cover for this link — the post may be private, or this app may not have oEmbed access approved for public content yet. Try uploading a screenshot instead.'
        : 'FB_APP_ID/FB_APP_SECRET are not configured on the server, so Instagram\'s official preview API can\'t be used yet — add them in Vercel → Settings → Environment Variables, or upload a screenshot instead.'
    }
  } else if (platform === 'youtube') {
    tags = await youtubeOEmbed(url)
    if (!tags?.image) tags = await scrapeTags(url)
    if (!tags?.image) note = "Couldn't find a cover image for that video."
  } else if (!isScrapeBlocked(url)) {
    tags = await scrapeTags(url)
    if (!tags?.image) note = "That page doesn't expose a public preview image."
  } else {
    note = "This platform blocks automated preview requests — there's no cover image to show for this link."
  }

  return {
    platform,
    type,
    url,
    title: tags?.title || '',
    description: tags?.description || '',
    image: tags?.image || '',
    ...(note ? { note } : {}),
  }
}

interface Req { method?: string; body?: unknown }
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  try {
    res.status(200).json(await getSocialPreview(String(body.url || '').trim()))
  } catch (err) {
    console.error('getSocialPreview failed:', err instanceof Error ? err.message : err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
