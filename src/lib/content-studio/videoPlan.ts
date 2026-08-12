/**
 * Client-side caller for api/content-studio/video-plan.ts — the AI half of
 * the auto-edit flow (referral-link analysis, transcription, editing plan).
 * The video file itself never leaves the browser except as the small
 * extracted audio track sent for transcription.
 */

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
