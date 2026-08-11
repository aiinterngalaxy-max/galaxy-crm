import { AccountResult, NormPost, ZERO, n, isoDate } from './types'
import { callProvider } from './proxy'

// The user/page tokens now live server-side; requests go through /api/social-proxy.
// The long-lived-token exchange and page-token lookup that used to run here (caching
// tokens in the Turso `cmo_settings` table) moved into the proxy, so no Facebook
// credential is ever held or stored by the browser.
export const FB_NEEDS = ['FB_ACCESS_TOKEN (User token)', 'FB_PAGE_ID (numeric page id)', 'FB_APP_ID', 'FB_APP_SECRET']

export async function fbPull(limit: number, pageId: string): Promise<AccountResult> {
  const page = (pageId || '').trim()
  const base: AccountResult = {
    ok: false, platform: 'Facebook', handle: '', account_id: page, follower_count: 0, posts: [],
  }

  try {
    if (!page) throw new Error('No Facebook page configured')

    try {
      const meta = await callProvider('facebook', `/${encodeURIComponent(page)}?fields=name`)
      base.handle = meta.name || page
    } catch {
      base.handle = page
    }

    try {
      const flw = await callProvider('facebook', `/${encodeURIComponent(page)}?fields=followers_count`)
      base.follower_count = n(flw.followers_count)
    } catch {
      base.follower_count = 0
    }

    const pageWithPosts = await callProvider(
      'facebook',
      `/${encodeURIComponent(page)}/feed?fields=id,message,story,permalink_url,created_time,attachments{type},reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_impressions_unique).period(lifetime)&limit=${Math.min(limit, 100)}`,
    )
    const feed = { data: pageWithPosts?.data || [] }

    const posts: NormPost[] = []

    for (const post of feed.data || []) {
      const metrics = { ...ZERO }

      metrics.likes    = n(post.reactions?.summary?.total_count)
      metrics.comments = n(post.comments?.summary?.total_count)
      metrics.shares   = n(post.shares?.count)

      for (const row of post.insights?.data || []) {
        const val = n(row.values?.[row.values.length - 1]?.value ?? row.value)
        if (row.name === 'post_impressions_unique') metrics.reach = val
        else if (row.name === 'post_impressions') metrics.views = val
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
