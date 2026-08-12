import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { decodeHtmlEntities, groqChain } from '../creative'

/**
 * The og:description / og:image content lives inside an HTML attribute, so
 * Instagram's page source has it entity-escaped. Left undecoded, two things
 * broke silently: the thumbnail URL's `&amp;` in place of `&` split its signed
 * query params on the wire into wrong-named params, so Instagram's CDN
 * rejected the fetch and the vision model never saw the actual reel — every
 * "analysis" quietly degraded to a guess from the caption text alone. And the
 * caption itself carried raw numeric refs (`&#xe9;`, `&#x1f621;`) into the
 * model as literal text instead of the accented letter or emoji they encode.
 * Both strings below are real og:description / og:image content captured
 * from live Instagram reels through this exact pipeline.
 */
describe('decodeHtmlEntities', () => {
  it('restores & inside a signed CDN URL so the query string is not split on the wire', () => {
    const raw =
      'https://scontent-iad3-2.cdninstagram.com/v/t51.71878-15/x.jpg?stp=cmp1&amp;_nc_cat=103&amp;oh=abc&amp;oe=def'
    expect(decodeHtmlEntities(raw)).toBe(
      'https://scontent-iad3-2.cdninstagram.com/v/t51.71878-15/x.jpg?stp=cmp1&_nc_cat=103&oh=abc&oe=def',
    )
  })

  it('decodes hex numeric character references (accented letters, emoji)', () => {
    expect(decodeHtmlEntities('fianc&#xe9;')).toBe('fiancé')
    expect(decodeHtmlEntities('lock down&#x1f621;')).toBe('lock down😡')
  })

  it('decodes decimal numeric character references', () => {
    expect(decodeHtmlEntities('caf&#233;')).toBe('café')
  })

  it('decodes the standard named entities', () => {
    expect(decodeHtmlEntities('&quot;hello&quot; &amp; &lt;tag&gt; &#39;x&#39;')).toBe('"hello" & <tag> \'x\'')
  })

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('Lunch #hamont')).toBe('Lunch #hamont')
  })
})

/**
 * Groq tracks its daily token cap per MODEL, not pooled across the account —
 * a 429 on one model says nothing about whether the next model in the chain
 * has headroom. groqChain() is what makes that fact useful: it must move on
 * from a 429 automatically, but a real mistake (bad request, malformed
 * prompt) should surface immediately rather than being retried three times
 * against models that can't fix it either.
 */
describe('groqChain', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GROQ_API_KEY
  })

  function okResponse(text: string) {
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) }
  }
  function errResponse(status: number, message = 'rate limited') {
    return { ok: false, status, text: async () => JSON.stringify({ error: { message } }) }
  }

  it('moves to the next model on a 429 and returns its result', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse('written by the second model'))

    const out = await groqChain(['model-a', 'model-b'], 'system', 'prompt')
    expect(out).toBe('written by the second model')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never reaches the second model when the first succeeds', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('first model was fine'))

    const out = await groqChain(['model-a', 'model-b'], 'system', 'prompt')
    expect(out).toBe('first model was fine')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-429 error — a bad request fails immediately', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, 'invalid request'))

    await expect(groqChain(['model-a', 'model-b'], 'system', 'prompt')).rejects.toThrow('Groq 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a clear error once every model in the chain is rate-limited', async () => {
    fetchMock.mockResolvedValue(errResponse(429))

    await expect(groqChain(['model-a', 'model-b'], 'system', 'prompt')).rejects.toThrow(/429|rate-limited/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
