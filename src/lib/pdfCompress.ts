import * as pdfjsLib from 'pdfjs-dist'
import jsPDF from 'jspdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

// Browser PDF compression works by rendering each page and re-encoding it as a
// JPEG, which rasterises the document — text stops being selectable or
// searchable. Quotes are read, not searched, and free storage caps files at
// 10 MB, so the trade is worth making when it is the difference between the
// quote uploading and not uploading at all.
//
// An earlier version of this froze the tab: it rendered every page back to back
// without ever returning to the event loop, so the browser could not repaint and
// the progress counter appeared stuck. Every page now yields via
// requestAnimationFrame before the next one starts, which keeps the UI alive.

/** Quality ladder. Each pass is tried in turn until the result fits the target. */
const QUALITY_STEPS = [0.75, 0.6, 0.45, 0.3]
/** Render scale per quality pass — dropped alongside quality on later passes. */
const SCALE_STEPS = [2, 1.75, 1.5, 1.25]
/** Beyond this many pages the wait stops being worth it and we give up. */
const MAX_PAGES = 60

export interface CompressResult {
  blob: Blob
  originalBytes: number
  compressedBytes: number
  /** 0.25 means the result is a quarter of the original. */
  ratio: number
  /** Quality setting that produced this result, for logging. */
  quality: number
}

export interface CompressProgress {
  /** 0..1 overall. */
  fraction: number
  page: number
  totalPages: number
  /** Which quality pass is running, 1-based. */
  pass: number
}

/** Hands control back to the browser so it can paint the progress counter. */
function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

/**
 * Rasterises a PDF at reduced quality, retrying at lower settings until the
 * result fits `targetBytes`.
 *
 * Returns null when the file cannot be processed (encrypted, corrupt, too many
 * pages) — callers should fall back to the original rather than treating it as
 * an error. Returns the best result it managed even if the target was not met,
 * so the caller can decide whether it is good enough.
 */
export async function compressPdf(
  file: File,
  onProgress?: (p: CompressProgress) => void,
  targetBytes?: number,
): Promise<CompressResult | null> {
  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  } catch (err) {
    console.warn('[quote-upload] could not open PDF, will upload original:', err)
    return null
  }

  if (pdf.numPages === 0 || pdf.numPages > MAX_PAGES) return null

  let best: CompressResult | null = null

  for (let pass = 0; pass < QUALITY_STEPS.length; pass++) {
    const quality = QUALITY_STEPS[pass]
    const scale = SCALE_STEPS[pass]

    let result: CompressResult | null = null
    try {
      result = await renderPass(pdf, file, quality, scale, (page, total) =>
        onProgress?.({
          // Spread each pass across the bar so it always moves forward.
          fraction: (pass + page / total) / QUALITY_STEPS.length,
          page,
          totalPages: total,
          pass: pass + 1,
        }),
      )
    } catch (err) {
      console.warn('[quote-upload] compression pass failed:', err)
      break
    }

    if (!result) break
    if (!best || result.compressedBytes < best.compressedBytes) best = result

    // Good enough — stop burning time on further passes.
    if (targetBytes == null || result.compressedBytes <= targetBytes) break
  }

  return best
}

/** One full render of the document at a given quality and scale. */
async function renderPass(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  file: File,
  quality: number,
  scale: number,
  onPage?: (page: number, total: number) => void,
): Promise<CompressResult | null> {
  let out: jsPDF | null = null

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // JPEG has no alpha; without this, transparent regions render black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvas, canvasContext: ctx, viewport }).promise

    const jpeg = canvas.toDataURL('image/jpeg', quality)

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

    // Free the bitmap eagerly; a long document otherwise holds every canvas.
    canvas.width = 0
    canvas.height = 0

    onPage?.(n, pdf.numPages)
    // Let the browser paint before starting the next page. This is what stops
    // the tab freezing on a large document.
    await yieldToBrowser()
  }

  if (!out) return null

  const blob = out.output('blob')
  return {
    blob,
    originalBytes: file.size,
    compressedBytes: blob.size,
    ratio: blob.size / file.size,
    quality,
  }
}
