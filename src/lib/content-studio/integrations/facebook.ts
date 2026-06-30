import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const V = 'v21.0'
const G = `https://graph.facebook.com/${V}`

export const FB_NEEDS = ['VITE_FB_ACCESS_TOKEN (Page access token)', 'VITE_FB_PAGE_ID (numeric page id)']

function env(key: string): string | undefined {
  return (import.meta.env as any)[key]
}

export function fbConfigured(): boolean {
  return !!(env('VITE_FB_ACCESS_TOKEN') && env('VITE_FB_PAGE_ID'))
}

export function fbBrandId(): number {
  return Number(env('VITE_FB_BRAND_ID') || 1)
}

async function j(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  const data = await r.json()
  if (!r.ok || data?.error) {
    const msg = data?.error?.message || `Facebook HTTP ${r.status}`
    const code = data?.error?.code || r.status
    const type = data?.error?.type || ''
    console.error(`[Facebook API Error] code=${code} type=${type} message="${msg}"`)
    console.error(`[Facebook API Error] URL:`, url.replace(/access_token=[^&]+/, 'access_token=REDACTED'))
    throw new Error(msg)
  }
  return data
}

export async function fbPull(limit: number): Promise<AccountResult> {
  const token = env('VITE_FB_ACCESS_TOKEN')!
  const pageId = env('VITE_FB_PAGE_ID')!.trim()
  const base: AccountResult = {
    ok: false, platform: 'Facebook', handle: '', account_id: pageId, follower_count: 0, posts: [],
  }

  try {
    // Page basic info — fetch fields separately so a missing permission on one doesn't kill both
    try {
      const page = await j(`${G}/${pageId}?fields=name&access_token=${token}`)
      base.handle = page.name || pageId
    } catch {
      base.handle = pageId
    }
    try {
      const flw = await j(`${G}/${pageId}?fields=followers_count&access_token=${token}`)
      base.follower_count = n(flw.followers_count)
    } catch {
      base.follower_count = 0
    }

    // Field expansion on page object — different permission path than /posts endpoint
    const pageWithPosts = await j(
      `${G}/${pageId}?fields=posts.limit(${Math.min(limit, 100)}){id,message,story,permalink_url,created_time,attachments{type},reactions.summary(true),comments.summary(true),shares}&access_token=${token}`,
    )
    const feed = { data: pageWithPosts?.posts?.data || [] }

    const posts: NormPost[] = []

    for (const post of feed.data || []) {
      const metrics = { ...ZERO }

      // These come from post fields — always work with pages_read_engagement
      metrics.likes    = n(post.reactions?.summary?.total_count)
      metrics.comments = n(post.comments?.summary?.total_count)
      metrics.shares   = n(post.shares?.count)

      // Try reach/impressions via insights (needs read_insights — optional)
      try {
        const ins = await j(
          `${G}/${post.id}/insights?metric=post_impressions_unique,post_impressions&period=lifetime&access_token=${token}`,
        )
        for (const row of ins.data || []) {
          const rawVal = row.values?.[row.values.length - 1]?.value
          const val = n(typeof rawVal === 'object'
            ? Object.values(rawVal as Record<string, number>).reduce((a: number, b) => a + Number(b), 0)
            : rawVal)
          if (row.name === 'post_impressions_unique') metrics.reach = val
          else if (row.name === 'post_impressions') metrics.views = val
        }
      } catch {
        // read_insights not available — reach/impressions stay 0, rest of metrics are fine
      }

      const attachmentType = post.attachments?.data?.[0]?.type || ''
      const format = attachmentType.includes('video') ? 'Video' : 'Post'
      const title = (post.message || post.story || '').split('\n')[0].slice(0, 80) || `Facebook ${format}`

      posts.push({
        ext_id: post.id,
        ext_url: post.permalink_url || `https://www.facebook.com/${post.id}`,
        platform: 'Facebook',
        title,
        publish_date: isoDate(post.created_time),
        format,
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
