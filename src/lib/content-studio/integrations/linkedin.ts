import { AccountResult, NormPost, ZERO, n, isoDate } from './types'
import { callProvider } from './proxy'

// The OAuth token now lives server-side; requests go through /api/social-proxy,
// which also sets the LinkedIn-Version and Restli protocol headers.
export const LI_NEEDS = ['LI_ACCESS_TOKEN (OAuth)', 'LI_ORG_ID (numeric org id)']

export async function liPull(limit: number, orgId: string): Promise<AccountResult> {
  const numericOrg = (orgId || '').trim().replace(/\D/g, '')
  const org = `urn:li:organization:${numericOrg}`
  const base: AccountResult = {
    ok: false, platform: 'LinkedIn', handle: org, account_id: numericOrg, follower_count: 0, posts: [],
  }
  try {
    if (!numericOrg) throw new Error('No LinkedIn organization configured')

    try {
      const fol = await callProvider(
        'linkedin',
        `/networkSizes/${encodeURIComponent(org)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      )
      base.follower_count = n(fol.firstDegreeSize)
    } catch {
      // followers optional
    }

    const posts = await callProvider(
      'linkedin',
      `/posts?q=author&author=${encodeURIComponent(org)}&count=${Math.min(limit, 50)}&sortBy=LAST_MODIFIED`,
    )
    const elements: any[] = posts.elements || []
    const out: NormPost[] = []

    for (const p of elements) {
      const urn: string = p.id || p.urn || ''
      const metrics = { ...ZERO }
      try {
        const stat = await callProvider(
          'linkedin',
          `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}&shares[0]=${encodeURIComponent(urn)}`,
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
