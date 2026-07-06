import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const V = 'v21.0'
const G = `https://graph.facebook.com/${V}`

export const IG_NEEDS = ['VITE_IG_ACCESS_TOKEN (long-lived)', 'VITE_IG_USER_ID (ig business id)']

function env(key: string): string | undefined {
  return (import.meta.env as any)[key]
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

    const cap = Math.min(limit, 100)
    const mediaFields = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count'

    const media = await j(`${G}/${uid}/media?fields=${mediaFields}&limit=${cap}&access_token=${token}`)

    // /reels returns Reels-tab posts not shared to the feed — these are invisible
    // to /media, which is why newly-uploaded Reels don't appear after sync.
    let reelsData: any[] = []
    try {
      const reels = await j(`${G}/${uid}/reels?fields=${mediaFields}&limit=${cap}&access_token=${token}`)
      reelsData = reels.data || []
    } catch {
      // endpoint unavailable for this account type — skip
    }

    // Merge feed posts and reels, deduplicating by Instagram media id.
    const seen = new Set<string>()
    const allMedia: any[] = []
    for (const m of [...(media.data || []), ...reelsData]) {
      if (!seen.has(m.id)) {
        seen.add(m.id)
        allMedia.push(m)
      }
    }

    const posts: NormPost[] = []
    for (const m of allMedia) {
      const mediaType = (m.media_type || '').toUpperCase()
      const metrics = { ...ZERO, likes: n(m.like_count), comments: n(m.comments_count) }

      // Batch all insight metrics into one request instead of four separate calls.
      // `plays` is the Reels-specific view count; `views` covers feed videos.
      try {
        const ins = await j(`${G}/${m.id}/insights?metric=reach,saved,shares,views,plays&access_token=${token}`)
        for (const row of ins.data || []) {
          const val = n(row.values?.[0]?.value ?? row.value)
          if (row.name === 'reach') metrics.reach = val
          else if (row.name === 'saved') metrics.saves = val
          else if (row.name === 'shares') metrics.shares = val
          else if (row.name === 'views' || row.name === 'plays') metrics.views = Math.max(metrics.views, val)
        }
      } catch {
        // insights not yet available (new post) or unsupported for this media type — keep zeros
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
