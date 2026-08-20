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
/** Background-ONLY blur — the subject stays sharp, unlike `blur` which hits
 *  every pixel. Only possible because of an actual ML segmentation model
 *  (autoEdit.ts's applyBackgroundBlur), not an ffmpeg filter — see that
 *  file's comment for why `blur` alone can't do this. Same [start,end] +
 *  strength 1-20 shape as `blur`/`pixelate`. */
export interface BackgroundBlurCommand { type: 'background_blur'; start: number; end: number; strength: number }
export interface PixelateCommand { type: 'pixelate'; start: number; end: number; strength: number }
/** Directional streak blur (camera/subject motion) along the frame's own
 *  horizontal or vertical axis. Distinct from `blur` (isotropic, no
 *  direction) — see autoEdit.ts's buildDirectionalBlurFilter. */
export interface MotionBlurCommand { type: 'motion_blur'; start: number; end: number; direction: 'horizontal' | 'vertical'; strength: number }
/** Same streak-blur technique as `motion_blur`, generalized to an arbitrary
 *  angle instead of just horizontal/vertical — kept as its own command
 *  since "blur it at a 45 degree angle" is a distinct enough phrase from
 *  "motion blur horizontally", though both share the same builder. */
export interface DirectionalBlurCommand { type: 'directional_blur'; start: number; end: number; angle: number; strength: number }
/** Burst/radial-zoom blur look, ALWAYS centered — simulates a zoom without
 *  changing framing. For a movable burst point use `radial_blur` instead. */
export interface ZoomBlurCommand { type: 'zoom_blur'; start: number; end: number; strength: number }
/** Same zoom-burst technique as `zoom_blur`, but radiating from a movable
 *  center point (x/y, 0-1 fraction of frame, default centered) — that
 *  movable center is the one real difference between the two commands. */
export interface RadialBlurCommand { type: 'radial_blur'; start: number; end: number; strength: number; x?: number; y?: number }
/** Rotational (swirl) blur around a center point (x/y, 0-1, default
 *  centered) — visually distinct from the burst look of zoom_blur/radial_blur. */
export interface SpinBlurCommand { type: 'spin_blur'; start: number; end: number; strength: number; x?: number; y?: number }
/** Miniature-photo look — a horizontal band (bandY = vertical center 0-1,
 *  default 0.5; bandHeight = fraction of frame height staying sharp, default
 *  0.25) stays in focus, blur increases with distance above/below it. */
export interface TiltShiftBlurCommand { type: 'tiltshift_blur'; start: number; end: number; strength: number; bandY?: number; bandHeight?: number }
/** Travelling sinusoidal ripple — rows slide sideways (axis 'horizontal',
 *  default) or columns slide up/down (axis 'vertical') by a sine of the
 *  perpendicular coordinate, animated over time. One-axis and periodic,
 *  unlike `warp`'s two-axis wobble — see autoEdit.ts's buildWaveFilter. */
export interface WaveCommand { type: 'wave'; start: number; end: number; strength: number; axis?: 'horizontal' | 'vertical' }
/** Concentric circular ripples radiating out from a point (x/y, 0-1
 *  fraction of frame, default centered — same convention as `mask` and
 *  `radial_blur`): pond/water look, displacement is radial, not per-axis. */
export interface RippleCommand { type: 'ripple'; start: number; end: number; strength: number; x?: number; y?: number }
/** General smooth spatial wobble — low-frequency sines on BOTH axes at once,
 *  so the frame drifts and bends rather than rippling in one direction the
 *  way `wave` does. No center point; it's a whole-frame heat-haze look. */
export interface WarpCommand { type: 'warp'; start: number; end: number; strength: number }
/** Spiral swirl: pixels rotate progressively more the closer they are to
 *  the center point (x/y, 0-1, default centered), fading to nothing at the
 *  edge of the effect radius. */
export interface TwirlCommand { type: 'twirl'; start: number; end: number; strength: number; x?: number; y?: number }
/** Whole-frame barrel/fisheye lens bulge — the centre swells and straight
 *  lines bow outward, zoomed just enough to keep the frame filled. Same
 *  lens math as `lens_distortion`'s "barrel" mode, only much stronger:
 *  fisheye is the look, lens_distortion is the subtle correction. */
export interface FisheyeCommand { type: 'fisheye'; start: number; end: number; strength: number }
/** LOCALIZED outward bulge around a point (x/y, 0-1, default centered) —
 *  a magnifying-glass blister, not the whole-frame swell `fisheye` gives. */
export interface BulgeCommand { type: 'bulge'; start: number; end: number; strength: number; x?: number; y?: number }
/** The exact inverse of `bulge`: a localized inward pinch around a point
 *  (x/y, 0-1, default centered) — shares one builder, sign flipped. */
export interface SqueezeCommand { type: 'squeeze'; start: number; end: number; strength: number; x?: number; y?: number }
/** Anisotropic stretch along ONE axis — content is pulled wider (axis
 *  'horizontal', default) or taller (axis 'vertical') while the frame keeps
 *  its original size, so the edges are cropped away. Not `zoom`, which
 *  scales both axes together and keeps the aspect ratio. */
export interface StretchCommand { type: 'stretch'; start: number; end: number; strength: number; axis?: 'horizontal' | 'vertical' }
/** Lens-correction-style distortion, in whichever of the two visually
 *  opposite directions is asked for: "barrel" bows straight lines outward,
 *  "pincushion" bows them inward. Mode is required — the two look nothing
 *  alike and picking one is the whole point of the command. */
export interface LensDistortionCommand { type: 'lens_distortion'; start: number; end: number; strength: number; mode: 'barrel' | 'pincushion' }
/** Continuous rotating-frame animation over [start,end] — the frame itself
 *  visibly spins, unlike `rotate`'s fixed one-time 90/180/270 snap and
 *  unlike `spin_blur`'s rotational SMEAR (a blur, the frame never actually
 *  moves). strength 1-20 controls rotation speed (revolutions/sec);
 *  direction defaults to clockwise. Always centered — no pivot field, since
 *  a continuously spinning frame around anything but its own center reads
 *  as broken rather than stylistic. See autoEdit.ts's buildPivotRotateFilter. */
export interface SpinCommand { type: 'spin'; start: number; end: number; strength: number; direction?: 'clockwise' | 'counterclockwise' }
/** A single BOUNDED partial turn from fromDegrees to toDegrees (both
 *  -360..360), linear over [start,end], holding fromDegrees before and
 *  toDegrees after — a controlled tilt/dutch-angle move. Distinct from
 *  `spin`'s open-ended continuous rotation (which never settles at a fixed
 *  angle and can sweep through many revolutions) and from `rotate`'s
 *  instant 90/180/270 snap (no animation at all). */
export interface RotationCommand { type: 'rotation'; start: number; end: number; fromDegrees: number; toDegrees: number }
/** Scale "pop": the frame briefly enlarges then springs back with a couple
 *  of decaying overshoots, over [start,end] — a SCALE-over-time animation,
 *  distinct from motionfx's `wobble` (position jitter, no scale change) and
 *  `zoomPunch` (one quick zoom in-and-out, no spring/overshoot). strength
 *  1-20 controls how large the initial pop is. */
export interface BounceCommand { type: 'bounce'; start: number; end: number; strength: number }
/** Pendulum-like ROTATIONAL oscillation — rotates one way then swings back
 *  the other, amplitude decaying to a standstill, around a pivot (x/y, 0-1
 *  fraction of frame, default centered — same convention as `spin_blur`/
 *  `ripple`). Distinct from `spin` (rotates continuously one direction,
 *  never reverses) and from `bounce` (scale, not rotation). strength 1-20
 *  controls swing amplitude. */
export interface SwingCommand { type: 'swing'; start: number; end: number; strength: number; x?: number; y?: number }
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
/** A bright circular flare/halo with smaller secondary rings strung out
 *  along the line from a light-source point (x/y, 0-1, default 0.8/0.2 —
 *  upper-right, the classic flare source position) through frame CENTER and
 *  beyond — the streak-of-shrinking-circles look, distinct from `light`'s
 *  "glow"/"bloom" (which brighten+blur the WHOLE frame, no shape). strength
 *  1-20 scales size/brightness of the whole rig. */
export interface LensFlareCommand { type: 'lens_flare'; start: number; end: number; strength: number; x?: number; y?: number }
/** Small bright points scattered over the frame, twinkling in and out via a
 *  shimmer pattern (several lit at once, not one blinking dot) — not a
 *  brightness/blur effect on the frame itself, a scattering of star-like
 *  highlights over it. strength 1-20 scales density/brightness. */
export interface SparkleCommand { type: 'sparkle'; start: number; end: number; strength: number }
/** A saturated-color glow around bright edges/highlights, tinted by `color`
 *  (a plain CSS color string — same convention as TextStyleFields.color, no
 *  allowlist — default a vivid neon pink). Distinct from `light`'s "glow",
 *  which is a white/tonal brighten+blur of the whole frame; this only lights
 *  up the ALREADY-bright parts of the image, in the requested hue. strength
 *  1-20 scales how far the glow spreads and how strong it is. */
export interface NeonGlowCommand { type: 'neon_glow'; start: number; end: number; strength: number; color?: string }
/** Bright diagonal rays radiating from a source point (x/y, 0-1, default
 *  0.5/0.1 — top-center, a common sunlight angle) — crepuscular/"god rays"
 *  simulating light breaking through, distinct from every `light` style
 *  (none of them are directional/radiating). strength 1-20 scales ray
 *  brightness/reach. */
export interface GodRaysCommand { type: 'god_rays'; start: number; end: number; strength: number; x?: number; y?: number }
/** Small drifting specks over [start,end] — each falls/sways over TIME
 *  (position changes frame to frame), distinct from `color`'s `grain` field
 *  and from `look`'s "oldFilm"/"super8" (both of those add STATIC per-pixel
 *  noise via ffmpeg's `noise` filter — same random texture shape every
 *  frame, no motion). strength 1-20 scales speck count/brightness. */
export interface DustCommand { type: 'dust'; start: number; end: number; strength: number }
/** A handful of thin vertical lines that flash on for a fraction of a second
 *  at a time, at varying positions, over [start,end] — the classic damaged-
 *  film-print scratch look. Distinct from "oldFilm"/"super8" under `look`,
 *  which only add a color grade + the same static `noise` texture as `dust`
 *  above — neither has any line/scratch structure. strength 1-20 scales how
 *  many scratches appear and how visible they are. */
export interface ScratchesCommand { type: 'scratches'; start: number; end: number; strength: number }
/** A warm/orange burn creeping in from the frame's right edge with a ragged,
 *  flickering boundary (not a straight line) that grows then recedes over
 *  [start,end] — organic and uneven, like an actual overexposed film burn.
 *  Distinct from `light`'s "lightLeak" (a flat, constant-strength warm wash
 *  with no shape or motion) and from `fade` (a hard cut to black, no color).
 *  strength 1-20 scales how far it reaches into frame and how bright it
 *  gets. */
export interface FilmBurnCommand { type: 'film_burn'; start: number; end: number; strength: number }
/** Viewfinder chrome — four white corner brackets plus a blinking red REC
 *  dot — over [start,end]. Distinct from `look`'s "camcorder" preset, which
 *  is only a color-grade+noise recipe with no on-screen chrome; use this
 *  ALONGSIDE "camcorder" (both, if asked for "old camcorder footage with a
 *  REC light and viewfinder brackets") rather than instead of it. strength
 *  1-20 scales bracket thickness slightly. */
export interface RetroCameraCommand { type: 'retro_camera'; start: number; end: number; strength: number }
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
export type AudioStyle = 'equalizer' | 'reverb' | 'echo' | 'distortion' | 'bassBoost' | 'pitch' | 'mono' | 'fadeIn' | 'fadeOut' | 'voiceChanger'
export type VoicePreset = 'robot' | 'chipmunk' | 'deep'
/** A whole-clip audio effect (no start/end window — same reasoning as
 *  `reverse`/`audio_noise_reduction`: these process the entire track).
 *  strength 0..1, default 0.5, unused by "mono" and "voiceChanger". "pitch"
 *  uses `direction` (default "up"); "fadeIn"/"fadeOut" use `duration`
 *  (seconds, default 1); "voiceChanger" uses `preset` (default "robot") — a
 *  fixed recipe, same reasoning as `look`/`glitch`/`light`, not a tunable
 *  strength. */
export interface AudioFxCommand {
  type: 'audiofx'; style: AudioStyle; strength?: number
  direction?: 'up' | 'down'; duration?: number; preset?: VoicePreset
}
/** Motion-smear/temporal-bleed effect over [start,end] — an approximation of
 *  "datamosh" (see autoEdit.ts's applyDatamosh for why it's an
 *  approximation, not a literal I-frame-drop datamosh). strength 1-20. */
export interface DatamoshCommand { type: 'datamosh'; start: number; end: number; strength: number }
/** A fixed "one-tap enhance" contrast/saturation/sharpen push over
 *  [start,end] — NOT real per-frame histogram/white-balance analysis (this
 *  build has no adaptive-normalize filter available). strength 0-1, default
 *  0.6. Use `color` instead when the instruction names specific tunable
 *  knobs (brightness/contrast/etc) rather than just "auto color correct". */
export interface AutoColorCommand { type: 'auto_color'; start: number; end: number; strength?: number }
export interface FadeCommand { type: 'fade'; direction: 'in' | 'out'; duration: number }
export interface RotateCommand { type: 'rotate'; degrees: 90 | 180 | 270 }
export interface FlipCommand { type: 'flip'; axis: 'horizontal' | 'vertical' }
export interface ReverseCommand { type: 'reverse' }
/** A "spotlight" region effect — the frame stays normal INSIDE the shape and
 *  is darkened OUTSIDE it, for [start,end]. Not a cutout/compositing mask —
 *  for that, use `chroma_key` instead — this is the realistic version of
 *  "mask"/"circle mask"/"rectangle mask" for drawing attention to a region.
 *  x/y/size/feather all default to a centered, medium spotlight if omitted
 *  — unlike a timestamp or amount, "where" a mask goes has a reasonable
 *  default (the middle of the frame) worth using rather than always asking. */
export interface MaskCommand {
  type: 'mask'; start: number; end: number; shape: 'circle' | 'rect'
  x?: number; y?: number; size?: number; feather?: number
}
/** Keys out `keyColor` (default green-screen green, e.g. "#00ff00") and
 *  replaces it with a solid `replacementColor` (default black), over
 *  [start,end]. strength 0-1 (default 0.5) scales key tolerance/similarity
 *  — higher pulls out a wider range of near-matching colors. This IS the
 *  cutout/background-removal tool `mask` explicitly is not — use chroma_key
 *  for "green screen"/"remove the background color"/"key out the blue
 *  screen", use mask for "spotlight"/"darken around". */
export interface ChromaKeyCommand { type: 'chroma_key'; start: number; end: number; keyColor?: string; replacementColor?: string; strength?: number }
/** Superimposes a translucent, horizontally-mirrored copy of the frame over
 *  itself, over [start,end] — the honest single-clip approximation of a
 *  double exposure (there's no second video source in this tool to
 *  superimpose a genuinely different image). strength 1-20 scales the
 *  ghost layer's opacity. */
export interface DoubleExposureCommand { type: 'double_exposure'; start: number; end: number; strength: number }
/** Hard-crops the frame into left/right halves and stacks them back to the
 *  original width — left is the untouched frame, right is a horizontally
 *  mirrored copy of it, over [start,end]. A visible hard seam at center,
 *  distinct from double_exposure's alpha blend. No strength knob — a
 *  structural effect, same reasoning as `flip`/`reverse`. */
export interface SplitScreenCommand { type: 'split_screen'; start: number; end: number }
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
export type EffectType = 'crop' | 'zoom' | 'pan' | 'speed' | 'loop' | 'blur' | 'background_blur' | 'pixelate' | 'motion_blur' | 'directional_blur' | 'zoom_blur' | 'radial_blur' | 'spin_blur' | 'tiltshift_blur' | 'wave' | 'ripple' | 'warp' | 'twirl' | 'fisheye' | 'bulge' | 'squeeze' | 'stretch' | 'lens_distortion' | 'spin' | 'rotation' | 'bounce' | 'swing' | 'color' | 'fade' | 'rotate' | 'flip' | 'reverse' | 'audio_noise_reduction' | 'mask' | 'look' | 'glitch' | 'light' | 'lens_flare' | 'sparkle' | 'neon_glow' | 'god_rays' | 'dust' | 'scratches' | 'film_burn' | 'retro_camera' | 'motionfx' | 'audiofx' | 'datamosh' | 'auto_color' | 'chroma_key' | 'double_exposure' | 'split_screen'
export const EFFECT_TYPES: EffectType[] = ['crop', 'zoom', 'pan', 'speed', 'loop', 'blur', 'background_blur', 'pixelate', 'motion_blur', 'directional_blur', 'zoom_blur', 'radial_blur', 'spin_blur', 'tiltshift_blur', 'wave', 'ripple', 'warp', 'twirl', 'fisheye', 'bulge', 'squeeze', 'stretch', 'lens_distortion', 'spin', 'rotation', 'bounce', 'swing', 'color', 'fade', 'rotate', 'flip', 'reverse', 'audio_noise_reduction', 'mask', 'look', 'glitch', 'light', 'lens_flare', 'sparkle', 'neon_glow', 'god_rays', 'dust', 'scratches', 'film_burn', 'retro_camera', 'motionfx', 'audiofx', 'datamosh', 'auto_color', 'chroma_key', 'double_exposure', 'split_screen']
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
  | BlurCommand | BackgroundBlurCommand | PixelateCommand
  | MotionBlurCommand | DirectionalBlurCommand | ZoomBlurCommand | RadialBlurCommand | SpinBlurCommand | TiltShiftBlurCommand
  | WaveCommand | RippleCommand | WarpCommand | TwirlCommand | FisheyeCommand | BulgeCommand | SqueezeCommand | StretchCommand | LensDistortionCommand
  | SpinCommand | RotationCommand | BounceCommand | SwingCommand
  | ColorCommand | FadeCommand | RotateCommand | FlipCommand | ReverseCommand | MaskCommand | LookCommand | GlitchCommand | LightCommand | LensFlareCommand | SparkleCommand | NeonGlowCommand | GodRaysCommand | DustCommand | ScratchesCommand | FilmBurnCommand | RetroCameraCommand | MotionCommand | AudioFxCommand
  | DatamoshCommand | AutoColorCommand
  | ChromaKeyCommand | DoubleExposureCommand | SplitScreenCommand
  | TextStyleCommand | TextEditCommand | CaptionsAutoCommand | NoiseReductionCommand | RemoveEffectCommand

export const COMMAND_TYPES = [
  'trim', 'crop', 'zoom', 'pan', 'speed', 'text', 'caption', 'remove_text',
  'audio_volume', 'mute', 'music', 'loop', 'mask', 'look', 'glitch', 'light', 'lens_flare', 'sparkle', 'neon_glow', 'god_rays', 'dust', 'scratches', 'film_burn', 'retro_camera', 'motionfx', 'audiofx',
  'blur', 'background_blur', 'pixelate', 'motion_blur', 'directional_blur', 'zoom_blur', 'radial_blur', 'spin_blur', 'tiltshift_blur',
  'wave', 'ripple', 'warp', 'twirl', 'fisheye', 'bulge', 'squeeze', 'stretch', 'lens_distortion',
  'spin', 'rotation', 'bounce', 'swing',
  'datamosh', 'auto_color', 'chroma_key', 'double_exposure', 'split_screen',
  'color', 'fade', 'rotate', 'flip', 'reverse',
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
const AUDIO_STYLES: AudioStyle[] = ['equalizer', 'reverb', 'echo', 'distortion', 'bassBoost', 'pitch', 'mono', 'fadeIn', 'fadeOut', 'voiceChanger']
export const AUDIO_LABELS: Record<AudioStyle, string> = {
  equalizer: 'Equalizer', reverb: 'Reverb', echo: 'Echo', distortion: 'Distortion', bassBoost: 'Bass Boost',
  pitch: 'Pitch', mono: 'Mono', fadeIn: 'Audio Fade In', fadeOut: 'Audio Fade Out', voiceChanger: 'Voice Changer',
}
const VOICE_PRESETS: VoicePreset[] = ['robot', 'chipmunk', 'deep']
export const VOICE_PRESET_LABELS: Record<VoicePreset, string> = {
  robot: 'Robot', chipmunk: 'Chipmunk', deep: 'Deep / Monster',
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
    case 'background_blur':
    case 'pixelate': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) {
        return { error: `${type === 'blur' ? 'Blur' : type === 'background_blur' ? 'Background blur' : 'Pixelate'} strength has to be between 1 and 20.` }
      }
      return { type: type as 'blur' | 'background_blur' | 'pixelate', ...w, strength }
    }

    case 'motion_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const direction = str(c.direction)
      if (direction !== 'horizontal' && direction !== 'vertical') {
        return { error: 'Motion blur needs a direction — "horizontal" or "vertical".' }
      }
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Motion blur strength has to be between 1 and 20.' }
      return { type: 'motion_blur', ...w, direction, strength }
    }

    case 'directional_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const angle = num(c.angle)
      if (angle === null) return { error: "Missing the blur angle (I won't guess a direction)." }
      if (angle < 0 || angle > 360) return { error: 'Directional blur angle has to be between 0 and 360 degrees.' }
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Directional blur strength has to be between 1 and 20.' }
      return { type: 'directional_blur', ...w, angle, strength }
    }

    case 'zoom_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Zoom blur strength has to be between 1 and 20.' }
      return { type: 'zoom_blur', ...w, strength }
    }

    case 'radial_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Radial blur strength has to be between 1 and 20.' }
      const x = num(c.x) ?? 0.5
      const y = num(c.y) ?? 0.5
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: 'Radial blur position (x/y) has to be between 0 and 1 — a fraction of the frame.' }
      return { type: 'radial_blur', ...w, strength, x, y }
    }

    case 'spin_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Spin blur strength has to be between 1 and 20.' }
      const x = num(c.x) ?? 0.5
      const y = num(c.y) ?? 0.5
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: 'Spin blur position (x/y) has to be between 0 and 1 — a fraction of the frame.' }
      return { type: 'spin_blur', ...w, strength, x, y }
    }

    case 'tiltshift_blur': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Tilt-shift blur strength has to be between 1 and 20.' }
      const bandY = num(c.bandY) ?? 0.5
      const bandHeight = num(c.bandHeight) ?? 0.25
      if (bandY < 0 || bandY > 1) return { error: 'Tilt-shift band position (bandY) has to be between 0 and 1 — a fraction of the frame.' }
      if (bandHeight < 0.05 || bandHeight > 0.9) return { error: 'Tilt-shift band height has to be between 0.05 and 0.9 — a fraction of the frame.' }
      return { type: 'tiltshift_blur', ...w, strength, bandY, bandHeight }
    }

    case 'wave':
    case 'stretch': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const label = type === 'wave' ? 'Wave' : 'Stretch'
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${label} strength has to be between 1 and 20.` }
      const axis = c.axis === undefined ? 'horizontal' : str(c.axis)
      if (axis !== 'horizontal' && axis !== 'vertical') {
        return { error: `${label} axis has to be "horizontal" or "vertical".` }
      }
      return { type: type as 'wave' | 'stretch', ...w, strength, axis }
    }

    case 'ripple':
    case 'twirl':
    case 'bulge':
    case 'squeeze': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const label = { ripple: 'Ripple', twirl: 'Twirl', bulge: 'Bulge', squeeze: 'Squeeze' }[type as 'ripple' | 'twirl' | 'bulge' | 'squeeze']
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${label} strength has to be between 1 and 20.` }
      const x = num(c.x) ?? 0.5
      const y = num(c.y) ?? 0.5
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: `${label} position (x/y) has to be between 0 and 1 — a fraction of the frame.` }
      return { type: type as 'ripple' | 'twirl' | 'bulge' | 'squeeze', ...w, strength, x, y }
    }

    case 'warp':
    case 'fisheye': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${type === 'warp' ? 'Warp' : 'Fisheye'} strength has to be between 1 and 20.` }
      return { type: type as 'warp' | 'fisheye', ...w, strength }
    }

    case 'lens_distortion': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const mode = str(c.mode)
      if (mode !== 'barrel' && mode !== 'pincushion') {
        return { error: 'Lens distortion needs a mode — "barrel" (lines bow outward) or "pincushion" (lines bow inward).' }
      }
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Lens distortion strength has to be between 1 and 20.' }
      return { type: 'lens_distortion', ...w, strength, mode }
    }

    case 'spin': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Spin strength has to be between 1 and 20.' }
      const direction = c.direction === undefined ? 'clockwise' : str(c.direction)
      if (direction !== 'clockwise' && direction !== 'counterclockwise') {
        return { error: 'Spin direction has to be "clockwise" or "counterclockwise".' }
      }
      return { type: 'spin', ...w, strength, direction }
    }

    case 'rotation': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const fromDegrees = num(c.fromDegrees)
      const toDegrees = num(c.toDegrees)
      if (fromDegrees === null || toDegrees === null) {
        return { error: 'Rotation needs both a fromDegrees and a toDegrees (I won\'t guess the turn amount).' }
      }
      if (fromDegrees < -360 || fromDegrees > 360 || toDegrees < -360 || toDegrees > 360) {
        return { error: 'Rotation degrees have to be between -360 and 360.' }
      }
      return { type: 'rotation', ...w, fromDegrees, toDegrees }
    }

    case 'bounce': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Bounce strength has to be between 1 and 20.' }
      return { type: 'bounce', ...w, strength }
    }

    case 'swing': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Swing strength has to be between 1 and 20.' }
      const x = num(c.x) ?? 0.5
      const y = num(c.y) ?? 0.5
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: 'Swing pivot (x/y) has to be between 0 and 1 — a fraction of the frame.' }
      return { type: 'swing', ...w, strength, x, y }
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

    case 'lens_flare':
    case 'god_rays': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const label = type === 'lens_flare' ? 'Lens flare' : 'God rays'
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${label} strength has to be between 1 and 20.` }
      const [dx, dy] = type === 'lens_flare' ? [0.8, 0.2] : [0.5, 0.1]
      const x = num(c.x) ?? dx
      const y = num(c.y) ?? dy
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: `${label} position (x/y) has to be between 0 and 1 — a fraction of the frame.` }
      return { type: type as 'lens_flare' | 'god_rays', ...w, strength, x, y }
    }

    case 'sparkle': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Sparkle strength has to be between 1 and 20.' }
      return { type: 'sparkle', ...w, strength }
    }

    case 'neon_glow': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Neon glow strength has to be between 1 and 20.' }
      const color = str(c.color) ?? undefined
      return { type: 'neon_glow', ...w, strength, ...(color != null ? { color } : {}) }
    }

    case 'dust':
    case 'scratches':
    case 'film_burn':
    case 'retro_camera': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const label = type === 'dust' ? 'Dust' : type === 'scratches' ? 'Scratches' : type === 'film_burn' ? 'Film burn' : 'Retro camera'
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: `${label} strength has to be between 1 and 20.` }
      return { type: type as 'dust' | 'scratches' | 'film_burn' | 'retro_camera', ...w, strength }
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
      if (style === 'voiceChanger') {
        const presetRaw = str(c.preset)
        const preset = presetRaw && VOICE_PRESETS.includes(presetRaw as VoicePreset) ? presetRaw as VoicePreset : 'robot'
        return { type: 'audiofx', style, preset }
      }
      return { type: 'audiofx', style, strength }
    }

    case 'datamosh': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Datamosh strength has to be between 1 and 20.' }
      return { type: 'datamosh', ...w, strength }
    }

    case 'auto_color': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 0.6
      if (strength < 0 || strength > 1) return { error: 'Auto color strength has to be between 0 and 1.' }
      return { type: 'auto_color', ...w, strength }
    }

    case 'chroma_key': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 0.5
      if (strength < 0 || strength > 1) return { error: 'Chroma key strength has to be between 0 and 1.' }
      const keyColor = str(c.keyColor) ?? undefined
      const replacementColor = str(c.replacementColor) ?? undefined
      return { type: 'chroma_key', ...w, strength, ...(keyColor != null ? { keyColor } : {}), ...(replacementColor != null ? { replacementColor } : {}) }
    }

    case 'double_exposure': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      const strength = num(c.strength) ?? 8
      if (strength < 1 || strength > 20) return { error: 'Double exposure strength has to be between 1 and 20.' }
      return { type: 'double_exposure', ...w, strength }
    }

    case 'split_screen': {
      const w = timeWindow(c, ctx)
      if ('error' in w) return w
      return { type: 'split_screen', ...w }
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

The video is ${ctx.durationSec.toFixed(1)}s long. ${ctx.hasMusic ? 'It already has background music.' : 'No background music yet.'}

CURRENT PROJECT STATE:
Existing text/caption layers:
${layersDesc}
${effectDesc}

CRITICAL — never ask for info already available above or in the instruction:
- Removing/restyling existing text NEVER needs font/size/color/position/timing asked for — those belong to the existing layer. Only pass "text" (the wording, if named) to identify WHICH layer; omit it for "it"/"that text". Layer lookup/disambiguation happens outside you.
- text_style: set ONLY the field(s) the instruction actually asked to change. Never invent values for fields not mentioned — they're preserved by omission.
- remove_effect: identify effectType only — never ask for strength/start/end.
- text_style ONLY works on an ALREADY-EXISTING layer. If an instruction both ADDS text and styles it in the same breath, that's ONE "text"/"caption" command with the style fields set directly on it — never "text" followed by "text_style" (the layer won't exist yet).
- A vague font request ("use a different font", no name given) is a clarification — but spell out the actual options verbatim: ${FONT_FAMILIES.join(', ')}. Never say "pick from the allowed list" without listing it.

Respond with ONLY a JSON object, no prose, no code fences, one of:
1) { "commands": [ <command objects> ] }
2) { "clarification": "<short question>" }

Use shape 2 whenever a timestamp/target/amount can't be determined from the instruction — GUESSING IS NOT ALLOWED (e.g. "zoom into the product" with no timing → ask when). If the missing info is a choice from a fixed list (fonts, aspects, positions), the question MUST spell out the actual options, never just refer to "the list".

Command types (times are seconds from video start; fields required unless marked optional):

trim { "type":"trim","start":number,"end":number } — keep only [start,end]
crop { "type":"crop","aspect":"9:16"|"1:1"|"4:5"|"16:9"|"4:3" }
zoom { "type":"zoom","start":number,"end":number,"fromScale":number,"toScale":number,"target":"center"|"left"|"right"|"top"|"bottom" } — fromScale defaults 1; scales 0.5-4
pan { "type":"pan","start":number,"end":number,"direction":"left-to-right"|"right-to-left"|"top-to-bottom"|"bottom-to-top","scale":number } — scale defaults 1.3, range 1-4
speed { "type":"speed","start":number,"end":number,"factor":number } — >1 faster, <1 slower, range 0.25-4
text { "type":"text","text":string,"start":number,"end":number,"position":"top"|"bottom"|"left"|"right"|"center","size":"sm"|"md"|"lg","color"?:string,"bold"?:boolean,"italic"?:boolean,"underline"?:boolean,"strikethrough"?:boolean,"glow"?:boolean,"outlineColor"?:string,"outlineWidth"?:number,"fontFamily"?:string,"backgroundColor"?:string,"backgroundOpacity"?:number,"animation"?:"slide-down"|"slide-up"|"fade"|"bounce"|"shake"|"blur-in","animationDuration"?:number } — supports real emoji chars (🔥🎉🚀) written directly, never spelled out in words. start:0,end:0 = whole video. ALL style fields optional — set any the instruction asks for right here when adding new text (never a separate text_style for text added in the same instruction). fontFamily must be one of: ${FONT_FAMILIES.join(', ')}. backgroundColor is the box behind the text (default black); backgroundOpacity 0 (invisible)..1 (solid), default 0.6. glow = standing neon glow ("make it neon" → glow:true). animation is the entrance at start time: slide-down/slide-up/fade/bounce (settles with overshoot)/shake/blur-in; omit for instant appearance; only meaningful with a real window. animationDuration 0-3s, default 0.4, omit unless a speed is asked for. For staggered "lines coming in one by one", use SEVERAL text commands with staggered start/end sharing the same animation.
caption { "type":"caption", ...same fields as text }
remove_text { "type":"remove_text","text"?:string,"start"?:number,"end"?:number } — REMOVES an existing overlay (never use "text"/"caption" for removal). All fields optional — only include what the instruction actually named; never ask to fill these in.
audio_volume { "type":"audio_volume","volume":number } — 0-3, 1=unchanged
mute { "type":"mute","muted":boolean }
music { "type":"music","action":"volume"|"remove","volume":number } — volume (0-1) only with action "volume", only if music track exists
loop { "type":"loop","times":integer } — 2-10 total plays
blur { "type":"blur","start":number,"end":number,"strength":number } — WHOLE-FRAME only, strength 1-20. For "blur just the background/person", use background_blur instead — never silently apply a whole-frame blur to that request.
background_blur { "type":"background_blur","start":number,"end":number,"strength":number } — blurs ONLY the background, keeping the person/subject sharp, strength 1-20 same meaning as blur. Uses real ML segmentation, not a guess — use for "blur the background but keep me/the person sharp", "portrait blur", "bokeh effect behind me".
pixelate { "type":"pixelate","start":number,"end":number,"strength":number } — same whole-frame-only rule as blur.
motion_blur { "type":"motion_blur","start":number,"end":number,"direction":"horizontal"|"vertical","strength":number } — directional streaking blur simulating camera/subject motion, strength 1-20 (same scale as blur). Use for "motion blur"/"speed streak"/"motion trail look" with a clear horizontal or vertical direction.
directional_blur { "type":"directional_blur","start":number,"end":number,"angle":number,"strength":number } — same streak blur as motion_blur but at an arbitrary angle (0-360°, 0=horizontal, 90=vertical) — use when a specific angle is named, e.g. "blur it at a 45 degree angle".
zoom_blur { "type":"zoom_blur","start":number,"end":number,"strength":number } — burst blur radiating from the CENTER of the frame, simulating a zoom without actually changing the framing (distinct from motionfx's zoomPunch, which really does zoom). strength 1-20.
radial_blur { "type":"radial_blur","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — same burst-blur look as zoom_blur but radiating from a chosen point instead of always the center — x/y (0-1 fraction of frame, default 0.5/0.5) is the burst point. Use when the instruction names a specific spot ("radiate from the product") rather than the whole frame.
spin_blur { "type":"spin_blur","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — rotational/swirl blur around a center point, x/y default 0.5/0.5. strength 1-20.
wave { "type":"wave","start":number,"end":number,"strength":number,"axis"?:"horizontal"|"vertical" } — travelling sinusoidal ripple: rows slide sideways (axis "horizontal", default) or columns slide up/down (axis "vertical"). strength 1-20 (same scale as blur) sets how far the frame sways. Map "wavy"/"wobble it like a flag"/"underwater wave" here.
ripple { "type":"ripple","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — concentric circular ripples radiating from a point, like a stone dropped in water. x/y = the ripple centre, 0-1 fraction of frame, default 0.5/0.5. Prefer this over wave whenever the instruction implies rings spreading from a spot.
warp { "type":"warp","start":number,"end":number,"strength":number } — smooth whole-frame wobble/heat-haze: gentle low-frequency bending on BOTH axes at once, no centre point and no regular wave train. Use for "warp it"/"heat haze"/"melting"/"drunk camera".
twirl { "type":"twirl","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — spiral swirl: pixels rotate more the closer they are to x/y (0-1, default 0.5/0.5), fading out with distance. Map "swirl"/"whirlpool"/"vortex" here — NOT rotate, which turns the whole frame rigidly.
fisheye { "type":"fisheye","start":number,"end":number,"strength":number } — whole-frame barrel/fisheye lens bulge, centre swells and straight lines bow outward, frame stays filled. Use for "fisheye"/"GoPro lens"/"bulge the whole shot". For a bulge around one spot use bulge instead.
bulge { "type":"bulge","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — LOCALIZED outward bulge (magnifying-glass blister) around x/y (0-1, default 0.5/0.5), rest of the frame untouched.
squeeze { "type":"squeeze","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — exact inverse of bulge: a localized inward pinch around x/y (0-1, default 0.5/0.5). Map "pinch"/"suck it inward" here.
stretch { "type":"stretch","start":number,"end":number,"strength":number,"axis"?:"horizontal"|"vertical" } — stretches the picture along ONE axis only (default "horizontal"), frame size unchanged so the edges crop off. Distinct from zoom, which scales both axes and keeps the aspect ratio. Map "squash it wide"/"make everyone tall and thin" here.
lens_distortion { "type":"lens_distortion","start":number,"end":number,"strength":number,"mode":"barrel"|"pincushion" } — lens-correction-style distortion. "barrel" bows straight lines outward (a milder, correction-scale version of fisheye), "pincushion" bows them inward. mode is REQUIRED — the two look opposite, so ask for a clarification rather than guessing when neither direction is implied.
spin { "type":"spin","start":number,"end":number,"strength":number,"direction"?:"clockwise"|"counterclockwise" } — the WHOLE FRAME continuously rotates, direction default "clockwise". strength 1-20 sets rotation speed. Distinct from rotate (instant fixed 90/180/270 snap, no animation) and spin_blur (a rotational SMEAR, the frame never actually turns). Map "spin it"/"keep spinning"/"rotating continuously" here.
rotation { "type":"rotation","start":number,"end":number,"fromDegrees":number,"toDegrees":number } — a single BOUNDED tilt from fromDegrees to toDegrees (-360..360), holding each end value before/after the window — a controlled dutch-angle move, NOT a continuous spin. Use when specific degree values or a one-way partial turn are named ("tilt from 0 to 20 degrees"); use spin instead for open-ended continuous rotation.
bounce { "type":"bounce","start":number,"end":number,"strength":number } — the WHOLE FRAME briefly scales up then springs back with a couple of decaying overshoots, like a spring pop. strength 1-20 sets how big the initial pop is. Distinct from motionfx's wobble (position jitter, no scale) and zoomPunch (one smooth zoom in-and-out, no overshoot/spring). Map "bounce"/"pop"/"spring effect" (on the whole frame, not text) here.
swing { "type":"swing","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — a pendulum: the frame rotates one way then swings back the other, amplitude decaying to a stop, around a pivot x/y (0-1, default 0.5/0.5). strength 1-20 sets swing amplitude. Distinct from spin (rotates one direction continuously, never reverses) and bounce (scale, not rotation). Map "swing"/"pendulum"/"rock back and forth" here.
tiltshift_blur { "type":"tiltshift_blur","start":number,"end":number,"strength":number,"bandY"?:number,"bandHeight"?:number } — miniature-photo look: a horizontal band stays sharp, blur increases with distance above/below it. bandY = vertical center of the sharp band (0-1, default 0.5); bandHeight = how much of the frame height stays sharp (0.05-0.9, default 0.25). strength 1-20 controls how strong the blur gets outside the band. Map "tilt-shift"/"miniature effect"/"toy town look" to this.
mask { "type":"mask","start":number,"end":number,"shape":"circle"|"rect","x"?:number,"y"?:number,"size"?:number,"feather"?:number } — SPOTLIGHT: normal inside the shape, darkened outside, for [start,end]. NOT a cutout/background-removal tool — use chroma_key for that. x/y = shape center as 0-1 fraction (default 0.5,0.5). size 0.05-0.9, default 0.35. feather 0 (hard)-0.3 (soft), default 0.12. Map "spotlight"/"circle the product" to sensible defaults rather than asking, unless there's no usable time window at all.
look { "type":"look","start":number,"end":number,"name":"sepia"|"negative"|"tealOrange"|"vintage"|"cinematic"|"hdr"|"colorize"|"duotone"|"oldFilm"|"super8"|"polaroid"|"camcorder","hueDegrees"?:number } — fixed canned color-grade preset (use "color" instead for tunable brightness/contrast/etc). "negative"=full invert. "tealOrange"=blockbuster grade (blue-green shadows, orange highlights). "hdr"=punchy local contrast/saturation, not real HDR. "colorize" tints toward one hue via hueDegrees (0-360, default ~200/blue) — e.g. "colorize it blue"→~200-220, "green sepia"→~100-140. Others are one fixed recipe, no params. Map "vintage look"/"cinematic grade"/"old film"/"like a polaroid"/"camcorder look" directly to the matching name.
glitch { "type":"glitch","start":number,"end":number,"style":"rgbSplit"|"tvNoise"|"screenFlicker"|"vhs"|"scanLines"|"digitalGlitch"|"signalDistortion","strength"?:number } — digital-degradation effect. strength 0-1, default 0.5, omit unless strength is specified. rgbSplit=chromatic-aberration channel shift. tvNoise=heavy static. screenFlicker=rapid brightness pulse. vhs=rgbSplit+noise+desaturation+vignette. scanLines=darkened alternating CRT lines. digitalGlitch=short jittery rgbSplit/noise bursts. signalDistortion=stronger static rgbSplit+contrast push. Map "glitch it"/"chromatic aberration"/"VHS effect"/"old TV look"/"static" to the matching style.
light { "type":"light","start":number,"end":number,"style":"flash"|"strobe"|"flicker"|"glow"|"bloom"|"lightLeak","strength"?:number } — brightness effect, strength 0-1 default 0.5. flash=one quick decaying pulse. strobe=fast sharp on/off. flicker=slower gentler wobble. glow/bloom=soft-blurred brighten-over-itself, bloom stronger. lightLeak=warm orange wash. Map "flash effect"/"strobe light"/"flickering light"/"glow"/"light leak" to the matching style.
lens_flare { "type":"lens_flare","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — a bright circular flare with smaller rings strung out along the line from the light source (x/y, 0-1 fraction of frame, default 0.8/0.2) through frame center and beyond. strength 1-20. Distinct from light's glow/bloom (those brighten the WHOLE frame, no shape) — use lens_flare for "lens flare"/"sun flare"/"anamorphic streak" specifically.
sparkle { "type":"sparkle","start":number,"end":number,"strength":number } — small bright points scattered over the frame, twinkling in and out. strength 1-20 controls density/brightness. Map "sparkly"/"twinkling"/"glittery"/"magic dust" here.
neon_glow { "type":"neon_glow","start":number,"end":number,"strength":number,"color"?:string } — saturated colored glow around the frame's own bright edges/highlights, tinted by color (any CSS color string, default a vivid neon pink). strength 1-20. Distinct from light's glow, which is white/tonal, not colored — use neon_glow whenever a HUE is named ("pink glow"/"neon blue edges"/"cyberpunk glow").
god_rays { "type":"god_rays","start":number,"end":number,"strength":number,"x"?:number,"y"?:number } — bright diagonal rays radiating from a source point (x/y, 0-1, default 0.5/0.1 — top-center). strength 1-20. Map "god rays"/"light rays"/"sun rays breaking through"/"crepuscular rays" here.
dust { "type":"dust","start":number,"end":number,"strength":number } — small specks that drift/sway over TIME, distinct from color's grain (static per-frame noise) and look's oldFilm/super8 (same static noise, plus a color grade). strength 1-20. Map "dust"/"floating debris"/"dusty film" here.
scratches { "type":"scratches","start":number,"end":number,"strength":number } — thin vertical lines flashing on briefly at varying spots, the damaged-film-print look. strength 1-20 controls how many/how visible. Map "film scratches"/"scratched film"/"damaged print" here.
film_burn { "type":"film_burn","start":number,"end":number,"strength":number } — a warm/orange burn creeping in from the frame's edge with a ragged, flickering boundary, growing then receding. Distinct from light's lightLeak (flat constant wash, no shape) and fade (hard cut to black, no color). strength 1-20. Map "film burn"/"burn effect"/"overexposed edge" here.
retro_camera { "type":"retro_camera","start":number,"end":number,"strength":number } — adds white viewfinder corner brackets plus a blinking red REC dot. Combine WITH look's "camcorder" (not instead of it) when someone wants the full old-camcorder package — camcorder is only the color grade, this is only the on-screen chrome. strength 1-20 (bracket thickness). Map "REC light"/"viewfinder brackets"/"camcorder viewfinder" here.
motionfx { "type":"motionfx","start":number,"end":number,"style":"cameraShake"|"wobble"|"zoomPunch"|"motionTrail"|"speedRamp","strength"?:number } — camera-motion effect, strength 0-1 default 0.5. cameraShake=sharp decaying jolt. wobble=sustained unsteady sway (not decaying). zoomPunch=quick zoom in and back out. motionTrail=ghosted recent-frames smear. speedRamp=steps through a few speeds (use "speed" instead for one constant rate change). No "freeze frame" effect exists (every attempt failed testing) — that must be a clarification, never approximated. Map "camera shake"/"wobbly camera"/"zoom punch"/"motion trail"/"speed ramp" to the matching style.
audiofx { "type":"audiofx","style":"equalizer"|"reverb"|"echo"|"distortion"|"bassBoost"|"pitch"|"mono"|"fadeIn"|"fadeOut"|"voiceChanger","strength"?:number,"direction"?:"up"|"down","duration"?:number,"preset"?:"robot"|"chipmunk"|"deep" } — WHOLE-CLIP audio effect, no start/end (same as reverse/audio_noise_reduction). strength 0-1, default 0.5, unused by mono and voiceChanger. equalizer=presence/clarity boost. reverb=approximate layered-echo room blend, not true convolution. echo=one clear spaced repeat. distortion=bit-crush grit. bassBoost=low-frequency boost. pitch shifts up/down without changing speed via "direction" (default up) — "deepen the voice"→down. mono=downmix to mono (no strength). fadeIn/fadeOut use "duration" (seconds, default 1), not strength. voiceChanger applies a FIXED preset via "preset" (default "robot") — "robot"=metallic/echoed, "chipmunk"=high-pitched fast-talker, "deep"=slowed-down monster voice. Prefer voiceChanger over pitch whenever the instruction names a character ("make me sound like a robot"/"chipmunk voice"/"monster voice") rather than just a direction ("deepen my voice"→pitch down). Map "add reverb"/"echo"/"distort audio"/"boost bass"/"pitch it up"/"deeper voice"/"make it mono"/"fade audio"/"voice changer"/"robot voice"/"chipmunk voice" to the matching style.
datamosh { "type":"datamosh","start":number,"end":number,"strength":number } — motion-smeared temporal-bleed look between frames, an APPROXIMATION of true datamoshing (this build can't manipulate raw encoded I-frames/GOPs, only whole-frame filters) via blending several preceding frames together. strength 1-20. Map "datamosh"/"datamoshed"/"corrupted video glitch"/"frame bleed" here.
auto_color { "type":"auto_color","start":number,"end":number,"strength"?:number } — one-tap "auto enhance": a FIXED contrast/saturation/sharpen push, strength 0-1 default 0.6. NOT real adaptive white-balance/histogram analysis (no such filter available in this build) — use "color" instead whenever specific tunable knobs are named. Map "auto color correct"/"auto enhance"/"fix the colors automatically"/"one-tap enhance" here.
chroma_key { "type":"chroma_key","start":number,"end":number,"keyColor"?:string,"replacementColor"?:string,"strength"?:number } — keys out keyColor (any CSS color, default green-screen green "#00ff00") and replaces it with a solid replacementColor (default black "#000000"). strength 0-1 default 0.5, scales key tolerance. THIS is the cutout tool mask explicitly is not — use for "green screen"/"key out the background"/"remove the blue screen", not "spotlight"/"darken around" (that's mask). There's no second video to composite onto — only a solid replacement color, never a second clip/image.
double_exposure { "type":"double_exposure","start":number,"end":number,"strength":number } — superimposes a translucent mirrored copy of the frame over itself, strength 1-20 scales ghost opacity. An honest single-clip approximation (no second footage source exists in this tool to blend a genuinely different image) — if asked to blend in a SPECIFIC second photo/video, that's a clarification saying only this self-ghosting version exists.
split_screen { "type":"split_screen","start":number,"end":number } — hard-splits the frame into left/right halves, left normal, right a mirrored copy, with a visible seam at center. No strength field. Distinct from double_exposure (alpha blend, no seam) — use split_screen for "split screen"/"mirror the frame"/"symmetric halves", double_exposure for "ghosting"/"superimposed"/"double exposure".
color { "type":"color","start":number,"end":number,"brightness"?:number,"contrast"?:number,"saturation"?:number,"grayscale"?:boolean,"warmth"?:number,"tint"?:number,"vignette"?:number,"exposure"?:number,"highlights"?:number,"shadows"?:number,"sharpness"?:number,"clarity"?:number,"grain"?:number } — at least one field besides start/end/type required. brightness -1..1 = flat offset; exposure -1..1 = multiplicative camera-dial push — use exposure for "overexposed/underexposed", brightness for plain "brighter/darker". contrast/saturation 0..3 (1=unchanged). warmth -1 (blue)..1 (orange); tint -1 (magenta)..1 (green) — "too green"→tint, "too warm/blue"→warmth. highlights/shadows -1..1 lift/crush just the bright/dark end independent of overall brightness — "recover blown-out sky"→negative highlights, "lift the blacks"→positive shadows. vignette 0..1. sharpness 0..2 = normal sharpen; clarity 0..1 = softer wider punchy local-contrast sharpen — "crisper"→sharpness, "more pop/texture"→clarity. grain 0..1 = film-grain noise. Map casual wording: "dull/muted/washed out"→lower saturation (~0.4); "vibrant/vivid/punchy"→higher saturation (~1.6); "dim/underexposed"→negative brightness; "brighter/overexposed look"→positive brightness. "moody/cinematic" alone is too vague — ask what specifically, rather than guessing a whole grade.
fade { "type":"fade","direction":"in"|"out","duration":number } — fades to/from black at the very start/end, duration seconds (default 1).
rotate { "type":"rotate","degrees":90|180|270 }
flip { "type":"flip","axis":"horizontal"|"vertical" }
reverse { "type":"reverse" } — plays the whole video backwards.
text_style { "type":"text_style","target"?:string,"color"?:string,"bold"?:boolean,"italic"?:boolean,"underline"?:boolean,"strikethrough"?:boolean,"glow"?:boolean,"outlineColor"?:string,"outlineWidth"?:number,"position"?:"top"|"bottom"|"left"|"right"|"center","size"?:"sm"|"md"|"lg","fontFamily"?:string,"backgroundColor"?:string,"backgroundOpacity"?:number,"animation"?:"slide-down"|"slide-up"|"fade"|"bounce"|"shake"|"blur-in","animationDuration"?:number } — MODIFIES existing text/caption (never adds — use "text"/"caption" for that). "target" is the wording if named; omit for "it"/"that text". Set ONLY the field(s) actually asked to change. Colors are CSS values ("white","#ffcc00","red"). booleans set exactly the one asked, "remove the underline" sets false, others untouched. backgroundOpacity 0 (invisible)..1 (solid). fontFamily must be one of: ${FONT_FAMILIES.join(', ')} — outside this list is a clarification, never a guessed closest match.
text_edit { "type":"text_edit","target"?:string,"text":string } — CHANGES WORDING only (use text_style for looks). "text" is the FULL new wording — if adding to existing text (e.g. an emoji), look up the layer's current text in CURRENT PROJECT STATE and compose the full new string yourself, don't send just the addition. "target" same rules as text_style.
captions_auto { "type":"captions_auto" } — auto-transcribes real speech into timed captions. Use for "add captions/subtitles" with no text given.
audio_noise_reduction { "type":"audio_noise_reduction" } — reduces steady background hiss/hum.
remove_effect { "type":"remove_effect","effectType":"crop"|"zoom"|"pan"|"speed"|"loop"|"blur"|"pixelate"|"color"|"fade"|"rotate"|"flip"|"reverse"|"audio_noise_reduction"|"mask" } — removes the most recently applied hard-baked effect. Never ask for strength/start/end — just the effectType, from the instruction + CURRENT PROJECT STATE.

Examples:
"Zoom into the person from 5 to 8 seconds." → {"commands":[{"type":"zoom","start":5,"end":8,"fromScale":1,"toScale":1.5,"target":"center"}]}
"Crop this to Instagram Reel format." → {"commands":[{"type":"crop","aspect":"9:16"}]}
"Make seconds 10 to 12 twice as fast." → {"commands":[{"type":"speed","start":10,"end":12,"factor":2}]}
"Make the video 2x faster." (no section named but whole-video IS determinable, not a clarification) → {"commands":[{"type":"speed","start":0,"end":${ctx.durationSec.toFixed(1)},"factor":2}]}
"Zoom into the product." (no timing) → {"clarification":"Which part of the video should I zoom into — what start and end time?"}
"Add 'Galaxy Home Automation' at the beginning." (brief intro, default first 3s) → {"commands":[{"type":"text","text":"Galaxy Home Automation","start":0,"end":3,"position":"top","size":"lg"}]}
"Reel intro — 'Hey', then 'I'm the CEO of Galaxy', sliding down one after another." (staggered — separate text commands, same animation) → {"commands":[{"type":"text","text":"Hey","start":0,"end":1.2,"position":"center","size":"lg","animation":"slide-down"},{"type":"text","text":"I'm the CEO of Galaxy","start":1,"end":3.5,"position":"center","size":"lg","animation":"slide-down"}]}
"Add 'Galaxy' at the bottom, 0-5s, Times New Roman, red." (new text + its own styling in one breath — ONE command, not a follow-up text_style) → {"commands":[{"type":"text","text":"Galaxy","start":0,"end":5,"position":"bottom","size":"md","color":"red","fontFamily":"Times New Roman"}]}
"Remove the Galaxy Home Automation text." (wording alone identifies it, no timing needed) → {"commands":[{"type":"remove_text","text":"Galaxy Home Automation"}]}
"Remove the text." (only one layer exists per CURRENT PROJECT STATE) → {"commands":[{"type":"remove_text"}]}
"Add a fire emoji to the CEO text." (existing layer says "I'm the CEO of Galaxy" — compose the full new wording, don't send just "🔥") → {"commands":[{"type":"text_edit","target":"CEO","text":"I'm the CEO of Galaxy 🔥"}]}
"Change the font from Times New Roman to any other." (no specific font named — clarification with the options spelled out) → {"clarification":"Which font would you like instead — one of: ${FONT_FAMILIES.join(', ')}?"}
"Make the Galaxy Home Automation text bigger." (only size named, rest stays as-is) → {"commands":[{"type":"text_style","target":"Galaxy Home Automation","size":"lg"}]}
"Remove the blur." (only valid if blur really is the single most recent change) → {"commands":[{"type":"remove_effect","effectType":"blur"}]}
"Blur the background but keep the person sharp." (no section named but whole-video IS determinable, not a clarification — real segmentation exists via background_blur) → {"commands":[{"type":"background_blur","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":8}]}
"Blur the background from 2 to 5 seconds." → {"commands":[{"type":"background_blur","start":2,"end":5,"strength":8}]}
"Add captions with a white font and black outline." (auto-transcribed, then styled) → {"commands":[{"type":"captions_auto"},{"type":"text_style","color":"white","outlineColor":"black","outlineWidth":3}]}
"Slow down the middle section." (determinable — literal middle third) → {"commands":[{"type":"speed","start":${(ctx.durationSec / 3).toFixed(1)},"end":${(ctx.durationSec * 2 / 3).toFixed(1)},"factor":0.5}]}
"Reduce background noise." → {"commands":[{"type":"audio_noise_reduction"}]}
"Give it a tilt-shift miniature look from 0 to 5 seconds." (sharp middle band, blurred top/bottom — defaults for band position/height) → {"commands":[{"type":"tiltshift_blur","start":0,"end":5,"strength":10}]}
"Add motion blur to the whole video, horizontal." → {"commands":[{"type":"motion_blur","start":0,"end":${ctx.durationSec.toFixed(1)},"direction":"horizontal","strength":8}]}
"Zoom blur burst from 2 to 4 seconds." (whole-frame burst, no point named) → {"commands":[{"type":"zoom_blur","start":2,"end":4,"strength":10}]}
"Make it look like ripples in a pond around the middle, 1 to 4 seconds." (rings from a point, so ripple not wave) → {"commands":[{"type":"ripple","start":1,"end":4,"strength":9}]}
"Swirl the first 3 seconds into a vortex." (rotation that fades with distance, so twirl not rotate) → {"commands":[{"type":"twirl","start":0,"end":3,"strength":12}]}
"Add a fisheye lens look." → {"commands":[{"type":"fisheye","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":10}]}
"Pinch the middle inward from 2 to 3 seconds." (inward, so squeeze not bulge) → {"commands":[{"type":"squeeze","start":2,"end":3,"strength":10}]}
"Stretch it out wide for the last 2 seconds." → {"commands":[{"type":"stretch","start":${Math.max(0, ctx.durationSec - 2).toFixed(1)},"end":${ctx.durationSec.toFixed(1)},"axis":"horizontal","strength":10}]}
"Add a lens flare from the top right, 0 to 3 seconds." → {"commands":[{"type":"lens_flare","start":0,"end":3,"strength":10,"x":0.8,"y":0.2}]}
"Make it sparkly for the first 4 seconds." → {"commands":[{"type":"sparkle","start":0,"end":4,"strength":10}]}
"Give it a pink neon glow the whole way through." → {"commands":[{"type":"neon_glow","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":10,"color":"#ff2fd6"}]}
"Add god rays coming down from the top." → {"commands":[{"type":"god_rays","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":10}]}
"Add floating dust for the first 5 seconds." → {"commands":[{"type":"dust","start":0,"end":5,"strength":10}]}
"Make it look like an old scratched film print." (scratches, not oldFilm alone — scratches has the actual line structure) → {"commands":[{"type":"scratches","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":10}]}
"Add a film burn from 3 to 6 seconds." → {"commands":[{"type":"film_burn","start":3,"end":6,"strength":10}]}
"Give it an old camcorder look with a REC light and viewfinder brackets." (needs BOTH — camcorder for the grade, retro_camera for the chrome) → {"commands":[{"type":"look","start":0,"end":${ctx.durationSec.toFixed(1)},"name":"camcorder"},{"type":"retro_camera","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":10}]}
"Datamosh the last 2 seconds." → {"commands":[{"type":"datamosh","start":${Math.max(0, ctx.durationSec - 2).toFixed(1)},"end":${ctx.durationSec.toFixed(1)},"strength":10}]}
"Auto color correct the whole video." → {"commands":[{"type":"auto_color","start":0,"end":${ctx.durationSec.toFixed(1)},"strength":0.6}]}
"Make my voice sound like a robot." (a character, not a direction, so voiceChanger not pitch) → {"commands":[{"type":"audiofx","style":"voiceChanger","preset":"robot"}]}
"Turn my voice into a chipmunk." → {"commands":[{"type":"audiofx","style":"voiceChanger","preset":"chipmunk"}]}
"Make the video keep spinning for the first 4 seconds." → {"commands":[{"type":"spin","start":0,"end":4,"strength":8}]}
"Tilt the frame from 0 to 15 degrees between 2 and 4 seconds." (specific degree values, one-way, so rotation not spin) → {"commands":[{"type":"rotation","start":2,"end":4,"fromDegrees":0,"toDegrees":15}]}
"Add a bounce/pop effect at the start." → {"commands":[{"type":"bounce","start":0,"end":1.5,"strength":10}]}
"Make it swing like a pendulum for the first 3 seconds." → {"commands":[{"type":"swing","start":0,"end":3,"strength":10}]}
"Green screen this — key out the green and put in a blue background." → {"commands":[{"type":"chroma_key","start":0,"end":${ctx.durationSec.toFixed(1)},"keyColor":"#00ff00","replacementColor":"#0000ff","strength":0.5}]}
"Give it a double exposure ghost look for the first 4 seconds." → {"commands":[{"type":"double_exposure","start":0,"end":4,"strength":10}]}
"Split the screen in half, mirrored, from 2 to 5 seconds." → {"commands":[{"type":"split_screen","start":2,"end":5}]}`
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
    case 'background_blur': return `Blur background ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'pixelate': return `Pixelate ${fmtTime(cmd.start)}–${fmtTime(cmd.end)} (whole frame)`
    case 'motion_blur': return `Motion blur (${cmd.direction}) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'directional_blur': return `Directional blur (${cmd.angle}°) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'zoom_blur': return `Zoom blur ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'radial_blur': return `Radial blur ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'spin_blur': return `Spin blur ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'tiltshift_blur': return `Tilt-shift blur ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'wave': return `Wave (${cmd.axis ?? 'horizontal'}) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'ripple': return `Ripple ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'warp': return `Warp ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'twirl': return `Twirl ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'fisheye': return `Fisheye ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'bulge': return `Bulge ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'squeeze': return `Squeeze ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'stretch': return `Stretch (${cmd.axis ?? 'horizontal'}) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'lens_distortion': return `Lens distortion (${cmd.mode}) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'spin': return `Spin (${cmd.direction ?? 'clockwise'}) ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'rotation': return `Rotate ${cmd.fromDegrees}°→${cmd.toDegrees}° ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'bounce': return `Bounce ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'swing': return `Swing ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'color': return `Color adjust ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'fade': return `Fade ${cmd.direction} (${cmd.duration}s)`
    case 'rotate': return `Rotate ${cmd.degrees}°`
    case 'flip': return `Flip ${cmd.axis}`
    case 'reverse': return 'Reverse video'
    case 'mask': return `${cmd.shape === 'circle' ? 'Circle' : 'Rectangle'} spotlight ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'look': return `${LOOK_LABELS[cmd.name]} look, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'glitch': return `${GLITCH_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'light': return `${LIGHT_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'lens_flare': return `Lens flare ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'sparkle': return `Sparkle ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'neon_glow': return `Neon glow ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'god_rays': return `God rays ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'dust': return `Dust ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'scratches': return `Scratches ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'film_burn': return `Film burn ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'retro_camera': return `Retro camera ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'motionfx': return `${MOTION_LABELS[cmd.style]}, ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'audiofx': return cmd.style === 'voiceChanger' ? `Voice Changer (${VOICE_PRESET_LABELS[cmd.preset ?? 'robot']})` : AUDIO_LABELS[cmd.style]
    case 'datamosh': return `Datamosh ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'auto_color': return `Auto color ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'chroma_key': return `Chroma key ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'double_exposure': return `Double exposure ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
    case 'split_screen': return `Split screen ${fmtTime(cmd.start)}–${fmtTime(cmd.end)}`
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
    case 'background_blur':
      return { title: 'Background Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Background only — subject stays sharp'] }
    case 'pixelate':
      return { title: 'Pixelate', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Whole frame'] }
    case 'motion_blur':
      return { title: 'Motion Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Direction: ${cmd.direction}`, `Strength: ${cmd.strength}`] }
    case 'directional_blur':
      return { title: 'Directional Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Angle: ${cmd.angle}°`, `Strength: ${cmd.strength}`] }
    case 'zoom_blur':
      return { title: 'Zoom Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'radial_blur':
      return { title: 'Radial Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Center: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'spin_blur':
      return { title: 'Spin Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Center: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'tiltshift_blur':
      return { title: 'Tilt-Shift Blur', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Sharp band: ${cmd.bandY ?? 0.5} ± ${((cmd.bandHeight ?? 0.25) / 2).toFixed(2)}`] }
    case 'wave':
      return { title: 'Wave', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Axis: ${cmd.axis ?? 'horizontal'}`, `Strength: ${cmd.strength}`] }
    case 'ripple':
      return { title: 'Ripple', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Centre: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'warp':
      return { title: 'Warp', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, 'Whole frame'] }
    case 'twirl':
      return { title: 'Twirl', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Centre: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'fisheye':
      return { title: 'Fisheye', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, 'Whole frame — lines bow outward'] }
    case 'bulge':
      return { title: 'Bulge', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Centre: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'squeeze':
      return { title: 'Squeeze', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Centre: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
    case 'stretch':
      return { title: 'Stretch', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Axis: ${cmd.axis ?? 'horizontal'}`, `Strength: ${cmd.strength}`] }
    case 'lens_distortion':
      return { title: 'Lens Distortion', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Mode: ${cmd.mode}`, `Strength: ${cmd.strength}`] }
    case 'spin':
      return { title: 'Spin', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Direction: ${cmd.direction ?? 'clockwise'}`, `Strength: ${cmd.strength}`] }
    case 'rotation':
      return { title: 'Rotation', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `${cmd.fromDegrees}° → ${cmd.toDegrees}°`] }
    case 'bounce':
      return { title: 'Bounce', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'swing':
      return { title: 'Swing', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Pivot: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.5}`] }
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
    case 'lens_flare':
      return { title: 'Lens Flare', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Source: ${cmd.x ?? 0.8}, ${cmd.y ?? 0.2}`] }
    case 'sparkle':
      return { title: 'Sparkle', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'neon_glow':
      return { title: 'Neon Glow', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Color: ${cmd.color ?? 'neon pink'}`] }
    case 'god_rays':
      return { title: 'God Rays', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`, `Source: ${cmd.x ?? 0.5}, ${cmd.y ?? 0.1}`] }
    case 'dust':
      return { title: 'Dust', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'scratches':
      return { title: 'Scratches', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'film_burn':
      return { title: 'Film Burn', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'retro_camera':
      return { title: 'Retro Camera', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'motionfx':
      return { title: MOTION_LABELS[cmd.style], lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'audiofx':
      return {
        title: cmd.style === 'voiceChanger' ? 'Voice Changer' : AUDIO_LABELS[cmd.style],
        lines: cmd.style === 'fadeIn' || cmd.style === 'fadeOut'
          ? [`Duration: ${cmd.duration}s`]
          : cmd.style === 'pitch'
            ? [`Direction: ${cmd.direction}`, `Strength: ${cmd.strength}`]
            : cmd.style === 'voiceChanger'
              ? [`Preset: ${VOICE_PRESET_LABELS[cmd.preset ?? 'robot']}`]
              : [`Strength: ${cmd.strength}`],
      }
    case 'datamosh':
      return { title: 'Datamosh', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'auto_color':
      return { title: 'Auto Color', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength ?? 0.6}`] }
    case 'chroma_key':
      return { title: 'Chroma Key', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Key: ${cmd.keyColor ?? 'green'} → ${cmd.replacementColor ?? 'black'}`] }
    case 'double_exposure':
      return { title: 'Double Exposure', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, `Strength: ${cmd.strength}`] }
    case 'split_screen':
      return { title: 'Split Screen', lines: [`${fmtTime(cmd.start)} → ${fmtTime(cmd.end)}`, 'Left normal, right mirrored'] }
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
