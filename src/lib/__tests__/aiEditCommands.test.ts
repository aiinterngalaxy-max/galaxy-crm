import { describe, it, expect, vi } from 'vitest'
import {
  validateCommand, interpretInstruction, targetToCenter, directionToPanPoints,
  describeAiCommand, describeAiCommandCard,
  type InterpretContext, type EditCommand,
} from '../content-studio/aiEditCommands'

const callClaude = vi.hoisted(() => vi.fn())
vi.mock('../ai', () => ({ callClaude }))

// Deliberately no shared beforeEach(() => callClaude.mockReset()) here: in
// this vitest version, calling .mockReset()/.mockClear() on a hoisted mock
// from WITHIN a beforeEach hook (as opposed to directly in a test body)
// breaks that mock's async-rejection handling for the rest of the run —
// confirmed by bisection: a test whose mock throws catches it fine as the
// only test in a file, and fine again with a no-op beforeEach, but starts
// reporting the caught-and-handled rejection as an uncaught test failure
// the moment ANY beforeEach calls .mockReset()/.mockClear() on it, even in
// an unrelated earlier test. Each test below sets its own mock behavior
// explicitly instead (mockResolvedValue/mockImplementation overwrite
// whatever the previous test left), and the two tests that check call
// history call mockClear() as their own first line, not from a hook.

const ctx: InterpretContext = { durationSec: 20, hasMusic: false }

describe('validateCommand', () => {
  it('rejects a non-object', () => {
    expect(validateCommand(null, ctx)).toEqual({ error: expect.any(String) })
    expect(validateCommand('zoom', ctx)).toEqual({ error: expect.any(String) })
  })

  it('rejects an unknown command type', () => {
    const result = validateCommand({ type: 'delete_everything' }, ctx)
    expect(result).toHaveProperty('error')
  })

  describe('trim', () => {
    it('accepts a valid window', () => {
      expect(validateCommand({ type: 'trim', start: 2, end: 10 }, ctx)).toEqual({ type: 'trim', start: 2, end: 10 })
    })
    it('rejects a missing end', () => {
      expect(validateCommand({ type: 'trim', start: 2 }, ctx)).toHaveProperty('error')
    })
    it('rejects end <= start', () => {
      expect(validateCommand({ type: 'trim', start: 5, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'trim', start: 5, end: 2 }, ctx)).toHaveProperty('error')
    })
    it('rejects a negative start', () => {
      expect(validateCommand({ type: 'trim', start: -1, end: 5 }, ctx)).toHaveProperty('error')
    })
    it('rejects a start past the end of the video', () => {
      expect(validateCommand({ type: 'trim', start: 25, end: 30 }, ctx)).toHaveProperty('error')
    })
    it('clamps an end past the video duration rather than rejecting it', () => {
      // A slightly-over end (rounding in the AI's own math) shouldn't be a
      // hard failure — clamped to the real duration instead.
      expect(validateCommand({ type: 'trim', start: 2, end: 999 }, ctx)).toEqual({ type: 'trim', start: 2, end: 20 })
    })
  })

  describe('crop', () => {
    it('accepts an allowed aspect', () => {
      expect(validateCommand({ type: 'crop', aspect: '9:16' }, ctx)).toEqual({ type: 'crop', aspect: '9:16' })
    })
    it('rejects an unsupported aspect string', () => {
      expect(validateCommand({ type: 'crop', aspect: '21:9' }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing aspect', () => {
      expect(validateCommand({ type: 'crop' }, ctx)).toHaveProperty('error')
    })
  })

  describe('zoom', () => {
    it('accepts a full valid zoom', () => {
      const result = validateCommand({ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' }, ctx)
      expect(result).toEqual({ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' })
    })
    it('defaults fromScale to 1 when omitted', () => {
      const result = validateCommand({ type: 'zoom', start: 5, end: 8, toScale: 2 }, ctx)
      expect(result).toMatchObject({ fromScale: 1, toScale: 2 })
    })
    it('defaults an unrecognized/missing target to center', () => {
      const result = validateCommand({ type: 'zoom', start: 5, end: 8, toScale: 2, target: 'nowhere' }, ctx)
      expect(result).toMatchObject({ target: 'center' })
    })
    it('rejects a missing toScale — this is the "never invent a value" case', () => {
      const result = validateCommand({ type: 'zoom', start: 5, end: 8 }, ctx)
      expect(result).toHaveProperty('error')
    })
    it('rejects a scale outside 0.5x-4x', () => {
      expect(validateCommand({ type: 'zoom', start: 5, end: 8, toScale: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'zoom', start: 5, end: 8, toScale: 0.1 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing time window', () => {
      expect(validateCommand({ type: 'zoom', toScale: 1.5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('pan', () => {
    it('accepts a valid pan with default scale', () => {
      const result = validateCommand({ type: 'pan', start: 0, end: 5, direction: 'left-to-right' }, ctx)
      expect(result).toMatchObject({ type: 'pan', direction: 'left-to-right', scale: 1.3 })
    })
    it('rejects an invalid direction', () => {
      expect(validateCommand({ type: 'pan', start: 0, end: 5, direction: 'diagonally' }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing direction rather than guessing one', () => {
      expect(validateCommand({ type: 'pan', start: 0, end: 5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('speed', () => {
    it('accepts a valid factor', () => {
      expect(validateCommand({ type: 'speed', start: 2, end: 5, factor: 1.5 }, ctx)).toEqual({ type: 'speed', start: 2, end: 5, factor: 1.5 })
    })
    it('rejects a factor outside 0.25x-4x', () => {
      expect(validateCommand({ type: 'speed', start: 2, end: 5, factor: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'speed', start: 2, end: 5, factor: 0.1 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing factor', () => {
      expect(validateCommand({ type: 'speed', start: 2, end: 5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('text/caption', () => {
    it('accepts a windowed caption', () => {
      const result = validateCommand({ type: 'caption', text: 'Hello', start: 1, end: 4 }, ctx)
      expect(result).toMatchObject({ type: 'caption', text: 'Hello', start: 1, end: 4, position: 'bottom', size: 'md' })
    })
    it('accepts 0/0 as "whole video", not a missing time', () => {
      const result = validateCommand({ type: 'text', text: 'Hello' }, ctx)
      expect(result).toMatchObject({ start: 0, end: 0 })
    })
    it('rejects empty text', () => {
      expect(validateCommand({ type: 'text', text: '   ' }, ctx)).toHaveProperty('error')
    })
    it('rejects text over 200 characters', () => {
      expect(validateCommand({ type: 'text', text: 'x'.repeat(201) }, ctx)).toHaveProperty('error')
    })
    it('rejects an invalid position/size by falling back to the default rather than erroring', () => {
      const result = validateCommand({ type: 'text', text: 'Hi', position: 'diagonal', size: 'huge' }, ctx)
      expect(result).toMatchObject({ position: 'bottom', size: 'md' })
    })
    it('accepts a supported fontFamily, case-insensitively', () => {
      const result = validateCommand({ type: 'text', text: 'Hi', fontFamily: 'times new roman' }, ctx)
      expect(result).toMatchObject({ fontFamily: 'Times New Roman' })
    })
    it('rejects an unrecognized fontFamily rather than silently dropping it — unlike position/size, there is no safe default font to fall back to', () => {
      const result = validateCommand({ type: 'text', text: 'Hi', fontFamily: 'Papyrus' }, ctx)
      expect(result).toEqual({ error: expect.stringContaining('Papyrus') })
    })
    it('accepts color/bold/outline set directly on a brand-new text, no text_style needed', () => {
      const result = validateCommand(
        { type: 'text', text: 'Galaxy', start: 0, end: 5, position: 'bottom', color: 'red', fontFamily: 'Times New Roman' },
        ctx,
      )
      expect(result).toEqual({
        type: 'text', text: 'Galaxy', start: 0, end: 5, position: 'bottom', size: 'md',
        color: 'red', fontFamily: 'Times New Roman',
      })
    })
    it('accepts italic/underline/strikethrough and a custom background directly on a brand-new text', () => {
      const result = validateCommand(
        { type: 'text', text: 'Galaxy', start: 0, end: 5, italic: true, underline: true, strikethrough: true, backgroundColor: 'blue', backgroundOpacity: 0.3 },
        ctx,
      )
      expect(result).toMatchObject({ italic: true, underline: true, strikethrough: true, backgroundColor: 'blue', backgroundOpacity: 0.3 })
    })
    it('rejects a backgroundOpacity outside 0-1', () => {
      expect(validateCommand({ type: 'text', text: 'Hi', backgroundOpacity: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'text', text: 'Hi', backgroundOpacity: -0.1 }, ctx)).toHaveProperty('error')
    })

    describe('entrance animation (TEST: "text sliding down from the top, one line at a time")', () => {
      it('accepts a slide-down entrance directly on a brand-new text', () => {
        const result = validateCommand({ type: 'text', text: 'Hey', start: 0, end: 1.2, animation: 'slide-down' }, ctx)
        expect(result).toMatchObject({ animation: 'slide-down' })
      })
      it('accepts slide-up, fade, bounce, shake and blur-in too', () => {
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'slide-up' }, ctx)).toMatchObject({ animation: 'slide-up' })
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'fade' }, ctx)).toMatchObject({ animation: 'fade' })
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'bounce' }, ctx)).toMatchObject({ animation: 'bounce' })
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'shake' }, ctx)).toMatchObject({ animation: 'shake' })
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'blur-in' }, ctx)).toMatchObject({ animation: 'blur-in' })
      })
      it('rejects an unrecognized animation rather than silently dropping it', () => {
        const result = validateCommand({ type: 'text', text: 'Hi', animation: 'spin' }, ctx)
        expect(result).toEqual({ error: expect.stringContaining('spin') })
      })
      it('accepts a standing glow, independent of animation', () => {
        expect(validateCommand({ type: 'text', text: 'Hi', glow: true }, ctx)).toMatchObject({ glow: true })
        expect(validateCommand({ type: 'text', text: 'Hi', glow: false }, ctx)).toMatchObject({ glow: false })
      })
      it('accepts a custom animationDuration', () => {
        const result = validateCommand({ type: 'text', text: 'Hi', animation: 'fade', animationDuration: 1.5 }, ctx)
        expect(result).toMatchObject({ animationDuration: 1.5 })
      })
      it('rejects an animationDuration outside 0-3 seconds', () => {
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'fade', animationDuration: 5 }, ctx)).toHaveProperty('error')
        expect(validateCommand({ type: 'text', text: 'Hi', animation: 'fade', animationDuration: 0 }, ctx)).toHaveProperty('error')
      })
      it('a multi-line staggered intro is several separate text commands sharing the same animation', () => {
        const first = validateCommand({ type: 'text', text: 'Hey', start: 0, end: 1.2, animation: 'slide-down' }, ctx)
        const second = validateCommand({ type: 'text', text: "I'm the CEO of Galaxy", start: 1, end: 3.5, animation: 'slide-down' }, ctx)
        expect(first).toMatchObject({ text: 'Hey', start: 0, end: 1.2, animation: 'slide-down' })
        expect(second).toMatchObject({ text: "I'm the CEO of Galaxy", start: 1, end: 3.5, animation: 'slide-down' })
      })
    })

    describe('emoji support', () => {
      it('accepts a literal emoji character directly in new text, no special handling needed', () => {
        const result = validateCommand({ type: 'text', text: 'Launching Now 🚀', start: 0, end: 3 }, ctx)
        expect(result).toMatchObject({ text: 'Launching Now 🚀' })
      })
      it('accepts a compound/multi-codepoint emoji (family, ZWJ sequence) without truncating it', () => {
        const result = validateCommand({ type: 'caption', text: 'Family time 👨‍👩‍👧‍👦', start: 0, end: 3 }, ctx)
        expect(result).toMatchObject({ text: 'Family time 👨‍👩‍👧‍👦' })
      })
    })
  })

  describe('remove_text (context-aware: resolves an existing layer, never asks for font/size/color/position/timing)', () => {
    const oneLayer: InterpretContext = { ...ctx, textLayers: [{ id: 'ov-1', text: 'Galaxy Home Automation', start: 0, end: 3 }] }
    const threeLayers: InterpretContext = {
      ...ctx,
      textLayers: [
        { id: 'ov-1', text: 'Galaxy Home Automation', start: 0, end: 3 },
        { id: 'ov-2', text: 'Smart Living', start: 3, end: 6 },
        { id: 'ov-3', text: 'Welcome', start: 6, end: 9 },
      ],
    }

    it('"Remove the Galaxy Home Automation text." — resolves by wording alone, no timing needed', () => {
      const result = validateCommand({ type: 'remove_text', text: 'Galaxy Home Automation' }, threeLayers)
      expect(result).toEqual({ type: 'remove_text', overlayId: 'ov-1', text: 'Galaxy Home Automation' })
    })
    it('"Remove the text." with only one layer — resolves directly, no question asked', () => {
      const result = validateCommand({ type: 'remove_text' }, oneLayer)
      expect(result).toEqual({ type: 'remove_text', overlayId: 'ov-1', text: 'Galaxy Home Automation' })
    })
    it('"Remove the text." with multiple layers and no wording — genuinely ambiguous, asks which one', () => {
      const result = validateCommand({ type: 'remove_text' }, threeLayers)
      expect(result).toEqual({ error: expect.stringContaining('Galaxy Home Automation') })
      expect((result as { error: string }).error).toContain('Smart Living')
      expect((result as { error: string }).error).toContain('Welcome')
    })
    it('resolves by time-window overlap when wording is ambiguous or absent but a range is given', () => {
      const result = validateCommand({ type: 'remove_text', start: 3, end: 6 }, threeLayers)
      expect(result).toEqual({ type: 'remove_text', overlayId: 'ov-2', text: 'Smart Living' })
    })
    it('errors when there is no text/caption on the video at all', () => {
      expect(validateCommand({ type: 'remove_text' }, ctx)).toEqual({ error: expect.stringContaining('no text or caption') })
    })
  })

  describe('audio_volume / mute', () => {
    it('accepts a valid volume', () => {
      expect(validateCommand({ type: 'audio_volume', volume: 0.5 }, ctx)).toEqual({ type: 'audio_volume', volume: 0.5 })
    })
    it('rejects volume outside 0-3', () => {
      expect(validateCommand({ type: 'audio_volume', volume: 5 }, ctx)).toHaveProperty('error')
    })
    it('accepts mute true/false', () => {
      expect(validateCommand({ type: 'mute', muted: true }, ctx)).toEqual({ type: 'mute', muted: true })
      expect(validateCommand({ type: 'mute', muted: false }, ctx)).toEqual({ type: 'mute', muted: false })
    })
    it('rejects a non-boolean muted', () => {
      expect(validateCommand({ type: 'mute', muted: 'yes' }, ctx)).toHaveProperty('error')
    })
  })

  describe('music', () => {
    it('rejects a volume change when the video has no music track — this is the explicit "cannot execute" case', () => {
      const result = validateCommand({ type: 'music', action: 'volume', volume: 0.5 }, ctx)
      expect(result).toEqual({ error: expect.stringContaining('no background music') })
    })
    it('accepts a volume change when music exists', () => {
      const withMusic: InterpretContext = { ...ctx, hasMusic: true }
      expect(validateCommand({ type: 'music', action: 'volume', volume: 0.5 }, withMusic)).toEqual({ type: 'music', action: 'volume', volume: 0.5 })
    })
    it('accepts remove regardless of hasMusic', () => {
      expect(validateCommand({ type: 'music', action: 'remove' }, ctx)).toEqual({ type: 'music', action: 'remove' })
    })
  })

  describe('loop', () => {
    it('accepts a valid integer count', () => {
      expect(validateCommand({ type: 'loop', times: 3 }, ctx)).toEqual({ type: 'loop', times: 3 })
    })
    it('rejects a non-integer', () => {
      expect(validateCommand({ type: 'loop', times: 2.5 }, ctx)).toHaveProperty('error')
    })
    it('rejects out of the 2-10 range', () => {
      expect(validateCommand({ type: 'loop', times: 1 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'loop', times: 11 }, ctx)).toHaveProperty('error')
    })
  })

  describe('blur / pixelate (TEST: "Blur the background from 10 to 16 seconds" style instructions)', () => {
    it('accepts a valid windowed blur', () => {
      expect(validateCommand({ type: 'blur', start: 10, end: 16, strength: 8 }, ctx)).toEqual({ type: 'blur', start: 10, end: 16, strength: 8 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'blur', start: 10, end: 16 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'blur', start: 0, end: 1, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'blur', start: 0, end: 1, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('pixelate follows the same shape as blur', () => {
      expect(validateCommand({ type: 'pixelate', start: 2, end: 4, strength: 5 }, ctx)).toEqual({ type: 'pixelate', start: 2, end: 4, strength: 5 })
    })
    it('rejects a missing time window for both', () => {
      expect(validateCommand({ type: 'blur', strength: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'pixelate', strength: 5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('background_blur (TEST: "Blur the background from 2 to 5 seconds" style instructions)', () => {
    it('accepts a valid windowed background blur', () => {
      expect(validateCommand({ type: 'background_blur', start: 2, end: 5, strength: 8 }, ctx))
        .toEqual({ type: 'background_blur', start: 2, end: 5, strength: 8 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'background_blur', start: 2, end: 5 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'background_blur', start: 0, end: 1, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'background_blur', start: 0, end: 1, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'background_blur', strength: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'background_blur', start: 5, end: 2, strength: 5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('motion_blur (TEST: "Add motion blur horizontally" style instructions)', () => {
    it('accepts a valid windowed motion blur', () => {
      expect(validateCommand({ type: 'motion_blur', start: 1, end: 4, direction: 'horizontal', strength: 10 }, ctx))
        .toEqual({ type: 'motion_blur', start: 1, end: 4, direction: 'horizontal', strength: 10 })
    })
    it('rejects a missing/invalid direction', () => {
      expect(validateCommand({ type: 'motion_blur', start: 1, end: 4, strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'motion_blur', start: 1, end: 4, direction: 'diagonal', strength: 10 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'motion_blur', start: 1, end: 4, direction: 'vertical', strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'motion_blur', start: 1, end: 4, direction: 'vertical', strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'motion_blur', direction: 'horizontal', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'motion_blur', start: 5, end: 2, direction: 'horizontal', strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('directional_blur (TEST: "Blur it at a 45 degree angle" style instructions)', () => {
    it('accepts a valid windowed directional blur', () => {
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, angle: 45, strength: 10 }, ctx))
        .toEqual({ type: 'directional_blur', start: 1, end: 4, angle: 45, strength: 10 })
    })
    it('rejects a missing/invalid angle', () => {
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, angle: 400, strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, angle: -10, strength: 10 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, angle: 45, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'directional_blur', start: 1, end: 4, angle: 45, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'directional_blur', angle: 45, strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'directional_blur', start: 5, end: 2, angle: 45, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('zoom_blur (TEST: "Zoom blur burst" style instructions)', () => {
    it('accepts a valid windowed zoom blur', () => {
      expect(validateCommand({ type: 'zoom_blur', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'zoom_blur', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'zoom_blur', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'zoom_blur', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'zoom_blur', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'zoom_blur', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'zoom_blur', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('radial_blur (TEST: "Radial blur from the product" style instructions)', () => {
    it('accepts a valid windowed radial blur with a custom center', () => {
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 12, x: 0.3, y: 0.7 }, ctx))
        .toEqual({ type: 'radial_blur', start: 1, end: 4, strength: 12, x: 0.3, y: 0.7 })
    })
    it('defaults x/y to centered when omitted', () => {
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.5, y: 0.5 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 10, x: 1.5, y: 0.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 10, x: 0.5, y: -0.2 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'radial_blur', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'radial_blur', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'radial_blur', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('spin_blur (TEST: "Add a spin blur" style instructions)', () => {
    it('accepts a valid windowed spin blur with a custom center', () => {
      expect(validateCommand({ type: 'spin_blur', start: 1, end: 4, strength: 12, x: 0.4, y: 0.6 }, ctx))
        .toEqual({ type: 'spin_blur', start: 1, end: 4, strength: 12, x: 0.4, y: 0.6 })
    })
    it('defaults x/y to centered when omitted', () => {
      expect(validateCommand({ type: 'spin_blur', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.5, y: 0.5 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'spin_blur', start: 1, end: 4, strength: 10, x: 2, y: 0.5 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'spin_blur', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'spin_blur', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'spin_blur', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'spin_blur', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('tiltshift_blur (TEST: "Give it a tilt-shift miniature look" style instructions)', () => {
    it('accepts a valid windowed tilt-shift blur with custom band', () => {
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10, bandY: 0.4, bandHeight: 0.3 }, ctx))
        .toEqual({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10, bandY: 0.4, bandHeight: 0.3 })
    })
    it('defaults bandY/bandHeight when omitted', () => {
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ bandY: 0.5, bandHeight: 0.25 })
    })
    it('rejects bandY outside 0-1 and bandHeight outside 0.05-0.9', () => {
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10, bandY: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10, bandHeight: 0.01 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 10, bandHeight: 0.95 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'tiltshift_blur', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'tiltshift_blur', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'tiltshift_blur', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('wave (TEST: "Make it wavy" style instructions)', () => {
    it('accepts a valid windowed wave', () => {
      expect(validateCommand({ type: 'wave', start: 1, end: 4, strength: 10, axis: 'vertical' }, ctx))
        .toEqual({ type: 'wave', start: 1, end: 4, strength: 10, axis: 'vertical' })
    })
    it('defaults the axis to horizontal when omitted', () => {
      expect(validateCommand({ type: 'wave', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ axis: 'horizontal' })
    })
    it('rejects an invalid axis', () => {
      expect(validateCommand({ type: 'wave', start: 1, end: 4, strength: 10, axis: 'diagonal' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'wave', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'wave', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'wave', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'wave', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('ripple (TEST: "Ripples spreading from the middle" style instructions)', () => {
    it('accepts a valid windowed ripple with a custom centre', () => {
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 12, x: 0.3, y: 0.7 }, ctx))
        .toEqual({ type: 'ripple', start: 1, end: 4, strength: 12, x: 0.3, y: 0.7 })
    })
    it('defaults x/y to centred when omitted', () => {
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.5, y: 0.5 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 10, x: 1.5, y: 0.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 10, x: 0.5, y: -0.2 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'ripple', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'ripple', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'ripple', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('warp (TEST: "Warp it like a heat haze" style instructions)', () => {
    it('accepts a valid windowed warp', () => {
      expect(validateCommand({ type: 'warp', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'warp', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'warp', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'warp', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'warp', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'warp', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'warp', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('twirl (TEST: "Swirl it into a vortex" style instructions)', () => {
    it('accepts a valid windowed twirl with a custom centre', () => {
      expect(validateCommand({ type: 'twirl', start: 1, end: 4, strength: 12, x: 0.4, y: 0.6 }, ctx))
        .toEqual({ type: 'twirl', start: 1, end: 4, strength: 12, x: 0.4, y: 0.6 })
    })
    it('defaults x/y to centred when omitted', () => {
      expect(validateCommand({ type: 'twirl', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.5, y: 0.5 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'twirl', start: 1, end: 4, strength: 10, x: 2, y: 0.5 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'twirl', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'twirl', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'twirl', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'twirl', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('fisheye (TEST: "Give it a fisheye lens look" style instructions)', () => {
    it('accepts a valid windowed fisheye', () => {
      expect(validateCommand({ type: 'fisheye', start: 1, end: 4, strength: 14 }, ctx))
        .toEqual({ type: 'fisheye', start: 1, end: 4, strength: 14 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'fisheye', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'fisheye', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'fisheye', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'fisheye', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'fisheye', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('bulge / squeeze (TEST: "Bulge the middle out" / "Pinch it inward" style instructions)', () => {
    it('accepts a valid windowed bulge with a custom centre', () => {
      expect(validateCommand({ type: 'bulge', start: 1, end: 4, strength: 12, x: 0.3, y: 0.35 }, ctx))
        .toEqual({ type: 'bulge', start: 1, end: 4, strength: 12, x: 0.3, y: 0.35 })
    })
    it('accepts a valid windowed squeeze', () => {
      expect(validateCommand({ type: 'squeeze', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'squeeze', start: 1, end: 4, strength: 12, x: 0.5, y: 0.5 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'bulge', start: 1, end: 4, strength: 10, x: 1.2, y: 0.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'squeeze', start: 1, end: 4, strength: 10, x: 0.5, y: -1 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'bulge', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'squeeze', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'bulge', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'squeeze', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('stretch (TEST: "Stretch it out wide" style instructions)', () => {
    it('accepts a valid windowed stretch', () => {
      expect(validateCommand({ type: 'stretch', start: 1, end: 4, strength: 10, axis: 'vertical' }, ctx))
        .toEqual({ type: 'stretch', start: 1, end: 4, strength: 10, axis: 'vertical' })
    })
    it('defaults the axis to horizontal when omitted', () => {
      expect(validateCommand({ type: 'stretch', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ axis: 'horizontal' })
    })
    it('rejects an invalid axis', () => {
      expect(validateCommand({ type: 'stretch', start: 1, end: 4, strength: 10, axis: 'both' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'stretch', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'stretch', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'stretch', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'stretch', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('lens_distortion (TEST: "Add some barrel distortion" style instructions)', () => {
    it('accepts both modes', () => {
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 10, mode: 'barrel' }, ctx))
        .toEqual({ type: 'lens_distortion', start: 1, end: 4, strength: 10, mode: 'barrel' })
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 10, mode: 'pincushion' }, ctx))
        .toMatchObject({ mode: 'pincushion' })
    })
    it('rejects a missing/invalid mode', () => {
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 10, mode: 'fisheye' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 0, mode: 'barrel' }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_distortion', start: 1, end: 4, strength: 21, mode: 'barrel' }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'lens_distortion', strength: 10, mode: 'barrel' }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_distortion', start: 5, end: 2, strength: 10, mode: 'barrel' }, ctx)).toHaveProperty('error')
    })
  })

  describe('lens_flare (TEST: "Add a lens flare from the top right" style instructions)', () => {
    it('accepts a valid windowed lens flare with a custom source point', () => {
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 12, x: 0.9, y: 0.1 }, ctx))
        .toEqual({ type: 'lens_flare', start: 1, end: 4, strength: 12, x: 0.9, y: 0.1 })
    })
    it('defaults x/y to the upper-right source position when omitted', () => {
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.8, y: 0.2 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 10, x: 1.5, y: 0.2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 10, x: 0.8, y: -0.1 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_flare', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'lens_flare', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'lens_flare', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('sparkle (TEST: "Make it sparkly" style instructions)', () => {
    it('accepts a valid windowed sparkle', () => {
      expect(validateCommand({ type: 'sparkle', start: 1, end: 4, strength: 14 }, ctx))
        .toEqual({ type: 'sparkle', start: 1, end: 4, strength: 14 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'sparkle', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'sparkle', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'sparkle', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'sparkle', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'sparkle', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('neon_glow (TEST: "Give it a pink neon glow" style instructions)', () => {
    it('accepts a valid windowed neon glow with a custom color', () => {
      expect(validateCommand({ type: 'neon_glow', start: 1, end: 4, strength: 12, color: '#33ffee' }, ctx))
        .toEqual({ type: 'neon_glow', start: 1, end: 4, strength: 12, color: '#33ffee' })
    })
    it('omits color when not given, leaving the default to apply()', () => {
      const result = validateCommand({ type: 'neon_glow', start: 1, end: 4, strength: 10 }, ctx)
      expect(result).toMatchObject({ strength: 10 })
      expect(result).not.toHaveProperty('color')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'neon_glow', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'neon_glow', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'neon_glow', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'neon_glow', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('god_rays (TEST: "Add god rays coming down from the top" style instructions)', () => {
    it('accepts a valid windowed god rays with a custom source point', () => {
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 12, x: 0.3, y: 0.05 }, ctx))
        .toEqual({ type: 'god_rays', start: 1, end: 4, strength: 12, x: 0.3, y: 0.05 })
    })
    it('defaults x/y to top-center when omitted', () => {
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 10 }, ctx)).toMatchObject({ x: 0.5, y: 0.1 })
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 10, x: 1.2, y: 0.1 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 10, x: 0.5, y: -0.2 }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'god_rays', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'god_rays', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'god_rays', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('dust (TEST: "Add floating dust" style instructions)', () => {
    it('accepts a valid windowed dust command', () => {
      expect(validateCommand({ type: 'dust', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'dust', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'dust', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'dust', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'dust', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'dust', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'dust', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('scratches (TEST: "Make it look like a scratched film print" style instructions)', () => {
    it('accepts a valid windowed scratches command', () => {
      expect(validateCommand({ type: 'scratches', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'scratches', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'scratches', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'scratches', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'scratches', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'scratches', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'scratches', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('film_burn (TEST: "Add a film burn" style instructions)', () => {
    it('accepts a valid windowed film burn command', () => {
      expect(validateCommand({ type: 'film_burn', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'film_burn', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'film_burn', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'film_burn', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'film_burn', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'film_burn', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'film_burn', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('retro_camera (TEST: "Add viewfinder brackets and a REC light" style instructions)', () => {
    it('accepts a valid windowed retro camera command', () => {
      expect(validateCommand({ type: 'retro_camera', start: 1, end: 4, strength: 12 }, ctx))
        .toEqual({ type: 'retro_camera', start: 1, end: 4, strength: 12 })
    })
    it('defaults strength when omitted', () => {
      expect(validateCommand({ type: 'retro_camera', start: 1, end: 4 }, ctx)).toMatchObject({ strength: 8 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'retro_camera', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'retro_camera', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing or invalid time window', () => {
      expect(validateCommand({ type: 'retro_camera', strength: 10 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'retro_camera', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('color', () => {
    it('accepts a single field set', () => {
      expect(validateCommand({ type: 'color', start: 0, end: 5, brightness: 0.2 }, ctx)).toEqual({ type: 'color', start: 0, end: 5, brightness: 0.2 })
    })
    it('accepts multiple fields together', () => {
      const result = validateCommand({ type: 'color', start: 0, end: 5, contrast: 1.5, grayscale: true }, ctx)
      expect(result).toMatchObject({ contrast: 1.5, grayscale: true })
    })
    it('rejects when nothing to adjust is given — this is the "never invent a value" case', () => {
      expect(validateCommand({ type: 'color', start: 0, end: 5 }, ctx)).toHaveProperty('error')
    })
    it('rejects out-of-range brightness/contrast/saturation/warmth/vignette', () => {
      expect(validateCommand({ type: 'color', start: 0, end: 5, brightness: 2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, contrast: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, saturation: -1 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, warmth: 2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, vignette: 2 }, ctx)).toHaveProperty('error')
    })
    it('accepts the new adjustment fields (exposure/highlights/shadows/tint/sharpness/clarity/grain)', () => {
      const result = validateCommand(
        { type: 'color', start: 0, end: 5, exposure: 0.3, highlights: -0.2, shadows: 0.4, tint: -0.1, sharpness: 1.2, clarity: 0.5, grain: 0.3 },
        ctx,
      )
      expect(result).toEqual({
        type: 'color', start: 0, end: 5,
        exposure: 0.3, highlights: -0.2, shadows: 0.4, tint: -0.1, sharpness: 1.2, clarity: 0.5, grain: 0.3,
      })
    })
    it('rejects out-of-range exposure/highlights/shadows/tint/sharpness/clarity/grain', () => {
      expect(validateCommand({ type: 'color', start: 0, end: 5, exposure: 2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, highlights: -2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, shadows: 2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, tint: -2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, sharpness: 3 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, clarity: 2 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'color', start: 0, end: 5, grain: 2 }, ctx)).toHaveProperty('error')
    })
  })

  describe('mask', () => {
    it('accepts a minimal circle mask, filling in defaults', () => {
      const result = validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle' }, ctx)
      expect(result).toEqual({ type: 'mask', start: 0, end: 5, shape: 'circle', x: 0.5, y: 0.5, size: 0.35, feather: 0.12 })
    })
    it('accepts a rect mask with explicit position/size/feather', () => {
      const result = validateCommand({ type: 'mask', start: 1, end: 4, shape: 'rect', x: 0.2, y: 0.8, size: 0.5, feather: 0 }, ctx)
      expect(result).toMatchObject({ shape: 'rect', x: 0.2, y: 0.8, size: 0.5, feather: 0 })
    })
    it('rejects a missing/invalid shape rather than guessing', () => {
      expect(validateCommand({ type: 'mask', start: 0, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'triangle' }, ctx)).toHaveProperty('error')
    })
    it('rejects x/y outside 0-1', () => {
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle', x: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle', y: -0.1 }, ctx)).toHaveProperty('error')
    })
    it('rejects size outside 0.05-0.9', () => {
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle', size: 0.01 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle', size: 1 }, ctx)).toHaveProperty('error')
    })
    it('rejects feather outside 0-0.3', () => {
      expect(validateCommand({ type: 'mask', start: 0, end: 5, shape: 'circle', feather: 0.5 }, ctx)).toHaveProperty('error')
    })
  })

  describe('look', () => {
    it('accepts every supported look name', () => {
      const names = ['sepia', 'negative', 'tealOrange', 'vintage', 'cinematic', 'hdr', 'colorize', 'duotone', 'oldFilm', 'super8', 'polaroid', 'camcorder']
      for (const name of names) {
        expect(validateCommand({ type: 'look', start: 0, end: 5, name }, ctx)).toMatchObject({ type: 'look', name })
      }
    })
    it('rejects a missing/unsupported name rather than guessing', () => {
      expect(validateCommand({ type: 'look', start: 0, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'look', start: 0, end: 5, name: 'explosion' }, ctx)).toHaveProperty('error')
    })
    it('accepts hueDegrees for colorize', () => {
      const result = validateCommand({ type: 'look', start: 0, end: 5, name: 'colorize', hueDegrees: 220 }, ctx)
      expect(result).toMatchObject({ name: 'colorize', hueDegrees: 220 })
    })
    it('rejects hueDegrees outside 0-360', () => {
      expect(validateCommand({ type: 'look', start: 0, end: 5, name: 'colorize', hueDegrees: 400 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'look', start: 0, end: 5, name: 'colorize', hueDegrees: -10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('glitch', () => {
    it('accepts every supported glitch style, defaulting strength to 0.5', () => {
      const styles = ['rgbSplit', 'tvNoise', 'screenFlicker', 'vhs', 'scanLines', 'digitalGlitch', 'signalDistortion']
      for (const style of styles) {
        expect(validateCommand({ type: 'glitch', start: 0, end: 5, style }, ctx)).toEqual({ type: 'glitch', start: 0, end: 5, style, strength: 0.5 })
      }
    })
    it('accepts an explicit strength', () => {
      const result = validateCommand({ type: 'glitch', start: 0, end: 5, style: 'rgbSplit', strength: 0.9 }, ctx)
      expect(result).toMatchObject({ strength: 0.9 })
    })
    it('rejects a missing/unsupported style rather than guessing', () => {
      expect(validateCommand({ type: 'glitch', start: 0, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'glitch', start: 0, end: 5, style: 'explosion' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 0-1', () => {
      expect(validateCommand({ type: 'glitch', start: 0, end: 5, style: 'rgbSplit', strength: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'glitch', start: 0, end: 5, style: 'rgbSplit', strength: -0.1 }, ctx)).toHaveProperty('error')
    })
  })

  describe('light', () => {
    it('accepts every supported light style, defaulting strength to 0.5', () => {
      const styles = ['flash', 'strobe', 'flicker', 'glow', 'bloom', 'lightLeak']
      for (const style of styles) {
        expect(validateCommand({ type: 'light', start: 0, end: 5, style }, ctx)).toEqual({ type: 'light', start: 0, end: 5, style, strength: 0.5 })
      }
    })
    it('rejects a missing/unsupported style rather than guessing', () => {
      expect(validateCommand({ type: 'light', start: 0, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'light', start: 0, end: 5, style: 'lightning' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 0-1', () => {
      expect(validateCommand({ type: 'light', start: 0, end: 5, style: 'flash', strength: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'light', start: 0, end: 5, style: 'flash', strength: -0.1 }, ctx)).toHaveProperty('error')
    })
  })

  describe('motionfx', () => {
    it('accepts every supported motion style, defaulting strength to 0.5', () => {
      const styles = ['cameraShake', 'wobble', 'zoomPunch', 'motionTrail', 'speedRamp']
      for (const style of styles) {
        expect(validateCommand({ type: 'motionfx', start: 0, end: 5, style }, ctx)).toEqual({ type: 'motionfx', start: 0, end: 5, style, strength: 0.5 })
      }
    })
    it('rejects a missing/unsupported style rather than guessing — freezeFrame is deliberately not supported', () => {
      expect(validateCommand({ type: 'motionfx', start: 0, end: 5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'motionfx', start: 0, end: 5, style: 'freezeFrame' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 0-1', () => {
      expect(validateCommand({ type: 'motionfx', start: 0, end: 5, style: 'wobble', strength: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'motionfx', start: 0, end: 5, style: 'wobble', strength: -0.1 }, ctx)).toHaveProperty('error')
    })
  })

  describe('audiofx', () => {
    it('accepts every supported audio style, defaulting strength to 0.5', () => {
      const styles = ['equalizer', 'reverb', 'echo', 'distortion', 'bassBoost', 'mono']
      for (const style of styles) {
        expect(validateCommand({ type: 'audiofx', style }, ctx)).toEqual({ type: 'audiofx', style, strength: 0.5 })
      }
    })
    it('defaults pitch direction to up and accepts down', () => {
      expect(validateCommand({ type: 'audiofx', style: 'pitch' }, ctx)).toEqual({ type: 'audiofx', style: 'pitch', strength: 0.5, direction: 'up' })
      expect(validateCommand({ type: 'audiofx', style: 'pitch', direction: 'down' }, ctx)).toEqual({ type: 'audiofx', style: 'pitch', strength: 0.5, direction: 'down' })
    })
    it('defaults fadeIn/fadeOut duration to 1s and validates range', () => {
      expect(validateCommand({ type: 'audiofx', style: 'fadeIn' }, ctx)).toEqual({ type: 'audiofx', style: 'fadeIn', duration: 1 })
      expect(validateCommand({ type: 'audiofx', style: 'fadeOut', duration: 3 }, ctx)).toEqual({ type: 'audiofx', style: 'fadeOut', duration: 3 })
      expect(validateCommand({ type: 'audiofx', style: 'fadeIn', duration: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'audiofx', style: 'fadeIn', duration: 11 }, ctx)).toHaveProperty('error')
    })
    it('rejects a missing/unsupported style', () => {
      expect(validateCommand({ type: 'audiofx' }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'audiofx', style: 'beatSync' }, ctx)).toHaveProperty('error')
    })
    it('rejects strength outside 0-1', () => {
      expect(validateCommand({ type: 'audiofx', style: 'reverb', strength: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'audiofx', style: 'reverb', strength: -0.1 }, ctx)).toHaveProperty('error')
    })
    it('defaults voiceChanger preset to robot, no strength, and rejects an unsupported preset', () => {
      expect(validateCommand({ type: 'audiofx', style: 'voiceChanger' }, ctx)).toEqual({ type: 'audiofx', style: 'voiceChanger', preset: 'robot' })
      expect(validateCommand({ type: 'audiofx', style: 'voiceChanger', preset: 'chipmunk' }, ctx)).toEqual({ type: 'audiofx', style: 'voiceChanger', preset: 'chipmunk' })
      expect(validateCommand({ type: 'audiofx', style: 'voiceChanger', preset: 'nonsense' }, ctx)).toEqual({ type: 'audiofx', style: 'voiceChanger', preset: 'robot' })
    })
  })

  describe('datamosh', () => {
    it('accepts a valid window/strength', () => {
      expect(validateCommand({ type: 'datamosh', start: 1, end: 4, strength: 10 }, ctx))
        .toEqual({ type: 'datamosh', start: 1, end: 4, strength: 10 })
    })
    it('rejects strength outside 1-20', () => {
      expect(validateCommand({ type: 'datamosh', start: 1, end: 4, strength: 0 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'datamosh', start: 1, end: 4, strength: 21 }, ctx)).toHaveProperty('error')
    })
    it('rejects an invalid time window', () => {
      expect(validateCommand({ type: 'datamosh', start: 5, end: 2, strength: 10 }, ctx)).toHaveProperty('error')
    })
  })

  describe('auto_color', () => {
    it('accepts a valid window, defaulting strength to 0.6', () => {
      expect(validateCommand({ type: 'auto_color', start: 1, end: 4 }, ctx))
        .toEqual({ type: 'auto_color', start: 1, end: 4, strength: 0.6 })
      expect(validateCommand({ type: 'auto_color', start: 1, end: 4, strength: 0.9 }, ctx))
        .toEqual({ type: 'auto_color', start: 1, end: 4, strength: 0.9 })
    })
    it('rejects strength outside 0-1', () => {
      expect(validateCommand({ type: 'auto_color', start: 1, end: 4, strength: 1.5 }, ctx)).toHaveProperty('error')
      expect(validateCommand({ type: 'auto_color', start: 1, end: 4, strength: -0.1 }, ctx)).toHaveProperty('error')
    })
  })

  describe('fade / rotate / flip / reverse', () => {
    it('accepts a valid fade', () => {
      expect(validateCommand({ type: 'fade', direction: 'in', duration: 2 }, ctx)).toEqual({ type: 'fade', direction: 'in', duration: 2 })
    })
    it('defaults fade duration to 1s', () => {
      expect(validateCommand({ type: 'fade', direction: 'out' }, ctx)).toMatchObject({ duration: 1 })
    })
    it('rejects an invalid fade direction', () => {
      expect(validateCommand({ type: 'fade', direction: 'sideways' }, ctx)).toHaveProperty('error')
    })
    it('accepts only the three allowed rotate degrees', () => {
      expect(validateCommand({ type: 'rotate', degrees: 90 }, ctx)).toEqual({ type: 'rotate', degrees: 90 })
      expect(validateCommand({ type: 'rotate', degrees: 45 }, ctx)).toHaveProperty('error')
    })
    it('accepts a valid flip axis, rejects an invalid one', () => {
      expect(validateCommand({ type: 'flip', axis: 'horizontal' }, ctx)).toEqual({ type: 'flip', axis: 'horizontal' })
      expect(validateCommand({ type: 'flip', axis: 'diagonal' }, ctx)).toHaveProperty('error')
    })
    it('reverse takes no fields', () => {
      expect(validateCommand({ type: 'reverse' }, ctx)).toEqual({ type: 'reverse' })
    })
  })

  describe('text_style (TEST: "Make the text white and bold." / "Make that text red." — context-aware, patches only what changed)', () => {
    const oneLayer: InterpretContext = {
      ...ctx,
      textLayers: [{ id: 'ov-1', text: 'Galaxy Home Automation', start: 0, end: 5 }],
    }
    const twoLayers: InterpretContext = {
      ...ctx,
      textLayers: [
        { id: 'ov-1', text: 'Galaxy Home Automation', start: 0, end: 5 },
        { id: 'ov-2', text: 'Smart Living', start: 5, end: 10 },
      ],
    }

    it('resolves an explicit target to its overlayId, and only carries the field(s) actually named', () => {
      const result = validateCommand({ type: 'text_style', target: 'Galaxy Home Automation', color: 'white', bold: true }, twoLayers)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', color: 'white', bold: true })
    })
    it('"Make it red." with no target and only one layer — resolves directly, no question asked', () => {
      const result = validateCommand({ type: 'text_style', color: 'red' }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', color: 'red' })
    })
    it('"Make it red." with multiple layers and no target — genuinely ambiguous, asks which one instead of guessing', () => {
      const result = validateCommand({ type: 'text_style', color: 'red' }, twoLayers)
      expect(result).toEqual({ error: expect.stringContaining('Galaxy Home Automation') })
    })
    it('"Make it bigger." only sets size — every other field of the existing layer is left untouched by omission', () => {
      const result = validateCommand({ type: 'text_style', size: 'lg' }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', size: 'lg' })
      expect(result).not.toHaveProperty('color')
      expect(result).not.toHaveProperty('position')
    })
    it('rejects when no style field is given at all, even with a resolvable target', () => {
      expect(validateCommand({ type: 'text_style', target: 'Galaxy Home Automation' }, oneLayer)).toHaveProperty('error')
    })
    it('errors when there is no text layer to restyle', () => {
      expect(validateCommand({ type: 'text_style', color: 'red' }, ctx)).toEqual({ error: expect.stringContaining('no text or caption') })
    })
    it('accepts outline color + width together', () => {
      const result = validateCommand({ type: 'text_style', outlineColor: 'black', outlineWidth: 3 }, oneLayer)
      expect(result).toMatchObject({ outlineColor: 'black', outlineWidth: 3 })
    })
    it('rejects an outline width outside 0-20', () => {
      expect(validateCommand({ type: 'text_style', outlineWidth: 50 }, oneLayer)).toHaveProperty('error')
    })
    it('"Make it italic and underlined." — sets only those two booleans, no other style field touched', () => {
      const result = validateCommand({ type: 'text_style', italic: true, underline: true }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', italic: true, underline: true })
    })
    it('"Add a strikethrough to that text." — sets only strikethrough', () => {
      const result = validateCommand({ type: 'text_style', strikethrough: true }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', strikethrough: true })
    })
    it('"Remove the background box." — backgroundOpacity:0 alone is enough, not treated as "nothing to change"', () => {
      const result = validateCommand({ type: 'text_style', backgroundOpacity: 0 }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', backgroundOpacity: 0 })
    })
    it('accepts a custom background color', () => {
      const result = validateCommand({ type: 'text_style', backgroundColor: 'blue' }, oneLayer)
      expect(result).toMatchObject({ backgroundColor: 'blue' })
    })
    it('rejects a backgroundOpacity outside 0-1', () => {
      expect(validateCommand({ type: 'text_style', backgroundOpacity: 1.2 }, oneLayer)).toHaveProperty('error')
    })
    it('"Make it Times New Roman and red." — sets font and color together, case-insensitively matched', () => {
      const result = validateCommand({ type: 'text_style', fontFamily: 'times new roman', color: 'red' }, oneLayer)
      expect(result).toEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', color: 'red', fontFamily: 'Times New Roman' })
    })
    it('rejects a font that is not in the supported list, rather than silently dropping it', () => {
      const result = validateCommand({ type: 'text_style', fontFamily: 'Papyrus' }, oneLayer)
      expect(result).toEqual({ error: expect.stringContaining('Papyrus') })
    })
  })

  describe('text_edit (TEST: "Add a 🔥 emoji to the CEO text." — changes wording, never styling)', () => {
    const oneLayer: InterpretContext = {
      ...ctx,
      textLayers: [{ id: 'ov-1', text: "I'm the CEO of Galaxy", start: 0, end: 3 }],
    }
    const twoLayers: InterpretContext = {
      ...ctx,
      textLayers: [
        { id: 'ov-1', text: "I'm the CEO of Galaxy", start: 0, end: 3 },
        { id: 'ov-2', text: 'Smart Living', start: 3, end: 6 },
      ],
    }

    it('resolves by target and replaces the wording with the AI-composed full string (existing text + emoji)', () => {
      const result = validateCommand({ type: 'text_edit', target: 'CEO', text: "I'm the CEO of Galaxy 🔥" }, twoLayers)
      expect(result).toEqual({ type: 'text_edit', overlayId: 'ov-1', text: "I'm the CEO of Galaxy 🔥" })
    })
    it('resolves with no target when there is only one layer', () => {
      const result = validateCommand({ type: 'text_edit', text: 'Welcome Home' }, oneLayer)
      expect(result).toEqual({ type: 'text_edit', overlayId: 'ov-1', text: 'Welcome Home' })
    })
    it('asks which layer when ambiguous, same as text_style/remove_text', () => {
      const result = validateCommand({ type: 'text_edit', text: 'Welcome Home' }, twoLayers)
      expect(result).toEqual({ error: expect.stringContaining('Galaxy') })
    })
    it('rejects empty new text', () => {
      expect(validateCommand({ type: 'text_edit', text: '   ' }, oneLayer)).toHaveProperty('error')
    })
    it('rejects text over 200 characters', () => {
      expect(validateCommand({ type: 'text_edit', text: 'x'.repeat(201) }, oneLayer)).toHaveProperty('error')
    })
    it('errors when there is no text layer to edit', () => {
      expect(validateCommand({ type: 'text_edit', text: 'Hi' }, ctx)).toEqual({ error: expect.stringContaining('no text or caption') })
    })
  })

  describe('remove_effect (TEST: "Remove the blur." — only when it truly is the most recent change)', () => {
    it('removes an effect that is exactly the most recent change', () => {
      const withBlur: InterpretContext = { ...ctx, lastEffectType: 'blur' }
      expect(validateCommand({ type: 'remove_effect', effectType: 'blur' }, withBlur)).toEqual({ type: 'remove_effect', effectType: 'blur' })
    })
    it('refuses when the most recent change was a different effect, without silently doing nothing', () => {
      const withRotate: InterpretContext = { ...ctx, lastEffectType: 'rotate' }
      const result = validateCommand({ type: 'remove_effect', effectType: 'blur' }, withRotate)
      expect(result).toEqual({ error: expect.stringContaining('rotate') })
    })
    it('refuses when there is no effect history at all', () => {
      const result = validateCommand({ type: 'remove_effect', effectType: 'blur' }, ctx)
      expect(result).toHaveProperty('error')
    })
    it('rejects an unrecognized effectType', () => {
      expect(validateCommand({ type: 'remove_effect', effectType: 'sparkle' }, ctx)).toHaveProperty('error')
    })
  })

  describe('captions_auto / audio_noise_reduction', () => {
    it('both take no fields', () => {
      expect(validateCommand({ type: 'captions_auto' }, ctx)).toEqual({ type: 'captions_auto' })
      expect(validateCommand({ type: 'audio_noise_reduction' }, ctx)).toEqual({ type: 'audio_noise_reduction' })
    })
  })
})

describe('targetToCenter', () => {
  it('maps every named target to a distinct, in-bounds fraction', () => {
    for (const t of ['center', 'left', 'right', 'top', 'bottom']) {
      const { x, y } = targetToCenter(t)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
    expect(targetToCenter('left').x).toBeLessThan(targetToCenter('right').x)
    expect(targetToCenter('top').y).toBeLessThan(targetToCenter('bottom').y)
  })
  it('falls back to center for an unrecognized target', () => {
    expect(targetToCenter('nowhere')).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('directionToPanPoints', () => {
  it('left-to-right moves x from low to high, y unchanged', () => {
    const p = directionToPanPoints('left-to-right')
    expect(p.fromX).toBeLessThan(p.toX)
    expect(p.fromY).toBe(p.toY)
  })
  it('top-to-bottom moves y from low to high, x unchanged', () => {
    const p = directionToPanPoints('top-to-bottom')
    expect(p.fromY).toBeLessThan(p.toY)
    expect(p.fromX).toBe(p.toX)
  })
})

describe('interpretInstruction', () => {
  it('returns validated commands for a well-formed AI response', async () => {
    callClaude.mockResolvedValue(JSON.stringify({
      commands: [{ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' }],
    }))
    const result = await interpretInstruction('Zoom into the person from 5 to 8 seconds.', ctx)
    expect(result.commands).toEqual([{ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' }])
    expect(result.clarification).toBeUndefined()
  })

  it('strips a markdown code fence before parsing', async () => {
    callClaude.mockResolvedValue('```json\n{"commands":[{"type":"loop","times":3}]}\n```')
    const result = await interpretInstruction('Loop this 3 times.', ctx)
    expect(result.commands).toEqual([{ type: 'loop', times: 3 }])
  })

  it('passes through an explicit AI clarification request', async () => {
    callClaude.mockResolvedValue(JSON.stringify({ clarification: 'Which part of the video should I zoom into?' }))
    const result = await interpretInstruction('Zoom into the product.', ctx)
    expect(result.clarification).toBe('Which part of the video should I zoom into?')
    expect(result.commands).toBeUndefined()
  })

  it('appends the actual font list when the AI asks a font clarification without naming any options — the reported bug', async () => {
    callClaude.mockResolvedValue(JSON.stringify({
      clarification: 'Which font would you like to change the text to? (Choose from the allowed fonts list)',
    }))
    const result = await interpretInstruction('change the font style from times new roman to any other', ctx)
    expect(result.clarification).toContain('Times New Roman')
    expect(result.clarification).toContain('Arial')
    expect(result.clarification).toContain('Georgia')
  })

  it('leaves a font clarification untouched if the AI already named specific options', async () => {
    const clarification = 'Which font — Arial or Georgia?'
    callClaude.mockResolvedValue(JSON.stringify({ clarification }))
    const result = await interpretInstruction('change the font', ctx)
    expect(result.clarification).toBe(clarification)
  })

  it('leaves a non-font clarification untouched', async () => {
    callClaude.mockResolvedValue(JSON.stringify({ clarification: 'Which part of the video should I zoom into?' }))
    const result = await interpretInstruction('Zoom into the product.', ctx)
    expect(result.clarification).toBe('Which part of the video should I zoom into?')
  })

  it('turns a validation failure into a clarification rather than executing a bad command', async () => {
    // The AI invented a command with no toScale — must be caught, not run.
    callClaude.mockResolvedValue(JSON.stringify({ commands: [{ type: 'zoom', start: 5, end: 8 }] }))
    const result = await interpretInstruction('Zoom in.', ctx)
    expect(result.commands).toBeUndefined()
    expect(result.clarification).toEqual(expect.any(String))
  })

  it('handles unparseable JSON from the AI without throwing', async () => {
    callClaude.mockResolvedValue('I think you should zoom in around the 5 second mark!')
    const result = await interpretInstruction('Zoom in.', ctx)
    expect(result.clarification).toEqual(expect.any(String))
  })

  it('handles a network/API failure without throwing — reported as `error`, not `clarification`, since it is a real failure the operator can\'t fix by rephrasing', async () => {
    callClaude.mockImplementation(async () => {
      throw new Error('502 Bad Gateway')
    })
    const result = await interpretInstruction('Zoom in.', ctx)
    expect(result.error).toContain('502 Bad Gateway')
    expect(result.clarification).toBeUndefined()
  })

  it('rejects an empty instruction without calling the AI at all', async () => {
    callClaude.mockClear()
    const result = await interpretInstruction('   ', ctx)
    expect(result.clarification).toEqual(expect.any(String))
    expect(callClaude).not.toHaveBeenCalled()
  })

  it('sends the real video duration and music state in the system prompt', async () => {
    callClaude.mockClear()
    callClaude.mockResolvedValue(JSON.stringify({ commands: [{ type: 'loop', times: 2 }] }))
    await interpretInstruction('loop it', { durationSec: 42.3, hasMusic: true })
    const systemPromptSent = callClaude.mock.calls[0][1] as string
    expect(systemPromptSent).toContain('42.3')
    expect(systemPromptSent).toContain('already has background music')
  })
})

describe('describeAiCommand / describeAiCommandCard', () => {
  // One command per type, run through both — the two functions must never
  // throw or return something empty for any of the eleven command types,
  // and the card format must never leak an ffmpeg filter string or an
  // internal field name (the explicit "no technical details" requirement).
  const samples: EditCommand[] = [
    { type: 'trim', start: 0, end: 3 },
    { type: 'crop', aspect: '9:16' },
    { type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' },
    { type: 'pan', start: 1, end: 6, direction: 'left-to-right', scale: 1.3 },
    { type: 'speed', start: 2, end: 5, factor: 2 },
    { type: 'text', text: 'Galaxy Home Automation', start: 0, end: 0, position: 'bottom', size: 'md' },
    { type: 'caption', text: 'Hello', start: 1, end: 4, position: 'top', size: 'sm' },
    { type: 'text', text: 'Neon Sign', start: 0, end: 2, position: 'center', size: 'lg', glow: true, animation: 'bounce', animationDuration: 0.6 },
    { type: 'text', text: 'Rattle', start: 0, end: 2, position: 'center', size: 'lg', animation: 'shake' },
    { type: 'text', text: 'Coming Into Focus', start: 0, end: 2, position: 'center', size: 'lg', animation: 'blur-in' },
    { type: 'audio_volume', volume: 0.3 },
    { type: 'mute', muted: true },
    { type: 'music', action: 'remove' },
    { type: 'loop', times: 3 },
    { type: 'mask', start: 1, end: 4, shape: 'circle', x: 0.5, y: 0.5, size: 0.35, feather: 0.12 },
    { type: 'look', start: 1, end: 4, name: 'sepia' },
    { type: 'look', start: 1, end: 4, name: 'colorize', hueDegrees: 220 },
    { type: 'glitch', start: 1, end: 4, style: 'rgbSplit', strength: 0.5 },
    { type: 'light', start: 1, end: 4, style: 'flash', strength: 0.5 },
    { type: 'motionfx', start: 1, end: 4, style: 'cameraShake', strength: 0.5 },
    { type: 'audiofx', style: 'reverb', strength: 0.5 },
    { type: 'audiofx', style: 'pitch', strength: 0.5, direction: 'down' },
    { type: 'audiofx', style: 'fadeOut', duration: 2 },
    { type: 'audiofx', style: 'voiceChanger', preset: 'robot' },
    { type: 'datamosh', start: 1, end: 4, strength: 10 },
    { type: 'auto_color', start: 1, end: 4, strength: 0.6 },
  ]

  it('produces a non-empty one-line description for every command type', () => {
    for (const cmd of samples) {
      expect(describeAiCommand(cmd)).toEqual(expect.any(String))
      expect(describeAiCommand(cmd).length).toBeGreaterThan(0)
    }
  })

  it('produces a card with a title and at least one line for every command type', () => {
    for (const cmd of samples) {
      const card = describeAiCommandCard(cmd)
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.lines.length).toBeGreaterThan(0)
      expect(card.lines.every((l) => l.length > 0)).toBe(true)
    }
  })

  it('never mentions ffmpeg, filter syntax, or drive ids — the explicit "no technical details" requirement', () => {
    const forbidden = /ffmpeg|zoompan|crop=|atempo|filter_complex|drive_id/i
    for (const cmd of samples) {
      expect(describeAiCommand(cmd)).not.toMatch(forbidden)
      const card = describeAiCommandCard(cmd)
      expect(card.title).not.toMatch(forbidden)
      for (const line of card.lines) expect(line).not.toMatch(forbidden)
    }
  })

  it('states the zoom scale change and target the user actually asked for', () => {
    const card = describeAiCommandCard({ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' })
    expect(card.title).toBe('Zoom')
    expect(card.lines.join(' ')).toContain('1x → 1.5x')
    expect(card.lines.join(' ')).toContain('center')
    expect(card.lines.join(' ')).toContain('0:05')
    expect(card.lines.join(' ')).toContain('0:08')
  })

  it('converts a music volume fraction to a percentage a normal user reads at a glance', () => {
    const card = describeAiCommandCard({ type: 'music', action: 'volume', volume: 0.3 })
    expect(card.lines.join(' ')).toContain('30%')
  })
})

// The five instructions the AI Edit integration is required to handle
// end-to-end. These mock the AI's response to exactly what a model
// following the system prompt's own worked examples should produce, then
// verify the full parse+validate pipeline accepts it and shapes it
// correctly — this proves the PLUMBING; it does not prove Groq's real
// llama-3.3-70b reliably phrases it this way for every way a user might
// type these instructions (never tested against the live API — see the
// implementation report).
describe('the five required end-to-end instructions', () => {
  const videoCtx: InterpretContext = { durationSec: 12, hasMusic: false }

  it('1. "Remove the first 3 seconds."', async () => {
    callClaude.mockImplementation(async () => JSON.stringify({ commands: [{ type: 'trim', start: 3, end: 12 }] }))
    const result = await interpretInstruction('Remove the first 3 seconds.', videoCtx)
    expect(result.commands).toEqual([{ type: 'trim', start: 3, end: 12 }])
  })

  it('2. "Zoom into the center from 5 to 8 seconds."', async () => {
    callClaude.mockImplementation(async () => JSON.stringify({
      commands: [{ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' }],
    }))
    const result = await interpretInstruction('Zoom into the center from 5 to 8 seconds.', videoCtx)
    expect(result.commands).toEqual([{ type: 'zoom', start: 5, end: 8, fromScale: 1, toScale: 1.5, target: 'center' }])
  })

  it('3. "Make the video 2x faster." — whole-video speed, not a clarification case', async () => {
    callClaude.mockImplementation(async () => JSON.stringify({ commands: [{ type: 'speed', start: 0, end: 12, factor: 2 }] }))
    const result = await interpretInstruction('Make the video 2x faster.', videoCtx)
    expect(result.commands).toEqual([{ type: 'speed', start: 0, end: 12, factor: 2 }])
    expect(result.clarification).toBeUndefined()
  })

  it('4. "Mute the original audio."', async () => {
    callClaude.mockImplementation(async () => JSON.stringify({ commands: [{ type: 'mute', muted: true }] }))
    const result = await interpretInstruction('Mute the original audio.', videoCtx)
    expect(result.commands).toEqual([{ type: 'mute', muted: true }])
  })

  it('5. "Add \'Galaxy Home Automation\' at the beginning."', async () => {
    callClaude.mockImplementation(async () => JSON.stringify({
      commands: [{ type: 'text', text: 'Galaxy Home Automation', start: 0, end: 3, position: 'top', size: 'lg' }],
    }))
    const result = await interpretInstruction("Add 'Galaxy Home Automation' at the beginning.", videoCtx)
    expect(result.commands).toEqual([{ type: 'text', text: 'Galaxy Home Automation', start: 0, end: 3, position: 'top', size: 'lg' }])
  })
})
