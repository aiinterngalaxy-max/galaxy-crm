export const config = { runtime: 'edge' }

/**
 * Server-side proxy for the Klap video API.
 *
 * Klap keys are account-wide and billed per minute of video processed, so the
 * key must never reach the browser — anyone with DevTools open could otherwise
 * spend the account down. Every call goes through here, and only for a caller
 * holding a valid Firebase ID token, matching api/cloudinary-sign.ts.
 *
 * The flow Klap requires is four separate polled steps, which is why this is one
 * endpoint with an `action` rather than four:
 *   generate → task (async)  → folder of candidate clips
 *   task     → poll until ready
 *   clips    → list the folder's projects
 *   export   → render one chosen project (async)
 *   export-status → poll until the MP4 URL appears
 *
 * Required environment variable (Vercel → Settings → Environment Variables):
 *   KLAP_API_KEY   from https://klap.app/rest-api
 *
 * With the key unset every action returns 501, so deploying this cannot break
 * anything — the UI reads that as "not configured" and says so plainly.
 */

const KLAP_BASE = 'https://api.klap.app/v2'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS })
}

/** Same check the Cloudinary signer uses — catches disabled/deleted users too. */
async function verifyFirebaseUser(idToken: string, apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    )
    if (!r.ok) return false
    const data = await r.json()
    const user = data?.users?.[0]
    return Boolean(user && user.disabled !== true)
  } catch {
    return false
  }
}

interface KlapRequest {
  idToken?: string
  action?: string
  sourceUrl?: string
  name?: string
  options?: {
    language?: string
    maxDuration?: number
    maxClipCount?: number
    captions?: boolean
    reframe?: boolean
    emojis?: boolean
    introTitle?: boolean
    removeSilences?: boolean
    dimensions?: { width: number; height: number }
  }
  taskId?: string
  folderId?: string
  projectId?: string
  exportId?: string
}

interface KlapProject {
  id: string
  name?: string
  virality_score?: number | null
}

type KlapBody = Record<string, unknown> | null

async function klap(path: string, apiKey: string, init?: RequestInit): Promise<KlapBody> {
  const r = await fetch(`${KLAP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await r.text()
  let body: KlapBody = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!r.ok) {
    const detail = body?.message || body?.error || body?.raw || `HTTP ${r.status}`
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return body
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const apiKey = process.env.KLAP_API_KEY
  const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU'

  if (!apiKey) {
    return json(
      {
        error: 'klap-not-configured',
        message:
          'Video auto-editing is not set up yet. Add KLAP_API_KEY in Vercel → Settings → Environment Variables (get one at klap.app/rest-api), then redeploy.',
      },
      501,
    )
  }

  let payload: KlapRequest
  try {
    payload = (await req.json()) as KlapRequest
  } catch {
    return json({ error: 'bad request body' }, 400)
  }

  const { idToken, action } = payload ?? {}
  if (!idToken) return json({ error: 'missing idToken' }, 401)
  if (!(await verifyFirebaseUser(idToken, firebaseApiKey))) {
    return json({ error: 'not signed in' }, 403)
  }

  try {
    switch (action) {
      case 'generate': {
        const { sourceUrl, name, options } = payload
        if (!sourceUrl) return json({ error: 'sourceUrl is required' }, 400)

        const body = await klap('/tasks/video-to-shorts', apiKey, {
          method: 'POST',
          body: JSON.stringify({
            source_video_url: sourceUrl,
            language: options?.language || 'en',
            max_duration: options?.maxDuration ?? 60,
            max_clip_count: options?.maxClipCount ?? 5,
            name: name || 'Galaxy CRM clip',
            editing_options: {
              captions: options?.captions ?? true,
              reframe: options?.reframe ?? true,
              emojis: options?.emojis ?? false,
              intro_title: options?.introTitle ?? false,
              remove_silences: options?.removeSilences ?? true,
            },
            dimensions: options?.dimensions ?? { width: 1080, height: 1920 },
          }),
        })
        return json({ taskId: body?.id, folderId: body?.output_id, status: body?.status })
      }

      case 'task': {
        const { taskId } = payload
        if (!taskId) return json({ error: 'taskId is required' }, 400)
        const body = await klap(`/tasks/${encodeURIComponent(taskId)}`, apiKey)
        return json({ status: body?.status, folderId: body?.output_id })
      }

      case 'clips': {
        const { folderId } = payload
        if (!folderId) return json({ error: 'folderId is required' }, 400)
        const body = await klap(`/projects/${encodeURIComponent(folderId)}`, apiKey)
        // The list endpoint has returned both a bare array and a {projects:[…]}
        // wrapper across API revisions; accept either rather than break on it.
        const list: KlapProject[] = Array.isArray(body)
          ? (body as KlapProject[])
          : ((body?.projects as KlapProject[]) ?? [])
        return json({
          clips: list.map((p) => ({
            id: p.id,
            name: p.name ?? '',
            virality_score: p.virality_score ?? null,
            // Klap exposes previews through its hosted player; there is no raw
            // preview URL on the project object, so the modal iframes this.
            preview_url: `https://klap.app/player/${p.id}`,
          })),
        })
      }

      case 'export': {
        const { folderId, projectId } = payload
        if (!folderId || !projectId) return json({ error: 'folderId and projectId are required' }, 400)
        const body = await klap(
          `/projects/${encodeURIComponent(folderId)}/${encodeURIComponent(projectId)}/exports`,
          apiKey,
          { method: 'POST', body: JSON.stringify({}) },
        )
        return json({ exportId: body?.id, status: body?.status, url: body?.src_url ?? '' })
      }

      case 'export-status': {
        const { folderId, projectId, exportId } = payload
        if (!folderId || !projectId || !exportId) {
          return json({ error: 'folderId, projectId and exportId are required' }, 400)
        }
        const body = await klap(
          `/projects/${encodeURIComponent(folderId)}/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}`,
          apiKey,
        )
        return json({ status: body?.status, url: body?.src_url ?? '' })
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (err) {
    return json({ error: 'klap-error', message: err instanceof Error ? err.message : String(err) }, 502)
  }
}
