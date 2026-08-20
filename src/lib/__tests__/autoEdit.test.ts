import { describe, it, expect } from 'vitest'
import {
  parseSilenceLog, computeKeepSegments, atempoChain, buildInsertClipFilter, buildMaskFilter,
  LOOK_RECIPES, hueToColorbalanceShift, GLITCH_RECIPES, LIGHT_RECIPES, MOTION_RECIPES, buildSpeedRampFilter,
  AUDIO_RECIPES, VOICE_RECIPES, buildDoubleExposureFilter, buildSplitScreenFilter,
  buildRotateCoverScale, buildPivotRotateFilter, buildSpinAngleExpr, buildRotationAngleExpr, buildSwingAngleExpr, buildBounceZoomExpr,
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

describe('GLITCH_RECIPES', () => {
  const names = ['rgbSplit', 'tvNoise', 'screenFlicker', 'vhs', 'scanLines', 'digitalGlitch', 'signalDistortion'] as const

  it('has a recipe for every GlitchStyle the command vocabulary advertises', () => {
    for (const name of names) expect(GLITCH_RECIPES).toHaveProperty(name)
  })

  it('every non-burst style produces a non-empty filter string that honors its enable window', () => {
    const w = ":enable='between(t\\,1\\,3)'"
    for (const name of names) {
      if (name === 'digitalGlitch') continue // burst style — checked separately, its OWN sub-windows differ from w
      const vf = GLITCH_RECIPES[name](w, 0.5, 1, 3)
      expect(vf.length, `${name} produced an empty filter string`).toBeGreaterThan(0)
      expect(vf, `${name} did not include its enable window`).toContain(w)
    }
  })

  it('rgbSplit shifts red and blue in opposite directions (the actual "split" look)', () => {
    const vf = GLITCH_RECIPES.rgbSplit('', 0.5, 0, 1)
    const rh = Number(vf.match(/rh=(-?\d+)/)?.[1])
    const bh = Number(vf.match(/bh=(-?\d+)/)?.[1])
    expect(rh).toBeGreaterThan(0)
    expect(bh).toBeLessThan(0)
    expect(rh).toBe(-bh)
  })

  it('digitalGlitch builds several short burst sub-windows inside [start,end], not one continuous effect', () => {
    const vf = GLITCH_RECIPES.digitalGlitch('', 0.5, 10, 20)
    const windows = [...vf.matchAll(/between\(t\\,([\d.]+)\\,([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(windows.length).toBeGreaterThanOrEqual(3)
    for (const [bStart, bEnd] of windows) {
      expect(bStart).toBeGreaterThanOrEqual(10)
      expect(bEnd).toBeLessThanOrEqual(20)
    }
  })

  it('strength scales intensity (higher strength shifts pixels further / adds more noise)', () => {
    const low = GLITCH_RECIPES.rgbSplit('', 0.1, 0, 1)
    const high = GLITCH_RECIPES.rgbSplit('', 0.9, 0, 1)
    const lowShift = Number(low.match(/rh=(\d+)/)?.[1])
    const highShift = Number(high.match(/rh=(\d+)/)?.[1])
    expect(highShift).toBeGreaterThan(lowShift)
  })
})

describe('LIGHT_RECIPES', () => {
  const singleVfStyles = ['flash', 'strobe', 'flicker', 'glow', 'bloom'] as const

  it('has a recipe for every single-vf LightStyle (lightLeak is handled separately via filter_complex)', () => {
    for (const name of singleVfStyles) expect(LIGHT_RECIPES).toHaveProperty(name)
  })

  it('every recipe produces a non-empty filter string that honors the enable window it is given', () => {
    const w = ":enable='between(t\\,1\\,3)'"
    for (const name of singleVfStyles) {
      const vf = LIGHT_RECIPES[name]!(w, 0.5, 1)
      expect(vf.length, `${name} produced an empty filter string`).toBeGreaterThan(0)
      expect(vf, `${name} did not include its enable window`).toContain(w)
    }
  })

  it('glow/bloom use blend=screen with an opacity that scales with strength, not a fixed value', () => {
    const low = LIGHT_RECIPES.glow!('', 0.1, 0)
    const high = LIGHT_RECIPES.glow!('', 0.9, 0)
    const lowOpacity = Number(low.match(/all_opacity=([\d.]+)/)?.[1])
    const highOpacity = Number(high.match(/all_opacity=([\d.]+)/)?.[1])
    expect(highOpacity).toBeGreaterThan(lowOpacity)
  })

  it('flash decays from the window start (uses an exp() falloff, not a flat/constant value)', () => {
    const vf = LIGHT_RECIPES.flash!('', 0.5, 3)
    expect(vf).toContain('exp(-8*(t-3))')
  })
})

describe('MOTION_RECIPES', () => {
  it('has a recipe for every single-vf MotionStyle (zoomPunch/speedRamp are handled separately)', () => {
    for (const name of ['cameraShake', 'wobble', 'motionTrail']) expect(MOTION_RECIPES).toHaveProperty(name)
  })

  it('cameraShake/wobble fold the [start,end] window into the x/y expression itself, not :enable=', () => {
    // Caught by testing: crop fails to initialize when a time-varying x/y
    // expression is combined with :enable= ("Error initializing filter
    // 'crop'") — the fix bakes the window check into an if(between(...))
    // inside the expression instead.
    for (const name of ['cameraShake', 'wobble'] as const) {
      const vf = MOTION_RECIPES[name]!(0.5, 1, 3)
      expect(vf, `${name} must not use the shared :enable= clause`).not.toContain(":enable=")
      expect(vf, `${name} must gate its shake formula with if(between(...))`).toContain('if(between(t')
    }
  })

  it('motionTrail still uses the shared :enable= window (tmix has no conflict with it)', () => {
    const vf = MOTION_RECIPES.motionTrail!(0.5, 1, 3)
    expect(vf).toContain(":enable='between(t\\,1\\,3)'")
  })

  it('strength scales cameraShake/wobble amplitude', () => {
    const low = MOTION_RECIPES.cameraShake!(0.1, 0, 1)
    const high = MOTION_RECIPES.cameraShake!(0.9, 0, 1)
    expect(low).not.toBe(high)
  })
})

describe('buildSpeedRampFilter', () => {
  it('produces 3 speed factors: slower, normal, faster', () => {
    const { factors } = buildSpeedRampFilter(0, 3, 0.5)
    expect(factors).toHaveLength(3)
    expect(factors[0]).toBeLessThan(1)
    expect(factors[1]).toBe(1)
    expect(factors[2]).toBeGreaterThan(1)
  })

  it('clamps factors to a sane range regardless of strength', () => {
    const { factors } = buildSpeedRampFilter(0, 3, 1)
    expect(factors[0]).toBeGreaterThanOrEqual(0.25)
    expect(factors[2]).toBeLessThanOrEqual(4)
  })

  it('splices in unmodified before/after segments around the ramped window', () => {
    const { filterComplex } = buildSpeedRampFilter(2, 5, 0.5)
    expect(filterComplex).toContain('trim=end=2')
    expect(filterComplex).toContain('trim=start=5')
    expect(filterComplex).toContain('concat=n=5:v=1:a=1')
  })
})

describe('AUDIO_RECIPES', () => {
  const styles = ['equalizer', 'reverb', 'echo', 'distortion', 'bassBoost', 'pitch', 'mono', 'fadeIn', 'fadeOut'] as const

  it('has a recipe for every AudioStyle the command vocabulary advertises', () => {
    for (const style of styles) expect(AUDIO_RECIPES).toHaveProperty(style)
  })

  it('pitch shifts sample rate up for "up" and down for "down", each compensated by the inverse atempo', () => {
    const up = AUDIO_RECIPES.pitch(0.5, 'up', 1)
    const down = AUDIO_RECIPES.pitch(0.5, 'down', 1)
    const upRate = Number(up.match(/asetrate=44100\*([\d.]+)/)?.[1])
    const downRate = Number(down.match(/asetrate=44100\*([\d.]+)/)?.[1])
    expect(upRate).toBeGreaterThan(1)
    expect(downRate).toBeLessThan(1)
    // atempo must be the exact inverse of the rate multiplier, or duration drifts
    const upTempo = Number(up.match(/atempo=([\d.]+)/)?.[1])
    expect(upTempo * upRate).toBeCloseTo(1, 2)
  })

  it('reverb layers multiple aecho taps (pipe-separated delays/decays), not a single echo', () => {
    const vf = AUDIO_RECIPES.reverb(0.5, 'up', 1)
    expect(vf).toContain('aecho=')
    expect(vf.split('|').length).toBeGreaterThanOrEqual(3) // at least 3 delay taps
  })

  it('mono ignores strength — same output regardless', () => {
    expect(AUDIO_RECIPES.mono(0.1, 'up', 1)).toBe(AUDIO_RECIPES.mono(0.9, 'up', 1))
  })

  it('bassBoost gain scales with strength', () => {
    const low = Number(AUDIO_RECIPES.bassBoost(0.1, 'up', 1).match(/g=([\d.]+)/)?.[1])
    const high = Number(AUDIO_RECIPES.bassBoost(0.9, 'up', 1).match(/g=([\d.]+)/)?.[1])
    expect(high).toBeGreaterThan(low)
  })
})

describe('VOICE_RECIPES', () => {
  const presets = ['robot', 'chipmunk', 'deep'] as const

  it('has a recipe for every VoicePreset the command vocabulary advertises', () => {
    for (const preset of presets) expect(VOICE_RECIPES).toHaveProperty(preset)
  })

  it('chipmunk raises sample rate, deep lowers it — each compensated by the inverse atempo, same trick pitch uses', () => {
    for (const [preset, expectHigher] of [['chipmunk', true], ['deep', false]] as const) {
      const recipe = VOICE_RECIPES[preset]
      const rate = Number(recipe.match(/asetrate=44100\*([\d.]+)/)?.[1])
      const tempo = Number(recipe.match(/atempo=([\d.]+)/)?.[1])
      expect(expectHigher ? rate > 1 : rate < 1).toBe(true)
      expect(tempo * rate).toBeCloseTo(1, 1)
    }
  })

  it('every preset builds a real filter chain, not an empty/placeholder string', () => {
    for (const preset of presets) expect(VOICE_RECIPES[preset].length).toBeGreaterThan(0)
  })
})

describe('buildDoubleExposureFilter', () => {
  it('mirrors a translucent copy of the frame over the original within the time window', () => {
    const vf = buildDoubleExposureFilter(10, 1, 4)
    expect(vf).toContain('hflip')
    expect(vf).toContain('colorchannelmixer=aa=')
    expect(vf).toContain("between(t\\,1\\,4)")
    expect(vf).toContain('[outv]')
  })

  it('ghost opacity scales with strength, capped at 0.95', () => {
    const low = Number(buildDoubleExposureFilter(1, 0, 1).match(/colorchannelmixer=aa=([\d.]+)/)?.[1])
    const high = Number(buildDoubleExposureFilter(20, 0, 1).match(/colorchannelmixer=aa=([\d.]+)/)?.[1])
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThanOrEqual(0.95)
  })
})

describe('buildSplitScreenFilter', () => {
  it('crops left/right halves and hstacks them, gated to the time window', () => {
    const vf = buildSplitScreenFilter(2, 5)
    expect(vf).toContain('crop=w=iw/2:h=ih')
    expect(vf).toContain('hflip')
    expect(vf).toContain('hstack=inputs=2')
    expect(vf).toContain("between(t\\,2\\,5)")
    expect(vf).toContain('[outv]')
  })

  it('has no strength-driven parameter — same filter chain regardless of call site', () => {
    const a = buildSplitScreenFilter(0, 3)
    const b = buildSplitScreenFilter(0, 3)
    expect(a).toBe(b)
  })
})

describe('buildRotateCoverScale', () => {
  it('is never below 1 (never shrinks the frame)', () => {
    expect(buildRotateCoverScale(1920, 1080, 0, Math.PI)).toBeGreaterThanOrEqual(1)
  })
  it('a full-circle sweep needs strictly more coverage than a small-angle sweep', () => {
    const small = buildRotateCoverScale(1920, 1080, 0, 0.1)
    const full = buildRotateCoverScale(1920, 1080, 0, Math.PI)
    expect(full).toBeGreaterThan(small)
  })
  it('at angle 0 a square frame needs no extra scale', () => {
    expect(buildRotateCoverScale(1000, 1000, 0, 0)).toBeCloseTo(1, 4)
  })
})

describe('buildPivotRotateFilter', () => {
  it('produces the pad/scale/rotate/crop chain in order', () => {
    const vf = buildPivotRotateFilter(1920, 1080, 0.5, 0.5, '0', 0, Math.PI)
    const stages = vf.split(',')
    expect(stages[0]).toMatch(/^pad=/)
    expect(stages[1]).toMatch(/^scale=/)
    expect(stages[2]).toMatch(/^rotate=/)
    expect(stages[3]).toMatch(/^crop=/)
  })
  it('a centered pivot (0.5,0.5) pads by exactly 1x (a no-op pad)', () => {
    const vf = buildPivotRotateFilter(1920, 1080, 0.5, 0.5, '0', 0, Math.PI)
    expect(vf).toContain("pad=w='iw*1.0000'")
    expect(vf).toContain("pad=w='iw*1.0000':h='ih*1.0000'")
  })
  it('an off-center pivot pads by more than 1x on at least one axis', () => {
    const vf = buildPivotRotateFilter(1920, 1080, 0.2, 0.5, '0', 0, Math.PI)
    expect(vf).not.toContain("pad=w='iw*1.0000':h='ih*1.0000'")
  })
})

describe('buildSpinAngleExpr', () => {
  it('clockwise advances the angle positively over time, counterclockwise negatively', () => {
    const cw = buildSpinAngleExpr(10, 'clockwise', 0, 5)
    const ccw = buildSpinAngleExpr(10, 'counterclockwise', 0, 5)
    expect(cw.startsWith('1*')).toBe(true)
    expect(ccw.startsWith('-1*')).toBe(true)
  })
  it('holds the angle before start and after end via clip(t,start,end)', () => {
    const expr = buildSpinAngleExpr(10, 'clockwise', 2, 6)
    expect(expr).toContain('clip(t\\,2\\,6)')
  })
})

describe('buildRotationAngleExpr', () => {
  it('interpolates linearly from fromDegrees to toDegrees converted to radians', () => {
    const expr = buildRotationAngleExpr(0, 90, 0, 2)
    const fromRad = 0
    const toRad = Math.PI / 2
    expect(expr).toContain(String(fromRad))
    expect(expr).toContain(String(toRad - fromRad))
  })
})

describe('buildSwingAngleExpr', () => {
  it('settles back to exactly 0 at progress=1 (no discontinuity)', () => {
    // sin(2*PI*2.5*1) = sin(5*PI) = 0 exactly, so the expression algebraically
    // evaluates to 0 at t=end regardless of amplitude/strength.
    const expr = buildSwingAngleExpr(10, 0, 4)
    expect(expr).toContain('sin(2*PI*2.5*')
    expect(expr).toContain('exp(-4*')
  })
  it('peak swing amplitude scales with strength', () => {
    const low = buildSwingAngleExpr(1, 0, 4)
    const high = buildSwingAngleExpr(20, 0, 4)
    const lowAmp = Number(low.match(/^([\d.]+)\*sin/)?.[1])
    const highAmp = Number(high.match(/^([\d.]+)\*sin/)?.[1])
    expect(highAmp).toBeGreaterThan(lowAmp)
  })
})

describe('buildBounceZoomExpr', () => {
  it('is neutral (scale factor 1 baseline) before startFrame and after endFrame', () => {
    const expr = buildBounceZoomExpr(10, 30, 90)
    expect(expr).toContain('lt(on\\,30)\\,0')
    expect(expr).toContain('gt(on\\,90)\\,1')
  })
  it('pop amplitude scales with strength', () => {
    const low = buildBounceZoomExpr(1, 0, 60)
    const high = buildBounceZoomExpr(20, 0, 60)
    const lowAmp = Number(low.match(/^1\+([\d.]+)\*sin/)?.[1])
    const highAmp = Number(high.match(/^1\+([\d.]+)\*sin/)?.[1])
    expect(highAmp).toBeGreaterThan(lowAmp)
  })
})
