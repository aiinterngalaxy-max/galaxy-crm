import { auth } from '../../firebase'

// Client side of the social-integration proxy.
//
// No platform credentials exist in the browser any more. Each call names a provider
// and an origin-relative API path; /api/social-proxy attaches the token server-side.

const ENDPOINT = '/api/social-proxy'

export type ProviderKey = 'youtube' | 'instagram' | 'facebook' | 'linkedin'

export interface ProviderStatus {
  configured: boolean
  brandId: number
  accountId: string
}

export type StatusMap = Record<ProviderKey, ProviderStatus>

const EMPTY: StatusMap = {
  youtube: { configured: false, brandId: 1, accountId: '' },
  instagram: { configured: false, brandId: 1, accountId: '' },
  facebook: { configured: false, brandId: 1, accountId: '' },
  linkedin: { configured: false, brandId: 1, accountId: '' },
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser
  if (!user) throw new Error('You must be signed in to sync social accounts.')
  return { Authorization: `Bearer ${await user.getIdToken()}` }
}

let statusCache: StatusMap | undefined

/** Which providers the server has credentials for. Cached for the session. */
export async function providerStatus(force = false): Promise<StatusMap> {
  if (statusCache && !force) return statusCache
  try {
    const res = await fetch(`${ENDPOINT}?action=status`, { headers: await authHeader() })
    if (!res.ok) return EMPTY
    statusCache = (await res.json()) as StatusMap
    return statusCache
  } catch {
    // Not signed in, or the endpoint is unavailable — report nothing as connected
    // rather than throwing, since this drives a status panel.
    return EMPTY
  }
}

/**
 * Calls a provider API through the server proxy.
 * `path` must be origin-relative, e.g. `/channels?part=snippet&id=UC123`.
 */
export async function callProvider(provider: ProviderKey, path: string): Promise<any> {
  const url = `${ENDPOINT}?provider=${provider}&path=${encodeURIComponent(path)}`
  const res = await fetch(url, { headers: await authHeader(), cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || data?.error || data?.message || `${provider} HTTP ${res.status}`)
  }
  return data
}
