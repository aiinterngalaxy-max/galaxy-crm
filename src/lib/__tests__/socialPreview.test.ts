import { describe, it, expect } from 'vitest'
import { normalizeSocialUrl } from '../../../api/content-studio/social-preview'

describe('normalizeSocialUrl', () => {
  describe('Instagram', () => {
    it('normalizes a reel URL', () => {
      expect(normalizeSocialUrl('https://www.instagram.com/reel/ABC123/')).toEqual({
        platform: 'instagram', type: 'reel', url: 'https://www.instagram.com/reel/ABC123/',
      })
    })
    it('normalizes a reel URL WITH tracking params (?igsh=...) to the same canonical URL as without', () => {
      const withTracking = normalizeSocialUrl('https://instagram.com/reel/ABC123/?igsh=xxxx')
      const bare = normalizeSocialUrl('https://www.instagram.com/reel/ABC123/')
      expect(withTracking.url).toBe(bare.url)
      expect(withTracking).toEqual({ platform: 'instagram', type: 'reel', url: 'https://www.instagram.com/reel/ABC123/' })
    })
    it('treats /reels/ (plural, the mobile-app share link form) the same as /reel/', () => {
      expect(normalizeSocialUrl('https://www.instagram.com/reels/ABC123/')).toMatchObject({ type: 'reel', url: 'https://www.instagram.com/reel/ABC123/' })
    })
    it('normalizes a post URL as type "post"', () => {
      expect(normalizeSocialUrl('https://www.instagram.com/p/XYZ789/')).toEqual({
        platform: 'instagram', type: 'post', url: 'https://www.instagram.com/p/XYZ789/',
      })
    })
    it('normalizes an IGTV/video URL as type "video"', () => {
      expect(normalizeSocialUrl('https://www.instagram.com/tv/QWE456/')).toMatchObject({ type: 'video' })
    })
    it('normalizes a bare profile URL as type "profile"', () => {
      expect(normalizeSocialUrl('https://www.instagram.com/somecreator/')).toEqual({
        platform: 'instagram', type: 'profile', url: 'https://www.instagram.com/somecreator/',
      })
    })
    it('recognizes instagram.com without www', () => {
      expect(normalizeSocialUrl('https://instagram.com/reel/ABC123/').platform).toBe('instagram')
    })
  })

  describe('YouTube', () => {
    it('normalizes a standard video URL, stripping tracking params', () => {
      expect(normalizeSocialUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&si=abc')).toEqual({
        platform: 'youtube', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      })
    })
    it('normalizes a Shorts URL as type "short"', () => {
      expect(normalizeSocialUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
        platform: 'youtube', type: 'short', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      })
    })
    it('normalizes a youtu.be short-link to the canonical watch URL', () => {
      expect(normalizeSocialUrl('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual({
        platform: 'youtube', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      })
    })
  })

  describe('other platforms', () => {
    it('recognizes TikTok', () => {
      expect(normalizeSocialUrl('https://www.tiktok.com/@someone/video/123456').platform).toBe('tiktok')
    })
    it('recognizes X/Twitter under both hostnames', () => {
      expect(normalizeSocialUrl('https://x.com/someone/status/123').platform).toBe('twitter')
      expect(normalizeSocialUrl('https://twitter.com/someone/status/123').platform).toBe('twitter')
    })
    it('recognizes LinkedIn', () => {
      expect(normalizeSocialUrl('https://www.linkedin.com/posts/someone_abc-123').platform).toBe('linkedin')
    })
    it('falls back to generic for an unrecognized site, still stripping query params', () => {
      expect(normalizeSocialUrl('https://example.com/some/page?utm_source=x')).toEqual({
        platform: 'generic', type: 'link', url: 'https://example.com/some/page',
      })
    })
  })

  describe('invalid input', () => {
    it('does not throw on an unparseable URL — returns a generic fallback instead', () => {
      expect(normalizeSocialUrl('not a url at all')).toEqual({ platform: 'generic', type: 'link', url: 'not a url at all' })
    })
  })
})
