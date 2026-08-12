/**
 * Browser-side client for the Klap auto-edit API.
 *
 * Every call goes through /api/klap rather than to Klap directly: the API key is
 * account-wide and billed per minute, so it stays server-side. See api/klap.ts.
 */
import type { VideoClip, VideoJobStatus } from '@/types/content-studio'

export class KlapNotConfiguredError extends Error {}
export class KlapError extends Error {}

export interface GenerateOptions {
  language?: string
  maxDuration?: number
  maxClipCount?: number
  captions?: boolean
  reframe?: boolean
  emojis?: boolean
  introTitle?: boolean
  removeSilences?: boolean
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  language: 'en',
  maxDuration: 60,
  maxClipCount: 5,
  captions: true,
  reframe: true,
  emojis: false,
  introTitle: false,
  removeSilences: true,
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { auth } = await import('@/lib/firebase')
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) throw new KlapError('You need to be signed in to use video auto-editing.')

  const res = await fetch('/api/klap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, action, idToken }),
  })

  const data = await res.json().catch(() => null)

  if (res.status === 501) {
    throw new KlapNotConfiguredError(
      data?.message ?? 'Video auto-editing is not configured on this deployment yet.',
    )
  }
  if (!res.ok) {
    throw new KlapError(data?.message || data?.error || `Video service error (HTTP ${res.status})`)
  }
  return data as T
}

export function startGeneration(
  sourceUrl: string,
  name: string,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
) {
  return call<{ taskId: string; folderId: string; status: string }>('generate', {
    sourceUrl,
    name,
    options,
  })
}

export function getTaskStatus(taskId: string) {
  return call<{ status: string; folderId: string }>('task', { taskId })
}

export function listClips(folderId: string) {
  return call<{ clips: VideoClip[] }>('clips', { folderId })
}

export function startExport(folderId: string, projectId: string) {
  return call<{ exportId: string; status: string; url: string }>('export', { folderId, projectId })
}

export function getExportStatus(folderId: string, projectId: string, exportId: string) {
  return call<{ status: string; url: string }>('export-status', { folderId, projectId, exportId })
}

/**
 * Maps a Klap task/export status onto the job status stored in our own table.
 *
 * Klap reports the same three words ('processing' | 'ready' | 'error') for both
 * the generate step and the export step, so the caller says which phase it is
 * asking about — otherwise a finished export would read as "clips are ready".
 */
export function mapKlapStatus(
  klapStatus: string,
  phase: 'generate' | 'export',
): VideoJobStatus {
  if (klapStatus === 'error') return 'Failed'
  if (klapStatus === 'ready') return phase === 'generate' ? 'Generated' : 'Exported'
  return phase === 'generate' ? 'Generating' : 'Exporting'
}

/**
 * Polls until a terminal status or the attempt budget runs out.
 *
 * A budget rather than a deadline because the tab can be backgrounded, where
 * timers are throttled — counting attempts keeps the failure mode "gave up after
 * N checks" instead of "silently polled for an hour". Callers persist the Klap
 * ids first, so hitting the cap loses nothing: reopening resumes the poll.
 */
export async function pollUntilDone<T extends { status: string }>(
  check: () => Promise<T>,
  { intervalMs = 5000, maxAttempts = 120 }: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<T> {
  let last: T | null = null
  for (let i = 0; i < maxAttempts; i++) {
    last = await check()
    if (last.status === 'ready' || last.status === 'error') return last
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new KlapError(
    `Still rendering after ${Math.round((intervalMs * maxAttempts) / 60000)} minutes. ` +
      'It may still finish — reopen this piece later to check.',
  )
}
