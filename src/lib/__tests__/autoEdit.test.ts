import { describe, it, expect } from 'vitest'
import {
  parseSilenceLog, computeKeepSegments, atempoChain, buildInsertClipFilter, buildMaskFilter,
  LOOK_RECIPES, hueToColorbalanceShift,
} from '../content-studio/autoEdit'

describe('parseSilenceLog', () => {
  it('pairs up start/end lines in ffmpeg silencedetect output', () => {
    const log = `
[silencedetect @ 0x1] silence_start: 2.5
[silencedetect @ 0x1] silence_end: 4.1 | silence_duration: 1.6
[silencedetect @ 0x1] silence_start: 10
[silencedetect @ 0x1] silence_end: 10.8 | silence_duration: 0.8
`
    expect(parseSilenceLog(log)).toEqual([
      { start: 2.5, end: 4.1 },
      { start: 10, end: 10.8 },
    ])
  })

  it('returns nothing for a log with no silence detected', () => {
    expect(parseSilenceLog('frame=  120 fps=30\nsize=   500kB time=00:00:04.00')).toEqual([])
  })

  // A clip that's still silent when ffmpeg stops has a start with no matching
  // end line — that trailing silence is real, but without an end timestamp
  // there's nothing to compute a keep-segment boundary from, so it's dropped
  // rather than guessed at.
  it('drops an unterminated trailing silence_start', () => {
    const log = '[x] silence_start: 5\n[x] silence_end: 7\n[x] silence_start: 20\n'
    expect(parseSilenceLog(log)).toEqual([{ start: 5, end: 7 }])
  })
})

describe('computeKeepSegments', () => {
  it('keeps everything when there is no silence', () => {
    expect(computeKeepSegments([], 30)).toEqual([{ start: 0, end: 30 }])
  })

  it('cuts a silent middle section, keeping padding on both sides', () => {
    const keep = computeKeepSegments([{ start: 10, end: 15 }], 30, { paddingSec: 0.5 })
    expect(keep).toEqual([
      { start: 0, end: 10.5 },
      { start: 14.5, end: 30 },
    ])
  })

  it('ignores silences shorter than minSilenceSec', () => {
    // A 0.3s gap is a natural pause, not dead air — filtered by minSilenceSec.
    const keep = computeKeepSegments([{ start: 10, end: 10.3 }], 30, { minSilenceSec: 0.5 })
    expect(keep).toEqual([{ start: 0, end: 30 }])
  })

  it('drops a segment that is entirely silence with no video left', () => {
    // Silence covers the whole clip (with padding eating the rest) — the
    // real-world case this must not crash on is an all-silent test clip.
    const keep = computeKeepSegments([{ start: 0, end: 30 }], 30, { paddingSec: 0 })
    expect(keep).toEqual([])
  })

  it('merges keep-segments left too close together to bother cutting', () => {
    // A single 0.7s silence with 0.3s padding on each side nets only 0.1s of
    // actual removed content — smaller than the 0.6s (2×padding) it would
    // cost to make it its own cut, so the two sides merge back into one
    // segment instead of producing a near-zero-length sliver.
    const keep = computeKeepSegments([{ start: 10, end: 10.7 }], 20, {
      paddingSec: 0.3,
      minSilenceSec: 0.5,
    })
    expect(keep).toEqual([{ start: 0, end: 20 }])
  })

  it('caps segment count by keeping the longest stretches, in original order', () => {
    // 5 silences carve 6 keep-segments of very different lengths; capped at 2,
    // it must return the two longest — but still in playback order.
    const silences = [
      { start: 5, end: 5.5 },
      { start: 10, end: 10.5 },
      { start: 15, end: 15.5 },
      { start: 20, end: 20.5 },
      { start: 25, end: 25.5 },
    ]
    const keep = computeKeepSegments(silences, 30, { paddingSec: 0, maxSegments: 2, minSilenceSec: 0.1 })
    expect(keep).toHaveLength(2)
    // Segments: [0,5]=5s [5.5,10]=4.5s [10.5,15]=4.5s [15.5,20]=4.5s [20.5,25]=4.5s [25.5,30]=4.5s
    // Longest is [0,5]; ties for second are broken by array order (first found).
    expect(keep[0]).toEqual({ start: 0, end: 5 })
    expect(keep.every((s, i) => i === 0 || s.start > keep[i - 1].start)).toBe(true)
  })
})

describe('atempoChain', () => {
  it('leaves a factor already in ffmpeg atempo\'s own 0.5-2.0 range as a single filter', () => {
    expect(atempoChain(1.5)).toBe('atempo=1.5')
    expect(atempoChain(2)).toBe('atempo=2')
    expect(atempoChain(0.5)).toBe('atempo=0.5')
  })

  it('chains two atempo=2 filters for a 4x speed-up (2 * 2 = 4, each within range)', () => {
    expect(atempoChain(4)).toBe('atempo=2,atempo=2')
  })

  it('chains two atempo=0.5 filters for a 0.25x slow-down (0.5 * 0.5 = 0.25)', () => {
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5')
  })

  it('produces a chain whose product equals the requested factor', () => {
    for (const factor of [0.25, 0.4, 0.6, 1, 1.8, 3, 4]) {
      const chain = atempoChain(factor)
      const product = chain.split(',').reduce((acc, part) => acc * Number(part.split('=')[1]), 1)
      expect(product).toBeCloseTo(factor, 5)
    }
  })
})

describe('buildInsertClipFilter', () => {
  it("builds a plain concat (no xfade) for transition 'none'", () => {
    const { filterComplex, clampedDuration } = buildInsertClipFilter(640, 360, 4, 1, 'none')
    expect(filterComplex).toContain('concat=n=2:v=1:a=1[outv][outa]')
    expect(filterComplex).not.toContain('xfade')
    expect(clampedDuration).toBe(1)
  })

  it('builds an xfade + acrossfade pair for the circle/iris transition (the original ask)', () => {
    const { filterComplex } = buildInsertClipFilter(640, 360, 4, 2, 'circleopen')
    expect(filterComplex).toContain('xfade=transition=circleopen:duration=2:offset=2')
    expect(filterComplex).toContain('acrossfade=d=2')
  })

  it('trims the base clip to end exactly at insertAt', () => {
    const { filterComplex } = buildInsertClipFilter(640, 360, 4, 1, 'fade')
    expect(filterComplex).toContain('[0:v]trim=end=4,')
    expect(filterComplex).toContain('[0:a]atrim=end=4,')
  })

  it('normalizes both inputs to the same width/height/fps so xfade can accept them', () => {
    const { filterComplex } = buildInsertClipFilter(720, 1280, 5, 1, 'wipeleft')
    expect(filterComplex).toContain('scale=720:1280:force_original_aspect_ratio=decrease')
    expect(filterComplex.match(/fps=30/g)?.length).toBe(2) // both v0 and v1 normalized
  })

  it('clamps the transition duration to the available lead-in (cannot crossfade longer than insertAt)', () => {
    const { filterComplex, clampedDuration } = buildInsertClipFilter(640, 360, 1.5, 5, 'fade')
    expect(clampedDuration).toBe(1.5)
    expect(filterComplex).toContain('duration=1.5')
    expect(filterComplex).toContain('offset=0') // dur === insertAt, so no lead-in before the transition
  })

  it('clamps the transition duration to a 3s ceiling even with a long lead-in available', () => {
    const { clampedDuration } = buildInsertClipFilter(640, 360, 20, 8, 'dissolve')
    expect(clampedDuration).toBe(3)
  })

  it('never lets clampedDuration fall below 0.1s', () => {
    const { clampedDuration } = buildInsertClipFilter(640, 360, 4, 0, 'fade')
    expect(clampedDuration).toBe(0.1)
  })
})

describe('buildMaskFilter', () => {
  it('darkens via a split + eq=brightness stage, gated to the time window', () => {
    const fc = buildMaskFilter(2, 5)
    expect(fc).toContain('split=2[base][toDark]')
    expect(fc).toContain('eq=brightness=-0.5')
    expect(fc).toContain("between(t\\,2\\,5)")
  })

  it('base stream (normal) is the FIRST maskedmerge input, dark is second — normal shows where the mask is black', () => {
    // Verified against a real ffmpeg render: maskedmerge shows its base
    // (1st) stream where the mask is black, overlay (2nd) where white — the
    // reverse order was tried first and produced an inverted (dark-inside)
    // spotlight in testing.
    const fc = buildMaskFilter(0, 3)
    expect(fc).toMatch(/\[base\]\[dark\]\[maskloop\]maskedmerge/)
  })

  it('loops the single mask PNG across the whole stream so it holds for the full window', () => {
    const fc = buildMaskFilter(0, 3)
    expect(fc).toContain('loop=-1:size=1')
  })
})

describe('hueToColorbalanceShift', () => {
  it('produces a positive blue shift and negative red shift for a blue hue (200deg)', () => {
    const { r, b } = hueToColorbalanceShift(200)
    expect(Number(b)).toBeGreaterThan(0)
    expect(Number(r)).toBeLessThan(0)
  })
  it('produces a positive red shift for a red hue (0deg)', () => {
    const { r } = hueToColorbalanceShift(0)
    expect(Number(r)).toBeGreaterThan(0)
  })
  it('wraps hues outside 0-360 the same as their in-range equivalent', () => {
    expect(hueToColorbalanceShift(560)).toEqual(hueToColorbalanceShift(200))
    expect(hueToColorbalanceShift(-160)).toEqual(hueToColorbalanceShift(200))
  })
})

describe('LOOK_RECIPES', () => {
  it('has a recipe for every LookName the command vocabulary advertises', () => {
    const names = ['sepia', 'negative', 'tealOrange', 'vintage', 'cinematic', 'hdr', 'colorize', 'duotone', 'oldFilm', 'super8', 'polaroid', 'camcorder']
    for (const name of names) expect(LOOK_RECIPES).toHaveProperty(name)
  })
  it('every recipe produces a non-empty filter string that honors the enable window it is given', () => {
    const w = ":enable='between(t\\,1\\,3)'"
    for (const [name, recipe] of Object.entries(LOOK_RECIPES)) {
      const vf = recipe(w, 200)
      expect(vf.length, `${name} produced an empty filter string`).toBeGreaterThan(0)
      expect(vf, `${name} did not include its enable window`).toContain(w)
    }
  })
  it('negative uses the negate filter (a full color invert)', () => {
    expect(LOOK_RECIPES.negative('', 0)).toContain('negate')
  })
  it('colorize response changes with hueDegrees (not a fixed/ignored parameter)', () => {
    const blue = LOOK_RECIPES.colorize('', 200)
    const red = LOOK_RECIPES.colorize('', 0)
    expect(blue).not.toBe(red)
  })
})
