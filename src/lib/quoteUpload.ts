import { uploadFileResumable } from './firebase'
import { compressPdf } from './pdfCompress'
import type { QuoteDoc } from '../types'

/** Largest PDF accepted, checked before any work starts. */
export const MAX_QUOTE_BYTES = 25 * 1024 * 1024

/**
 * Compression rasterises the PDF, costing selectable text, so the result is only
 * kept when it saves more than this. Image-heavy quotes clear it comfortably;
 * text-only ones do not and are uploaded untouched with their text intact.
 */
const MIN_SAVING = 0.4

/**
 * Off: compressPdf() renders pages to canvas on the main thread, which blocks
 * the browser for long enough on a large PDF that the tab freezes and progress
 * never repaints — it looks stuck at 0%. Re-enable once the work runs off the
 * main thread (OffscreenCanvas in a worker) or is capped to small files.
 */
const COMPRESSION_ENABLED = false

/** Is the compressed result a big enough win to justify losing selectable text? */
export function shouldUseCompressed(ratio: number): boolean {
  return ratio <= 1 - MIN_SAVING
}

export interface QuoteUploadProgress {
  phase: 'compressing' | 'uploading'
  /** 0..1 within the current phase. */
  fraction: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export class QuoteUploadError extends Error {}

/**
 * Validates, optionally compresses, and uploads a quote PDF.
 * Throws QuoteUploadError with a message fit to show the user.
 */
export async function uploadQuotePdf(opts: {
  file: File
  collectionName: 'leads' | 'partners'
  docId: string
  uploadedByName?: string
  onProgress?: (p: QuoteUploadProgress) => void
}): Promise<QuoteDoc> {
  const { file, collectionName, docId, uploadedByName, onProgress } = opts

  if (!isPdf(file)) {
    throw new QuoteUploadError('Please upload a PDF file')
  }
  if (file.size > MAX_QUOTE_BYTES) {
    throw new QuoteUploadError(
      `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_QUOTE_BYTES)}. Compress it and try again.`,
    )
  }

  // Try to shrink it, but never fail the upload because compression did not work.
  let body: Blob = file
  if (COMPRESSION_ENABLED) {
    const result = await compressPdf(file, f => onProgress?.({ phase: 'compressing', fraction: f }))
    if (result && shouldUseCompressed(result.ratio)) {
      body = result.blob
    }
  }

  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${collectionName}/${docId}/quotes/${Date.now()}-${safeName}`

  const url = await uploadFileResumable(
    path,
    body,
    f => onProgress?.({ phase: 'uploading', fraction: f }),
    'application/pdf',
  )

  return { name: file.name, url, uploadedAt: Date.now(), uploadedByName }
}
