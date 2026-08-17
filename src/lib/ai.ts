/**
 * The app's one shared AI helper — document extraction, the CRM chatbot,
 * the JD Wizard, and the resume scorer all call this.
 *
 * This used to call Groq directly from the browser with a VITE_-prefixed
 * env var. Any Vite env var with that prefix gets inlined as a literal
 * string into the shipped JS bundle — meaning the API key was sitting in
 * plain text in every visitor's browser, readable by anyone who opened
 * dev tools or fetched the bundle. It now goes through api/ai/chat.ts,
 * which holds the real key server-side, same pattern already used by
 * Content Studio's AI features.
 */
export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  maxTokens = 2048
): Promise<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userPrompt, systemPrompt, maxTokens }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `AI request failed (${res.status})`)
  return String(data?.content ?? '')
}
