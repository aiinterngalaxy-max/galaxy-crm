import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../chat'

/**
 * Regression test for the exact failure a real user hit: Groq rejected an
 * AI Edit "masking effect" request with HTTP 413 (not 429) and a body
 * whose `code` is "rate_limit_exceeded" — the model-fallback logic used to
 * only retry on 429, so this case fell straight through to the caller as
 * Groq's raw JSON error text. This reproduces that exact response body and
 * asserts the handler now falls back to the second model instead of
 * surfacing it.
 */
describe('api/ai/chat handler — Groq 413 rate-limit fallback', () => {
  const fetchMock = vi.fn()

  function fakeRes() {
    const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => void } = {
      status(code: number) {
        res.statusCode = code
        return res
      },
      json(body: unknown) {
        res.body = body
      },
    }
    return res
  }

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GROQ_API_KEY
  })

  // The literal body Groq returned in production for this exact request.
  const REAL_GROQ_413_BODY = JSON.stringify({
    error: {
      message:
        "Request too large for model `openai/gpt-oss-120b` in organization `org_01kwy632kwerbtj951e425k96c` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8165, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing",
      type: 'tokens',
      code: 'rate_limit_exceeded',
    },
  })

  it('falls back to the second model on the real 413 rate-limit body and returns its answer, not the raw Groq error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 413, text: async () => REAL_GROQ_413_BODY })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"commands":[{"type":"mask","start":4,"end":5,"shape":"circle"}]}' } }] }),
      })

    const res = fakeRes()
    await handler(
      { method: 'POST', body: { prompt: 'from 4 to 5 second I need masking effect', systemPrompt: 'sys' } },
      res,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ content: '{"commands":[{"type":"mask","start":4,"end":5,"shape":"circle"}]}' })
  })

  it('still returns the friendly busy message (not raw JSON) if every model hits the same 413 rate limit', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, text: async () => REAL_GROQ_413_BODY })

    const res = fakeRes()
    await handler({ method: 'POST', body: { prompt: 'anything', systemPrompt: 'sys' } }, res)

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'The AI service is busy right now — please try again in a moment.' })
    // Never leak Groq's raw body (token counts, org id, billing link) to the caller.
    expect(JSON.stringify(res.body)).not.toContain('org_01kwy632kwerbtj951e425k96c')
  })

  it('does NOT fall back / mask a genuine 413 that is not a rate limit (e.g. a truly oversized request)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: async () => JSON.stringify({ error: { message: 'payload too large', code: 'request_too_large' } }),
    })

    const res = fakeRes()
    await handler({ method: 'POST', body: { prompt: 'x', systemPrompt: 'sys' } }, res)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(502)
  })

  it('still moves to the next model on a plain 429, same as before this fix', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })

    const res = fakeRes()
    await handler({ method: 'POST', body: { prompt: 'x', systemPrompt: 'sys' } }, res)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ content: 'ok' })
  })
})
