import * as pdfjsLib from 'pdfjs-dist'
import jsPDF from 'jspdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

// Browser PDF compression works by rendering each page and re-encoding it as a
// JPEG, which rasterises the document — text stops being selectable or
// searchable. That trade is only worth making when the saving is large, so
// compressPdf() reports the result and the caller decides whether to keep it.
// Text-heavy quotes barely shrink (and would lose their text for nothing), so
// they end up uploaded untouched.

/** Render scale. 2 keeps small print legible on screen without ballooning the JPEG. */
const RENDER_SCALE = 2
const JPEG_QUALITY = 0.75
/** Pages beyond this are left alone — the wait stops being worth it. */
const MAX_PAGES = 40

export interface CompressResult {
  blob: Blob
  originalBytes: number
  compressedBytes: number
  /** 0.25 means the result is a quarter of the original. */
  ratio: number
}

/**
 * Rasterises a PDF at reduced quality. Returns null when the file cannot be
 * processed (encrypted, corrupt, too many pages) — callers should fall back to
 * uploading the original rather than treating it as an error.
 */
export async function compressPdf(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CompressResult | null> {
  try {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise

    if (pdf.numPages === 0 || pdf.numPages > MAX_PAGES) return null

    let out: jsPDF | null = null

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: RENDER_SCALE })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // JPEG has no alpha; without this, transparent regions render black.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvas, canvasContext: ctx, viewport }).promise

      const jpeg = canvas.toDataURL('image/jpeg', JPEG_QUALITY)

      // Page size in points, matching the unscaled page so proportions hold.
      const unscaled = page.getViewport({ scale: 1 })
      const wPt = unscaled.width
      const hPt = unscaled.height

      if (!out) {
        out = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'landscape' : 'portrait' })
      } else {
        out.addPage([wPt, hPt], wPt > hPt ? 'landscape' : 'portrait')
      }
      out.addImage(jpeg, 'JPEG', 0, 0, wPt, hPt)

      // Free the bitmap eagerly; a 40-page run otherwise holds every canvas.
      canvas.width = 0
      canvas.height = 0

      onProgress?.(n / pdf.numPages)
    }

    if (!out) return null

    const blob = out.output('blob')
    return {
      blob,
      originalBytes: file.size,
      compressedBytes: blob.size,
      ratio: blob.size / file.size,
    }
  } catch (err) {
    console.warn('PDF compression failed, will upload original:', err)
    return null
  }
}
