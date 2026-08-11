import { AccountResult, NormPost, ZERO, n, isoDate } from './types'
import { callProvider } from './proxy'

// The access token now lives server-side; requests go through /api/social-proxy.
export const IG_NEEDS = ['IG_ACCESS_TOKEN (long-lived)', 'IG_USER_ID (ig business id)']

export async function igPull(limit: number, userId: string): Promise<AccountResult> {
  const uid = (userId || '').trim()
  const base: AccountResult = {
    ok: false, platform: 'Instagram', handle: '', account_id: uid, follower_count: 0, posts: [],
  }
  try {
    if (!uid) throw new Error('No Instagram business account configured')

    const me = await callProvider('instagram', `/${encodeURIComponent(uid)}?fields=username,followers_count`)
    base.handle = me.username || uid
    base.follower_count = n(me.followers_count)

    const media = await callProvider(
      'instagram',
      `/${encodeURIComponent(uid)}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=${Math.min(limit, 50)}`,
    )

    const posts: NormPost[] = []
    for (const m of media.data || []) {
      const mediaType = (m.media_type || '').toUpperCase()
      const metrics = { ...ZERO, likes: n(m.like_count), comments: n(m.comments_count) }
      const insightMetrics = ['reach', 'saved', 'shares', 'views']
      for (const metric of insightMetrics) {
        try {
          const ins = await callProvider('instagram', `/${encodeURIComponent(m.id)}/insights?metric=${metric}`)
          for (const row of ins.data || []) {
            const val = n(row.values?.[0]?.value ?? row.value)
            if (row.name === 'reach') metrics.reach = val
            else if (row.name === 'saved') metrics.saves = val
            else if (row.name === 'shares') metrics.shares = val
            else if (row.name === 'views') metrics.views = Math.max(metrics.views, val)
          }
        } catch {
          // unsupported metric for this media type — keep zero
        }
      }
      const title = (m.caption || '').split('\n')[0].slice(0, 80) || `Instagram ${mediaType || 'post'}`
      posts.push({
        ext_id: m.id,
        ext_url: m.permalink || '',
        platform: 'Instagram',
        title,
        publish_date: isoDate(m.timestamp),
        format: (m.media_product_type || m.media_type || '').toUpperCase() === 'REELS' ? 'Reel' : 'Post',
        metrics,
      })
    }
    base.posts = posts
    base.ok = true
    return base
  } catch (e: any) {
    base.error = String(e?.message || e)
    return base
  }
}
