import { describe, it, expect, vi, beforeEach } from 'vitest'

// pdfCompress pulls in pdfjs + a web worker, neither of which exist under vitest.
const compressPdf = vi.hoisted(() => vi.fn())
const uploadFileResumable = vi.hoisted(() => vi.fn())

vi.mock('../pdfCompress', () => ({ compressPdf }))
vi.mock('../firebase', () => ({ uploadFileResumable }))

const { uploadQuotePdf, MAX_QUOTE_BYTES, formatBytes, isPdf, shouldUseCompressed } = await import('../quoteUpload')

function makeFile(name: string, size: number, type = 'application/pdf'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const base = { collectionName: 'leads' as const, docId: 'L1', uploadedByName: 'Riya' }

beforeEach(() => {
  compressPdf.mockReset()
  uploadFileResumable.mockReset()
  uploadFileResumable.mockResolvedValue('https://example.com/quote.pdf')
})

describe('isPdf', () => {
  it('accepts by mime type', () => {
    expect(isPdf(makeFile('q.pdf', 100))).toBe(true)
  })

  it('accepts by extension when the mime type is missing', () => {
    expect(isPdf(makeFile('QUOTE.PDF', 100, ''))).toBe(true)
  })

  it('rejects non-pdfs', () => {
    expect(isPdf(makeFile('photo.png', 100, 'image/png'))).toBe(false)
  })
})

describe('shouldUseCompressed', () => {
  it('accepts a result that saves more than 40%', () => {
    expect(shouldUseCompressed(0.25)).toBe(true)
    expect(shouldUseCompressed(0.6)).toBe(true)
  })

  it('rejects a result that barely shrinks, which would lose text for nothing', () => {
    expect(shouldUseCompressed(0.9)).toBe(false)
    expect(shouldUseCompressed(0.61)).toBe(false)
  })

  it('rejects a result that grew', () => {
    expect(shouldUseCompressed(1.2)).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
  })
})

describe('uploadQuotePdf', () => {
  it('rejects a non-pdf before doing any work', async () => {
    await expect(uploadQuotePdf({ ...base, file: makeFile('a.png', 10, 'image/png') }))
      .rejects.toThrow(/PDF/)
    expect(uploadFileResumable).not.toHaveBeenCalled()
  })

  it('rejects a file over the size limit and names the limit', async () => {
    await expect(uploadQuotePdf({ ...base, file: makeFile('big.pdf', MAX_QUOTE_BYTES + 1) }))
      .rejects.toThrow(/25\.0 MB/)
    expect(uploadFileResumable).not.toHaveBeenCalled()
  })

  it('accepts a file exactly at the limit', async () => {
    compressPdf.mockResolvedValue(null)
    await expect(uploadQuotePdf({ ...base, file: makeFile('edge.pdf', MAX_QUOTE_BYTES) }))
      .resolves.toBeTruthy()
  })

  // Compression is currently disabled — it blocked the main thread and froze the
  // tab on large PDFs. These lock in that uploads go straight through until the
  // work moves off the main thread.
  it('uploads the original without attempting compression', async () => {
    const file = makeFile('img-heavy.pdf', 20_000_000)

    await uploadQuotePdf({ ...base, file })
    expect(compressPdf).not.toHaveBeenCalled()
    expect(uploadFileResumable.mock.calls[0][1]).toBe(file)
  })

  it('never blocks on compression for a large file', async () => {
    const file = makeFile('big.pdf', 24_000_000)

    await expect(uploadQuotePdf({ ...base, file })).resolves.toBeTruthy()
    expect(compressPdf).not.toHaveBeenCalled()
  })

  it('sanitises the storage path but keeps the original display name', async () => {
    compressPdf.mockResolvedValue(null)
    const result = await uploadQuotePdf({ ...base, file: makeFile('Quote #7 (final).pdf', 100) })

    const path = uploadFileResumable.mock.calls[0][0] as string
    expect(path).toMatch(/^leads\/L1\/quotes\/\d+-/)
    expect(path).not.toMatch(/[#()\s]/)
    expect(result.name).toBe('Quote #7 (final).pdf')
  })

  it('reports upload progress through onProgress', async () => {
    uploadFileResumable.mockImplementation(async (_p: string, _b: Blob, cb: (n: number) => void) => {
      cb(0.25); cb(0.75); return 'https://example.com/q.pdf'
    })

    const phases: string[] = []
    await uploadQuotePdf({ ...base, file: makeFile('q.pdf', 100), onProgress: p => phases.push(`${p.phase}:${p.fraction}`) })
    // Hashing runs first so an identical file can be caught before any transfer.
    expect(phases).toEqual(['hashing:0', 'uploading:0.25', 'uploading:0.75'])
  })

  it('stamps the uploader and a timestamp on the returned doc', async () => {
    compressPdf.mockResolvedValue(null)
    const before = Date.now()
    const result = await uploadQuotePdf({ ...base, file: makeFile('q.pdf', 100) })

    expect(result.uploadedByName).toBe('Riya')
    expect(result.uploadedAt).toBeGreaterThanOrEqual(before)
    expect(result.url).toBe('https://example.com/quote.pdf')
  })
})

// ─── Deduplication (Issue 2: storage optimisation) ──────────────────────────────

const { hashFile, findDuplicate, DuplicateQuoteError } = await import('../quoteUpload')

function docWith(over: Partial<QuoteDocT>): QuoteDocT {
  return { name: 'q.pdf', url: 'https://x/q.pdf', uploadedAt: 1, ...over }
}
type QuoteDocT = import('../../types').QuoteDoc

describe('hashFile', () => {
  it('is stable for identical bytes and differs for different bytes', async () => {
    const a = await hashFile(new Blob(['same content']))
    const b = await hashFile(new Blob(['same content']))
    const c = await hashFile(new Blob(['other content']))
    expect(a).toBeTruthy()
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('returns a 64-char hex digest', async () => {
    expect(await hashFile(new Blob(['x']))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('findDuplicate', () => {
  it('matches on content hash regardless of filename', () => {
    const existing = [docWith({ name: 'quote.pdf', sha256: 'abc', size: 100 })]
    const hit = findDuplicate(existing, { sha256: 'abc', name: 'quote (1).pdf', size: 100 })
    expect(hit?.name).toBe('quote.pdf')
  })

  it('does not match a different file with the same name', () => {
    const existing = [docWith({ name: 'quote.pdf', sha256: 'abc', size: 100 })]
    expect(findDuplicate(existing, { sha256: 'zzz', name: 'quote.pdf', size: 100 })).toBeUndefined()
  })

  // Records uploaded before hashing existed have no sha256 and must still work.
  it('falls back to name + size for legacy records without a hash', () => {
    const legacy = [docWith({ name: 'old.pdf', size: 2048 })]
    expect(findDuplicate(legacy, { sha256: 'new', name: 'old.pdf', size: 2048 })?.name).toBe('old.pdf')
  })

  it('does not treat a legacy record of a different size as a duplicate', () => {
    const legacy = [docWith({ name: 'old.pdf', size: 2048 })]
    expect(findDuplicate(legacy, { sha256: null, name: 'old.pdf', size: 9999 })).toBeUndefined()
  })

  it('never matches a legacy record that has no size recorded', () => {
    const legacy = [docWith({ name: 'old.pdf' })]
    expect(findDuplicate(legacy, { sha256: null, name: 'old.pdf', size: 100 })).toBeUndefined()
  })

  it('returns nothing when the record has no quotes yet', () => {
    expect(findDuplicate([], { sha256: 'abc', name: 'q.pdf', size: 1 })).toBeUndefined()
  })
})

describe('uploadQuotePdf deduplication', () => {
  it('refuses to re-upload an identical file and does not touch Storage', async () => {
    const file = makeFile('q.pdf', 12)
    const sha = await hashFile(file)
    const existing = [docWith({ name: 'already-here.pdf', sha256: sha!, size: 12 })]

    await expect(uploadQuotePdf({ ...base, file, existingDocs: existing }))
      .rejects.toBeInstanceOf(DuplicateQuoteError)
    expect(uploadFileResumable).not.toHaveBeenCalled()
  })

  it('uploads normally when the record holds a different file', async () => {
    const existing = [docWith({ name: 'other.pdf', sha256: 'unrelated', size: 999 })]
    await expect(uploadQuotePdf({ ...base, file: makeFile('q.pdf', 12), existingDocs: existing }))
      .resolves.toBeTruthy()
    expect(uploadFileResumable).toHaveBeenCalledOnce()
  })

  it('records size and hash on the returned doc so future uploads can dedupe', async () => {
    const result = await uploadQuotePdf({ ...base, file: makeFile('q.pdf', 12) })
    expect(result.size).toBe(12)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
