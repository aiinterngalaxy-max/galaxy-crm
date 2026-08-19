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
import { fmtTime } from './videoEditShared'
import type { CaptionPosition, CaptionSize, CropAspect } from './autoEdit'

export interface TrimCommand { type: 'trim'; start: number; end: number }
export interface CropCommand { type: 'crop'; aspect: CropAspect }
export type ZoomTarget = 'center' | 'left' | 'right' | 'top' | 'bottom'
export interface ZoomCommand { type: 'zoom'; start: number; end: number; fromScale: number; toScale: number; target: ZoomTarget }
export type PanDirection = 'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top'
export interface PanCommand { type: 'pan'; start: number; end: number; direction: PanDirection; scale: number }
export interface SpeedCommand { type: 'speed'; start: number; end: number; factor: number }
/** Styling fields shared by TextCommand/CaptionCommand (styling brand-new
 *  text at the moment it's added) and TextStyleCommand (restyling text that
 *  already exists) — factored out so a single instruction like "add
 *  'Galaxy' in red, Times New Roman" can set these directly on the ADD
 *  command instead of requiring a separate text_style patch, which would
 *  fail validation since the layer it'd patch doesn't exist yet. */
export interface TextStyleFields {
  color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean
  outlineColor?: string; outlineWidth?: number; fontFamily?: string
  backgroundColor?: string; backgroundOpacity?: number
  /** How the text enters at its own start time — 'slide-down' comes from
   *  above, 'slide-up' from below, 'fade' opacity-ins in place, 'bounce'
   *  drops in and settles with a couple of diminishing overshoots, 'shake'
   *  rattles side-to-side and settles, 'blur-in' starts out of focus and
   *  sharpens. Omitted = appears instantly. Only meaningful with a real
   *  (non-whole-video) time window — there's no "entrance" to animate on
   *  text shown throughout. */
  animation?: 'slide-down' | 'slide-up' | 'fade' | 'bounce' | 'shake' | 'blur-in'
  animationDuration?: number
  /** A persistent glow around the text ("neon" look) — not an entrance, a
   *  standing style, so it lives here rather than in `animation`. */
  glow?: boolean
}
export interface TextCommand extends TextStyleFields { type: 'text'; text: string; start: number; end: number; position: CaptionPosition; size: CaptionSize }
export interface CaptionCommand extends TextStyleFields { type: 'caption'; text: string; start: number; end: number; position: CaptionPosition; size: CaptionSize }
/** Removes an existing text/caption overlay — as opposed to `text`/
 *  `caption`, which only ever ADD one. Resolved to a concrete `overlayId`
 *  by validateCommand (using the project's actual current layers, passed in
 *  via ctx.textLayers), NOT by the AI guessing an id — the AI only ever
 *  supplies a wording/time hint if the instruction named one. `text` here
 *  is the matched layer's own current text, for display only. */
export interface RemoveTextCommand { type: 'remove_text'; overlayId: string; text: string }
export interface AudioVolumeCommand { type: 'audio_volume'; volume: number }
export interface MuteCommand { type: 'mute'; muted: boolean }
export interface MusicCommand { type: 'music'; action: 'volume' | 'remove'; volume?: number }
export interface LoopCommand { type: 'loop'; times: number }
export interface BlurCommand { type: 'blur'; start: number; end: number; strength: number }
export interface PixelateCommand { type: 'pixelate'; start: number; end: number; strength: number }
export interface ColorCommand {
  type: 'color'; start: number; end: number
  brightness?: number; contrast?: number; saturation?: number; grayscale?: boolean; warmth?: number; vignette?: number
  /** exposure: -1 (darker) .. 1 (brighter), a multiplicative gamma push —
   *  distinct from brightness's additive offset, closer to a camera's own
   *  exposure control. highlights/shadows: -1..1, lifts/lowers just the
   *  bright or dark end of the tonal range (a `curves` push, not a flat
   *  brightness shift). tint: -1 (magenta) .. 1 (green), same shadows/mids/
   *  highlights push `warmth` already uses on the red/blue axis. sharpness:
   *  0..2 (1 = a moderate sharpen, 0 = none). clarity: 0..1, a softer/wider
   *  "local contrast" sharpen. grain: 0..1 added film-grain-style noise. */
  exposure?: number; highlights?: number; shadows?: number; tint?: number
  sharpness?: number; clarity?: number; grain?: number
}
export type LookName =
  | 'sepia' | 'negative' | 'tealOrange' | 'vintage' | 'cinematic' | 'hdr'
  | 'colorize' | 'duotone' | 'oldFilm' | 'super8' | 'polaroid' | 'camcorder'
/** A canned color-grade preset over [start,end] — each name is a fixed
 *  filter recipe (see LOOK_RECIPES, autoEdit.ts), not a set of individually
 *  tunable knobs like `color` — same reasoning `RotateCommand` has no
 *  "amount" field. hueDegrees only affects 'colorize' (0-360, the single
 *  hue the footage is tinted toward); ignored for every other name. */
export interface LookCommand { type: 'look'; start: number; end: number; name: LookName; hueDegrees?: number }
export type GlitchStyle = 'rgbSplit' | 'tvNoise' | 'screenFlicker' | 'vhs' | 'scanLines' | 'digitalGlitch' | 'signalDistortion'
/** A digital-degradation effect over [start,end] — strength 0..1 scales
 *  intensity (0.5 is a moderate, clearly-visible default). Each style is a
 *  fixed recipe, same reasoning as `look`. */
export interface GlitchCommand { type: 'glitch'; start: number; end: number; style: GlitchStyle; strength?: number }
export type LightStyle = 'flash' | 'strobe' | 'flicker' | 'glow' | 'bloom' | 'lightLeak'
/** A brightness/light-based effect over [start,end] — strength 0..1 scales
 *  intensity, default 0.5. "flash"/"strobe"/"flicker" pulse brightness;
 *  "glow"/"bloom" brighten+blur+screen-blend the frame with itself;
 *  "lightLeak" overlays a warm color wash. Each style is a fixed recipe. */
export interface LightCommand { type: 'light'; start: number; end: number; style: LightStyle; strength?: number }
export type MotionStyle = 'cameraShake' | 'wobble' | 'zoomPunch' | 'motionTrail' | 'speedRamp'
/** A camera-motion-style effect over [start,end] — strength 0..1 scales
 *  intensity, default 0.5. "cameraShake"/"wobble" jitter the frame position;
 *  "zoomPunch" is a quick zoom in and back out (reuses the existing zoom
 *  machinery, not a new technique); "motionTrail" ghosts recent frames
 *  together; "speedRamp" steps through a few discrete speeds across the
 *  window rather than one continuous rate change. Freeze Frame was in the
 *  original request but is NOT implemented — every approach tried produced
 *  a genuinely broken result in testing (wrong duration, a "frozen" segment
 *  that wasn't actually static), not just a rough edge worth shipping. */
export interface MotionCommand { type: 'motionfx'; start: number; end: number; style: MotionStyle; strength?: number }
export type AudioStyle = 'equalizer' | 'reverb' | 'echo' | 'distortion' | 'bassBoost' | 'pitch' | 'mono' | 'fadeIn' | 'fadeOut'
/** A whole-clip audio effect (no start/end window — same reasoning as
 *  `reverse`/`audio_noise_reduction`: these process the entire track).
 *  strength 0..1, default 0.5, unused by "mono". "pitch" uses `direction`
 *  (default "up"); "fadeIn"/"fadeOut" use `duration` (seconds, default 1). */
export interface AudioFxCommand {
  type: 'audiofx'; style: AudioStyle; strength?: number
  direction?: 'up' | 'down'; duration?: number
}
export interface FadeCommand { type: 'fade'; direction: 'in' | 'out'; duration: number }
export interface RotateCommand { type: 'rotate'; degrees: 90 | 180 | 270 }
export interface FlipCommand { type: 'flip'; axis: 'horizontal' | 'vertical' }
export interface ReverseCommand { type: 'reverse' }
/** A "spotlight" region effect — the frame stays normal INSIDE the shape and
 *  is darkened OUTSIDE it, for [start,end]. There's no chroma key/background
 *  removal in this tool, so this is the realistic version of "mask"/"circle
 *  mask"/"rectangle mask": drawing attention to a region, not compositing a
 *  second layer through a cutout. x/y/size/feather all default to a centered,
 *  medium spotlight if omitted — unlike a timestamp or amount, "where" a mask
 *  goes has a reasonable default (the middle of the frame) worth using rather
 *  than always asking. */
export interface MaskCommand {
  type: 'mask'; start: number; end: number; shape: 'circle' | 'rect'
  x?: number; y?: number; size?: number; feather?: number
}
/** Modifies an EXISTING text/caption overlay rather than adding one.
 *  `overlayId`/`text` are resolved by validateCommand the same way as
 *  RemoveTextCommand (never guessed by the AI) — ONLY the fields the
 *  instruction actually named are set; everything else about the layer
 *  (font size, position, timing, other styling) is left untouched by the
 *  caller, which patches rather than replaces. */
export interface TextStyleCommand extends TextStyleFields {
  type: 'text_style'; overlayId: string; text: string
  position?: CaptionPosition; size?: CaptionSize
}
/** Changes the WORDING of an existing text/caption overlay — as opposed to
 *  text_style (which only ever touches styling, never content). Covers
 *  "add a 🔥 emoji to the CEO text" (the AI composes the full new string —
 *  existing text + emoji — since ctx.textLayers gives it the current
 *  wording) and "change the text to say 'Welcome!'" alike. overlayId is
 *  resolved by validateCommand the same way as text_style/remove_text. */
export interface TextEditCommand { type: 'text_edit'; overlayId: string; text: string }
/** Auto-generates timed captions from the video's own speech (real
 *  transcription via the app's existing Whisper integration) — not a guess,
 *  not fake captions. */
export interface CaptionsAutoCommand { type: 'captions_auto' }
export interface NoiseReductionCommand { type: 'audio_noise_reduction' }

/** Every hard-baked (pixel-level) effect type — the same set commitNewSource
 *  can tag a history snapshot with, so "remove the blur" can check whether
 *  the blur really is the single most recent change before touching undo. */
export type EffectType = 'crop' | 'zoom' | 'pan' | 'speed' | 'loop' | 'blur' | 'pixelate' | 'color' | 'fade' | 'rotate' | 'flip' | 'reverse' | 'audio_noise_reduction' | 'mask' | 'look' | 'glitch' | 'light' | 'motionfx' | 'audiofx'
export const EFFECT_TYPES: EffectType[] = ['crop', 'zoom', 'pan', 'speed', 'loop', 'blur', 'pixelate', 'color', 'fade', 'rotate', 'flip', 'reverse', 'audio_noise_reduction', 'mask', 'look', 'glitch', 'light', 'motionfx', 'audiofx']
/** Removes the most recently applied hard-baked effect via the editor's own
 *  Undo — only valid when that effect is EXACTLY the top of the undo stack
 *  (see ctx.lastEffectType), since a hard-baked effect can't be lifted back
 *  out of the pixels any other way. If something else was baked at the same
 *  time, or other edits happened since, this is correctly refused rather
 *  than faked — see validateCommand's 'remove_effect' case. */
export interface RemoveEffectCommand { type: 'remove_effect'; effectType: EffectType }

export type EditCommand =
  | TrimCommand | CropCommand | ZoomCommand | PanCommand | SpeedCommand
  | TextCommand | CaptionCommand | RemoveTextCommand | AudioVolumeCommand | MuteCommand | MusicCommand | LoopCommand
  | BlurCommand | PixelateCommand | ColorCommand | FadeCommand | RotateCommand | FlipCommand | ReverseCommand | MaskCommand | LookCommand | GlitchCommand | LightCommand | MotionCommand | AudioFxCommand
  | TextStyleCommand | TextEditCommand | CaptionsAutoCommand | NoiseReductionCommand | RemoveEffectCommand

export const COMMAND_TYPES = [
  'trim', 'crop', 'zoom', 'pan', 'speed', 'text', 'caption', 'remove_text',
  'audio_volume', 'mute', 'music', 'loop', 'mask', 'look', 'glitch', 'light', 'motionfx', 'audiofx',
  'blur', 'pixelate', 'color', 'fade', 'rotate', 'flip', 'reverse',
  'text_style', 'text_edit', 'captions_auto', 'audio_noise_reduction', 'remove_effect',
] as const

const LOOK_NAMES: LookName[] = [
  'sepia', 'negative', 'tealOrange', 'vintage', 'cinematic', 'hdr',
  'colorize', 'duotone', 'oldFilm', 'super8', 'polaroid', 'camcorder',
]
export const LOOK_LABELS: Record<LookName, string> = {
  sepia: 'Sepia', negative: 'Negative / Invert', tealOrange: 'Teal & Orange',
  vintage: 'Vintage', cinematic: 'Cinematic', hdr: 'HDR', colorize: 'Colorize',
  duotone: 'Duotone', oldFilm: 'Old Film', super8: 'Super 8', polaroid: 'Polaroid', camcorder: 'Camcorder',
}
const GLITCH_STYLES: GlitchStyle[] = ['rgbSplit', 'tvNoise', 'screenFlicker', 'vhs', 'scanLines', 'digitalGlitch', 'signalDistortion']
export const GLITCH_LABELS: Record<GlitchStyle, string> = {
  rgbSplit: 'RGB Split', tvNoise: 'TV Noise', screenFlicker: 'Screen Flicker', vhs: 'VHS',
  scanLines: 'Scan Lines', digitalGlitch: 'Digital Glitch', signalDistortion: 'Signal Distortion',
}
const LIGHT_STYLES: LightStyle[] = ['flash', 'strobe', 'flicker', 'glow', 'bloom', 'lightLeak']
export const LIGHT_LABELS: Record<LightStyle, string> = {
  flash: 'Flash', strobe: 'Strobe', flicker: 'Flicker', glow: 'Glow', bloom: 'Bloom', lightLeak: 'Light Leak',
}
const MOTION_STYLES: MotionStyle[] = ['cameraShake', 'wobble', 'zoomPunch', 'motionTrail', 'speedRamp']
export const MOTION_LABELS: Record<MotionStyle, string> = {
  cameraShake: 'Camera Shake', wobble: 'Wobble', zoomPunch: 'Zoom Punch', motionTrail: 'Motion Trail', speedRamp: 'Speed Ramp',
}
const AUDIO_STYLES: AudioStyle[] = ['equalizer', 'reverb', 'echo', 'distortion', 'bassBoost', 'pitch', 'mono', 'fadeIn', 'fadeOut']
export const AUDIO_LABELS: Record<AudioStyle, string> = {
  equalizer: 'Equalizer', reverb: 'Reverb', echo: 'Echo', distortion: 'Distortion', bassBoost: 'Bass Boost',
  pitch: 'Pitch', mono: 'Mono', fadeIn: 'Audio Fade In', fadeOut: 'Audio Fade Out',
}
const CROP_ASPECTS: CropAspect[] = ['9:16', '1:1', '4:5', '16:9', '4:3']
const ZOOM_TARGETS: ZoomTarget[] = ['center', 'left', 'right', 'top', 'bottom']
const PAN_DIRECTIONS: PanDirection[] = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top']
const CAPTION_POSITIONS: CaptionPosition[] = ['top', 'bottom', 'left', 'right', 'center']
const CAPTION_SIZES: CaptionSize[] = ['sm', 'md', 'lg']
/** Fonts actually available on renderCaptionImage's canvas-drawn overlay
 *  (captionOverlay.ts) and in the live-preview CSS — an allowlist rather
 *  than a passthrough, same reasoning as every other validated field: a
 *  freeform string here would just silently fall back to sans-serif with
 *  no way for the operator to know why their requested font didn't apply. */
export const FONT_FAMILIES = [
  'sans-serif', 'serif', 'monospace',
  'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Tahoma',
  'Times New Roman', 'Georgia', 'Courier New', 'Impact', 'Comic Sans MS',
] as const

/** Entrance animations text/captions can appear with — see TextStyleFields.animation. */
export const ANIMATIONS = ['slide-down', 'slide-up', 'fade', 'bounce', 'shake', 'blur-in'] as const

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

/** An existing text/caption overlay as the AI parser needs to see it —
 *  enough to resolve "the Galaxy Home Automation text" / "it" / "that text"
 *  to a real layer without asking the user to repeat information the
 *  project already has. */
export interface ContextTextLayer {
  id: string
  text: string
  start: number
  end: number
}

export interface InterpretContext {
  durationSec: number
  hasMusic: boolean
  /** All current text/caption overlays — required for remove_text/text_style
   *  to resolve without asking unnecessary questions; omit only when there
   *  is truly no editing project loaded yet. */
  textLayers?: ContextTextLayer[]
  /** The type of the single most recent hard-baked effect, if the last
   *  history entry was exactly one effect and nothing else — see
   *  RemoveEffectCommand. Omit/undefined if the last change wasn't an
   *  effect, combined several, or there's no history yet. */
  lastEffectType?: EffectType
}

export interface ValidationError {
  error: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Case-insensitively resolves a requested font name to one of
 *  FONT_FAMILIES — undefined if missing or not a supported font. */
function resolveFontFamily(v: unknown): string | undefined {
  const raw = str(v)
  if (!raw || !raw.trim()) return undefined
  return FONT_FAMILIES.find((f) => f.toLowerCase() === raw.trim().toLowerCase())
}

/** Parses the shared color/bold/outline/font fields off a raw command
 *  object — used by 'text'/'caption' (styling brand-new text at creation)
 *  and 'text_style' (restyling existing text) so both accept the exact same
 *  styling vocabulary. Returns only the fields actually present. */
function parseTextStyleFields(c: Record<string, unknown>): TextStyleFields | ValidationError {
  const color = str(c.color) ?? undefined
  const bold = typeof c.bold === 'boolean' ? c.bold : undefined
  const italic = typeof c.italic === 'boolean' ? c.italic : undefined
  const underline = typeof c.underline === 'boolean' ? c.underline : undefined
  const strikethrough = typeof c.strikethrough === 'boolean' ? c.strikethrough : undefined
  const glow = typeof c.glow === 'boolean' ? c.glow : undefined
  const outlineColor = str(c.outlineColor) ?? undefined
  const outlineWidth = num(c.outlineWidth) ?? undefined
  if (outlineWidth != null && (outlineWidth < 0 || outlineWidth > 20)) return { error: 'Outline width has to be between 0 and 20.' }
  const backgroundColor = str(c.backgroundColor) ?? undefined
  const backgroundOpacity = num(c.backgroundOpacity) ?? undefined
  if (backgroundOpacity != null && (backgroundOpacity < 0 || backgroundOpacity > 1)) {
    return { error: 'Background opacity has to be between 0 (invisible) and 1 (solid).' }
  }
  const fontFamilyRaw = str(c.fontFamily)
  const fontFamily = resolveFontFamily(c.fontFamily)
  if (fontFamilyRaw && fontFamilyRaw.trim() && !fontFamily) {
    return { error: `"${fontFamilyRaw}" isn't a supported font — choose one of: ${FONT_FAMILIES.join(', ')}.` }
  }
  const animationRaw = str(c.animation)
  const animation = ANIMATIONS.includes(animationRaw as (typeof ANIMATIONS)[number]) ? (animationRaw as TextStyleFields['animation']) : undefined
  if (animationRaw && animationRaw.trim() && !animation) {
    return { error: `"${animationRaw}" isn't a supported entrance — choose one of: ${ANIMATIONS.join(', ')}.` }
  }
  const animationDuration = num(c.animationDuration) ?? undefined
  if (animationDuration != null && (animationDuration <= 0 || animationDuration > 3)) {
    return { error: 'Animation duration has to be between 0 and 3 seconds.' }
  }
  return {
    ...(color != null ? { color } : {}),
    ...(bold != null ? { bold } : {}),
    ...(italic != null ? { italic } : {}),
    ...(underline != null ? { underline } : {}),
    ...(strikethrough != null ? { strikethrough } : {}),
    ...(glow != null ? { glow } : {}),
    ...(outlineColor != null ? { outlineColor } : {}),
    ...(outlineWidth != null ? { outlineWidth } : {}),
    ...(fontFamily != null ? { fontFamily } : {}),
    ...(backgroundColor != null ? { backgroundColor } : {}),
    ...(backgroundOpacity != null ? { backgroundOpacity } : {}),
    ...(animation != null ? { animation } : {}),
    ...(animationDuration != null ? { animationDuration } : {}),
  }
}

/**
 * Resolves a text/caption reference (an optional wording hint and/or time
 * window from the instruction) against the project's REAL current layers —
 * this is the actual state-management fix: the AI never invents/echoes a
 * layer id, and never needs to be asked for font/size/position/timing just
 * to identify WHICH layer, because those aren't needed to identify it.
 *
 * Priority: unique text-substring match > unique time-overlap match among
 * text matches > "there's only one layer anyway" > ask, listing every
 * layer's text so the question itself carries no wasted round-trip.
 */
function resolveTextLayer(c: Record<string, unknown>, ctx: InterpretContext): ContextTextLayer | ValidationError {
  const layers = ctx.textLayers ?? []
  if (!layers.length) return { error: 'There is no text or caption on this video yet.' }

  const textHint = str(c.text)
  const start = num(c.start)
  const end = num(c.end)

  let candidates = layers
  if (textHint && textHint.trim()) {
    const byText = layers.filter((l) => l.text.toLowerCase().includes(textHint.trim().toLowerCase()))
    if (byText.length) candidates = byText
  }
  if (candidates.length > 1 && start != null && end != null) {
    const byTime = candidates.filter((l) => l.start < end && l.end > start)
    if (byTime.length) candidates = byTime
  }
  if (candidates.length === 1) return candidates[0]
  if (layers.length === 1) return layers[0]

  const names = (candidates.length > 1 ? candidates : layers).map((l) => `"${l.text}"`).join(', ')
  return { error: `Which text did you mean — ${names}?` }
}

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
      const style = parseTextStyleFields(c)
      if ('error' in style) return style
      return type === 'text'
        ? { type: 'text', text: text.trim(), start, end, position, size, ...style }
        : { type: 'caption', text: text.trim(), start, end, position, size, ...style }
    }

    case 'remove_text': {
      const resolved = resolveTextLayer(c, ctx)
      if ('error' in resolved) return resolved
      return { type: 'remove_text', overlayId: resolved.id, text: resolved.text }
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

    case 'blur':
    case 'pixelate': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${type === 'blur' ? 'Blur' : 'Pixelate'} strength has to be between 1 and 20.` }
      return { type: type as 'blur' | 'pixelate', ...w, strength }
    }

    case 'mask': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const shapeRaw = str(c.shape)
      if (shapeRaw !== 'circle' && shapeRaw !== 'rect') {
        return { error: 'Mask shape has to be "circle" or "rect".' }
      }
      const x = num(c.x) ?? 0.5
      const y = num(c.y) ?? 0.5
      const size = num(c.size) ?? 0.35
      const feather = num(c.feather) ?? 0.12
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: 'Mask position (x/y) has to be between 0 and 1 — a fraction of the frame.' }
      if (size < 0.05 || size > 0.9) return { error: 'Mask size has to be between 0.05 and 0.9 — a fraction of the frame.' }
      if (feather < 0 || feather > 0.3) return { error: 'Mask feather has to be between 0 and 0.3.' }
      return { type: 'mask', ...w, shape: shapeRaw, x, y, size, feather }
    }

    case 'look': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const name = str(c.name)
      if (!name || !LOOK_NAMES.includes(name as LookName)) {
        return { error: `"${name}" isn't a supported look — choose one of: ${LOOK_NAMES.join(', ')}.` }
      }
      const hueDegrees = num(c.hueDegrees) ?? undefined
      if (hueDegrees != null && (hueDegrees < 0 || hueDegrees > 360)) return { error: 'Hue has to be between 0 and 360 degrees.' }
      return { type: 'look', ...w, name: name as LookName, ...(hueDegrees != null ? { hueDegrees } : {}) }
    }

    case 'glitch': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const style = str(c.style)
      if (!style || !GLITCH_STYLES.includes(style as GlitchStyle)) {
        return { error: `"${style}" isn't a supported glitch style — choose one of: ${GLITCH_STYLES.join(', ')}.` }
      }
      const strength = num(c.strength) ?? 0.5
      if (strength < 0 || strength > 1) return { error: 'Glitch strength has to be between 0 and 1.' }
      return { type: 'glitch', ...w, style: style as GlitchStyle, strength }
    }

    case 'light': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const style = str(c.style)
      if (!style || !LIGHT_STYLES.includes(style as LightStyle)) {
        return { error: `"${style}" isn't a supported light style — choose one of: ${LIGHT_STYLES.join(', ')}.` }
      }
      const strength = num(c.strength) ?? 0.5
      if (strength < 0 || strength > 1) return { error: 'Light strength has to be between 0 and 1.' }
      return { type: 'light', ...w, style: style as LightStyle, strength }
    }

    case 'motionfx': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const style = str(c.style)
      if (!style || !MOTION_STYLES.includes(style as MotionStyle)) {
        return { error: `"${style}" isn't a supported motion style — choose one of: ${MOTION_STYLES.join(', ')}.` }
      }
      const strength = num(c.strength) ?? 0.5
      if (strength < 0 || strength > 1) return { error: 'Motion strength has to be between 0 and 1.' }
      return { type: 'motionfx', ...w, style: style as MotionStyle, strength }
    }

    case 'audiofx': {
      const styleRaw = str(c.style)
      if (!styleRaw || !AUDIO_STYLES.includes(styleRaw as AudioStyle)) {
        return { error: `"${styleRaw}" isn't a supported audio effect — choose one of: ${AUDIO_STYLES.join(', ')}.` }
      }
      const style = styleRaw as AudioStyle
      const strength = num(c.strength) ?? 0.5
      if (strength < 0 || strength > 1) return { error: 'Audio effect strength has to be between 0 and 1.' }
      if (style === 'pitch') {
        const directionRaw = str(c.direction)
        const direction = directionRaw === 'down' ? 'down' : 'up'
        return { type: 'audiofx', style, strength, direction }
      }
      if (style === 'fadeIn' || style === 'fadeOut') {
        const duration = num(c.duration) ?? 1
        if (duration <= 0 || duration > 10) return { error: 'Audio fade duration has to be between 0 and 10 seconds.' }
        return { type: 'audiofx', style, duration }
      }
      return { type: 'audiofx', style, strength }
    }

    case 'color': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const brightness = num(c.brightness)
      const contrast = num(c.contrast)
      const saturation = num(c.saturation)
      const warmth = num(c.warmth)
      const vignette = num(c.vignette)
      const grayscale = typeof c.grayscale === 'boolean' ? c.grayscale : undefined
      const exposure = num(c.exposure)
      const highlights = num(c.highlights)
      const shadows = num(c.shadows)
      const tint = num(c.tint)
      const sharpness = num(c.sharpness)
      const clarity = num(c.clarity)
      const grain = num(c.grain)
      if ([brightness, contrast, saturation, warmth, vignette, grayscale, exposure, highlights, shadows, tint, sharpness, clarity, grain].every((v) => v == null)) {
        return { error: 'Missing what to adjust (brightness, contrast, saturation, exposure, highlights, shadows, warmth, tint, vignette, sharpness, clarity, grain, or grayscale).' }
      }
      if (brightness != null && (brightness < -1 || brightness > 1)) return { error: 'Brightness has to be between -1 and 1.' }
      if (contrast != null && (contrast < 0 || contrast > 3)) return { error: 'Contrast has to be between 0 and 3.' }
      if (saturation != null && (saturation < 0 || saturation > 3)) return { error: 'Saturation has to be between 0 and 3.' }
      if (warmth != null && (warmth < -1 || warmth > 1)) return { error: 'Warmth has to be between -1 (cooler) and 1 (warmer).' }
      if (vignette != null && (vignette < 0 || vignette > 1)) return { error: 'Vignette has to be between 0 and 1.' }
      if (exposure != null && (exposure < -1 || exposure > 1)) return { error: 'Exposure has to be between -1 and 1.' }
      if (highlights != null && (highlights < -1 || highlights > 1)) return { error: 'Highlights has to be between -1 and 1.' }
      if (shadows != null && (shadows < -1 || shadows > 1)) return { error: 'Shadows has to be between -1 and 1.' }
      if (tint != null && (tint < -1 || tint > 1)) return { error: 'Tint has to be between -1 (magenta) and 1 (green).' }
      if (sharpness != null && (sharpness < 0 || sharpness > 2)) return { error: 'Sharpness has to be between 0 and 2.' }
      if (clarity != null && (clarity < 0 || clarity > 1)) return { error: 'Clarity has to be between 0 and 1.' }
      if (grain != null && (grain < 0 || grain > 1)) return { error: 'Grain has to be between 0 and 1.' }
      return {
        type: 'color', ...w,
        ...(brightness != null ? { brightness } : {}),
        ...(contrast != null ? { contrast } : {}),
        ...(saturation != null ? { saturation } : {}),
        ...(grayscale != null ? { grayscale } : {}),
        ...(warmth != null ? { warmth } : {}),
        ...(vignette != null ? { vignette } : {}),
        ...(exposure != null ? { exposure } : {}),
        ...(highlights != null ? { highlights } : {}),
        ...(shadows != null ? { shadows } : {}),
        ...(tint != null ? { tint } : {}),
        ...(sharpness != null ? { sharpness } : {}),
        ...(clarity != null ? { clarity } : {}),
        ...(grain != null ? { grain } : {}),
      }
    }

    case 'fade': {
      const direction = str(c.direction)
      if (direction !== 'in' && direction !== 'out') return { error: 'Fade needs a direction — "in" or "out".' }
      const duration = num(c.duration) ?? 1
      if (duration <= 0 || duration > 10) return { error: 'Fade duration has to be between 0 and 10 seconds.' }
      return { type: 'fade', direction, duration }
    }

    case 'rotate': {
      const degrees = num(c.degrees)
      if (degrees !== 90 && degrees !== 180 && degrees !== 270) return { error: 'Rotate needs 90, 180, or 270 degrees.' }
      return { type: 'rotate', degrees }
    }

    case 'flip': {
      const axis = str(c.axis)
      if (axis !== 'horizontal' && axis !== 'vertical') return { error: 'Flip needs an axis — "horizontal" or "vertical".' }
      return { type: 'flip', axis }
    }

    case 'reverse':
      return { type: 'reverse' }

    case 'text_style': {
      const positionRaw = str(c.position)
      const position = positionRaw && CAPTION_POSITIONS.includes(positionRaw as CaptionPosition) ? (positionRaw as CaptionPosition) : undefined
      const sizeRaw = str(c.size)
      const size = sizeRaw && CAPTION_SIZES.includes(sizeRaw as CaptionSize) ? (sizeRaw as CaptionSize) : undefined
      const style = parseTextStyleFields(c)
      if ('error' in style) return style
      if (Object.keys(style).length === 0 && position == null && size == null) {
        return { error: 'Missing what to change about the text (color, bold, italic, underline, strikethrough, outline, background, position, size, or font).' }
      }
      // target is just a wording hint here (like remove_text's) — resolved
      // against the REAL current layers below, never guessed by the AI.
      const resolved = resolveTextLayer({ text: c.target }, ctx)
      if ('error' in resolved) return resolved
      return {
        type: 'text_style', overlayId: resolved.id, text: resolved.text,
        ...style,
        ...(position != null ? { position } : {}),
        ...(size != null ? { size } : {}),
      }
    }

    case 'text_edit': {
      const newText = str(c.text)
      if (!newText || !newText.trim()) return { error: 'Missing the new wording for that text.' }
      if (newText.length > 200) return { error: 'That text is too long (200 characters max).' }
      // target is the wording hint identifying WHICH layer to edit — never
      // confused with the new text itself, which is a separate field.
      const resolved = resolveTextLayer({ text: c.target }, ctx)
      if ('error' in resolved) return resolved
      return { type: 'text_edit', overlayId: resolved.id, text: newText.trim() }
    }

    case 'captions_auto':
      return { type: 'captions_auto' }

    case 'audio_noise_reduction':
      return { type: 'audio_noise_reduction' }

    case 'remove_effect': {
      const effectType = str(c.effectType)
      if (!effectType || !EFFECT_TYPES.includes(effectType as EffectType)) {
        return { error: `Which effect should I remove — one of ${EFFECT_TYPES.join(', ')}?` }
      }
      if (ctx.lastEffectType !== effectType) {
        return {
          error: ctx.lastEffectType
            ? `I can only remove the ${effectType} if it's the most recent change — the most recent change was ${ctx.lastEffectType}, possibly combined with other edits. Use Undo if you'd like to step back through recent edits instead.`
            : `There's no ${effectType} currently applied that I can remove.`,
        }
      }
      return { type: 'remove_effect', effectType: effectType as EffectType }
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
  /** Present instead of commands when the AI (or validation) couldn't
   *  determine something required — a timestamp, a target, a missing music
   *  file, an unsupported font. This is a NORMAL outcome of a genuinely
   *  ambiguous/incomplete instruction, not a failure — the caller should
   *  show it as a plain question, not an error. */
  clarification?: string
  /** Present instead of commands/clarification when something actually went
   *  wrong reaching or parsing a response from the AI service itself (rate
   *  limit, network failure, malformed response) — as opposed to the AI
   *  successfully responding but needing more information. The caller
   *  should show this as a real error (distinct styling from
   *  clarification), since it's not something rephrasing the instruction
   *  will fix — it's the service being unavailable. */
  error?: string
}

function systemPrompt(ctx: InterpretContext): string {
  const layers = ctx.textLayers ?? []
  const layersDesc = layers.length
    ? layers.map((l) => `- "${l.text}" (${l.start.toFixed(1)}s–${l.end.toFixed(1)}s)`).join('\n')
    : '(none yet)'
  const effectDesc = ctx.lastEffectType
    ? `The single most recent edit was a "${ctx.lastEffectType}" effect (nothing else combined with it).`
    : "The most recent edit either wasn't an effect, combined several things, or there isn't one yet."

  return `You convert a plain-English video editing instruction into structured JSON commands for an editing tool. You do not edit video yourself — you only output data.

The video is ${ctx.durationSec.toFixed(1)} seconds long. ${ctx.hasMusic ? 'It already has a background music track.' : 'It has no background music track yet.'}

CURRENT PROJECT STATE — use this to avoid asking for information you can already see:
Existing text/caption layers:
${layersDesc}
${effectDesc}

CRITICAL — do not ask for information already available above or already given in the instruction:
- To remove or restyle an existing text/caption, you NEVER need to ask for its font, size, color, position, or timing — those are properties of the EXISTING layer, not something you need to know to identify it. Only the wording (if the instruction names it) matters for picking WHICH layer — pass it as "text" on remove_text/text_style, or omit "text" entirely for "it"/"that text"/"the text". The actual layer lookup (and any "which one did you mean" disambiguation, only if truly ambiguous) happens outside of you — you do not need the layer list to be unambiguous yourself, just pass through what the instruction gave you.
- For text_style, set ONLY the fields the instruction actually asked to change (e.g. "make it red" → only "color"; "make it bigger" → only "size"; "make it bold"/"italic"/"underlined"/"struck through" → only that one boolean; "move it to the top" → only "position"). Never invent values for properties the instruction didn't mention — those are preserved automatically by not including them.
- To remove a previously-applied effect ("remove the blur", "undo the pixelation"), use remove_effect with the matching effectType — never ask for its strength, start, or end time; those aren't needed to remove it.
- text_style ONLY works on a layer that ALREADY appears in "Existing text/caption layers" above. If the instruction both ADDS new text and describes how it should look (color/font/bold/outline) in the same breath — e.g. "add 'Galaxy' in red, Times New Roman" — that is ONE "text"/"caption" command with the style fields set directly on it, never a "text" command followed by a separate "text_style" command: the text_style would fail because that layer doesn't exist until this instruction creates it.
- If the instruction asks to change the font but doesn't name a specific one (e.g. "change the font to something else", "use a different font", "change it from Times New Roman to any other"), that is a clarification — but NEVER just say "choose from the allowed fonts list" without saying what they are. Spell out the actual options in the question itself, verbatim from this list: ${FONT_FAMILIES.join(', ')}. The operator can't act on a vague reference to a list they can't see.

Respond with ONLY a JSON object, no prose, no markdown code fences, matching exactly one of these two shapes:

1) { "commands": [ <one or more command objects> ] }
2) { "clarification": "<a short question asking for the missing information>" }

Use shape 2 whenever the instruction is missing a timestamp, target, or amount you cannot determine from the instruction itself — GUESSING A VALUE IS NOT ALLOWED. If someone says "zoom into the product" with no timing, ask when. If they say "crop this" with no target format, ask what aspect ratio. Whenever the missing information is itself a choice from a fixed, known list (fonts, crop aspect ratios, positions, etc.), the clarification question MUST list the actual options — never refer to "the allowed list"/"supported options" without spelling them out, since the operator has no other way to see that list.

Supported command types (all times are seconds from the start of the video, all fields shown are required unless marked optional):

trim        { "type": "trim", "start": number, "end": number }  — keep only [start,end]
crop        { "type": "crop", "aspect": "9:16" | "1:1" | "4:5" | "16:9" | "4:3" }
zoom        { "type": "zoom", "start": number, "end": number, "fromScale": number, "toScale": number, "target": "center" | "left" | "right" | "top" | "bottom" }  — fromScale defaults to 1 if omitted; scales are 0.5-4
pan         { "type": "pan", "start": number, "end": number, "direction": "left-to-right" | "right-to-left" | "top-to-bottom" | "bottom-to-top", "scale": number }  — scale (how zoomed in while panning) defaults to 1.3, range 1-4
speed       { "type": "speed", "start": number, "end": number, "factor": number }  — factor > 1 is faster, < 1 is slower, range 0.25-4
text        { "type": "text", "text": string, "start": number, "end": number, "position": "top"|"bottom"|"left"|"right"|"center", "size": "sm"|"md"|"lg", "color"?: string, "bold"?: boolean, "italic"?: boolean, "underline"?: boolean, "strikethrough"?: boolean, "glow"?: boolean, "outlineColor"?: string, "outlineWidth"?: number, "fontFamily"?: string, "backgroundColor"?: string, "backgroundOpacity"?: number, "animation"?: "slide-down"|"slide-up"|"fade"|"bounce"|"shake"|"blur-in", "animationDuration"?: number }  — "text" fully supports real emoji characters (🔥🎉🚀 etc.) written directly in the string — this editor renders text via the browser's own font stack (Canvas), which draws color emoji correctly; never spell out an emoji's name in words or omit an emoji the instruction asked for, just include the literal character. start:0, end:0 means "shown for the whole video", not "missing". ALL styling fields are optional — set any of them the instruction asks for RIGHT HERE when adding text that doesn't exist yet (e.g. "add 'Galaxy' in red, Times New Roman, italic and underlined" is one single text command with color/fontFamily/italic/underline all included — never a separate text_style for text being added in the same instruction, since text_style only works on text that's already on the video). fontFamily must be one of: ${FONT_FAMILIES.join(', ')}. backgroundColor is the color of the box behind the text (default black); backgroundOpacity is 0 (invisible box)..1 (solid), default 0.6. glow is a standing neon-style glow around the text (not an entrance) — "make it neon"/"give it a glow" → glow:true. animation is how the text ENTERS at its start time — "slide-down" (comes down from above into place, like a reel-style intro), "slide-up" (comes up from below), "fade" (fades in in place), "bounce" (drops in and settles with a couple of diminishing overshoots), "shake" (rattles side-to-side and settles), "blur-in" (starts out of focus and sharpens into place); omit for an instant, non-animated appearance (the default); only meaningful with a real start/end window, not "whole video". animationDuration is how long the entrance takes in seconds (0-3, default 0.4) — omit unless a speed is explicitly asked for ("slide in slowly"/"quick pop in"). For "text lines coming in one by one" (a sequence, e.g. a name/title/role each appearing after the last), use SEVERAL separate text commands with staggered start/end times and the same animation, not one command — see the multi-line example below. Omit anything not asked for rather than guessing.
caption     { "type": "caption", ...same fields as text }
remove_text { "type": "remove_text", "text"?: string, "start"?: number, "end"?: number }  — REMOVES an existing text/caption overlay; use this whenever the instruction says to remove/delete/take out/get rid of an on-screen text, never the "text"/"caption" type (those only ADD text). ALL fields optional: "text" is the wording mentioned in the instruction (e.g. "Galaxy Home Automation") if any is given — include it if named, omit it for "remove the text"/"remove it" with no wording. "start"/"end" are optional too, only useful if the instruction names a time range to disambiguate multiple similar layers. Do NOT ask the user for start/end/text just to fill these in — omit what wasn't given.
audio_volume{ "type": "audio_volume", "volume": number }  — 0 to 3, 1 = unchanged
mute        { "type": "mute", "muted": boolean }
music       { "type": "music", "action": "volume" | "remove", "volume": number }  — volume (0-1) only used with action "volume", and only valid if the video already has a music track
loop        { "type": "loop", "times": integer }  — 2 to 10, total number of plays
blur        { "type": "blur", "start": number, "end": number, "strength": number }  — WHOLE-FRAME blur only, strength 1-20. There is no person/object/background detection in this tool — if the instruction asks to blur only the background, only a person, or only an object (not the whole frame), you MUST use clarification instead, explaining plainly that only whole-frame blur is available and asking if they'd like that instead. Never silently apply a whole-frame blur to a "blur just the background" request.
pixelate    { "type": "pixelate", "start": number, "end": number, "strength": number }  — same whole-frame-only rule as blur.
mask        { "type": "mask", "start": number, "end": number, "shape": "circle" | "rect", "x"?: number, "y"?: number, "size"?: number, "feather"?: number }  — a SPOTLIGHT effect: the video stays normal INSIDE the shape and is darkened OUTSIDE it, for [start,end]. This is NOT a cutout/compositing mask — there's no chroma key, background removal, or second layer in this tool, so "cut me out and put me on a different background" or "remove the background" is NOT achievable with this command; that must be a clarification explaining plainly that only a darken-outside spotlight is available, never silently applied as if it were background removal. x/y are the CENTER of the shape as a 0-1 fraction of the frame (0.5,0.5 = middle) — default to 0.5,0.5 if not said. size is how big the shape is, 0.05 (tiny) to 0.9 (nearly full-frame), default 0.35. feather is edge softness, 0 (hard edge) to 0.3 (very soft), default 0.12. Map "spotlight the person"/"circle around the product"/"highlight the middle" to this with sensible defaults rather than asking, UNLESS the instruction gives no usable time window at all.
look        { "type": "look", "start": number, "end": number, "name": "sepia"|"negative"|"tealOrange"|"vintage"|"cinematic"|"hdr"|"colorize"|"duotone"|"oldFilm"|"super8"|"polaroid"|"camcorder", "hueDegrees"?: number }  — a fixed, canned color-grade preset (not individually tunable — use "color" instead for specific brightness/contrast/etc. adjustments). "negative" is a full color invert. "tealOrange" pushes shadows blue-green and highlights orange (the common blockbuster-movie grade). "hdr" boosts local contrast and saturation for a punchy, "HDR-look" image — not real HDR (no wider dynamic range is actually captured, just simulated). "colorize" tints the whole image toward one hue — hueDegrees (0-360, default ~200/blue if not said) is only used here, e.g. "colorize it blue" → hueDegrees near 200-220, "sepia-tone but green" → hueDegrees near 100-140. "duotone"/"oldFilm"/"super8"/"polaroid"/"camcorder" are each one fixed recipe, no extra params. Map "make it black and white sepia"/"give it a vintage look"/"cinematic color grade"/"old film effect"/"like a polaroid photo"/"camcorder look" directly to the matching name.
glitch      { "type": "glitch", "start": number, "end": number, "style": "rgbSplit"|"tvNoise"|"screenFlicker"|"vhs"|"scanLines"|"digitalGlitch"|"signalDistortion", "strength"?: number }  — a digital-degradation effect, for [start,end]. strength 0-1, default 0.5 (a clearly-visible middle amount) — omit unless the instruction says how strong/subtle. "rgbSplit" separates the red/blue channels sideways (the classic chromatic-aberration glitch look). "tvNoise" is heavy grainy static. "screenFlicker" pulses brightness rapidly. "vhs" combines rgbSplit+noise+a slight desaturation and vignette for an old-tape look. "scanLines" darkens alternating horizontal lines like an old CRT. "digitalGlitch" is short, jittery rgbSplit/noise bursts rather than one continuous effect. "signalDistortion" is a stronger, static (non-pulsing) rgbSplit+contrast push. Map "glitch it out"/"add a glitch"/"chromatic aberration"/"VHS effect"/"old TV look"/"scan lines"/"static" directly to the matching style.
light       { "type": "light", "start": number, "end": number, "style": "flash"|"strobe"|"flicker"|"glow"|"bloom"|"lightLeak", "strength"?: number }  — a brightness/light effect, for [start,end]. strength 0-1, default 0.5. "flash" is one bright pulse that decays quickly from the start of the window (a camera-flash moment). "strobe" is fast, sharp on/off brightness pulses. "flicker" is a slower, gentler brightness wobble (an unstable-light look). "glow"/"bloom" brighten and soft-blur the whole frame blended back over itself — bloom is the stronger/blurrier of the two. "lightLeak" washes a warm orange color glow across the frame (the light-leaking-into-camera look). Map "add a flash"/"flash effect"/"strobe light"/"flickering light"/"make it glow"/"soft glow"/"light leak effect" directly to the matching style.
motionfx    { "type": "motionfx", "start": number, "end": number, "style": "cameraShake"|"wobble"|"zoomPunch"|"motionTrail"|"speedRamp", "strength"?: number }  — a camera-motion effect, for [start,end]. strength 0-1, default 0.5. "cameraShake" is a sharp jolt that decays quickly (a bump/impact feel). "wobble" is a slower, sustained unsteady sway (a handheld-camera feel), not decaying. "zoomPunch" is a quick zoom in and back out. "motionTrail" ghosts recent frames together for a smeared-motion look. "speedRamp" steps through a few different speeds across the window (not one smooth continuous rate change) — use the existing "speed" command instead if a single constant speed change over the window is what's actually wanted. There is no "freeze frame"/"pause on this moment" effect available — every technique tried for it produced a genuinely broken result in testing, so that must be a clarification saying it isn't available, never silently approximated. Map "add camera shake"/"shake effect"/"wobbly camera"/"zoom punch"/"punch zoom"/"motion blur trail"/"speed ramp" directly to the matching style.
audiofx     { "type": "audiofx", "style": "equalizer"|"reverb"|"echo"|"distortion"|"bassBoost"|"pitch"|"mono"|"fadeIn"|"fadeOut", "strength"?: number, "direction"?: "up"|"down", "duration"?: number }  — a WHOLE-CLIP audio effect (no start/end — same as "reverse"/"audio_noise_reduction", it processes the entire track). strength 0-1, default 0.5, unused by "mono". "equalizer" boosts presence/clarity. "reverb" is an approximate room-echo blend (several layered short echoes), not true convolution reverb. "echo" is one clear, spaced-out repeat. "distortion" is a bit-crush/gritty texture. "bassBoost" boosts low frequencies. "pitch" shifts the voice/audio higher or lower without changing speed — use "direction" ("up"|"down", default "up"), e.g. "make the voice higher" → direction up, "deepen the voice" → direction down. "mono" downmixes stereo to mono (no strength). "fadeIn"/"fadeOut" fade the audio in/out — use "duration" (seconds, default 1), not strength. Map "add reverb"/"echo effect"/"distort the audio"/"boost the bass"/"pitch it up"/"deeper voice"/"make it mono"/"fade the audio in/out" directly to the matching style.
color       { "type": "color", "start": number, "end": number, "brightness"?: number, "contrast"?: number, "saturation"?: number, "grayscale"?: boolean, "warmth"?: number, "tint"?: number, "vignette"?: number, "exposure"?: number, "highlights"?: number, "shadows"?: number, "sharpness"?: number, "clarity"?: number, "grain"?: number }  — at least one field besides start/end/type required. brightness -1 (darker)..1 (brighter) is a flat offset; exposure -1..1 is a multiplicative push closer to a camera's exposure dial — use exposure for "overexposed"/"underexposed"/"more exposure", brightness for a plain "brighter"/"darker". contrast/saturation 0..3 (1=unchanged, 0=flat/no contrast or fully desaturated). warmth -1 (cooler/blue)..1 (warmer/orange) is the orange/blue axis; tint -1 (magenta)..1 (green) is the other color axis — "too green"/"add magenta" → tint, "too warm"/"too blue" → warmth. highlights/shadows -1..1 each lift or crush just the bright or dark end of the image, independent of overall brightness — "bring back the blown-out sky"/"recover highlight detail" → negative highlights; "brighten the shadows"/"lift the blacks" → positive shadows. vignette 0 (none)..1 (strong, darkened edges). sharpness 0 (none)..2 (strong) is a normal sharpen; clarity 0..1 is a softer, wider "punchy/textured" local-contrast sharpen — "make it crisper"/"sharpen it" → sharpness, "add texture/punch"/"make it pop" (without asking for color) → clarity. grain 0..1 adds film-grain noise. Map casual wording to these fields rather than asking: "dull"/"muted"/"washed out"/"desaturated"/"flat" → lower saturation (e.g. 0.4); "vibrant"/"vivid"/"punchy"/"more colorful" → higher saturation (e.g. 1.6); "dim"/"darker"/"underexposed" → negative brightness; "brighter"/"lighter"/"overexposed look" → positive brightness; "moody"/"cinematic" (with no other detail given) is too vague on its own — ask what specifically (darker? cooler? more contrast?) rather than guessing a whole grade.
fade        { "type": "fade", "direction": "in" | "out", "duration": number }  — video fades to/from black at the very start (in) or very end (out) of the clip, duration in seconds (default 1 if not said).
rotate      { "type": "rotate", "degrees": 90 | 180 | 270 }
flip        { "type": "flip", "axis": "horizontal" | "vertical" }
reverse     { "type": "reverse" }  — plays the whole video backwards.
text_style  { "type": "text_style", "target"?: string, "color"?: string, "bold"?: boolean, "italic"?: boolean, "underline"?: boolean, "strikethrough"?: boolean, "glow"?: boolean, "outlineColor"?: string, "outlineWidth"?: number, "position"?: "top"|"bottom"|"left"|"right"|"center", "size"?: "sm"|"md"|"lg", "fontFamily"?: string, "backgroundColor"?: string, "backgroundOpacity"?: number, "animation"?: "slide-down"|"slide-up"|"fade"|"bounce"|"shake"|"blur-in", "animationDuration"?: number }  — MODIFIES an existing text/caption overlay (never adds a new one — use "text"/"caption" to add). "target" is the wording of the text to restyle if named (e.g. "Galaxy Home Automation"); omit target entirely for "it"/"that text" with nothing else to go on — layer lookup happens outside of you, you don't need to resolve it yourself. Set ONLY the style field(s) the instruction actually asked to change — never include a field the instruction didn't mention, that would overwrite something the user wants kept as-is. color/outlineColor/backgroundColor are CSS colors (e.g. "white", "#ffcc00", "red"). italic/underline/strikethrough are booleans — "make it italic"/"underline it"/"strike it through" each set exactly one, "remove the underline"/"un-italicize it" sets it back to false, don't touch the others. backgroundOpacity is 0 (invisible)..1 (solid); "remove the background box"/"make the background transparent" → backgroundOpacity:0. fontFamily must be one of: ${FONT_FAMILIES.join(', ')} — a request for a font outside this list should be a clarification saying so, not a guess at the closest match.
text_edit   { "type": "text_edit", "target"?: string, "text": string }  — CHANGES THE WORDING of an existing text/caption overlay (never its styling — use text_style for that). Use this for "add a 🔥 emoji to the CEO text", "change the text to say...", "add an emoji to it". "text" is the FULL new wording — if the instruction adds to existing text (e.g. an emoji) rather than replacing it outright, look up that layer's CURRENT text in the CURRENT PROJECT STATE above and compose the new full string yourself (existing text + the emoji/change), don't just send the emoji alone. "target" is the wording hint identifying which layer, same rules as text_style/remove_text — omit for "it"/"that text".
captions_auto { "type": "captions_auto" }  — auto-generates timed captions from the video's real speech (actual transcription). Use for "add captions"/"add subtitles"/"caption this" with no text of their own given.
audio_noise_reduction { "type": "audio_noise_reduction" }  — reduces steady background hiss/hum in the original audio.
remove_effect { "type": "remove_effect", "effectType": "crop"|"zoom"|"pan"|"speed"|"loop"|"blur"|"pixelate"|"color"|"fade"|"rotate"|"flip"|"reverse"|"audio_noise_reduction"|"mask" }  — removes a previously-applied hard-baked effect, e.g. "remove the blur"/"undo the pixelation"/"take off that color filter"/"remove the spotlight". Never ask for strength/start/end to do this — just identify WHICH effect type is meant from the instruction and the CURRENT PROJECT STATE above.

Examples:
"Zoom into the person from 5 to 8 seconds." → {"commands":[{"type":"zoom","start":5,"end":8,"fromScale":1,"toScale":1.5,"target":"center"}]}
"Crop this to Instagram Reel format." → {"commands":[{"type":"crop","aspect":"9:16"}]}
"Make seconds 10 to 12 twice as fast." → {"commands":[{"type":"speed","start":10,"end":12,"factor":2}]}
"Make the video 2x faster." (no section named — applies to the whole video, which IS determinable, so this is not a clarification case) → {"commands":[{"type":"speed","start":0,"end":${ctx.durationSec.toFixed(1)},"factor":2}]}
"Remove the first 3 seconds." → {"commands":[{"type":"trim","start":3,"end":${ctx.durationSec.toFixed(1)}}]}
"Zoom into the product." (no timing given) → {"clarification":"Which part of the video should I zoom into — what start and end time?"}
"Add 'Galaxy Home Automation' at the beginning." ("at the beginning" means a brief intro, not the whole video — default to the first 3 seconds unless told otherwise) → {"commands":[{"type":"text","text":"Galaxy Home Automation","start":0,"end":3,"position":"top","size":"lg"}]}
"Make an intro like a reel — 'Hey', then 'I'm the CEO of Galaxy', text sliding down from the top one after another." (a staggered multi-line intro — each line is its OWN text command with its own start/end, all sharing the same slide-down entrance) → {"commands":[{"type":"text","text":"Hey","start":0,"end":1.2,"position":"center","size":"lg","animation":"slide-down"},{"type":"text","text":"I'm the CEO of Galaxy","start":1,"end":3.5,"position":"center","size":"lg","animation":"slide-down"}]}
"Add write 'Galaxy' at the bottom of the video from 0 to 5 seconds, and make sure the font style is Times New Roman and the color should be red." (a brand-new text with its styling given in the same instruction — ONE command, style fields set directly on it, not a follow-up text_style) → {"commands":[{"type":"text","text":"Galaxy","start":0,"end":5,"position":"bottom","size":"md","color":"red","fontFamily":"Times New Roman"}]}
"Remove the Galaxy Home Automation text." (no timing needed — the wording alone identifies the layer) → {"commands":[{"type":"remove_text","text":"Galaxy Home Automation"}]}
"Remove the text." (only one text layer exists per CURRENT PROJECT STATE above) → {"commands":[{"type":"remove_text"}]}
"Remove the Galaxy Home Automation text between 0 and 0.5 seconds." → {"commands":[{"type":"remove_text","start":0,"end":0.5,"text":"Galaxy Home Automation"}]}
"Make it red." (restyling an existing text, only color named) → {"commands":[{"type":"text_style","color":"red"}]}
"Add 'Launching Now 🚀' at the top." (a brand-new text with a literal emoji character — never spelled out in words) → {"commands":[{"type":"text","text":"Launching Now 🚀","start":0,"end":3,"position":"top","size":"lg"}]}
"Add a fire emoji to the CEO text." (existing layer says "I'm the CEO of Galaxy" per CURRENT PROJECT STATE — compose the new full wording, don't send just "🔥") → {"commands":[{"type":"text_edit","target":"CEO","text":"I'm the CEO of Galaxy 🔥"}]}
"Change the text to say 'Welcome Home'." → {"commands":[{"type":"text_edit","text":"Welcome Home"}]}
"I want the text in Times New Roman and the color should be red." → {"commands":[{"type":"text_style","fontFamily":"Times New Roman","color":"red"}]}
"Change the font style from Times New Roman to any other." (no specific replacement font named — this IS a clarification, but the options must be spelled out, not just referenced) → {"clarification":"Which font would you like instead — one of: ${FONT_FAMILIES.join(', ')}?"}
"Make the Galaxy Home Automation text bigger." (only size named — font/color/position/timing all stay as they are) → {"commands":[{"type":"text_style","target":"Galaxy Home Automation","size":"lg"}]}
"Move it to the top." → {"commands":[{"type":"text_style","position":"top"}]}
"Make it italic and underlined." → {"commands":[{"type":"text_style","italic":true,"underline":true}]}
"Add a strikethrough to that text." → {"commands":[{"type":"text_style","strikethrough":true}]}
"Remove the background box behind the text." → {"commands":[{"type":"text_style","backgroundOpacity":0}]}
"Add 'Galaxy' at the bottom from 0 to 5 seconds, italic, underlined, in Times New Roman and red, with a blue background." (brand-new text with full styling given up front — ONE text command, every style field set directly on it) → {"commands":[{"type":"text","text":"Galaxy","start":0,"end":5,"position":"bottom","size":"md","italic":true,"underline":true,"fontFamily":"Times New Roman","color":"red","backgroundColor":"blue"}]}
"Remove the blur." (only valid if blur really is the single most recent change — see CURRENT PROJECT STATE) → {"commands":[{"type":"remove_effect","effectType":"blur"}]}
"Loop this 3 times." → {"commands":[{"type":"loop","times":3}]}
"Blur the entire video from 10 to 16 seconds." → {"commands":[{"type":"blur","start":10,"end":16,"strength":8}]}
"Blur the background but keep the person sharp." (no person/background detection exists) → {"clarification":"I can only blur the whole frame, not just the background — there's no person/background detection in this editor. Want me to blur the whole frame instead, and for which time range?"}
"Make the text white and bold." (about the most recently added text, no wording named) → {"commands":[{"type":"text_style","color":"white","bold":true}]}
"Make that text red." → {"commands":[{"type":"text_style","color":"red"}]}
"Add captions with a white font and black outline." (auto-transcribed, then styled) → {"commands":[{"type":"captions_auto"},{"type":"text_style","color":"white","outlineColor":"black","outlineWidth":3}]}
"Make this Instagram Reel format." → {"commands":[{"type":"crop","aspect":"9:16"}]}
"Slow down the middle section." (a time range IS determinable — the literal middle third of the video) → {"commands":[{"type":"speed","start":${(ctx.durationSec / 3).toFixed(1)},"end":${(ctx.durationSec * 2 / 3).toFixed(1)},"factor":0.5}]}
"Reduce background noise." → {"commands":[{"type":"audio_noise_reduction"}]}`
}

/** Strips a ```json fenced block down to just its contents, if present — the model is told not to do this, but following that instruction isn't guaranteed. */
function stripCodeFence(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  return (m ? m[1] : text).trim()
}

/** A deterministic backstop for the system prompt's "spell out the actual
 *  font options" instruction — following a prompt instruction isn't
 *  guaranteed, so if the model asks a font-related clarification without
 *  actually naming any of the supported fonts in it, the real list is
 *  appended here rather than leaving the operator staring at a vague
 *  "choose from the allowed fonts list" with no way to see what that is. */
function withFontOptionsIfAsking(clarification: string): string {
  const mentionsFont = /\bfonts?\b/i.test(clarification)
  const alreadyListsOne = FONT_FAMILIES.some((f) => clarification.toLowerCase().includes(f.toLowerCase()))
  if (!mentionsFont || alreadyListsOne) return clarification
  return `${clarification} (${FONT_FAMILIES.join(', ')})`
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
    return { error: `Could not reach the AI service: ${err instanceof Error ? err.message : String(err)}` }
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
    return { clarification: withFontOptionsIfAsking(obj.clarification.trim()) }
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

// ---------- human-readable descriptions ----------
// Pure and exported (rather than defined inline in VideoEditWorkspacePage)
// so the mapping from a validated command to what the operator actually
// sees is unit-testable on its own, same as validateCommand's accept/reject
// rules — this is the layer that answers "does the user understand exactly
// what changed", not just "did the JSON parse".

/** One line per command — used for the pending-command review list and the activity log. */
/** One short comma-joined summary of whichever style fields are actually
 *  set — shared by describeAiCommand's text/caption/text_style cases. */
function styleSummary(cmd: TextStyleFields): string {
  const parts: string[] = []
  if (cmd.fontFamily) parts.push(cmd.fontFamily)
  if (cmd.color) parts.push(cmd.color)
  if (cmd.bold) parts.push('bold')
  if (cmd.italic) parts.push('italic')
  if (cmd.underline) parts.push('underline')
  if (cmd.strikethrough) parts.push('strikethrough')
  if (cmd.glow) parts.push('glow')
  if (cmd.animation) parts.push(`${cmd.animation} in`)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/** The same style fields as styleSummary, but as separate card lines
 *  (describeAiCommandCard's text/caption/text_style cases) rather than one
 *  joined string. */
function styleCardLines(cmd: TextStyleFields): string[] {
  const lines: string[] = []
  if (cmd.fontFamily) lines.push(`Font: ${cmd.fontFamily}`)
  if (cmd.color) lines.push(`Color: ${cmd.color}`)
  if (cmd.bold != null) lines.push(cmd.bold ? 'Bold' : 'Not bold')
  if (cmd.italic != null) lines.push(cmd.italic ? 'Italic' : 'Not italic')
  if (cmd.underline != null) lines.push(cmd.underline ? 'Underlined' : 'No underline')
  if (cmd.strikethrough != null) lines.push(cmd.strikethrough ? 'Strikethrough' : 'No strikethrough')
  if (cmd.glow != null) lines.push(cmd.glow ? 'Neon glow' : 'No glow')
  if (cmd.outlineColor || cmd.outlineWidth) lines.push(`Outline: ${cmd.outlineColor ?? 'black'}${cmd.outlineWidth ? `, ${cmd.outlineWidth}px` : ''}`)
  if (cmd.backgroundColor || cmd.backgroundOpacity != null) {
    lines.push(`Background: ${cmd.backgroundColor ?? 'black'}${cmd.backgroundOpacity != null ? `, ${Math.round(cmd.backgroundOpacity * 100)}% opacity` : ''}`)
  }
  if (cmd.animation) lines.push(`Entrance: ${cmd.animation}${cmd.animationDuration ? ` (${cmd.animationDuration}s)` : ''}`)
  return lines
}

export function describeAiCommand(cmd: EditCommand): string {
  switch (cmd.type) {
    case 'trim': return `Trim to ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'crop': return `Crop to ${cmd.aspect}`
    case 'zoom': return `Zoom ${cmd.fromScale}x→${cmd.toScale}x on ${cmd.target}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'pan': return `Pan ${cmd.direction} (${cmd.scale}x), ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'speed': return `Speed ${cmd.factor}x, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'text': return `Text "${cmd.text}" (${cmd.position})${styleSummary(cmd)}`
    case 'caption': return `Caption "${cmd.text}" (${cmd.position})${styleSummary(cmd)}`
    case 'remove_text': return `Remove text "${cmd.text}"`
    case 'audio_volume': return `Original audio volume → ${cmd.volume}x`
    case 'mute': return cmd.muted ? 'Mute original audio' : 'Unmute original audio'
    case 'music': return cmd.action === 'remove' ? 'Remove background music' : `Music volume → ${cmd.volume}`
    case 'loop': return `Loop ${cmd.times}x`
    case 'blur': return `Blur ${fmtTime(cmd.start)}–${fmtTime(cmd.end)} (whole frame)`
    case 'pixelate': return `Pixelate ${fmtTime(cmd.start)}–${fmtTime(cmd.end)} (whole frame)`
    case 'color': return `Color adjust ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'fade': return `Fade ${cmd.direction} (${cmd.duration}s)`
    case 'rotate': return `Rotate ${cmd.degrees}°`
    case 'flip': return `Flip ${cmd.axis}`
    case 'reverse': return 'Reverse video'
    case 'mask': return `${cmd.shape === 'circle' ? 'Circle' : 'Rectangle'} spotlight ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'look': return `${LOOK_LABELS[cmd.name]} look, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'glitch': return `${GLITCH_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'light': return `${LIGHT_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'motionfx': return `${MOTION_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'audiofx': return AUDIO_LABELS[cmd.style]
    case 'text_style': return `Restyle text "${cmd.text}"${styleSummary(cmd)}`
    case 'text_edit': return `Edit text → "${cmd.text}"`
    case 'captions_auto': return 'Auto-generate captions from speech'
    case 'audio_noise_reduction': return 'Reduce background noise'
    case 'remove_effect': return `Remove ${cmd.effectType}`
  }
}

/** The structured "AI Edit Applied" card — title + plain-English detail
 *  lines, no ffmpeg filter strings or internal field names, per the explicit
 *  requirement that normal users never see technical rendering details. */
export function describeAiCommandCard(cmd: EditCommand): { title: string; lines: string[] } {
  switch (cmd.type) {
    case 'trim':
      return { title: 'Trim', lines: [`Kept ${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`] }
    case 'crop':
      return { title: 'Crop', lines: [`Aspect ratio: ${cmd.aspect}`] }
    case 'zoom':
      return { title: 'Zoom', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Scale: ${cmd.fromScale}x → ${cmd.toScale}x`, `Target: ${cmd.target}`] }
    case 'pan':
      return { title: 'Pan', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Direction: ${cmd.direction}`, `Scale: ${cmd.scale}x`] }
    case 'speed':
      return { title: 'Speed', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `${cmd.factor}x ${cmd.factor > 1 ? 'faster' : 'slower'}`] }
    case 'text':
      return { title: 'Text', lines: [`"${cmd.text}"`, `Position: ${cmd.position}`, ...styleCardLines(cmd)] }
    case 'caption':
      return { title: 'Caption', lines: [`"${cmd.text}"`, `Position: ${cmd.position}`, ...styleCardLines(cmd)] }
    case 'remove_text':
      return { title: 'Remove Text', lines: [`"${cmd.text}"`] }
    case 'audio_volume':
      return { title: 'Audio Volume', lines: [`Original audio set to ${Math.round(cmd.volume * 100)}%`] }
    case 'mute':
      return { title: cmd.muted ? 'Mute' : 'Unmute', lines: [cmd.muted ? 'Original audio muted' : 'Original audio restored'] }
    case 'music':
      return cmd.action === 'remove'
        ? { title: 'Music', lines: ['Background music removed'] }
        : { title: 'Music', lines: [`Volume set to ${Math.round((cmd.volume ?? 0) * 100)}%`] }
    case 'loop':
      return { title: 'Loop', lines: [`Video now plays ${cmd.times} times`] }
    case 'blur':
      return { title: 'Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Whole frame (not just background/person)'] }
    case 'pixelate':
      return { title: 'Pixelate', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Whole frame'] }
    case 'mask':
      return {
        title: `${cmd.shape === 'circle' ? 'Circle' : 'Rectangle'} Spotlight`,
        lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Normal inside, darkened outside'],
      }
    case 'look':
      return { title: LOOK_LABELS[cmd.name], lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`] }
    case 'glitch':
      return { title: GLITCH_LABELS[cmd.style], lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'light':
      return { title: LIGHT_LABELS[cmd.style], lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'motionfx':
      return { title: MOTION_LABELS[cmd.style], lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'audiofx':
      return {
        title: AUDIO_LABELS[cmd.style],
        lines: cmd.style === 'fadeIn' || cmd.style === 'fadeOut'
          ? [`Duration: ${cmd.duration}s`]
          : cmd.style === 'pitch'
            ? [`Direction: ${cmd.direction}`, `Strength: ${cmd.strength}`]
            : [`Strength: ${cmd.strength}`],
      }
    case 'color': {
      const lines: string[] = []
      if (cmd.brightness != null) lines.push(`Brightness: ${cmd.brightness > 0 ? '+' : ''}${cmd.brightness}`)
      if (cmd.contrast != null) lines.push(`Contrast: ${cmd.contrast}x`)
      if (cmd.saturation != null) lines.push(`Saturation: ${cmd.saturation}x`)
      if (cmd.grayscale) lines.push('Grayscale')
      if (cmd.warmth != null) lines.push(`Warmth: ${cmd.warmth > 0 ? '+' : ''}${cmd.warmth}`)
      if (cmd.tint != null) lines.push(`Tint: ${cmd.tint > 0 ? '+' : ''}${cmd.tint}`)
      if (cmd.vignette != null) lines.push(`Vignette: ${cmd.vignette}`)
      if (cmd.exposure != null) lines.push(`Exposure: ${cmd.exposure > 0 ? '+' : ''}${cmd.exposure}`)
      if (cmd.highlights != null) lines.push(`Highlights: ${cmd.highlights > 0 ? '+' : ''}${cmd.highlights}`)
      if (cmd.shadows != null) lines.push(`Shadows: ${cmd.shadows > 0 ? '+' : ''}${cmd.shadows}`)
      if (cmd.sharpness != null) lines.push(`Sharpness: ${cmd.sharpness}`)
      if (cmd.clarity != null) lines.push(`Clarity: ${cmd.clarity}`)
      if (cmd.grain != null) lines.push(`Grain: ${cmd.grain}`)
      lines.push(`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`)
      return { title: 'Color', lines }
    }
    case 'fade':
      return { title: 'Fade', lines: [`Fade ${cmd.direction} over ${cmd.duration}s`] }
    case 'rotate':
      return { title: 'Rotate', lines: [`${cmd.degrees}° clockwise`] }
    case 'flip':
      return { title: 'Flip', lines: [`Flipped ${cmd.axis}ly`] }
    case 'reverse':
      return { title: 'Reverse', lines: ['Video now plays backwards'] }
    case 'text_style': {
      const lines: string[] = [`"${cmd.text}"`, ...styleCardLines(cmd)]
      if (cmd.position) lines.push(`Position: ${cmd.position}`)
      if (cmd.size) lines.push(`Size: ${cmd.size}`)
      return { title: 'Text Style', lines }
    }
    case 'text_edit':
      return { title: 'Edit Text', lines: [`Now reads: "${cmd.text}"`] }
    case 'captions_auto':
      return { title: 'Captions', lines: ["Generated from the video's speech"] }
    case 'audio_noise_reduction':
      return { title: 'Audio', lines: ['Background noise reduced'] }
    case 'remove_effect':
      return { title: 'Remove Effect', lines: [`${cmd.effectType} removed`] }
  }
}
