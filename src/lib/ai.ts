const API_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined

export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  _maxTokens = 2048
): Promise<string> {
  if (!API_KEY) throw new Error('VITE_GROQ_API_KEY is not set — get a free key at console.groq.com')

  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: userPrompt },
  ]

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: _maxTokens,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Groq API error (${res.status}): ${text}`)
  }

  const data = await res.json()
  return (data.choices?.[0]?.message?.content as string) ?? ''
}
