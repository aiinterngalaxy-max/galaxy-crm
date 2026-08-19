/**
 * Server-side proxy for the app's one shared AI helper (src/lib/ai.ts,
 * `callClaude`) — used by document extraction, the CRM chatbot, the JD
 * Wizard, and the resume scorer.
 *
 * Before this route existed, callClaude called Groq directly from the
 * browser using VITE_GROQ_API_KEY — a Vite env var with that prefix gets
 * inlined as a literal string into the shipped JS bundle, which means the
 * key was sitting in plain text in every visitor's browser, readable by
 * anyone who opened dev tools or fetched the bundle directly. That's the
 * same reason api/content-studio/creative.ts already keeps its Groq key
 * server-side; this route brings the rest of the app's AI calls in line
 * with that pattern instead of leaving a second, insecure path around.
 *
 * Self-contained rather than importing from another api/*.ts file — see
 * api/content-studio/video-plan.ts's history for why: each file under
 * api/ is bundled as its own Vercel function, and one importing another
 * broke the function outright instead of just duplicating a few lines.
 */

function groqKey(): string {
  const key = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!key) throw new Error('No Groq key on the server. Add GROQ_API_KEY in Vercel → Settings → Environment Variables.')
  return key
}

/**
 * Groq's token-per-minute cap is tracked PER MODEL, not pooled across the
 * account — a 429 on the primary model means only that model's own
 * allowance is spent, not that the key itself is out of headroom. Falling
 * back to a second model on a 429 (same pattern as
 * api/content-studio/creative.ts's TEXT_MODEL_CHAIN) means a caller almost
 * never actually sees the rate-limit error the primary model hit; it just
 * transparently gets an answer from the fallback instead.
 */
const MODEL_CHAIN = [process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'].filter(
  (m, i, arr) => arr.indexOf(m) === i,
)

class GroqError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function callGroq(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  })
  if (!res.ok) throw new GroqError(res.status, `Groq ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content ?? '')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tries every model in MODEL_CHAIN in order, moving to the next ONLY on a
 * 429 — any other failure (bad request, network error) surfaces right away,
 * since trying more models won't fix a malformed prompt. If every model in
 * the chain is rate-limited (rare — they have separate quota pools), one
 * short delay-and-retry pass is given before finally giving up, so a
 * caller only ever sees a rate-limit message after genuinely exhausting
 * every option, not on the first transient 429.
 */
async function callGroqWithFallback(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1500)
    for (const model of MODEL_CHAIN) {
      try {
        return await callGroq(model, messages, maxTokens, temperature)
      } catch (err) {
        lastErr = err
        if (err instanceof GroqError && err.status === 429) continue
        throw err
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('The AI service is busy right now — please try again in a moment.')
}

interface Req { method?: string; body?: unknown }
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as {
    prompt?: string
    systemPrompt?: string
    // Full conversation history (chatbot use case) — takes priority over
    // prompt/systemPrompt when given, since it already includes the system role.
    messages?: Array<{ role: string; content: string }>
    maxTokens?: number
    temperature?: number
  }

  let messages: Array<{ role: string; content: string }>
  if (Array.isArray(body.messages) && body.messages.length) {
    messages = body.messages
  } else {
    const prompt = String(body.prompt || '').trim()
    if (!prompt) { res.status(400).json({ error: 'Missing prompt' }); return }
    messages = [
      ...(body.systemPrompt ? [{ role: 'system', content: body.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ]
  }

  try {
    const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 2048, 1), 8000)
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7
    const content = await callGroqWithFallback(messages, maxTokens, temperature)
    res.status(200).json({ content })
  } catch (err) {
    // A rate limit that survives the model fallback AND the retry pass is
    // still reported — but as a short, plain message, never the raw Groq
    // JSON body (token counts, org ids, upgrade links) a caller has no use
    // for and that reads as a broken/scary error rather than "try again".
    if (err instanceof GroqError && err.status === 429) {
      res.status(503).json({ error: 'The AI service is busy right now — please try again in a moment.' })
      return
    }
    res.status(err instanceof GroqError ? 502 : 500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
