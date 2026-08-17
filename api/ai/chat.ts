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
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: Math.min(Math.max(Number(body.maxTokens) || 2048, 1), 8000),
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      }),
    })

    if (!groqRes.ok) {
      const text = await groqRes.text()
      res.status(502).json({ error: `Groq API error (${groqRes.status}): ${text.slice(0, 500)}` })
      return
    }

    const data = await groqRes.json()
    const content = String(data?.choices?.[0]?.message?.content ?? '')
    res.status(200).json({ content })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
