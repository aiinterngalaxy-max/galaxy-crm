/**
 * Cloudinary upload — the storage backend for quote PDFs.
 *
 * Firebase Storage needs a paid (Blaze) plan, so quotes go to Cloudinary's free
 * tier instead. Uploads are *unsigned*: the browser posts straight to Cloudinary
 * using a preset that only permits uploads. No API secret is involved, so
 * nothing sensitive ships in the bundle.
 *
 * The cloud name and preset are public by design — both are visible in the
 * network request of any upload — so they are defaulted here rather than
 * requiring an environment variable to be set on every deploy. Either can still
 * be overridden by env when the account changes.
 */
import { logStage } from './uploadDiagnostics'

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'tjez7kaf'
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'filup0gz'

/**
 * Cloudinary's free plan rejects anything over 10 MB for images and raw files.
 * Checked before upload so the user gets a useful message instead of a 400.
 */
export const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024

export class CloudinaryUploadError extends Error {}

export interface CloudinaryResult {
  url: string
  bytes: number
  publicId: string
}

interface SignedParams {
  signature: string
  timestamp: string
  apiKey: string
  folder: string
}

/**
 * Asks the server to sign this upload.
 *
 * Returns null when signing is unavailable — either the endpoint has no
 * Cloudinary secret configured yet, or the request failed — and the caller then
 * uses the unsigned preset. Uploading must keep working while signing is being
 * switched on; the whole point is to reduce abuse surface, not to add an outage.
 */
async function getSignature(): Promise<SignedParams | null> {
  try {
    const { auth } = await import('./firebase')
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) return null

    const res = await fetch('/api/cloudinary-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (res.status === 501) {
      logStage('upload-start', { signing: 'not configured, using unsigned preset' })
      return null
    }
    if (!res.ok) {
      logStage('failed', { stage: 'sign', status: res.status })
      return null
    }
    return (await res.json()) as SignedParams
  } catch (err) {
    logStage('failed', { stage: 'sign', error: String(err) })
    return null
  }
}

/**
 * Uploads a blob and resolves with its public URL.
 *
 * Uses XMLHttpRequest rather than fetch: fetch cannot report upload progress,
 * and a quote can take a minute on site broadband — without a moving percentage
 * the UI reads as frozen, which is the bug this whole change set exists to fix.
 */
export function uploadToCloudinary(
  file: Blob,
  fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<CloudinaryResult> & { cancel: () => void } {
  const xhr = new XMLHttpRequest()

  const promise = new Promise<CloudinaryResult>((resolve, reject) => {
    if (file.size > CLOUDINARY_MAX_BYTES) {
      reject(
        new CloudinaryUploadError(
          `This file is still ${(file.size / 1024 / 1024).toFixed(1)} MB after compression. ` +
            'The free storage plan accepts up to 10 MB — re-scan or re-export the quote at a lower quality and try again.',
        ),
      )
      return
    }

    // Signed when the server can sign (only signed-in users get a signature),
    // unsigned when it cannot — see getSignature().
    void getSignature().then(signed => {
      const form = new FormData()
      form.append('file', file, fileName)

      if (signed) {
        form.append('api_key', signed.apiKey)
        form.append('timestamp', signed.timestamp)
        form.append('signature', signed.signature)
        form.append('folder', signed.folder)
      } else {
        form.append('upload_preset', UPLOAD_PRESET)
      }
      logStage('upload-start', { mode: signed ? 'signed' : 'unsigned', bytes: file.size })

      // 'auto' lets Cloudinary classify the file; a PDF becomes an image resource,
      // which is deliverable because PDF delivery is enabled on the account.
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`)

      xhr.upload.onprogress = e => {
        if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total)
      }

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail = `HTTP ${xhr.status}`
          try {
            detail = JSON.parse(xhr.responseText)?.error?.message || detail
          } catch {
            /* non-JSON error body */
          }
          logStage('failed', { stage: 'cloudinary', status: xhr.status, detail })
          reject(new CloudinaryUploadError(`Storage rejected the upload: ${detail}`))
          return
        }
        try {
          const body = JSON.parse(xhr.responseText)
          const url: string | undefined = body.secure_url || body.url
          if (!url) throw new Error('no URL in response')
          resolve({ url, bytes: body.bytes ?? file.size, publicId: body.public_id ?? '' })
        } catch (err) {
          reject(new CloudinaryUploadError(`Could not read the storage response: ${String(err)}`))
        }
      }

      xhr.onerror = () => {
        logStage('failed', { stage: 'cloudinary', reason: 'network' })
        reject(new CloudinaryUploadError('Network error while uploading. Check your connection and try again.'))
      }

      xhr.onabort = () => reject(new CloudinaryUploadError('Upload cancelled.'))

      xhr.send(form)
    })
  })

  return Object.assign(promise, { cancel: () => xhr.abort() })
}
