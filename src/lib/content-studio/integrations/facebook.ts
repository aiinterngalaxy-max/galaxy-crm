import { run, one } from '../db'
import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const V = 'v21.0'
const G = `https://graph.facebook.com/${V}`

export const FB_NEEDS = ['VITE_FB_ACCESS_TOKEN (User token)', 'VITE_FB_PAGE_ID (numeric page id)', 'VITE_FB_APP_ID', 'VITE_FB_APP_SECRET']

function env(key: string): string | undefined {
  const val = (import.meta.env as any)[key]
  if (!val) return val
  const prefix = key + '='
  return String(val).startsWith(prefix) ? String(val).slice(prefix.length) : String(val)
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

// Returns a long-lived token (60 days). Stores it in DB so we don't re-exchange every sync.
// Re-exchanges whenever the env token changes.
async function getLongLivedToken(userToken: string): Promise<string> {
  const appId = env('VITE_FB_APP_ID')
  const appSecret = env('VITE_FB_APP_SECRET')

  // Try stored token — only valid if it came from the same env token
  try {
    const stored = await one<{ value: string; updated_at: string }>(
      "SELECT value, updated_at FROM cmo_settings WHERE key='fb_long_lived_token'",
    )
    const storedSeed = await one<{ value: string }>(
      "SELECT value FROM cmo_settings WHERE key='fb_token_seed'",
    )
    if (stored?.value && storedSeed?.value === userToken) {
      const ageInDays = (Date.now() - new Date(stored.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      if (ageInDays < 55) return stored.value
    }
  } catch {
    // DB not ready yet — fall through
  }

  // If no App ID/Secret, can't exchange — use user token directly
  if (!appId || !appSecret) return userToken

  // Exchange for long-lived token
  try {
    const res = await j(
      `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${userToken}`,
    )
    const longLived = res.access_token
    if (longLived) {
      await run(
        `INSERT INTO cmo_settings(key, value, updated_at) VALUES('fb_long_lived_token', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        [longLived],
      )
      await run(
        `INSERT INTO cmo_settings(key, value, updated_at) VALUES('fb_token_seed', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        [userToken],
      )
      return longLived
    }
  } catch {
    // Exchange failed — use user token as fallback
  }

  return userToken
}

export async function fbPull(limit: number): Promise<AccountResult> {
  const userToken = env('VITE_FB_ACCESS_TOKEN')!
  const pageId = env('VITE_FB_PAGE_ID')!.trim()
  const base: AccountResult = {
    ok: false, platform: 'Facebook', handle: '', account_id: pageId, follower_count: 0, posts: [],
  }

  try {
    // Get long-lived user token (auto-exchanges and caches for 55 days)
    const longLivedToken = await getLongLivedToken(userToken)

    // Exchange for page access token
    let token = longLivedToken
    try {
      const pageTokenRes = await j(`${G}/${pageId}?fields=access_token,name&access_token=${longLivedToken}`)
      if (pageTokenRes.access_token) token = pageTokenRes.access_token
      base.handle = pageTokenRes.name || pageId
    } catch {
      base.handle = pageId
    }

    try {
      const flw = await j(`${G}/${pageId}?fields=followers_count&access_token=${token}`)
      base.follower_count = n(flw.followers_count)
    } catch {
      base.follower_count = 0
    }

    const pageWithPosts = await j(
      `${G}/${pageId}/feed?fields=id,message,story,permalink_url,created_time,attachments{type},reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_impressions_unique).period(lifetime)&limit=${Math.min(limit, 100)}&access_token=${token}`,
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
