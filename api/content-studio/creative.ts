/**
 * Reference lookup and script/caption writing for Content Studio.
 *
 * Runs on the server for two reasons. The Groq key stays out of the browser
 * bundle — on a paid plan an extracted key is somebody spending the user's
 * money. And Instagram's oEmbed endpoint has no CORS headers, so a browser
 * cannot call it at all.
 *
 * Three actions on one route: looking a reference up, writing a script from it,
 * and writing captions. They share the model call and the error handling, and
 * splitting them would triple the deploy surface for no gain.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Vision-capable by default; override if the model name moves on. */
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile'

function groqKey(): string {
  // The VITE_ copy is what the project has today. Set GROQ_API_KEY in Vercel and
  // the browser one can be deleted — this reads either.
  const key = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!key) throw new Error('No Groq key on the server. Add GROQ_API_KEY in Vercel → Settings → Environment Variables.')
  return key
}

interface ChatContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

async function groq(model: string, system: string, content: string | ChatContent[], maxTokens = 900): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content ?? '').trim()
}

// ─── Reference lookup ─────────────────────────────────────────────────────────

interface Reference {
  author: string
  thumbnail: string
  caption: string
  provider: string
}

/**
 * oEmbed matches on the canonical post URL and returns nothing for anything
 * else — a share link carrying ?igsh=… , a missing trailing slash, or the
 * mobile host are all enough to come back empty. Posts (/p/), reels (/reel/ and
 * /reels/) and IGTV (/tv/) all resolve the same way.
 */
function canonicalInstagramUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
    if (!m) return raw.trim()
    const kind = m[1] === 'reels' ? 'reel' : m[1]
    return `https://www.instagram.com/${kind}/${m[2]}/`
  } catch {
    return raw.trim()
  }
}

/**
 * Instagram's official route. Needs an app id and secret, which this project
 * already has for the Graph sync — no new credential, no scraping, and nothing
 * that risks the account.
 */
async function instagramOEmbed(url: string): Promise<Reference | null> {
  const appId = process.env.VITE_FB_APP_ID || process.env.FB_APP_ID
  const appSecret = process.env.VITE_FB_APP_SECRET || process.env.FB_APP_SECRET
  if (!appId || !appSecret) return null

  const endpoint = `${GRAPH}/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true&fields=author_name,thumbnail_url,title&access_token=${appId}|${appSecret}`
  const res = await fetch(endpoint)
  if (!res.ok) {
    // The message says whether the app lacks oEmbed Read or the post is simply
    // private, and guessing between those wastes an afternoon.
    console.error('instagram_oembed failed:', res.status, (await res.text()).slice(0, 300))
    return null
  }
  const j = await res.json()
  if (!j?.thumbnail_url && !j?.title) return null
  return {
    author: j.author_name || '',
    thumbnail: j.thumbnail_url || '',
    caption: j.title || '',
    provider: 'Instagram',
  }
}

/**
 * Last resort: read the page's own preview tags. Instagram serves these to
 * link-preview crawlers, so it works often enough to be worth trying, and
 * costs nothing when it doesn't.
 */
async function openGraphTags(url: string): Promise<Reference | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } })
  if (!res.ok) return null
  const html = await res.text()
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ?? ''
  const thumbnail = meta('image')
  const caption = meta('description')
  if (!thumbnail && !caption) return null
  return {
    author: meta('title').split(' on ')[0] || '',
    thumbnail,
    caption: caption.replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    provider: url.includes('youtu') ? 'YouTube' : url.includes('facebook') ? 'Facebook' : 'Instagram',
  }
}

const ANALYST = `You are a short-form video strategist for an Indian home-automation brand.
Given a reference post's cover image and caption, describe in 2-3 short sentences what the video appears to be: the hook style, the format, and how it likely ends.
Be concrete about what you can actually see. Never invent view counts, dates or dialogue.`

async function analyseReference(ref: Reference): Promise<string> {
  const brief = `Caption: ${ref.caption || '(none)'}\nAuthor: ${ref.author || '(unknown)'}\nPlatform: ${ref.provider}`
  if (ref.thumbnail) {
    try {
      return await groq(VISION_MODEL, ANALYST, [
        { type: 'text', text: `Describe this reference post.\n${brief}` },
        { type: 'image_url', image_url: { url: ref.thumbnail } },
      ], 400)
    } catch {
      // Vision models get renamed and retired. Falling back to the caption is
      // worse than seeing the cover, but far better than an error.
    }
  }
  return groq(TEXT_MODEL, ANALYST, `Only the caption is available — do not describe imagery.\n${brief}`, 400)
}

// ─── Writing ──────────────────────────────────────────────────────────────────

const SCRIPT_SYSTEM = `You write short-form video scripts for Galaxy Home Automation, an Indian smart-home company.
Return ONLY valid JSON: {"hook":"...","body":"...","cta":"..."}
hook: one line, under 12 words, earns the first 3 seconds.
body: 2-3 sentences a presenter can say in about 20 seconds. Concrete benefits, no jargon.
cta: one line asking for a comment or DM.
Indian English. No emoji in the script. No markdown, no commentary outside the JSON.`

const CAPTION_SYSTEM = `You write Instagram captions for Galaxy Home Automation, an Indian smart-home company.
Study the example captions and match their voice, length and emoji habits.
Return ONLY a JSON array of 3 caption strings. Each ends with 2-4 relevant hashtags.
No markdown, no numbering, no commentary outside the array.`

/** Models wrap JSON in prose or fences no matter how firmly they are told not to. */
function extractJson<T>(raw: string, opener: '{' | '['): T | null {
  const closer = opener === '{' ? '}' : ']'
  const start = raw.indexOf(opener)
  const end = raw.lastIndexOf(closer)
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

interface Req { method?: string; body?: unknown }
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, string>
  const action = String(body.action || '')

  try {
    if (action === 'analyse') {
      const raw = String(body.url || '').trim()
      if (!/^https?:\/\//i.test(raw)) { res.status(400).json({ error: 'Paste a full post link starting with https://' }); return }
      const url = canonicalInstagramUrl(raw)

      // Both routes are tried whatever the outcome of the first: oEmbed often
      // returns the caption but no cover, and the page's own preview tags
      // usually have the cover. Between them there is normally a full picture.
      const viaOEmbed = await instagramOEmbed(url).catch(() => null)
      const viaTags = viaOEmbed?.thumbnail ? null : await openGraphTags(url).catch(() => null)
      const ref: Reference | null = viaOEmbed || viaTags
        ? {
            author: viaOEmbed?.author || viaTags?.author || '',
            thumbnail: viaOEmbed?.thumbnail || viaTags?.thumbnail || '',
            caption: viaOEmbed?.caption || viaTags?.caption || '',
            provider: viaOEmbed?.provider || viaTags?.provider || 'Instagram',
          }
        : null

      if (!ref) {
        res.status(422).json({
          error: 'Could not read that post. It may be private or deleted — or the Facebook app may not have oEmbed Read enabled.',
        })
        return
      }
      const analysis = await analyseReference(ref).catch(() => '')
      res.status(200).json({ ...ref, analysis })
      return
    }

    if (action === 'script') {
      const raw = await groq(TEXT_MODEL, SCRIPT_SYSTEM, [
        `Topic: ${body.title || 'Smart home product'}`,
        `Platform: ${body.platform || 'Instagram'}`,
        body.analysis ? `What the reference video does: ${body.analysis}` : '',
        body.caption ? `Reference caption: ${body.caption}` : '',
        'Write a script for OUR product on this topic. Do not copy the reference — match its energy.',
      ].filter(Boolean).join('\n'))

      const parsed = extractJson<{ hook: string; body: string; cta: string }>(raw, '{')
      if (!parsed) { res.status(502).json({ error: 'The model did not return a usable script. Try again.' }); return }
      res.status(200).json({ hook: parsed.hook ?? '', body: parsed.body ?? '', cta: parsed.cta ?? '' })
      return
    }

    if (action === 'captions') {
      const raw = await groq(TEXT_MODEL, CAPTION_SYSTEM, [
        `Topic: ${body.title || ''}`,
        body.examples ? `Example captions to match:\n${body.examples}` : 'No examples given — keep it short and warm.',
        body.hook ? `The video opens with: ${body.hook}` : '',
        body.cta ? `The video ends with: ${body.cta}` : '',
      ].filter(Boolean).join('\n'))

      const parsed = extractJson<string[]>(raw, '[')
      if (!parsed?.length) { res.status(502).json({ error: 'The model did not return usable captions. Try again.' }); return }
      res.status(200).json({ captions: parsed.filter(c => typeof c === 'string').slice(0, 5) })
      return
    }

    res.status(400).json({ error: `Unknown action "${action}"` })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
