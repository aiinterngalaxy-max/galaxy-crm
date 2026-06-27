import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const V = 'v21.0'
const G = `https://graph.facebook.com/${V}`

export const FB_NEEDS = ['VITE_FB_ACCESS_TOKEN (Page or long-lived user token)', 'VITE_FB_PAGE_ID (numeric page id)']

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
  if (!r.ok) throw new Error(data?.error?.message || `Facebook HTTP ${r.status}`)
  return data
}

export async function fbPull(limit: number): Promise<AccountResult> {
  const token = env('VITE_FB_ACCESS_TOKEN')!
  const pageId = env('VITE_FB_PAGE_ID')!.trim()
  const base: AccountResult = { ok: false, platform: 'Facebook', handle: '', account_id: pageId, follower_count: 0, posts: [] }
  try {
    const page = await j(`${G}/${pageId}?fields=name,followers_count&access_token=${token}`)
    base.handle = page.name || pageId
    base.follower_count = n(page.followers_count)

    const feed = await j(
      `${G}/${pageId}/posts?fields=id,message,story,permalink_url,created_time,attachments{type}&limit=${Math.min(limit, 100)}&access_token=${token}`,
    )

    const posts: NormPost[] = []
    for (const post of feed.data || []) {
      const metrics = { ...ZERO }
      try {
        const ins = await j(
          `${G}/${post.id}/insights?metric=post_impressions_unique,post_engaged_users,post_reactions_by_type_total,post_clicks&access_token=${token}`,
        )
        for (const row of ins.data || []) {
          const val = n(
            typeof row.values?.[0]?.value === 'object'
              ? Object.values(row.values[0].value as Record<string, number>).reduce((a: number, b) => a + Number(b), 0)
              : row.values?.[0]?.value,
          )
          if (row.name === 'post_impressions_unique') metrics.reach = val
          else if (row.name === 'post_engaged_users') metrics.views = val
          else if (row.name === 'post_reactions_by_type_total') metrics.likes = val
          else if (row.name === 'post_clicks') metrics.shares = val
        }
      } catch {
        // insights may not be available for all posts — keep zeros
      }
      try {
        const comments = await j(`${G}/${post.id}?fields=comments.summary(true)&access_token=${token}`)
        metrics.comments = n(comments.comments?.summary?.total_count)
      } catch {
        // ignore
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
