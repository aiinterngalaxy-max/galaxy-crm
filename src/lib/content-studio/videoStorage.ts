/**
 * Client-side video/music upload/download/delete, backed by Firebase Storage
 * instead of Google Drive.
 *
 * Drive access needed a per-user Google OAuth consent popup (Drive is a
 * separate product from Firebase Auth, so being signed into the CRM didn't
 * automatically grant it) — shown once per browser session to EVERY person
 * who opened Content Studio's editor, including a fresh popup mid-edit
 * whenever a cached grant had expired. Firebase Storage instead uses the
 * exact sign-in the CRM already requires (see storage.rules: any
 * `request.auth != null` may read/write), so there is no separate consent
 * step and therefore no popup, for anyone, ever.
 *
 * Same shape as googleDrive.ts's upload/download functions on purpose —
 * every call site swaps the import and otherwise stays the same. The
 * "driveFileId"/"driveViewUrl" field names in cmo_video_jobs are reused
 * as-is to hold a Storage path / download URL instead of a real Drive id —
 * they're just TEXT columns, and renaming them would be a bigger, riskier
 * change than it's worth for what's really just a switch in what gets
 * stored there.
 */
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { storage } from '../firebase'

export class VideoStorageError extends Error {}

const STORAGE_PATH_PREFIX = 'content-studio/'

function uniquePath(fileName: string): string {
  const safe = fileName.replace(/[^\w.\- ]+/g, '').trim() || 'file'
  return `${STORAGE_PATH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
}

/** True for anything this module itself created (always starts with
 *  STORAGE_PATH_PREFIX) — false for a bare Google Drive file id (an opaque
 *  token with no slashes) left over from before this migration. */
function isStoragePath(id: string): boolean {
  return id.startsWith(STORAGE_PATH_PREFIX)
}

export interface StorageUploadResult {
  /** Reused as `driveFileId` at call sites — really the Storage path. */
  driveFileId: string
  /** Reused as `driveViewUrl` at call sites — really the download URL. */
  driveViewUrl: string
}

/**
 * Uploads a file/blob to Firebase Storage with progress, mirroring
 * googleDrive.ts's uploadToDrive/uploadBlobToDrive (both collapse into this
 * one function here — Storage has no separate "create a folder" step Drive
 * needed).
 */
export async function uploadVideoBlob(
  file: Blob,
  fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<StorageUploadResult> {
  const path = uniquePath(fileName)
  const storageRef = ref(storage, path)
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type || 'video/mp4' })
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      (err) => reject(new VideoStorageError(err.message || 'Upload failed. Please try again.')),
      async () => {
        try {
          const downloadUrl = await getDownloadURL(storageRef)
          resolve({ driveFileId: path, driveViewUrl: downloadUrl })
        } catch (err) {
          reject(new VideoStorageError(err instanceof Error ? err.message : 'Could not finish the upload.'))
        }
      },
    )
  })
}

/** Signature-compatible with googleDrive.ts's uploadToDrive (drops the
 *  Drive-only per-account-folder step this doesn't need). */
export const uploadVideoFile = uploadVideoBlob

/**
 * Downloads a file's bytes back from Storage, given the path stored in
 * `raw_drive_id`/`edited_drive_id`/`export_drive_id`/`music_drive_id`.
 *
 * Content uploaded before this migration has a real Google Drive file id in
 * that same column, not a Storage path — those still need to go through
 * Drive (one popup) since the bytes genuinely live there, not in Storage.
 * Without this fallback, every piece of content uploaded before today would
 * simply fail to load at all: the video stays stuck at 0:00/0:00 and every
 * button that needs the source blob (Interpret instruction included) stays
 * disabled with no way to fix it short of re-uploading.
 */
export async function downloadVideoBlob(storagePath: string): Promise<Blob> {
  if (!isStoragePath(storagePath)) {
    const { downloadFromDrive } = await import('../googleDrive')
    return downloadFromDrive(storagePath)
  }
  try {
    const url = await getDownloadURL(ref(storage, storagePath))
    const res = await fetch(url)
    if (!res.ok) throw new VideoStorageError(`Could not download the file (${res.status}).`)
    return await res.blob()
  } catch (err) {
    if (err instanceof VideoStorageError) throw err
    const code = (err as { code?: string })?.code
    // getDownloadURL retries transient failures internally and only throws
    // this after giving up — on a machine where it happens every time (but
    // not on others), that's this specific machine's network refusing to
    // reach Google's servers at all (a VPN, a corporate firewall, or
    // security software blocking firebasestorage.googleapis.com), not
    // something a code change here can route around.
    if (code === 'storage/retry-limit-exceeded') {
      throw new VideoStorageError(
        'Could not reach Firebase Storage after repeated retries — this usually means a VPN, ' +
        'firewall, or security software on THIS device/network is blocking requests to ' +
        'firebasestorage.googleapis.com. Try a different network, or check with whoever manages ' +
        'this device\'s network/antivirus settings.',
      )
    }
    const detail = err instanceof Error ? err.message : String(err)
    throw new VideoStorageError(`Could not reach Firebase Storage (${detail}).`)
  }
}

/** Deletes a file from Storage. A no-op (not an error) if it's already gone. */
export async function deleteVideoBlob(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath))
  } catch (err) {
    if ((err as { code?: string })?.code === 'storage/object-not-found') return
    throw new VideoStorageError(err instanceof Error ? err.message : 'Could not delete the file.')
  }
}
