/**
 * The AI half of the Video Studio auto-edit flow: turning a referral/app link
 * and the raw footage into a structured editing plan.
 *
 * Three actions, same reasons as creative.ts: the Groq key stays server-side,
 * and Groq's Whisper endpoint has to be called from a server anyway (it wants
 * a real API key on every request, never one sitting in the browser bundle).
 *
 *   analyzeLink  — fetch the app/referral URL, read its own preview tags plus
 *                  a vision pass over its cover image, return structured
 *                  product info (name, features, benefits, CTA, colors).
 *   transcribe   — send an extracted audio track to Groq's Whisper endpoint,
 *                  return the real transcript with timestamps.
 *   plan         — combine link info + transcript + silence map + duration
 *                  into a timeline plan an editor (human or the auto-edit
 *                  step) can follow.
 *
 * What this does NOT do: none of these calls touch the video file itself.
 * The plan is a recommendation — burning captions/branding/CTA into the
 * actual export is a separate, not-yet-built step. Preview/Approve here
 * approves the PLAN, not a rendered video with those elements baked in.
 */
// Deliberately self-contained rather than importing from ./creative — each
// file under api/ is its own Vercel serverless function, and having one
// import the other broke the function entirely (FUNCTION_INVOCATION_FAILED,
// not even a caught error) rather than just duplicating a couple hundred
// lines of Groq plumbing.

const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile'
const TEXT_MODEL_CHAIN = [TEXT_MODEL, 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'].filter(
  (m, i, arr) => arr.indexOf(m) === i,
)

function groqKey(): string {
  const key = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!key) throw new Error('No Groq key on the server. Add GROQ_API_KEY in Vercel → Settings → Environment Variables.')
  return key
}

interface ChatContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

class GroqError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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
  if (!res.ok) throw new GroqError(res.status, `Groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content ?? '').trim()
}

async function groqChain(chain: string[], system: string, content: string | ChatContent[], maxTokens = 900): Promise<string> {
  let lastErr: unknown
  for (const model of chain) {
    try {
      return await groq(model, system, content, maxTokens)
    } catch (err) {
      lastErr = err
      if (err instanceof GroqError && err.status === 429) continue
      throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All fallback models are rate-limited. Try again shortly.')
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

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GalaxyCRM/1.0)' } })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.byteLength > 4_000_000) return null
    const mime = r.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

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

// ─── analyzeLink ────────────────────────────────────────────────────────────

interface PageMeta {
  title: string
  description: string
  image: string
  siteName: string
}

async function fetchPageMeta(url: string): Promise<PageMeta> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GalaxyCRM/1.0; +https://galaxy-home-automation-crm.vercel.app)' },
  })
  if (!res.ok) throw new Error(`Could not open that link (HTTP ${res.status}). Check it's public and starts with https://`)
  const html = await res.text()
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${prop}["']`, 'i'))?.[1]
    ?? ''
  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ''
  return {
    title: decodeHtmlEntities(meta('title') || titleTag),
    description: decodeHtmlEntities(meta('description')),
    image: decodeHtmlEntities(meta('image')),
    siteName: decodeHtmlEntities(meta('site_name')),
  }
}

const LINK_ANALYST = `You analyze an app/product's own web page for someone about to make a short promotional video about it.

Read the page title, description and (if given) a screenshot of the page, and return ONLY valid JSON with this exact shape:
{
  "appName": "the product/app's actual name",
  "tagline": "its own one-line pitch, from the page — not invented",
  "features": ["3-6 concrete features actually mentioned or shown"],
  "benefits": ["2-4 outcomes/benefits for the user, only if actually implied by the page"],
  "cta": "the call-to-action this page itself pushes (e.g. 'Download now', 'Get started free') — if none is stated, write 'Try it now'",
  "brandColors": ["1-3 colors you can actually see in the screenshot, as plain words like 'deep blue' or 'orange' — empty array if no screenshot was given"],
  "relevantText": "one short paragraph a video script could quote or paraphrase, taken from the page's own words"
}

Never invent features, numbers or claims the page doesn't make. If the page gives you very little to work with, keep the arrays short rather than padding them with generic filler.`

async function analyzeLink(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full link starting with https://')
  const meta = await fetchPageMeta(url)
  if (!meta.title && !meta.description) {
    throw new Error("Couldn't read anything useful from that page — it may block automated visits, or have no preview tags.")
  }

  const brief = `Page title: ${meta.title || '(none)'}\nSite: ${meta.siteName || '(unknown)'}\nDescription: ${meta.description || '(none)'}`

  let raw: string
  if (meta.image) {
    const dataUrl = await fetchAsDataUrl(meta.image)
    if (dataUrl) {
      raw = await groq(VISION_MODEL, LINK_ANALYST, [
        { type: 'text', text: brief },
        { type: 'image_url', image_url: { url: dataUrl } },
      ], 700)
    } else {
      raw = await groqChain(TEXT_MODEL_CHAIN, LINK_ANALYST, `No screenshot could be loaded — brandColors must be [].\n${brief}`, 700)
    }
  } else {
    raw = await groqChain(TEXT_MODEL_CHAIN, LINK_ANALYST, `No screenshot on this page — brandColors must be [].\n${brief}`, 700)
  }

  const parsed = extractJson<Record<string, unknown>>(raw, '{')
  if (!parsed) throw new Error('The model did not return a usable analysis. Try again.')
  return {
    appName: String(parsed.appName || meta.title || ''),
    tagline: String(parsed.tagline || ''),
    features: Array.isArray(parsed.features) ? parsed.features.map(String).slice(0, 6) : [],
    benefits: Array.isArray(parsed.benefits) ? parsed.benefits.map(String).slice(0, 4) : [],
    cta: String(parsed.cta || 'Try it now'),
    brandColors: Array.isArray(parsed.brandColors) ? parsed.brandColors.map(String).slice(0, 3) : [],
    relevantText: String(parsed.relevantText || meta.description || ''),
    screenshot: meta.image || '',
    sourceUrl: url,
  }
}

// ─── transcribe ─────────────────────────────────────────────────────────────

interface WhisperSegment { start: number; end: number; text: string }

/**
 * Whisper wants multipart/form-data — the audio arrives here as base64 JSON
 * (simplest thing a browser fetch() can send without extra libraries) and
 * gets re-packed into a real multipart body for Groq.
 */
async function transcribe(audioBase64: string, mime: string) {
  if (!audioBase64) throw new Error('No audio to transcribe.')
  const bytes = Buffer.from(audioBase64, 'base64')
  if (bytes.byteLength > 24_000_000) {
    throw new Error('That clip is too long to transcribe in one pass — try a shorter clip (a couple of minutes) for now.')
  }

  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mime || 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-large-v3')
  form.append('response_format', 'verbose_json')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as { text?: string; segments?: Array<{ start: number; end: number; text: string }> }
  const segments: WhisperSegment[] = (data.segments || []).map((s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || '').trim(),
  }))
  return { text: String(data.text || '').trim(), segments }
}

// ─── plan ───────────────────────────────────────────────────────────────────

const PLANNER = `You are a short-form video editor planning cuts for a Reels/Shorts/TikTok-style promo video.

You are given: the real transcript of the raw footage (with timestamps), the stretches of near-silence already detected in it, the clip's total duration, and (if available) what the product/app being promoted actually offers.

Return ONLY valid JSON with this exact shape:
{
  "timeline": [ { "start": 0, "end": 3, "label": "Strong hook" }, ... ],
  "checklist": {
    "hook": true,
    "productShown": true,
    "featureHighlight": true,
    "demonstration": true,
    "benefits": true,
    "cta": true,
    "captions": true,
    "branding": true,
    "transitions": true,
    "music": true
  },
  "notes": "one short paragraph explaining the reasoning, in plain language"
}

Rules:
- "timeline" segments must be in order, non-overlapping, start at 0, and their total span must not exceed the given duration. Base them on what's ACTUALLY in the transcript — where the speaker actually hooks, demos, states a benefit, gives a CTA — not a generic template. If the footage doesn't clearly contain one of those beats, still cover the full duration but label the segment honestly (e.g. "Talking head — no clear feature demo" instead of inventing one).
- The checklist flags are your recommendation for what the edit SHOULD include, given what you saw and what the product info says is available — not a claim that they've been applied yet. Set a flag false if there's nothing in the transcript/product info to support it (e.g. "productShown" false if the raw footage never shows or mentions the product).
- "captions", "branding", "transitions", "music" are always true (every export benefits from them) unless the notes explain why not.
- Never invent product claims beyond what the given product info states.`

async function generatePlan(body: Record<string, unknown>) {
  const durationSec = Number(body.durationSec) || 0
  if (durationSec <= 0) throw new Error('Missing a valid clip duration.')

  const appInfo = body.appInfo as Record<string, unknown> | null
  const silences = Array.isArray(body.silences) ? body.silences as Array<{ start: number; end: number }> : []
  const transcript = String(body.transcript || '')

  const brief = [
    `Title: ${body.title || '(untitled)'}`,
    `Total duration: ${durationSec.toFixed(1)}s`,
    `Orientation: ${body.orientation || 'unknown'}`,
    silences.length
      ? `Detected near-silence stretches (seconds): ${silences.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', ')}`
      : 'No significant silence detected.',
    transcript ? `Transcript of the raw footage:\n${transcript}` : 'No speech was detected in the footage.',
    appInfo
      ? `Product being promoted:\nName: ${appInfo.appName}\nTagline: ${appInfo.tagline}\nFeatures: ${(appInfo.features as string[] || []).join(', ')}\nBenefits: ${(appInfo.benefits as string[] || []).join(', ')}\nCTA: ${appInfo.cta}\nRelevant text: ${appInfo.relevantText}`
      : 'No referral/app link was analyzed — plan around the footage alone.',
  ].filter(Boolean).join('\n\n')

  const raw = await groqChain(TEXT_MODEL_CHAIN, PLANNER, brief, 1400)
  const parsed = extractJson<{
    timeline?: Array<{ start: number; end: number; label: string }>
    checklist?: Record<string, boolean>
    notes?: string
  }>(raw, '{')
  if (!parsed?.timeline?.length) throw new Error('The model did not return a usable plan. Try again.')

  const defaults = {
    hook: false, productShown: false, featureHighlight: false, demonstration: false,
    benefits: false, cta: false, captions: true, branding: true, transitions: true, music: true,
  }
  return {
    timeline: parsed.timeline
      .map((t) => ({ start: Number(t.start) || 0, end: Number(t.end) || 0, label: String(t.label || '') }))
      .filter((t) => t.end > t.start),
    checklist: { ...defaults, ...(parsed.checklist || {}) },
    notes: String(parsed.notes || ''),
  }
}

// ─── handler ────────────────────────────────────────────────────────────────

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, any>
  const action = String(body.action || '')

  try {
    if (action === 'analyzeLink') {
      res.status(200).json(await analyzeLink(String(body.url || '').trim()))
      return
    }
    if (action === 'transcribe') {
      res.status(200).json(await transcribe(String(body.audioBase64 || ''), String(body.mime || '')))
      return
    }
    if (action === 'plan') {
      res.status(200).json(await generatePlan(body))
      return
    }
    res.status(400).json({ error: `Unknown action "${action}"` })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
