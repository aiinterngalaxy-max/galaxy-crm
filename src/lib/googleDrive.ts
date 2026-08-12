/**
 * Client-side Google Drive upload/download/trash.
 *
 * Files go browser → Google directly, never through our own Vercel functions
 * — a Vercel API route imposes a request-body ceiling that would cap "no
 * size limit" uploads at a few MB regardless of anything written here.
 *
 * Access is per-user (see googleDriveAuth.ts): whoever is signed into the CRM
 * grants Drive access themselves, the same way they already sign in. There is
 * no shared server-side secret behind this any more.
 */
import { getDriveAccessToken, clearCachedDriveToken, DriveAuthError } from './googleDriveAuth'

export { DriveAuthError as GoogleDriveError }

const FOLDER_NAME = 'Galaxy CRM Documents'

// In-memory only — cleared on reload, same lifetime as the access token
// itself (see googleDriveAuth.ts's cachedToken). Just avoids one redundant
// Drive search per upload within the same session; getOrCreateFolderId()
// finding it again via search on the next session is cheap and correct.
let cachedFolderId: string | null = null

/**
 * The destination folder for uploads, resolved per signed-in Google account
 * rather than one fixed ID from an env var.
 *
 * Drive access here uses the `drive.file` scope (see googleDriveAuth.ts) —
 * narrow enough that Google never shows the "app isn't verified" block screen,
 * but it also means the app can only see files/folders it created itself.
 * Pointing that at a folder someone made by hand in ordinary Drive doesn't
 * work: the folder is invisible to the app no matter who signs in or what
 * sharing is set on it. So instead, the first time a given Google account
 * uploads anything, the app creates its own "Galaxy CRM Documents" folder in
 * *that account's* Drive; every upload after searches for that same folder by
 * name and reuses it. One real consequence worth knowing: documents land in
 * whichever account uploaded them, not one shared company folder — if several
 * people upload, each gets their own folder in their own Drive.
 *
 * Deliberately not cached in Firestore: that would need a new security rule
 * deployed to the live project, which is a manual step outside what this
 * code can do on its own. Asking Drive itself to search its own files by
 * name is a second API call per upload, but needs nothing extra deployed
 * anywhere.
 */
async function getOrCreateFolderId(accessToken: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    )}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (searchRes.ok) {
    const { files } = await searchRes.json()
    if (files?.[0]?.id) {
      cachedFolderId = files[0].id
      return cachedFolderId as string
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!createRes.ok) {
    throw new DriveAuthError(`Could not create the Drive folder (${createRes.status}). Please try again.`)
  }
  const { id: newFolderId } = await createRes.json()
  cachedFolderId = newFolderId
  return newFolderId
}

export interface DriveUploadResult {
  driveFileId: string
  driveViewUrl: string
}

/**
 * Wraps a Drive call so a 401 (expired/invalid token) clears the cached token
 * and retries once with a fresh one, rather than surfacing a dead-end error
 * for something a silent retry can usually fix on its own.
 */
async function withTokenRetry<T>(run: (accessToken: string) => Promise<T>): Promise<T> {
  const token = await getDriveAccessToken()
  try {
    return await run(token)
  } catch (err) {
    if (err instanceof DriveUnauthorizedError) {
      clearCachedDriveToken()
      const freshToken = await getDriveAccessToken()
      return run(freshToken)
    }
    throw err
  }
}

class DriveUnauthorizedError extends Error {}

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
  return withTokenRetry(async accessToken => {
    const folderId = await getOrCreateFolderId(accessToken)

    // Step 1 — open a resumable session. Google returns the session URL in the
    // Location header; Drive's API explicitly supports this being read from a
    // browser (CORS-exposed), which is what makes a from-the-browser upload
    // work at all.
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
    if (initRes.status === 401) throw new DriveUnauthorizedError()
    if (!initRes.ok) {
      throw new DriveAuthError(`Could not start the upload (${initRes.status}). Please try again.`)
    }
    const sessionUrl = initRes.headers.get('Location')
    if (!sessionUrl) {
      throw new DriveAuthError('Google did not return an upload session. Please try again.')
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
            reject(new DriveAuthError('Upload finished but the response was unreadable.'))
          }
        } else {
          reject(new DriveAuthError(`Upload failed (${xhr.status}). Please try again.`))
        }
      }
      xhr.onerror = () => reject(new DriveAuthError('Upload failed — check your connection.'))
      xhr.send(file)
    })

    return { driveFileId: fileId, driveViewUrl: `https://drive.google.com/file/d/${fileId}/view` }
  })
}

/**
 * Fetches a file's bytes back from Drive, for extraction. Same direct
 * browser-to-Google path as the upload — no reason to proxy this one either.
 */
export async function downloadFromDrive(driveFileId: string): Promise<Blob> {
  return withTokenRetry(async accessToken => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (res.status === 401) throw new DriveUnauthorizedError()
    if (!res.ok) {
      throw new DriveAuthError(`Could not download the file from Drive (${res.status}).`)
    }
    return res.blob()
  })
}

/**
 * Uploads an already-in-memory blob (a generated PDF) to Drive. Small enough
 * that the resumable protocol's extra round trip isn't worth it — a single
 * multipart POST does the same job in one request.
 */
export async function uploadBlobToDrive(blob: Blob, fileName: string): Promise<DriveUploadResult> {
  return withTokenRetry(async accessToken => {
    const folderId = await getOrCreateFolderId(accessToken)
    const boundary = `-------galaxycrm${Date.now()}`
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] })
    const bodyParts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'application/pdf'}\r\n\r\n`,
    ]
    const closing = `\r\n--${boundary}--`
    const body = new Blob([bodyParts[0], bodyParts[1], blob, closing])

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
    if (res.status === 401) throw new DriveUnauthorizedError()
    if (!res.ok) {
      throw new DriveAuthError(`Could not save the generated document to Drive (${res.status}).`)
    }
    const { id } = await res.json()
    return { driveFileId: id, driveViewUrl: `https://drive.google.com/file/d/${id}/view` }
  })
}

async function driveTrashCall(driveFileId: string, action: 'trash' | 'restore' | 'delete'): Promise<void> {
  await withTokenRetry(async accessToken => {
    const res = action === 'delete'
      ? await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      : await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: action === 'trash' }),
        })

    if (res.status === 401) throw new DriveUnauthorizedError()
    // A permanent-delete retry on a file already gone returns 404 — the end
    // state the caller wants (file not present) is already true, so treat it
    // as success rather than an error.
    if (!res.ok && !(action === 'delete' && res.status === 404)) {
      throw new DriveAuthError(`Could not ${action} the file in Google Drive (${res.status}).`)
    }
  })
}

/** Moves a Drive file to trash (soft delete) or restores it. */
export const setDriveTrashed = (driveFileId: string, trashed: boolean) =>
  driveTrashCall(driveFileId, trashed ? 'trash' : 'restore')

/** Permanently deletes a Drive file. Cannot be undone from the Drive side. */
export const permanentlyDeleteDriveFile = (driveFileId: string) =>
  driveTrashCall(driveFileId, 'delete')
