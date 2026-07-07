const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  _maxTokens = 2048
): Promise<string> {
  if (!API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set in .env — get a free key at aistudio.google.com/app/apikey')

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: _maxTokens, temperature: 0.7 },
  }
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini API error (${res.status}): ${text}`)
  }

  const data = await res.json()
  return (data.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? ''
}
