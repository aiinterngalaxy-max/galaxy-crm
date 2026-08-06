/**
 * Logging and error translation for quote uploads.
 *
 * An upload that dies silently at 0% is the hardest kind to support: the user
 * sees a frozen number and the console shows nothing useful. Every stage of the
 * upload logs a line here, so a screenshot of the console is enough to say which
 * step failed and why — without asking anyone to open the Network tab.
 */

/** One line per stage, so a console screenshot tells the whole story. */
export type UploadStage =
  | 'file-selected'
  | 'validated'
  | 'hashed'
  | 'duplicate-found'
  | 'compressing'
  | 'compression-skipped'
  | 'upload-start'
  | 'first-byte'
  | 'upload-progress'
  | 'upload-complete'
  | 'firestore-saved'
  | 'failed'

const PREFIX = '[quote-upload]'

/* eslint-disable no-console -- console output is this module's entire purpose:
   support needs a readable trace in the browser without attaching a debugger. */
export function logStage(stage: UploadStage, detail?: Record<string, unknown>): void {
  const line = `${PREFIX} ${stage}`
  if (stage === 'failed') console.error(line, detail ?? '')
  else console.info(line, detail ?? '')
}
/* eslint-enable no-console */

/**
 * How long an upload may sit at zero bytes transferred before we stop waiting.
 *
 * A resumable upload opens its session and reports the first progress event
 * within a second or two on any working connection. Sitting at exactly 0 for
 * this long means the request never left the browser — nearly always CORS on the
 * bucket, occasionally a wrong bucket name. Failing here with that message beats
 * hanging forever with a frozen "0%".
 */
export const STALL_MS = 25_000

export class UploadStalledError extends Error {
  constructor() {
    super(
      'Upload did not start. The browser was blocked before any data was sent — ' +
        'this is almost always missing CORS configuration on the Storage bucket. ' +
        'See STORAGE_SETUP.md, or open DevTools → Network and look for a failed OPTIONS request.',
    )
    this.name = 'UploadStalledError'
  }
}

/** Firebase error shape — `code` is present on FirebaseError but not on Error. */
function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : ''
}

/**
 * Turns a Firebase Storage failure into something a salesperson can act on.
 * Unknown errors keep their original message rather than being flattened into a
 * useless "something went wrong".
 */
export function describeUploadError(err: unknown): string {
  if (err instanceof UploadStalledError) return err.message

  switch (errorCode(err)) {
    case 'storage/unauthorized':
      return 'You do not have permission to upload here. Sign out and back in; if it persists the Storage rules need checking.'
    case 'storage/unauthenticated':
      return 'Your session expired. Sign in again and retry the upload.'
    case 'storage/retry-limit-exceeded':
      return 'The connection dropped repeatedly. Check your internet and try again — nothing was saved.'
    case 'storage/canceled':
      return 'Upload cancelled.'
    case 'storage/quota-exceeded':
      return 'Storage is full. Free up space in Firebase Storage before uploading more quotes.'
    case 'storage/invalid-argument':
    case 'storage/object-not-found':
    case 'storage/bucket-not-found':
      return 'The storage bucket is misconfigured. Check VITE_FIREBASE_STORAGE_BUCKET matches the bucket in the Firebase console.'
    case 'storage/unknown':
      return 'Storage rejected the upload without a reason, which usually means CORS is not configured on the bucket. See STORAGE_SETUP.md.'
  }

  if (err instanceof Error) return err.message
  return 'Upload failed — check your connection and try again.'
}

/**
 * Warns once, loudly, when the app is running on placeholder Firebase config.
 * Without this the only symptom is that every write silently fails.
 */
let configWarned = false
export function warnIfPlaceholderConfig(bucket: string | undefined): void {
  if (configWarned) return
  if (!bucket || bucket.includes('placeholder')) {
    configWarned = true
    console.error(
      `${PREFIX} Firebase Storage bucket is "${bucket ?? 'unset'}". ` +
        'VITE_FIREBASE_STORAGE_BUCKET was not set at build time, so no upload can succeed. ' +
        'Set it in your .env (local) or Vercel project settings (deployed) and rebuild.',
    )
  }
}
