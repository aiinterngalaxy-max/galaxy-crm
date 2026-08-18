/**
 * Client-side caller for api/content-studio/social-preview.ts — a real
 * cover image + title for a pasted reference link (Instagram/YouTube/
 * TikTok/etc.), used by the Video Studio "Reference Link" field.
 */

export type SocialPlatform = 'instagram' | 'youtube' | 'tiktok' | 'facebook' | 'twitter' | 'linkedin' | 'generic'
export type SocialPreviewType = 'reel' | 'post' | 'video' | 'short' | 'profile' | 'link'

export interface SocialPreview {
  platform: SocialPlatform
  title: string
  description: string
  image: string
  url: string
  type: SocialPreviewType
}

export async function getSocialPreview(url: string): Promise<SocialPreview> {
  const res = await fetch('/api/content-studio/social-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data as SocialPreview
}

/** Hosts the existing image proxy (api/content-studio/thumb.ts) already
 *  allowlists — route through it for these so hotlink/Referer protection
 *  doesn't blank the image, and load everything else (generic og:image
 *  hosts) directly since proxying an arbitrary host is an SSRF risk the
 *  proxy deliberately refuses. */
const PROXIED_HOSTS = ['cdninstagram.com', 'fbcdn.net', 'ytimg.com', 'ggpht.com', 'licdn.com']

export function previewImageSrc(imageUrl: string): string {
  if (!imageUrl) return ''
  try {
    const host = new URL(imageUrl).hostname
    if (PROXIED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return `/api/content-studio/thumb?u=${encodeURIComponent(imageUrl)}`
    }
  } catch { /* fall through to direct */ }
  return imageUrl
}
