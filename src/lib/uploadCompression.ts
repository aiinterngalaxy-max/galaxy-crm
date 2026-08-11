/**
 * Best-effort compression applied to a file before it goes to Drive, so what
 * actually gets stored (and counted against the 15GB quota) is smaller than
 * what was picked. Never blocks the upload on failure — if compression
 * errors, isn't attempted for this file type, or simply isn't a big enough
 * win, the original file goes up untouched.
 *
 * PDF compression here has real history: an earlier version of this same
 * per-page canvas approach (in the leads quote uploader) froze the browser
 * tab outright on a real 20MB file — canvas.toDataURL() on a large page is a
 * genuinely expensive *synchronous* call, and running it back-to-back for
 * every page with nothing letting the browser breathe in between blocked the
 * main thread for the whole duration. Measured directly (see PR): an 8-page
 * synthetic run blocked the event loop for 7122ms straight with no yielding.
 *
 * The fix here — yielding to the browser before and after each page's heavy
 * work — is a real, measured improvement (same benchmark: worst single block
 * dropped to 881ms) but not a complete one: each page's encode is still one
 * atomic blocking call, so a brief stutter per page is still possible on a
 * large multi-page scan. A full fix would move the encode into a Web Worker
 * via OffscreenCanvas; not built here. The size/page caps below exist so this
 * only runs on documents where that residual stutter is brief and rare, not
 * on every single upload.
 */

export interface CompressResult {
  blob: Blob
  originalBytes: number
  compressedBytes: number
  ratio: number
}

/** Compression is only kept when it saves more than this — otherwise the
 *  original uploads untouched. Matches the threshold already validated for
 *  quote PDF compression. */
const MIN_SAVING = 0.35

function yieldToBrowser(): Promise<void> {
  // setTimeout(0), not requestAnimationFrame: this needs to yield the
  // JS event loop itself, which setTimeout does regardless of whether the
  // tab is actively compositing/painting. rAF only fires on a paint tick,
  // which is not guaranteed in every host environment.
  return new Promise(resolve => setTimeout(resolve, 0))
}

export function shouldUseCompressed(ratio: number): boolean {
  return ratio <= 1 - MIN_SAVING
}

// ─── Images ─────────────────────────────────────────────────────────────────
//
// A single decode + draw + encode, not a loop over N pages — the failure mode
// that broke PDF compression doesn't apply here, so this runs unconditionally.

const IMAGE_MAX_DIMENSION = 2000
const IMAGE_JPEG_QUALITY = 0.82

async function compressImage(file: File): Promise<CompressResult | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return null }

    // JPEG has no alpha channel; without a white backing fill, a transparent
    // PNG's transparent areas would render black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY))
    canvas.width = 0
    canvas.height = 0
    if (!blob) return null

    return { blob, originalBytes: file.size, compressedBytes: blob.size, ratio: blob.size / file.size }
  } catch (err) {
    console.warn('Image compression failed, uploading original:', err)
    return null
  }
}

// ─── PDFs ───────────────────────────────────────────────────────────────────

/** Below this, compression isn't worth the risk for the saving it would give. */
const PDF_MIN_BYTES_TO_ATTEMPT = 3 * 1024 * 1024
/** Above this many pages, skip compression entirely — upload as-is. */
const PDF_MAX_PAGES_TO_ATTEMPT = 15
const PDF_RENDER_SCALE = 1.5
const PDF_JPEG_QUALITY = 0.6

async function compressPdf(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CompressResult | null> {
  if (file.size < PDF_MIN_BYTES_TO_ATTEMPT) return null

  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
    const { jsPDF } = await import('jspdf')

    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    if (pdf.numPages === 0 || pdf.numPages > PDF_MAX_PAGES_TO_ATTEMPT) return null

    let out: InstanceType<typeof jsPDF> | null = null

    for (let n = 1; n <= pdf.numPages; n++) {
      await yieldToBrowser() // let the browser handle input/timers before the heavy part

      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise

      await yieldToBrowser() // right before the expensive synchronous encode call

      const jpeg = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY)
      const unscaled = page.getViewport({ scale: 1 })

      if (!out) {
        out = new jsPDF({
          unit: 'pt', format: [unscaled.width, unscaled.height],
          orientation: unscaled.width > unscaled.height ? 'landscape' : 'portrait',
        })
      } else {
        out.addPage([unscaled.width, unscaled.height], unscaled.width > unscaled.height ? 'landscape' : 'portrait')
      }
      out.addImage(jpeg, 'JPEG', 0, 0, unscaled.width, unscaled.height)

      canvas.width = 0
      canvas.height = 0
      onProgress?.(n / pdf.numPages)
    }

    if (!out) return null
    const blob = out.output('blob')
    return { blob, originalBytes: file.size, compressedBytes: blob.size, ratio: blob.size / file.size }
  } catch (err) {
    console.warn('PDF compression failed, uploading original:', err)
    return null
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface CompressForUploadResult {
  blob: Blob
  wasCompressed: boolean
  savedBytes: number
}

/**
 * Attempts to compress a file before upload. Always returns something safe to
 * upload: the compressed blob when it's a real win, otherwise the original
 * file untouched. Never throws — a compression failure falls back silently
 * rather than blocking the upload the accountant is waiting on.
 *
 * Excel, CSV, Word and anything else are not attempted: .xlsx/.docx are
 * already zip-compressed internally and a JS-side pass on CSV/plain text
 * saves little for the complexity — not worth the risk for the return.
 */
export async function compressForUpload(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CompressForUploadResult> {
  const isImage = file.type.startsWith('image/')
  const isPdf = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')

  let result: CompressResult | null = null
  if (isImage) result = await compressImage(file)
  else if (isPdf) result = await compressPdf(file, onProgress)

  if (result && shouldUseCompressed(result.ratio)) {
    return { blob: result.blob, wasCompressed: true, savedBytes: result.originalBytes - result.compressedBytes }
  }
  return { blob: file, wasCompressed: false, savedBytes: 0 }
}
