import { describe, it, expect } from 'vitest'
import { decodeHtmlEntities } from '../creative'

/**
 * The og:description / og:image content lives inside an HTML attribute, so
 * Instagram's page source has it entity-escaped. Left undecoded, two things
 * broke silently: the thumbnail URL's `&amp;` in place of `&` split its signed
 * query params on the wire into wrong-named params, so Instagram's CDN
 * rejected the fetch and the vision model never saw the actual reel — every
 * "analysis" quietly degraded to a guess from the caption text alone. And the
 * caption itself carried raw numeric refs (`&#xe9;`, `&#x1f621;`) into the
 * model as literal text instead of the accented letter or emoji they encode.
 * Both strings below are real og:description / og:image content captured
 * from live Instagram reels through this exact pipeline.
 */
describe('decodeHtmlEntities', () => {
  it('restores & inside a signed CDN URL so the query string is not split on the wire', () => {
    const raw =
      'https://scontent-iad3-2.cdninstagram.com/v/t51.71878-15/x.jpg?stp=cmp1&amp;_nc_cat=103&amp;oh=abc&amp;oe=def'
    expect(decodeHtmlEntities(raw)).toBe(
      'https://scontent-iad3-2.cdninstagram.com/v/t51.71878-15/x.jpg?stp=cmp1&_nc_cat=103&oh=abc&oe=def',
    )
  })

  it('decodes hex numeric character references (accented letters, emoji)', () => {
    expect(decodeHtmlEntities('fianc&#xe9;')).toBe('fiancé')
    expect(decodeHtmlEntities('lock down&#x1f621;')).toBe('lock down😡')
  })

  it('decodes decimal numeric character references', () => {
    expect(decodeHtmlEntities('caf&#233;')).toBe('café')
  })

  it('decodes the standard named entities', () => {
    expect(decodeHtmlEntities('&quot;hello&quot; &amp; &lt;tag&gt; &#39;x&#39;')).toBe('"hello" & <tag> \'x\'')
  })

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('Lunch #hamont')).toBe('Lunch #hamont')
  })
})
