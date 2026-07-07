const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined

export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  maxTokens = 2048
): Promise<string> {
  if (!API_KEY) throw new Error('VITE_ANTHROPIC_API_KEY is not set in .env')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${text}`)
  }

  const data = await res.json()
  return (data.content?.[0]?.text as string) ?? ''
}
