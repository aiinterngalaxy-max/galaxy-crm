/**
 * Client-side Google Drive upload.
 *
 * Files go browser → Google directly, never through our own Vercel functions.
 * That is deliberate: Vercel imposes a request-body ceiling on every API route,
 * which would cap "no size limit" uploads at a few MB regardless of anything
 * written here. Our server's only job is to hand the browser a short-lived
 * access token (api/google-drive-token.ts) — it never sees the file itself.
 */
import { auth } from './firebase'

export class GoogleDriveError extends Error {}

interface TokenResponse {
  accessToken: string
  folderId: string
  expiresIn: number
}

async function getToken(): Promise<TokenResponse> {
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) throw new GoogleDriveError('Not signed in')

  const res = await fetch('/api/google-drive-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })

  if (res.status === 501) {
    throw new GoogleDriveError(
      'Google Drive is not connected yet. See Settings → System for setup steps, or ask an admin.',
    )
  }
  if (res.status === 403) {
    throw new GoogleDriveError('Your session has expired — please sign in again.')
  }
  if (!res.ok) {
    throw new GoogleDriveError('Could not authorise the upload. Please try again.')
  }
  return res.json()
}

export interface DriveUploadResult {
  driveFileId: string
  driveViewUrl: string
}

/**
 * Uploads a file directly from the browser to Google Drive via the resumable
 * upload protocol.
 *
 * This is a single-shot PUT of the whole file rather than a chunked, retryable
 * transfer — if the connection drops mid-upload the whole thing has to be
 * retried from scratch. Google's resumable-session URL would support proper
 * chunk-level resume; that is a worthwhile follow-up for very large files on
 * flaky connections, not built here yet.
 */
export async function uploadToDrive(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<DriveUploadResult> {
  const { accessToken, folderId } = await getToken()

  // Step 1 — open a resumable session. Google returns the session URL in the
  // Location header; Drive's API explicitly supports this being read from a
  // browser (CORS-exposed), which is what makes a from-the-browser upload work
  // at all.
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify({ name: file.name, parents: [folderId] }),
    },
  )
  if (!initRes.ok) {
    throw new GoogleDriveError(`Could not start the upload (${initRes.status}). Please try again.`)
  }
  const sessionUrl = initRes.headers.get('Location')
  if (!sessionUrl) {
    throw new GoogleDriveError('Google did not return an upload session. Please try again.')
  }

  // Step 2 — PUT the file bytes, with progress. fetch() has no reliable
  // upload-progress event in browsers, so this uses XHR specifically for that.
  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', sessionUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText).id)
        } catch {
          reject(new GoogleDriveError('Upload finished but the response was unreadable.'))
        }
      } else {
        reject(new GoogleDriveError(`Upload failed (${xhr.status}). Please try again.`))
      }
    }
    xhr.onerror = () => reject(new GoogleDriveError('Upload failed — check your connection.'))
    xhr.send(file)
  })

  return { driveFileId: fileId, driveViewUrl: `https://drive.google.com/file/d/${fileId}/view` }
}

async function callTrashEndpoint(driveFileId: string, action: 'trash' | 'restore' | 'delete'): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) throw new GoogleDriveError('Not signed in')

  const res = await fetch('/api/google-drive-trash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, driveFileId, action }),
  })
  if (!res.ok) {
    throw new GoogleDriveError(`Could not ${action} the file in Google Drive.`)
  }
}

/** Moves a Drive file to trash (soft delete) or restores it. */
export const setDriveTrashed = (driveFileId: string, trashed: boolean) =>
  callTrashEndpoint(driveFileId, trashed ? 'trash' : 'restore')

/** Permanently deletes a Drive file. Cannot be undone from the Drive side. */
export const permanentlyDeleteDriveFile = (driveFileId: string) =>
  callTrashEndpoint(driveFileId, 'delete')
