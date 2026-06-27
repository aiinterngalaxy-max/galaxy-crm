import { AccountResult, NormPost, ZERO, n, isoDate } from './types'

const API = 'https://www.googleapis.com/youtube/v3'

export const YT_NEEDS = ['VITE_YT_API_KEY', 'VITE_YT_CHANNEL_ID (UC… or @handle)']

function env(key: string): string | undefined {
  return (import.meta.env as any)[key]
}

export function ytConfigured(): boolean {
  return !!(env('VITE_YT_API_KEY') && env('VITE_YT_CHANNEL_ID'))
}

export function ytBrandId(): number {
  return Number(env('VITE_YT_BRAND_ID') || 1)
}

async function j(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || `YouTube HTTP ${r.status}`)
  return data
}

export async function ytPull(limit: number): Promise<AccountResult> {
  const key = env('VITE_YT_API_KEY')!
  const chan = env('VITE_YT_CHANNEL_ID')!.trim()
  const base: AccountResult = { ok: false, platform: 'YouTube', handle: chan, account_id: chan, follower_count: 0, posts: [] }
  try {
    const sel = chan.startsWith('@') ? `forHandle=${encodeURIComponent(chan)}` : `id=${encodeURIComponent(chan)}`
    const ch = await j(`${API}/channels?part=statistics,contentDetails,snippet&${sel}&key=${key}`)
    const c = ch.items?.[0]
    if (!c) throw new Error('channel not found')
    base.account_id = c.id
    base.handle = c.snippet?.customUrl || c.snippet?.title || chan
    base.follower_count = n(c.statistics?.subscriberCount)
    const uploads = c.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) throw new Error('no uploads playlist')

    const pl = await j(`${API}/playlistItems?part=contentDetails,snippet&playlistId=${uploads}&maxResults=${Math.min(limit, 50)}&key=${key}`)
    const ids: string[] = (pl.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean)
    if (!ids.length) {
      base.ok = true
      return base
    }
    const vids = await j(`${API}/videos?part=statistics,snippet,contentDetails&id=${ids.join(',')}&key=${key}`)
    const posts: NormPost[] = (vids.items || []).map((v: any) => ({
      ext_id: v.id,
      ext_url: `https://youtu.be/${v.id}`,
      platform: 'YouTube',
      title: v.snippet?.title || 'Untitled',
      publish_date: isoDate(v.snippet?.publishedAt),
      format: parseDuration(v.contentDetails?.duration) <= 60 ? 'Short' : 'Long-form',
      metrics: { ...ZERO, views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount) },
    }))
    base.posts = posts
    base.ok = true
    return base
  } catch (e: any) {
    base.error = String(e?.message || e)
    return base
  }
}

function parseDuration(d: string | undefined): number {
  if (!d) return 0
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}
