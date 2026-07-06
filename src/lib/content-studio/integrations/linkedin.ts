import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const API = 'https://api.linkedin.com/rest'

export const LI_NEEDS = ['VITE_LI_ACCESS_TOKEN (OAuth)', 'VITE_LI_ORG_ID (numeric org id)']

function env(key: string): string | undefined {
  const val = (import.meta.env as any)[key]
  if (!val) return val
  const prefix = key + '='
  return String(val).startsWith(prefix) ? String(val).slice(prefix.length) : String(val)
}

export function liConfigured(): boolean {
  return !!(env('VITE_LI_ACCESS_TOKEN') && env('VITE_LI_ORG_ID'))
}

export function liBrandId(): number {
  return Number(env('VITE_LI_BRAND_ID') || 1)
}

function headers() {
  return {
    Authorization: `Bearer ${env('VITE_LI_ACCESS_TOKEN')}`,
    'LinkedIn-Version': env('VITE_LI_VERSION') || '202405',
    'X-Restli-Protocol-Version': '2.0.0',
  }
}

async function j(url: string) {
  const r = await fetch(url, { headers: headers(), cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.message || `LinkedIn HTTP ${r.status}`)
  return data
}

export async function liPull(limit: number): Promise<AccountResult> {
  const orgId = env('VITE_LI_ORG_ID')!.trim().replace(/\D/g, '')
  const org = `urn:li:organization:${orgId}`
  const base: AccountResult = { ok: false, platform: 'LinkedIn', handle: org, account_id: orgId, follower_count: 0, posts: [] }
  try {
    try {
      const fol = await j(`${API}/networkSizes/${encodeURIComponent(org)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`)
      base.follower_count = n(fol.firstDegreeSize)
    } catch {
      // followers optional
    }

    const posts = await j(`${API}/posts?q=author&author=${encodeURIComponent(org)}&count=${Math.min(limit, 50)}&sortBy=LAST_MODIFIED`)
    const elements: any[] = posts.elements || []
    const out: NormPost[] = []

    for (const p of elements) {
      const urn: string = p.id || p.urn || ''
      const metrics = { ...ZERO }
      try {
        const stat = await j(
          `${API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}&shares[0]=${encodeURIComponent(urn)}`,
        )
        const s = stat.elements?.[0]?.totalShareStatistics || {}
        metrics.views = n(s.impressionCount)
        metrics.reach = n(s.uniqueImpressionsCount || s.impressionCount)
        metrics.likes = n(s.likeCount)
        metrics.comments = n(s.commentCount)
        metrics.shares = n(s.shareCount)
      } catch {
        // per-post stats may need a share urn; keep zeros
      }
      const title = (p.commentary || '').split('\n')[0].slice(0, 80) || 'LinkedIn post'
      out.push({
        ext_id: urn,
        ext_url: `https://www.linkedin.com/feed/update/${urn}`,
        platform: 'LinkedIn',
        title,
        publish_date: isoDate(p.createdAt || p.firstPublishedAt),
        format: 'Post',
        metrics,
      })
    }
    base.posts = out
    base.ok = true
    return base
  } catch (e: any) {
    base.error = String(e?.message || e)
    return base
  }
}
