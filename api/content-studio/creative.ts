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
/** Groq's own compound system — it decides on its own when to run a real web
 * search (via Tavily) before answering. The "-mini" variant does at most one
 * search per call, which is all a single trend lookup needs, and is faster
 * and cheaper than the full compound model. */
const RESEARCH_MODEL = process.env.GROQ_RESEARCH_MODEL || 'groq/compound-mini'

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
 * The page source has these HTML-escaped (content lives inside a `content="…"`
 * attribute). Left alone, the thumbnail URL still had `&amp;` in place of `&`
 * between its query params — which Instagram's CDN then rejects as a bad
 * signature, so fetchAsDataUrl() silently got nothing and every reel fell
 * back to guessing from the caption alone, never actually seeing the frame.
 * Captions carry the same damage: numeric refs like `&#xe9;` or `&#x1f621;`
 * (an accented letter, an emoji) went into the model as literal text instead
 * of the character they encode.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
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
  const thumbnail = decodeHtmlEntities(meta('image'))
  const caption = decodeHtmlEntities(meta('description'))
  if (!thumbnail && !caption) return null
  return {
    author: decodeHtmlEntities(meta('title')).split(' on ')[0] || '',
    thumbnail,
    caption,
    provider: url.includes('youtu') ? 'YouTube' : url.includes('facebook') ? 'Facebook' : 'Instagram',
  }
}

const ANALYST = `You are a short-form video strategist.
Describe the reference post in 3 short lines, labelled exactly:
SUBJECT: what the video is actually about, in a few words.
HOOK: how it opens and why that earns attention.
FORMAT: the style — talking head, demo, POV skit, dance/trend, before-after, text-on-screen — and how it likely ends.
Be concrete about what you can see. Never invent view counts, dates or dialogue.`

/**
 * The cover is downloaded here and passed as data, not as a link.
 *
 * Instagram's CDN serves nothing to a fetcher whose Referer it doesn't
 * recognise, and the model's own fetcher is no exception — handing it the URL
 * meant it silently saw no image and wrote a guess from the caption instead,
 * which reads plausible and is exactly the failure that is hard to notice.
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GalaxyCRM/1.0)' } })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    // Well past any cover, and short of the model's per-request ceiling.
    if (buf.byteLength > 4_000_000) return null
    const mime = r.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function analyseReference(ref: Reference): Promise<string> {
  const brief = `Caption: ${ref.caption || '(none)'}\nAuthor: ${ref.author || '(unknown)'}\nPlatform: ${ref.provider}`

  if (ref.thumbnail) {
    const dataUrl = await fetchAsDataUrl(ref.thumbnail)
    if (dataUrl) {
      try {
        return await groq(VISION_MODEL, ANALYST, [
          { type: 'text', text: `Describe this reference post.\n${brief}` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ], 400)
      } catch (err) {
        // Vision model names get retired; the caption is a worse but working
        // fallback. Logged so a rename does not silently degrade every script.
        console.error('vision analysis failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return groq(TEXT_MODEL, ANALYST, `Only the caption is available — do not describe imagery.\n${brief}`, 400)
}

const RESEARCHER = `You are a short-form video trend researcher with live web search.
Search the web for what is CURRENTLY trending in short-form video (Instagram Reels, TikTok, YouTube Shorts) in the given niche — real posts, articles or roundups about viral formats in that space, not general advice.

Return 3-5 short lines, each one a CONCRETE hook or format pattern you found other creators actually using right now in this niche — e.g. "POV skit where the payoff is the product doing something unexpected" or "before/after with a 1-second transition on a loud sound cue". Not generic tips like "use humor" or "hook them early".

If the search turns up nothing specific to this niche, say plainly "No current trend data found for this niche" — never invent examples to fill the list.`

/**
 * One reference post is one data point. The brief was for the AI to go find
 * what ELSE is working in this niche right now — via a real web search, not
 * a guess — so the script is built from a pattern several creators are
 * currently using, not a clone of the single link that was pasted.
 *
 * Runs on Groq's own compound system, which decides for itself whether and
 * when to search rather than being handed a fixed query. Failures here must
 * never break Analyse — a working single-reference analysis with no trend
 * context is strictly better than the whole step failing.
 */
async function researchTrends(topic: string, ref: Reference): Promise<string> {
  const seed = [
    topic ? `Product/topic: ${topic}` : '',
    ref.caption ? `A reference post's caption, for the niche: ${ref.caption}` : '',
  ].filter(Boolean).join('\n')
  if (!seed) return ''
  try {
    return await groq(RESEARCH_MODEL, RESEARCHER, `${seed}\n\nWhat's trending in short-form video for this niche right now?`, 500)
  } catch (err) {
    console.error('trend research failed:', err instanceof Error ? err.message : err)
    return ''
  }
}

// ─── Writing ──────────────────────────────────────────────────────────────────

const SCRIPT_SYSTEM = `You write short-form video scripts for Galaxy Home Automation, an Indian smart-home company.

A REFERENCE is a template to copy the STRUCTURE of. If a list of what's currently trending in the niche is also given, you are not limited to the single reference — pick whichever pattern (the reference, or one of the trending ones) is the strongest fit for our product, and copy that one's structure instead. Say in your own head which one you picked; don't blend two different hook styles into one script. All three parts follow whichever pattern was picked, not just the hook:

HOOK — open the same WAY the reference opens. Question, mid-action, POV line, comedy setup, trend. Under 12 words.

BODY — continue the hook you just wrote. If the hook set up a joke, the body plays the joke out with our product in it. If it set up a scene, stay in that scene. Keep the reference's pacing: a fast comedy reel gets short clipped lines, not paragraphs. 2-3 sentences, about 20 seconds spoken. Name specific things — a fan, a lock, a light, a voice command — never "your appliances" or "your space".

CTA — end the way the reference ends. Comedy ends on a punchline that also asks something. A demo ends on a reveal. Never a survey question.

BANNED in every part, not just the hook. These are advert copy, not scripts:
"Imagine walking into…", "Imagine coming home…", "Experience the…", "Transform your…", "Smart homes made easy", "the future of living", "your own personal assistant", "with just your voice" as a closing flourish.
If the sentence would fit on a brochure, rewrite it as something a person would actually say to camera.

The topic stays ours. A comedy clip about a prank becomes a comedy clip about a prank involving our product.

Return ONLY valid JSON: {"hook":"...","body":"...","cta":"..."}
Indian English. No emoji in the script. No markdown, no commentary outside the JSON.`

/**
 * The long structured "explainer" format — a full presenter script for a
 * product deep-dive video, not a short reel. Structure is fixed (this is
 * what the team already shoots from); only the product/topic and which
 * feature gets the spotlight first varies. Two full calls, not one JSON
 * blob asking for both languages at once — a ~2000-word script is already
 * pushing the model's ability to close its own JSON string correctly, and
 * this is filmed verbatim, so a truncated or malformed response is worse
 * than the extra round trip.
 */
const EXPLAINER_STRUCTURE = `Structure, in this exact order:

1. A top heading: "# 🎬 Galaxy Home Automation – Premium [Product] Video Script"
2. "### INTRODUCTION" — 2 short spoken lines in bold, each on its own line wrapped in quotes. First line names the everyday problem in general terms, second introduces Galaxy's product as the upgrade.
3. Then 10-14 numbered sections ("## 1. SECTION NAME", "## 2. ...", separated by "---"), each opening with one bold spoken transition line, then plain narration paragraphs and/or a bullet list of **Bold Feature Name** – explanation lines, covering (adapt these to the actual product, don't force door-lock specifics onto an unrelated product): what it does / access or control methods, how the system works end to end, one standout technology feature, app/remote connectivity, sharing or guest/family access, safety or backup provisions, power source, physical build quality, design, which spaces it suits (homes, villas, offices, etc.), and a closing "why upgrade" summary section.
4. A final "# CLOSING – GALAXY HOME AUTOMATION" section: 3-4 bold spoken brand lines ending on the tagline "Galaxy Home Automation — Smart Living. Secure Living."

Never invent exact numeric specs — battery mAh, certifications, model/grade numbers — unless they're given to you in the input. Describe the capability in general terms instead ("a high-capacity rechargeable battery", not a fabricated number). This is filmed and said on camera as fact; a wrong spec is a real product claim, not a creative flourish.

If a reference post or trend research is given, use it only to shape the INTRODUCTION's opening line and which section leads first — the section structure itself does not change.`

const EXPLAINER_SYSTEM_EN = `You write long-form presenter video scripts for Galaxy Home Automation, an Indian smart-home company. This is a full product walkthrough for someone close to buying, not a short reel — depth and completeness are the point.

${EXPLAINER_STRUCTURE}

Write in natural spoken English, the way a presenter actually talks to camera — not brochure copy. Markdown output: headings, bold, bullet lists, "---" dividers, exactly like a script document meant to be read from.`

const EXPLAINER_SYSTEM_HI = `You write long-form presenter video scripts for Galaxy Home Automation, an Indian smart-home company. This is a full product walkthrough for someone close to buying, not a short reel — depth and completeness are the point.

${EXPLAINER_STRUCTURE}

Write in Hinglish — natural Hindi narration transliterated in Roman script, mixed with English for technical and product terms, exactly the way an Indian presenter actually speaks on camera. Match this register precisely:
"Aaj ke modern home mein security sirf ek strong door tak limited nahi hai. Aaj security smart, convenient aur intelligent honi chahiye."
"Galaxy Home Automation lekar aaya hai premium [Product] — ek advanced solution jo aapke ghar ko technology, safety aur convenience ke saath upgrade karta hai."
Markdown output: headings, bold, bullet lists, "---" dividers, exactly like a script document meant to be read from.`

const CAPTION_SYSTEM = `You write Instagram captions for Galaxy Home Automation, an Indian smart-home company.

The examples are the format, and you copy it rather than improve on it:
- Match their LENGTH. If the examples are a few words or only hashtags, yours are a few words or only hashtags. Never answer a two-word example with two lines of brochure copy.
- Match their EMOJI COUNT. No emoji in the examples means no emoji in yours.
- Match their HASHTAG STYLE — how many, and whether they are niche or broad.
- Match their TONE. Jokey examples get jokes, not product benefits.

The caption is about the video that was written, so refer to what actually happens in it.

BANNED, whatever the examples say: "Experience the…", "Transform your…", "the future of living", "where technology meets…", "smart haven", "innovative solutions". Those are advertising, and no one writes them on their own posts.

Return ONLY a JSON array of 3 caption strings. No markdown, no numbering, no commentary outside the array.`

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
      // The single-post analysis and the wider trend search are independent —
      // run them together so asking "what else is trending here" doesn't add
      // its own sequential round trip on top of an already-slow vision call.
      const [analysis, trends] = await Promise.all([
        analyseReference(ref).catch(() => ''),
        researchTrends(String(body.title || ''), ref).catch(() => ''),
      ])
      res.status(200).json({ ...ref, analysis, trends })
      return
    }

    if (action === 'script' && body.format === 'explainer') {
      const brief = [
        `Product/topic: ${body.title || 'Smart home product'}`,
        body.analysis ? `Reference post for the opening angle:\n${body.analysis}` : '',
        body.caption ? `Its caption: ${body.caption}` : '',
        body.trends ? `What's trending in this niche right now:\n${body.trends}` : '',
      ].filter(Boolean).join('\n')

      const [en, hi] = await Promise.all([
        groq(TEXT_MODEL, EXPLAINER_SYSTEM_EN, brief, 3000),
        groq(TEXT_MODEL, EXPLAINER_SYSTEM_HI, brief, 3000),
      ])
      if (!en.trim() && !hi.trim()) { res.status(502).json({ error: 'The model did not return a usable script. Try again.' }); return }
      res.status(200).json({ format: 'explainer', script_full_en: en, script_full_hi: hi })
      return
    }

    if (action === 'script') {
      const hasReference = !!(body.analysis || body.caption)
      const hasTrends = !!body.trends
      const raw = await groq(TEXT_MODEL, SCRIPT_SYSTEM, [
        `Topic: ${body.title || 'Smart home product'}`,
        `Platform: ${body.platform || 'Instagram'}`,
        hasReference ? '\nREFERENCE — copy this structure:' : '',
        body.analysis ? body.analysis : '',
        body.caption ? `Its caption: ${body.caption}` : '',
        body.author ? `Its author: ${body.author}` : '',
        hasTrends ? `\nWhat else is trending in this niche right now — use whichever of these is the strongest fit, not necessarily the single reference above:\n${body.trends}` : '',
        hasReference
          ? '\nNow write OUR version on the topic above, following that reference\'s hook style, pacing and ending. The hook must be recognisably the same kind of opening as the reference — not a slogan.'
          : '\nThere is no reference. Write a strong scroll-stopping hook anyway — a question, a claim or a POV line, never a slogan.',
      ].filter(Boolean).join('\n'))

      const parsed = extractJson<{ hook: string; body: string; cta: string }>(raw, '{')
      if (!parsed) { res.status(502).json({ error: 'The model did not return a usable script. Try again.' }); return }
      res.status(200).json({ hook: parsed.hook ?? '', body: parsed.body ?? '', cta: parsed.cta ?? '' })
      return
    }

    if (action === 'captions') {
      const examples = String(body.examples || '').trim()
      const raw = await groq(TEXT_MODEL, CAPTION_SYSTEM, [
        `Topic: ${body.title || ''}`,
        examples
          // Spelled out because the model reads a short example as a hint to be
          // brief and then writes three lines anyway.
          ? `EXAMPLES — copy this length and style exactly:\n${examples}\n\nThe longest example is ${Math.max(...examples.split('\n').map(l => l.trim().length))} characters. Yours must be about that long, not longer.`
          : 'No examples given — keep them short, human and specific.',
        body.analysis ? `The reference video this is modelled on:\n${body.analysis}` : '',
        body.trends ? `What's trending in this niche right now:\n${body.trends}` : '',
        body.hook ? `Our video opens with: ${body.hook}` : '',
        body.scriptBody ? `Then: ${body.scriptBody}` : '',
        body.cta ? `And ends with: ${body.cta}` : '',
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
