/**
 * Client-side caller for api/content-studio/video-plan.ts — the AI half of
 * the auto-edit flow (referral-link analysis, transcription, editing plan).
 * The video file itself never leaves the browser except as the small
 * extracted audio track sent for transcription.
 */
import { validateCommand, type EditCommand, type InterpretContext } from './aiEditCommands'

export interface LinkAnalysis {
  appName: string
  tagline: string
  features: string[]
  benefits: string[]
  cta: string
  brandColors: string[]
  relevantText: string
  screenshot: string
  sourceUrl: string
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

/** A general visual-style impression from a reference reel's cover image —
 *  NOT a frame-by-frame analysis of the actual video (there's no way to
 *  download that from a public link here). See api/content-studio/
 *  video-plan.ts's analyzeStyle for the exact scope/reasoning. */
export interface ReferenceStyleProfile {
  aspect: '9:16' | '16:9' | '1:1' | '4:5'
  brightness: number
  contrast: number
  saturation: number
  warmth: number
  captionColor: string
  captionBold: boolean
  captionPosition: 'top' | 'bottom' | 'left' | 'right' | 'center'
  vibe: string
}

export interface Transcript {
  text: string
  segments: TranscriptSegment[]
}

export interface EditPlanTimelineItem {
  start: number
  end: number
  label: string
}

export interface EditPlanChecklist {
  hook: boolean
  productShown: boolean
  featureHighlight: boolean
  demonstration: boolean
  benefits: boolean
  cta: boolean
  captions: boolean
  branding: boolean
  transitions: boolean
  music: boolean
}

export interface EditPlan {
  timeline: EditPlanTimelineItem[]
  checklist: EditPlanChecklist
  notes: string
}

async function callVideoPlan<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/content-studio/video-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data as T
}

export function analyzeReferralLink(url: string): Promise<LinkAnalysis> {
  return callVideoPlan('analyzeLink', { url })
}

export function analyzeReferenceStyle(url: string): Promise<ReferenceStyleProfile> {
  return callVideoPlan('analyzeStyle', { url })
}

/** For links the server can't fetch (Instagram/TikTok block non-browser
 *  requests entirely) — the operator screenshots or saves the reel's cover
 *  image themselves, using their own legitimate access, and this analyzes
 *  that directly instead. Same output shape as analyzeReferenceStyle. */
export async function analyzeReferenceStyleImage(image: Blob): Promise<ReferenceStyleProfile> {
  const imageBase64 = await blobToBase64(image)
  return callVideoPlan('analyzeStyleImage', { imageBase64, mime: image.type })
}

/**
 * Turns a style profile into real, validated AI Edit commands (crop +
 * color grade, plus a restyle of existing captions if any exist) — built
 * directly from the already-numeric profile rather than round-tripping it
 * through the natural-language parser, since there's nothing ambiguous
 * left to interpret. Still goes through validateCommand() like every other
 * command source, so it's held to the exact same allowlist/range checks.
 * Deliberately excludes text/caption CONTENT — this only matches the
 * reference's general visual look, never invents wording for the video.
 */
export function styleProfileToCommands(style: ReferenceStyleProfile, ctx: InterpretContext): EditCommand[] {
  const commands: EditCommand[] = []
  const push = (raw: Record<string, unknown>) => {
    const result = validateCommand(raw, ctx)
    if (!('error' in result)) commands.push(result)
  }

  push({ type: 'crop', aspect: style.aspect })

  const colorFields: Record<string, unknown> = {}
  if (Math.abs(style.brightness) > 0.05) colorFields.brightness = style.brightness
  if (Math.abs(style.contrast - 1) > 0.05) colorFields.contrast = style.contrast
  if (Math.abs(style.saturation - 1) > 0.05) colorFields.saturation = style.saturation
  if (Math.abs(style.warmth) > 0.05) colorFields.warmth = style.warmth
  if (Object.keys(colorFields).length) {
    push({ type: 'color', start: 0, end: ctx.durationSec, ...colorFields })
  }

  // One command per EXISTING layer, each targeted by its own exact text —
  // resolves unambiguously even with several layers on screen, rather than
  // one targetless command that would just get skipped as ambiguous. Never
  // creates new text, so there's nothing to do when there's none yet.
  for (const layer of ctx.textLayers ?? []) {
    push({ type: 'text_style', target: layer.text, color: style.captionColor, bold: style.captionBold, position: style.captionPosition })
  }

  return commands
}

/** btoa() chokes on large arrays in one call — chunked to stay safe on longer clips. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function transcribeAudio(audioBlob: Blob): Promise<Transcript> {
  const audioBase64 = await blobToBase64(audioBlob)
  return callVideoPlan('transcribe', { audioBase64, mime: audioBlob.type })
}

export function generateEditPlan(input: {
  title: string
  appInfo: LinkAnalysis | null
  transcript: string
  durationSec: number
  silences: { start: number; end: number }[]
  orientation: string
}): Promise<EditPlan> {
  return callVideoPlan('plan', input)
}
