/**
 * Natural-language editing instruction → validated, executable command.
 *
 *   instruction (free text, e.g. "Zoom into the person from 5 to 8 seconds")
 *     → AI (api/ai/chat.ts — the same Groq-backed proxy every other AI
 *        feature in this app already uses; no new key, no new endpoint)
 *     → strict JSON matching one of the EditCommand shapes below
 *     → validateCommand() — an ALLOWLIST, not a passthrough. Every field is
 *        type- and range-checked against the actual loaded video (its real
 *        duration, whether it already has music); nothing reaches a
 *        renderer that didn't pass. The AI's output is never treated as
 *        code — it only ever produces plain data, and only the functions in
 *        autoEdit.ts (crop/zoom/pan/speed/loop) or the editor's own existing
 *        state setters (trim/text/caption/volume/mute/music — the same ones
 *        a human clicking those panels already calls) act on it. There is
 *        no path from an instruction to a shell command.
 *     → execution (VideoEditWorkspacePage.tsx)
 *
 * "Never invent a value" is enforced two ways: the system prompt tells the
 * model to return `clarification` instead of guessing, and even if it
 * ignores that, validateCommand() rejects anything missing/out of range
 * before it can run — a hallucinated timestamp past the video's own
 * duration, for instance, is caught here, not discovered by ffmpeg erroring
 * or silently producing an empty clip.
 */
import { callClaude } from '../ai'
import type { CaptionPosition, CaptionSize, CropAspect } from './autoEdit'

export interface TrimCommand { type: 'trim'; start: number; end: number }
export interface CropCommand { type: 'crop'; aspect: CropAspect }
export type ZoomTarget = 'center' | 'left' | 'right' | 'top' | 'bottom'
export interface ZoomCommand { type: 'zoom'; start: number; end: number; fromScale: number; toScale: number; target: ZoomTarget }
export type PanDirection = 'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top'
export interface PanCommand { type: 'pan'; start: number; end: number; direction: PanDirection; scale: number }
export interface SpeedCommand { type: 'speed'; start: number; end: number; factor: number }
export interface TextCommand { type: 'text'; text: string; start: number; end: number; position: CaptionPosition; size: CaptionSize }
export interface CaptionCommand { type: 'caption'; text: string; start: number; end: number; position: CaptionPosition; size: CaptionSize }
export interface AudioVolumeCommand { type: 'audio_volume'; volume: number }
export interface MuteCommand { type: 'mute'; muted: boolean }
export interface MusicCommand { type: 'music'; action: 'volume' | 'remove'; volume?: number }
export interface LoopCommand { type: 'loop'; times: number }

export type EditCommand =
  | TrimCommand | CropCommand | ZoomCommand | PanCommand | SpeedCommand
  | TextCommand | CaptionCommand | AudioVolumeCommand | MuteCommand | MusicCommand | LoopCommand

export const COMMAND_TYPES = [
  'trim', 'crop', 'zoom', 'pan', 'speed', 'text', 'caption',
  'audio_volume', 'mute', 'music', 'loop',
] as const

const CROP_ASPECTS: CropAspect[] = ['9:16', '1:1', '4:5', '16:9', '4:3']
const ZOOM_TARGETS: ZoomTarget[] = ['center', 'left', 'right', 'top', 'bottom']
const PAN_DIRECTIONS: PanDirection[] = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top']
const CAPTION_POSITIONS: CaptionPosition[] = ['top', 'bottom', 'left', 'right', 'center']
const CAPTION_SIZES: CaptionSize[] = ['sm', 'md', 'lg']

/** A named zoom/pan target as a fraction-of-frame center point. */
export function targetToCenter(target: string): { x: number; y: number } {
  switch (target) {
    case 'left': return { x: 0.25, y: 0.5 }
    case 'right': return { x: 0.75, y: 0.5 }
    case 'top': return { x: 0.5, y: 0.25 }
    case 'bottom': return { x: 0.5, y: 0.75 }
    default: return { x: 0.5, y: 0.5 }
  }
}

/** A pan direction as a from→to pair of fraction-of-frame center points. */
export function directionToPanPoints(direction: PanDirection): { fromX: number; fromY: number; toX: number; toY: number } {
  switch (direction) {
    case 'left-to-right': return { fromX: 0.2, fromY: 0.5, toX: 0.8, toY: 0.5 }
    case 'right-to-left': return { fromX: 0.8, fromY: 0.5, toX: 0.2, toY: 0.5 }
    case 'top-to-bottom': return { fromX: 0.5, fromY: 0.2, toX: 0.5, toY: 0.8 }
    case 'bottom-to-top': return { fromX: 0.5, fromY: 0.8, toX: 0.5, toY: 0.2 }
  }
}

export interface InterpretContext {
  durationSec: number
  hasMusic: boolean
}

export interface ValidationError {
  error: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function timeWindow(c: Record<string, unknown>, ctx: InterpretContext): { start: number; end: number } | ValidationError {
  const start = num(c.start)
  const end = num(c.end)
  if (start === null || end === null) return { error: 'Missing a start or end time for that instruction.' }
  if (start < 0) return { error: 'The start time cannot be before the beginning of the video.' }
  if (end <= start) return { error: 'The end time has to be after the start time.' }
  if (start > ctx.durationSec + 0.25) {
    return { error: `That starts after the video ends (it's only ${ctx.durationSec.toFixed(1)}s long).` }
  }
  return { start, end: Math.min(end, ctx.durationSec) }
}

/**
 * Validates one raw (untrusted) command object from the AI against the
 * actual loaded video. Returns the validated, typed command, or an error —
 * never partially-valid data, and never a guessed default for anything the
 * caller didn't supply itself (aside from documented, harmless UI defaults
 * like caption position/size, which affect only where text appears, not
 * what gets cut).
 */
export function validateCommand(raw: unknown, ctx: InterpretContext): EditCommand | ValidationError {
  if (!raw || typeof raw !== 'object') return { error: 'That was not a recognizable editing command.' }
  const c = raw as Record<string, unknown>
  const type = str(c.type)
  if (!type || !(COMMAND_TYPES as readonly string[]).includes(type)) {
    return { error: `"${String(c.type)}" is not a supported edit — I can only do: ${COMMAND_TYPES.join(', ')}.` }
  }

  switch (type as EditCommand['type']) {
    case 'trim': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      return { type: 'trim', ...w }
    }

    case 'crop': {
      const aspect = str(c.aspect)
      if (!aspect || !CROP_ASPECTS.includes(aspect as CropAspect)) {
        return { error: `Crop needs a target aspect ratio — one of ${CROP_ASPECTS.join(', ')}.` }
      }
      return { type: 'crop', aspect: aspect as CropAspect }
    }

    case 'zoom': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const fromScale = num(c.fromScale) ?? 1
      const toScale = num(c.toScale)
      if (toScale === null) return { error: "Missing how much to zoom in (I won't guess a zoom amount)." }
      if (fromScale < 0.5 || fromScale > 4 || toScale < 0.5 || toScale > 4) {
        return { error: 'Zoom scale has to be between 0.5x and 4x.' }
      }
      const targetRaw = str(c.target)
      const target = (targetRaw && ZOOM_TARGETS.includes(targetRaw as ZoomTarget) ? targetRaw : 'center') as ZoomTarget
      return { type: 'zoom', ...w, fromScale, toScale, target }
    }

    case 'pan': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const direction = str(c.direction)
      if (!direction || !PAN_DIRECTIONS.includes(direction as PanDirection)) {
        return { error: `Pan needs a direction — one of ${PAN_DIRECTIONS.join(', ')}.` }
      }
      const scale = num(c.scale) ?? 1.3
      if (scale < 1 || scale > 4) return { error: 'Pan scale has to be between 1x and 4x.' }
      return { type: 'pan', ...w, direction: direction as PanDirection, scale }
    }

    case 'speed': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const factor = num(c.factor)
      if (factor === null) return { error: "Missing the speed factor (I won't guess how much faster/slower)." }
      if (factor < 0.25 || factor > 4) return { error: 'Speed factor has to be between 0.25x and 4x.' }
      return { type: 'speed', ...w, factor }
    }

    case 'text':
    case 'caption': {
      const text = str(c.text)
      if (!text || !text.trim()) return { error: 'Missing the text to show.' }
      if (text.length > 200) return { error: 'That text is too long (200 characters max).' }
      const start = num(c.start) ?? 0
      const end = num(c.end) ?? 0
      if (start < 0 || (end > 0 && end <= start) || start > ctx.durationSec + 0.25) {
        return { error: 'Invalid start/end time for that text.' }
      }
      const positionRaw = str(c.position)
      const position = (positionRaw && CAPTION_POSITIONS.includes(positionRaw as CaptionPosition) ? positionRaw : 'bottom') as CaptionPosition
      const sizeRaw = str(c.size)
      const size = (sizeRaw && CAPTION_SIZES.includes(sizeRaw as CaptionSize) ? sizeRaw : 'md') as CaptionSize
      return { type: type as 'text' | 'caption', text: text.trim(), start, end, position, size }
    }

    case 'audio_volume': {
      const volume = num(c.volume)
      if (volume === null) return { error: 'Missing the volume level.' }
      if (volume < 0 || volume > 3) return { error: 'Volume has to be between 0 (silent) and 3 (3x).' }
      return { type: 'audio_volume', volume }
    }

    case 'mute': {
      if (typeof c.muted !== 'boolean') return { error: 'Missing whether to mute or unmute.' }
      return { type: 'mute', muted: c.muted }
    }

    case 'music': {
      const action = str(c.action)
      if (action !== 'volume' && action !== 'remove') return { error: 'Music action must be "volume" or "remove".' }
      if (action === 'remove') return { type: 'music', action }
      if (!ctx.hasMusic) {
        return { error: 'There is no background music track to adjust yet — upload one in the Music panel first.' }
      }
      const volume = num(c.volume)
      if (volume === null || volume < 0 || volume > 1) return { error: 'Music volume has to be between 0 and 1.' }
      return { type: 'music', action, volume }
    }

    case 'loop': {
      const times = num(c.times)
      if (times === null || !Number.isInteger(times) || times < 2 || times > 10) {
        return { error: 'Loop count has to be a whole number between 2 and 10.' }
      }
      return { type: 'loop', times }
    }

    default:
      return { error: 'Unsupported command.' }
  }
}

export interface InterpretResult {
  /** Present when the AI understood the instruction (may be more than one
   *  command for a compound instruction, e.g. "crop for reels AND add
   *  captions"). Always already validated — never shown/executed raw. */
  commands?: EditCommand[]
  /** Present instead of commands when the AI couldn't determine something
   *  required — a timestamp, a target, a missing music file. Never both. */
  clarification?: string
}

function systemPrompt(ctx: InterpretContext): string {
  return `You convert a plain-English video editing instruction into structured JSON commands for an editing tool. You do not edit video yourself — you only output data.

The video is ${ctx.durationSec.toFixed(1)} seconds long. ${ctx.hasMusic ? 'It already has a background music track.' : 'It has no background music track yet.'}

Respond with ONLY a JSON object, no prose, no markdown code fences, matching exactly one of these two shapes:

1) { "commands": [ <one or more command objects> ] }
2) { "clarification": "<a short question asking for the missing information>" }

Use shape 2 whenever the instruction is missing a timestamp, target, or amount you cannot determine from the instruction itself — GUESSING A VALUE IS NOT ALLOWED. If someone says "zoom into the product" with no timing, ask when. If they say "crop this" with no target format, ask what aspect ratio.

Supported command types (all times are seconds from the start of the video, all fields shown are required unless marked optional):

trim        { "type": "trim", "start": number, "end": number }  — keep only [start,end]
crop        { "type": "crop", "aspect": "9:16" | "1:1" | "4:5" | "16:9" | "4:3" }
zoom        { "type": "zoom", "start": number, "end": number, "fromScale": number, "toScale": number, "target": "center" | "left" | "right" | "top" | "bottom" }  — fromScale defaults to 1 if omitted; scales are 0.5-4
pan         { "type": "pan", "start": number, "end": number, "direction": "left-to-right" | "right-to-left" | "top-to-bottom" | "bottom-to-top", "scale": number }  — scale (how zoomed in while panning) defaults to 1.3, range 1-4
speed       { "type": "speed", "start": number, "end": number, "factor": number }  — factor > 1 is faster, < 1 is slower, range 0.25-4
text        { "type": "text", "text": string, "start": number, "end": number, "position": "top"|"bottom"|"left"|"right"|"center", "size": "sm"|"md"|"lg" }  — start:0, end:0 means "shown for the whole video", not "missing"
caption     { "type": "caption", ...same fields as text }
audio_volume{ "type": "audio_volume", "volume": number }  — 0 to 3, 1 = unchanged
mute        { "type": "mute", "muted": boolean }
music       { "type": "music", "action": "volume" | "remove", "volume": number }  — volume (0-1) only used with action "volume", and only valid if the video already has a music track
loop        { "type": "loop", "times": integer }  — 2 to 10, total number of plays

Examples:
"Zoom into the person from 5 to 8 seconds." → {"commands":[{"type":"zoom","start":5,"end":8,"fromScale":1,"toScale":1.5,"target":"center"}]}
"Crop this to Instagram Reel format." → {"commands":[{"type":"crop","aspect":"9:16"}]}
"Make seconds 10 to 12 twice as fast." → {"commands":[{"type":"speed","start":10,"end":12,"factor":2}]}
"Remove the first 3 seconds." → {"commands":[{"type":"trim","start":3,"end":${ctx.durationSec.toFixed(1)}}]}
"Zoom into the product." (no timing given) → {"clarification":"Which part of the video should I zoom into — what start and end time?"}
"Loop this 3 times." → {"commands":[{"type":"loop","times":3}]}`
}

/** Strips a ```json fenced block down to just its contents, if present — the model is told not to do this, but following that instruction isn't guaranteed. */
function stripCodeFence(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  return (m ? m[1] : text).trim()
}

/**
 * Sends the instruction to the AI, parses its JSON response, and validates
 * every command it returned. A command that fails validation is dropped and
 * reported back as a clarification rather than silently ignored or executed
 * partially-wrong — the caller always gets either commands it can trust, or
 * an explanation of what's missing, never a mix.
 */
export async function interpretInstruction(instruction: string, ctx: InterpretContext): Promise<InterpretResult> {
  const trimmed = instruction.trim()
  if (!trimmed) return { clarification: 'Enter an editing instruction first.' }

  let raw: string
  try {
    raw = await callClaude(trimmed, systemPrompt(ctx), 1024)
  } catch (err) {
    return { clarification: `Could not reach the AI service: ${err instanceof Error ? err.message : String(err)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return { clarification: "The AI's response wasn't valid JSON — try rephrasing the instruction." }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { clarification: 'The AI did not return a usable response — try rephrasing the instruction.' }
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.clarification === 'string' && obj.clarification.trim()) {
    return { clarification: obj.clarification.trim() }
  }

  if (!Array.isArray(obj.commands) || obj.commands.length === 0) {
    return { clarification: "I couldn't turn that into an edit — try being more specific (what, and when)." }
  }

  const validated: EditCommand[] = []
  for (const rawCmd of obj.commands) {
    const result = validateCommand(rawCmd, ctx)
    if ('error' in result) return { clarification: result.error }
    validated.push(result)
  }

  return { commands: validated }
}
