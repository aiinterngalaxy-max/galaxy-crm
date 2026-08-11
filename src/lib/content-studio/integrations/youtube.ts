import { AccountResult, NormPost, ZERO, n, isoDate } from './types'
import { callProvider } from './proxy'

// The API key now lives server-side; requests go through /api/social-proxy.
export const YT_NEEDS = ['YT_API_KEY', 'YT_CHANNEL_ID (UC… or @handle)']

export async function ytPull(limit: number, channelId: string): Promise<AccountResult> {
  const chan = (channelId || '').trim()
  const base: AccountResult = {
    ok: false, platform: 'YouTube', handle: chan, account_id: chan, follower_count: 0, posts: [],
  }
  try {
    if (!chan) throw new Error('No YouTube channel configured')

    const sel = chan.startsWith('@') ? `forHandle=${encodeURIComponent(chan)}` : `id=${encodeURIComponent(chan)}`
    const ch = await callProvider('youtube', `/channels?part=statistics,contentDetails,snippet&${sel}`)
    const c = ch.items?.[0]
    if (!c) throw new Error('channel not found')
    base.account_id = c.id
    base.handle = c.snippet?.customUrl || c.snippet?.title || chan
    base.follower_count = n(c.statistics?.subscriberCount)
    const uploads = c.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) throw new Error('no uploads playlist')

    const pl = await callProvider(
      'youtube',
      `/playlistItems?part=contentDetails,snippet&playlistId=${encodeURIComponent(uploads)}&maxResults=${Math.min(limit, 50)}`,
    )
    const ids: string[] = (pl.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean)
    if (!ids.length) {
      base.ok = true
      return base
    }

    const vids = await callProvider(
      'youtube',
      `/videos?part=statistics,snippet,contentDetails&id=${encodeURIComponent(ids.join(','))}`,
    )
    const posts: NormPost[] = (vids.items || []).map((v: any) => ({
      ext_id: v.id,
      ext_url: `https://youtu.be/${v.id}`,
      platform: 'YouTube',
      title: v.snippet?.title || 'Untitled',
      publish_date: isoDate(v.snippet?.publishedAt),
      format: parseDuration(v.contentDetails?.duration) <= 60 ? 'Short' : 'Long-form',
      metrics: {
        ...ZERO,
        views: n(v.statistics?.viewCount),
        likes: n(v.statistics?.likeCount),
        comments: n(v.statistics?.commentCount),
      },
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
