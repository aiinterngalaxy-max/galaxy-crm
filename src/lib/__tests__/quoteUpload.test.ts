import { describe, it, expect, vi, beforeEach } from 'vitest'

// pdfCompress pulls in pdfjs + a web worker, neither of which exist under vitest.
const compressPdf = vi.hoisted(() => vi.fn())
const uploadFileResumable = vi.hoisted(() => vi.fn())

vi.mock('../pdfCompress', () => ({ compressPdf }))
vi.mock('../firebase', () => ({ uploadFileResumable }))

const { uploadQuotePdf, MAX_QUOTE_BYTES, formatBytes, isPdf } = await import('../quoteUpload')

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

  it('keeps the compressed blob when it saves more than 40%', async () => {
    const file = makeFile('img-heavy.pdf', 20_000_000)
    const blob = new Blob(['small'])
    compressPdf.mockResolvedValue({ blob, originalBytes: 20_000_000, compressedBytes: 5_000_000, ratio: 0.25 })

    await uploadQuotePdf({ ...base, file })
    expect(uploadFileResumable.mock.calls[0][1]).toBe(blob)
  })

  it('uploads the original when compression saves too little to justify losing text', async () => {
    const file = makeFile('text-only.pdf', 1_000_000)
    compressPdf.mockResolvedValue({
      blob: new Blob(['barely smaller']),
      originalBytes: 1_000_000,
      compressedBytes: 900_000,
      ratio: 0.9,
    })

    await uploadQuotePdf({ ...base, file })
    expect(uploadFileResumable.mock.calls[0][1]).toBe(file)
  })

  it('uploads the original when compression fails outright', async () => {
    const file = makeFile('weird.pdf', 5_000_000)
    compressPdf.mockResolvedValue(null)

    await uploadQuotePdf({ ...base, file })
    expect(uploadFileResumable.mock.calls[0][1]).toBe(file)
  })

  it('sanitises the storage path but keeps the original display name', async () => {
    compressPdf.mockResolvedValue(null)
    const result = await uploadQuotePdf({ ...base, file: makeFile('Quote #7 (final).pdf', 100) })

    const path = uploadFileResumable.mock.calls[0][0] as string
    expect(path).toMatch(/^leads\/L1\/quotes\/\d+-/)
    expect(path).not.toMatch(/[#()\s]/)
    expect(result.name).toBe('Quote #7 (final).pdf')
  })

  it('reports both phases through onProgress', async () => {
    compressPdf.mockImplementation(async (_f: File, cb: (n: number) => void) => { cb(0.5); return null })
    uploadFileResumable.mockImplementation(async (_p: string, _b: Blob, cb: (n: number) => void) => {
      cb(0.75); return 'https://example.com/q.pdf'
    })

    const phases: string[] = []
    await uploadQuotePdf({ ...base, file: makeFile('q.pdf', 100), onProgress: p => phases.push(`${p.phase}:${p.fraction}`) })
    expect(phases).toEqual(['compressing:0.5', 'uploading:0.75'])
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
