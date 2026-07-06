import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const V = 'v21.0'
const G = `https://graph.facebook.com/${V}`

export const IG_NEEDS = ['VITE_IG_ACCESS_TOKEN (long-lived)', 'VITE_IG_USER_ID (ig business id)']

function env(key: string): string | undefined {
  const val = (import.meta.env as any)[key]
  if (!val) return val
  const prefix = key + '='
  return String(val).startsWith(prefix) ? String(val).slice(prefix.length) : String(val)
}

export function igConfigured(): boolean {
  return !!(env('VITE_IG_ACCESS_TOKEN') && env('VITE_IG_USER_ID'))
}

export function igBrandId(): number {
  return Number(env('VITE_IG_BRAND_ID') || 1)
}

async function j(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || `Instagram HTTP ${r.status}`)
  return data
}

export async function igPull(limit: number): Promise<AccountResult> {
  const token = env('VITE_IG_ACCESS_TOKEN')!
  const uid = env('VITE_IG_USER_ID')!.trim()
  const base: AccountResult = { ok: false, platform: 'Instagram', handle: '', account_id: uid, follower_count: 0, posts: [] }
  try {
    const me = await j(`${G}/${uid}?fields=username,followers_count&access_token=${token}`)
    base.handle = me.username || uid
    base.follower_count = n(me.followers_count)

    const media = await j(
      `${G}/${uid}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=${Math.min(limit, 50)}&access_token=${token}`,
    )

    const posts: NormPost[] = []
    for (const m of media.data || []) {
      const mediaType = (m.media_type || '').toUpperCase()
      const metrics = { ...ZERO, likes: n(m.like_count), comments: n(m.comments_count) }
      const insightMetrics = ['reach', 'saved', 'shares', 'views']
      for (const metric of insightMetrics) {
        try {
          const ins = await j(`${G}/${m.id}/insights?metric=${metric}&access_token=${token}`)
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
