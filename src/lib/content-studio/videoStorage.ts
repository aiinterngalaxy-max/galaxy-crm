/**
 * Client-side video/music upload/download/delete for Content Studio, backed
 * by Google Drive (see googleDrive.ts) via the same per-user OAuth grant the
 * rest of the app already uses for invoices/documents.
 *
 * This used to be backed by Firebase Storage instead, to skip Drive's
 * per-session OAuth consent popup. That required Firebase Storage's default
 * bucket to actually be provisioned for this project, which needs the Blaze
 * (pay-as-you-go) plan — confirmed 2026-08-22 the project is on Spark (free)
 * and the user does not want to upgrade. Storage was never provisioned, so
 * every upload attempt failed (CORS-preflight-looking errors, but the real
 * cause was "no bucket exists" — `gsutil ls` on the project came back with
 * zero buckets, and the Firebase console Storage page shows the "Get
 * started"/upgrade screen, not a Files tab). Drive needs no plan upgrade, so
 * this reverts back to it. Same field-reuse as before Firebase Storage: the
 * `driveFileId`/`driveViewUrl` names in cmo_video_jobs hold a real Drive file
 * id / view URL again.
 */
import { uploadToDrive, uploadBlobToDrive, downloadFromDrive, permanentlyDeleteDriveFile } from '../googleDrive'

export { GoogleDriveError as VideoStorageError } from '../googleDrive'

export interface StorageUploadResult {
  driveFileId: string
  driveViewUrl: string
}

/** Uploads a File, with upload progress (used for the initial footage/clip upload). */
export async function uploadVideoFile(
  file: File,
  _fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<StorageUploadResult> {
  return uploadToDrive(file, onProgress)
}

/** Uploads an in-memory Blob (a joined/edited/rendered result, or a music file) — no progress events. */
export async function uploadVideoBlob(blob: Blob, fileName: string): Promise<StorageUploadResult> {
  return uploadBlobToDrive(blob, fileName)
}

/** Downloads a file's bytes back from Drive, given the id stored in `raw_drive_id`/`edited_drive_id`/`export_drive_id`/`music_drive_id`. */
export async function downloadVideoBlob(driveFileId: string): Promise<Blob> {
  return downloadFromDrive(driveFileId)
}

/** Permanently deletes a file from Drive. */
export const deleteVideoBlob = permanentlyDeleteDriveFile
