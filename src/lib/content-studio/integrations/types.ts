export interface NormMetrics {
  views: number
  reach: number
  likes: number
  comments: number
  shares: number
  saves: number
  watch_time_sec: number
}

export interface NormPost {
  ext_id: string
  ext_url: string
  platform: string
  title: string
  publish_date: string | null
  format: string
  metrics: NormMetrics
}

export interface AccountResult {
  ok: boolean
  platform: string
  handle: string
  account_id: string
  follower_count: number
  posts: NormPost[]
  error?: string
}

export interface Provider {
  key: 'youtube' | 'instagram' | 'facebook' | 'linkedin'
  label: string
  brandId: number
  configured: boolean
  needs: string[]
  pull: (limit: number) => Promise<AccountResult>
}

export const ZERO: NormMetrics = {
  views: 0,
  reach: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  watch_time_sec: 0,
}

export function n(x: any): number {
  const v = Number(x)
  return isFinite(v) ? Math.round(v) : 0
}

export function isoDate(d: string | number | null | undefined): string | null {
  if (d === null || d === undefined || d === '') return null
  const dt = typeof d === 'number' ? new Date(d) : new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 10)
}
