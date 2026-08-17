import { describe, it, expect, vi } from 'vitest'
import {
  validateCommand, interpretInstruction, targetToCenter, directionToPanPoints,
  type InterpretContext,
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

  it('handles a network/API failure without throwing', async () => {
    callClaude.mockImplementation(async () => {
      throw new Error('502 Bad Gateway')
    })
    const result = await interpretInstruction('Zoom in.', ctx)
    expect(result.clarification).toContain('502 Bad Gateway')
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
    expect(systemPromptSent).toContain('already has a background music track')
  })
})
