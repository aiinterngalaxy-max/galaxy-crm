const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

// Models tried in order — falls back if one is overloaded
const MODELS = [
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
  'gemini-2.0-flash-lite',
]

async function tryModel(model: string, userPrompt: string, systemPrompt: string | undefined, maxTokens: number): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
  }
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}::${text}`)
  }

  const data = await res.json()
  return (data.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? ''
}

export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  maxTokens = 2048
): Promise<string> {
  if (!API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set — get a free key at aistudio.google.com/app/apikey')

  for (const model of MODELS) {
    try {
      return await tryModel(model, userPrompt, systemPrompt, maxTokens)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // Only fall through on 503 (overloaded) or 429 (quota) — hard fail on anything else
      if (!msg.startsWith('503') && !msg.startsWith('429') && !msg.startsWith('404')) {
        throw new Error(`Gemini API error: ${msg.split('::')[1] || msg}`)
      }
      // Try next model
    }
  }

  throw new Error('All Gemini models are currently busy — please try again in a few seconds.')
}
