import { uploadFileResumable } from './firebase'
import { logStage } from './uploadDiagnostics'
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
 *
 * Deliberately left off until uploads are confirmed working end to end: turning
 * this on in the same change as the CORS fix would make a regression impossible
 * to attribute. Deduplication below saves more storage than compression anyway.
 */
const COMPRESSION_ENABLED = false

/** Is the compressed result a big enough win to justify losing selectable text? */
export function shouldUseCompressed(ratio: number): boolean {
  return ratio <= 1 - MIN_SAVING
}

export interface QuoteUploadProgress {
  phase: 'hashing' | 'compressing' | 'uploading'
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

/** Raised when the exact same PDF is already attached to this record. */
export class DuplicateQuoteError extends QuoteUploadError {
  constructor(public readonly existing: QuoteDoc) {
    super(`"${existing.name}" is already attached to this record — it was not uploaded again.`)
    this.name = 'DuplicateQuoteError'
  }
}

/**
 * SHA-256 of the file's bytes, hex encoded.
 *
 * Identifies a PDF by content rather than by filename, so the same quote re-sent
 * as "quote.pdf" and "quote (1).pdf" is recognised as one file. Uses SubtleCrypto,
 * which is native and does not block the way canvas rendering did — hashing 20 MB
 * costs well under a second.
 *
 * Returns null when SubtleCrypto is unavailable (an http:// origin that is not
 * localhost); deduplication is then skipped rather than blocking the upload.
 */
export async function hashFile(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch (err) {
    console.warn('[quote-upload] hashing unavailable, skipping duplicate check:', err)
    return null
  }
}

/**
 * Finds an already-uploaded quote with identical content.
 *
 * Records uploaded before hashing existed carry no `sha256`, so they fall back to
 * matching on name plus byte size. That is a weaker signal, so it only applies
 * when both values are present on the stored record.
 */
export function findDuplicate(
  existing: QuoteDoc[],
  candidate: { sha256: string | null; name: string; size: number },
): QuoteDoc | undefined {
  if (candidate.sha256) {
    const byHash = existing.find(d => d.sha256 === candidate.sha256)
    if (byHash) return byHash
  }
  return existing.find(
    d => d.sha256 == null && d.size != null && d.name === candidate.name && d.size === candidate.size,
  )
}

/**
 * Validates, deduplicates, optionally compresses, and uploads a quote PDF.
 * Throws QuoteUploadError (or DuplicateQuoteError) with a message fit to show the user.
 */
export async function uploadQuotePdf(opts: {
  file: File
  collectionName: 'leads' | 'partners'
  docId: string
  uploadedByName?: string
  /** Quotes already on the record, used to skip re-uploading the same file. */
  existingDocs?: QuoteDoc[]
  onProgress?: (p: QuoteUploadProgress) => void
}): Promise<QuoteDoc> {
  const { file, collectionName, docId, uploadedByName, existingDocs = [], onProgress } = opts

  logStage('file-selected', { name: file.name, bytes: file.size, type: file.type })

  if (!isPdf(file)) {
    throw new QuoteUploadError('Please upload a PDF file')
  }
  if (file.size > MAX_QUOTE_BYTES) {
    throw new QuoteUploadError(
      `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_QUOTE_BYTES)}. Compress it and try again.`,
    )
  }
  logStage('validated', { name: file.name, bytes: file.size })

  // Hash before uploading: an identical file costs a fraction of a second to
  // detect and saves a full transfer plus a duplicate copy in Storage.
  onProgress?.({ phase: 'hashing', fraction: 0 })
  const sha256 = await hashFile(file)
  logStage('hashed', { sha256: sha256 ? `${sha256.slice(0, 12)}…` : 'unavailable' })

  const duplicate = findDuplicate(existingDocs, { sha256, name: file.name, size: file.size })
  if (duplicate) {
    logStage('duplicate-found', { name: duplicate.name, uploadedAt: duplicate.uploadedAt })
    throw new DuplicateQuoteError(duplicate)
  }

  // Try to shrink it, but never fail the upload because compression did not work.
  // Imported dynamically: pdfCompress pulls in pdfjs and jspdf (~800KB), which
  // would otherwise be downloaded with the leads page for code that never runs.
  let body: Blob = file
  if (COMPRESSION_ENABLED) {
    const { compressPdf } = await import('./pdfCompress')
    const result = await compressPdf(file, f => onProgress?.({ phase: 'compressing', fraction: f }))
    if (result && shouldUseCompressed(result.ratio)) {
      body = result.blob
      logStage('compressing', { from: file.size, to: body.size, ratio: result.ratio.toFixed(2) })
    } else {
      logStage('compression-skipped', { reason: result ? 'saving too small' : 'could not process' })
    }
  } else {
    logStage('compression-skipped', { reason: 'disabled' })
  }

  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${collectionName}/${docId}/quotes/${Date.now()}-${safeName}`

  const url = await uploadFileResumable(
    path,
    body,
    f => onProgress?.({ phase: 'uploading', fraction: f }),
    'application/pdf',
  )

  return {
    name: file.name,
    url,
    uploadedAt: Date.now(),
    uploadedByName,
    size: body.size,
    ...(sha256 ? { sha256 } : {}),
  }
}
