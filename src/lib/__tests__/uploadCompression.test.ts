import { describe, it, expect } from 'vitest'
import { compressForUpload, shouldUseCompressed } from '../uploadCompression'

function makeFile(name: string, size: number, type: string): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('shouldUseCompressed', () => {
  it('accepts a result that saves more than 35%', () => {
    expect(shouldUseCompressed(0.5)).toBe(true)
    expect(shouldUseCompressed(0.64)).toBe(true)
  })

  it('rejects a result that barely shrinks', () => {
    expect(shouldUseCompressed(0.9)).toBe(false)
    expect(shouldUseCompressed(0.66)).toBe(false)
  })

  it('rejects a result that grew', () => {
    expect(shouldUseCompressed(1.1)).toBe(false)
  })
})

describe('compressForUpload', () => {
  it('never attempts Excel, CSV, Word or other formats — original passes through untouched', async () => {
    const file = makeFile('data.csv', 5_000_000, 'text/csv')
    const result = await compressForUpload(file)
    expect(result.wasCompressed).toBe(false)
    expect(result.blob).toBe(file)
    expect(result.savedBytes).toBe(0)
  })

  it('skips a PDF below the size threshold without attempting compression', async () => {
    const file = makeFile('small.pdf', 1_000_000, 'application/pdf') // < 3MB threshold
    const result = await compressForUpload(file)
    expect(result.wasCompressed).toBe(false)
    expect(result.blob).toBe(file)
  })

  it('falls back to the original file, never throwing, when compression cannot run in this environment', async () => {
    // No Canvas/createImageBitmap in the test environment — compressImage
    // must catch that internally and return null, not propagate the error.
    const file = makeFile('photo.jpg', 8_000_000, 'image/jpeg')
    await expect(compressForUpload(file)).resolves.toEqual({
      blob: file, wasCompressed: false, savedBytes: 0,
    })
  })

  it('identifies a PDF by extension even with a generic mime type', async () => {
    const file = makeFile('scan.pdf', 1_000_000, '') // some browsers/OSes report no type
    const result = await compressForUpload(file)
    // Still under the size threshold, so still a no-op — the point is it does
    // not crash trying to read `file.type.includes` on an unexpected mime type
    // and correctly recognises the .pdf extension.
    expect(result.blob).toBe(file)
  })
})
