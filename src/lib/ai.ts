const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

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
    throw Object.assign(new Error(text), { status: res.status })
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
    // Try each model up to 3 times before moving on
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await tryModel(model, userPrompt, systemPrompt, maxTokens)
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 503 || status === 429) {
          if (attempt < 3) await sleep(attempt * 2000) // 2s, 4s
          continue
        }
        // 404 = model not found, try next model immediately
        if (status === 404) break
        // Any other error — surface it
        throw new Error(`Gemini API error (${status}): ${(err as Error).message}`)
      }
    }
  }

  throw new Error('Gemini 2.5 Flash is overloaded right now — please try again in a few seconds.')
}
