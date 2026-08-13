import { describe, it, expect, vi, beforeEach } from 'vitest'

// pdfjs/tesseract/xlsx/mammoth all touch DOM or Node APIs vitest doesn't have —
// only the AI call is mocked here, since extractStructuredInvoiceData is pure
// JSON-in, JSON-out on top of it.
const callClaude = vi.hoisted(() => vi.fn())
vi.mock('../ai', () => ({ callClaude }))

const { extractStructuredInvoiceData, ExtractionError } = await import('../documentExtraction')

beforeEach(() => callClaude.mockReset())

function mockReply(obj: unknown) {
  callClaude.mockResolvedValue(JSON.stringify(obj))
}

describe('extractStructuredInvoiceData', () => {
  it('rejects empty source text before calling the AI at all', async () => {
    await expect(extractStructuredInvoiceData('   ')).rejects.toThrow(ExtractionError)
    expect(callClaude).not.toHaveBeenCalled()
  })

  it('parses a well-formed reply into structured data', async () => {
    mockReply({
      buyerName: 'Acme Corp', buyerAddress: '1 Main St', buyerGstin: '27AAAAA0000A1Z5', buyerContact: '9999999999',
      items: [{ description: 'Widget', model: 'W-1', hsnCode: '1234', quantity: 5, unitPrice: 100 }],
      notes: 'Net 30',
    })
    const result = await extractStructuredInvoiceData('some invoice text')
    expect(result.buyerName).toBe('Acme Corp')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ description: 'Widget', model: 'W-1', hsnCode: '1234', quantity: 5, unitPrice: 100 })
    expect(result.items[0].id).toBeTruthy()
  })

  it('strips a markdown code fence around the JSON', async () => {
    callClaude.mockResolvedValue('```json\n{"items":[{"description":"X","quantity":1,"unitPrice":1}]}\n```')
    const result = await extractStructuredInvoiceData('text')
    expect(result.items[0].description).toBe('X')
  })

  it('throws ExtractionError on unparsable AI output rather than crashing', async () => {
    callClaude.mockResolvedValue('not json at all')
    await expect(extractStructuredInvoiceData('text')).rejects.toThrow(ExtractionError)
  })

  it('drops items with no description — a description-less row is not a line item', async () => {
    mockReply({ items: [{ description: '', quantity: 1, unitPrice: 1 }, { description: 'Real item', quantity: 1, unitPrice: 1 }] })
    const result = await extractStructuredInvoiceData('text')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].description).toBe('Real item')
  })

  it('never invents a quantity of 0 — treats missing/invalid as 1', async () => {
    mockReply({ items: [{ description: 'X', quantity: 0, unitPrice: 10 }, { description: 'Y', unitPrice: 10 }] })
    const result = await extractStructuredInvoiceData('text')
    expect(result.items[0].quantity).toBe(1)
    expect(result.items[1].quantity).toBe(1)
  })

  it('treats a missing or negative price as 0 rather than guessing', async () => {
    mockReply({ items: [{ description: 'X', quantity: 1 }, { description: 'Y', quantity: 1, unitPrice: -5 }] })
    const result = await extractStructuredInvoiceData('text')
    expect(result.items[0].unitPrice).toBe(0)
    expect(result.items[1].unitPrice).toBe(0)
  })

  it('leaves hsnCode as an empty string when the source has none', async () => {
    // Not `undefined`: this object is written straight to Firestore, which
    // rejects any field whose value is literally undefined, even nested
    // inside an object (see DocumentReviewPage's handleExtract).
    mockReply({ items: [{ description: 'X', quantity: 1, unitPrice: 1, hsnCode: '' }] })
    const result = await extractStructuredInvoiceData('text')
    expect(result.items[0].hsnCode).toBe('')
  })

  it('leaves buyer fields as empty strings, not undefined, when absent', async () => {
    mockReply({ items: [{ description: 'X', quantity: 1, unitPrice: 1 }] })
    const result = await extractStructuredInvoiceData('text')
    expect(result.buyerName).toBe('')
    expect(result.buyerGstin).toBe('')
  })

  it('truncates a very long source rather than sending it whole', async () => {
    mockReply({ items: [{ description: 'X', quantity: 1, unitPrice: 1 }] })
    const huge = 'a'.repeat(50000)
    await extractStructuredInvoiceData(huge)
    const promptSent = callClaude.mock.calls[0][0] as string
    expect(promptSent.length).toBeLessThan(huge.length)
    expect(promptSent).toContain('[...truncated...]')
  })
})
