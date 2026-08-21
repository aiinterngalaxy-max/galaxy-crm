import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Scissors, Undo2, Redo2, Save, Send,
  Type, MessageSquare, Music, RotateCcw, Trash2, CheckCircle2, RotateCw, Calendar,
} from 'lucide-react'
import type { ContentRow, VideoJob, ActivityEntry } from '@/types/content-studio'
import {
  ensureVideoJob, updateVideoJob, updateContent, getContent,
  getActivityForEntity, logActivity,
} from '@/lib/content-studio/queries'
import {
  renderFinal, renderSegments, AutoEditError,
  applyCropAspect, applyZoomPan, applyWindowedSpeed, loopVideo,
  applyBlur, applyBackgroundBlur, applyPixelate,
  applyMotionBlur, applyDirectionalBlur, applyZoomBlur, applyRadialBlur, applySpinBlur, applyTiltShiftBlur,
  applyWave, applyRipple, applyWarp, applyTwirl, applyFisheye, applyBulge, applySqueeze, applyStretch, applyLensDistortion,
  applySpin, applyRotation, applyBounce, applySwing,
  applyColorAdjust, applyVideoFade, applyRotate, applyFlip, applyReverse, applyNoiseReduction, applyMask, applyLook, applyGlitch, applyLight, applyLensFlare, applySparkle, applyNeonGlow, applyGodRays, applyDust, applyScratches, applyFilmBurn, applyRetroCamera, applyRain, applySnow, applyFog, applyFrost, applyMotionFx, applyAudioFx,
  applyDatamosh, applyAutoColor,
  applyChromaKey, applyDoubleExposure, applySplitScreen,
  applyInsertClip, TRANSITION_TYPES,
  applyBatchedEffects, type BatchableEffect,
  analyzeFootage,
  type AutoEditProgress, type SegmentTrim, type TimedCaption, type CaptionPosition, type CaptionSize, type TransitionType,
} from '@/lib/content-studio/autoEdit'
import {
  interpretInstruction, targetToCenter, directionToPanPoints,
  describeAiCommand, describeAiCommandCard, FONT_FAMILIES,
  type EditCommand, type EffectType,
} from '@/lib/content-studio/aiEditCommands'
import { uploadBlobToDrive, downloadFromDrive, GoogleDriveError } from '@/lib/googleDrive'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { parseJsonField, type ClipSegmentRecord, fmtTime, toSrt, toVtt } from '@/lib/content-studio/videoEditShared'
import { transcribeAudio, analyzeReferenceStyle, analyzeReferenceStyleImage, styleProfileToCommands } from '@/lib/content-studio/videoPlan'
import { Page } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const PLATFORMS = ['Instagram', 'Facebook', 'YouTube', 'LinkedIn'] as const

/** One block on the timeline — either an original clip within a joined video
 *  (from job.clip_segments) or, for a single-source job, the whole video. */
interface EditClip {
  id: string
  label: string
  start: number
  end: number
  cutStart: number
  cutEnd: number
  deleted: boolean
  thumbnail: string
}

/** One entry in the combined undo/redo history — see the `history` state's
 *  own comment for why clip-level and source-level changes share one stack. */
interface HistorySnapshot {
  clips: EditClip[]
  sourceKey: string
  /** Shown in the Edit History panel, e.g. "Trim clip", "Zoom 5.0s→8.0s". */
  label: string
  /** The hard-bake command type(s) folded into this snapshot, if any — lets
   *  "remove the blur" check whether blur is EXACTLY the most recent change
   *  (not combined with anything else) before treating Undo as a safe way
   *  to remove it. Absent for clip-level (trim/split) commits. */
  effectTypes?: string[]
  /** Every AI effect applied to reach this snapshot, in order, expressed
   *  against the ORIGINAL loaded source rather than the previous render.
   *
   *  Baking each new instruction onto the last render is what made quality
   *  fall off a cliff over a session: five instructions meant five stacked
   *  generations of lossy encoding, on top of however many the effects
   *  inside each instruction cost. Keeping the cumulative list lets the next
   *  instruction re-render from the pristine source with the whole list
   *  applied once, so the loss stays flat instead of compounding.
   *
   *  Absent on clip-level commits and on any snapshot produced by the
   *  fallback path below (see canReplayFromBase). */
  effectStack?: EditCommand[]
  /** True when a pending trim was baked into this snapshot's video. The
   *  trim bake runs before the effects, so a stack recorded alongside one
   *  can't be replayed from the base without reordering trim against those
   *  effects — such a snapshot ends the replay chain. */
  bakedTrim?: boolean
}

/** A Text or Captions item — same shape as TimedCaption, plus a stable id for editing/deleting in the UI. */
interface Overlay {
  id: string
  kind: 'text' | 'caption'
  text: string
  start: number
  end: number
  position: CaptionPosition
  size: CaptionSize
  /** All optional — omitted means "use the original fixed look" (white,
   *  unbolded, no outline), same as before these existed. */
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** A standing neon glow, in the text's own color — not an entrance. */
  glow?: boolean
  /** A standing offset+blurred drop shadow — distinct from glow (no offset). */
  dropShadow?: boolean
  /** Paired with `color` (the gradient's start) for a left-to-right gradient fill. */
  gradientTo?: string
  /** Extra spacing between characters in pixels, 0-30. */
  letterSpacing?: number
  outlineColor?: string
  outlineWidth?: number
  /** One of FONT_FAMILIES (aiEditCommands.ts) — omitted means the default sans-serif look. */
  fontFamily?: string
  backgroundColor?: string
  backgroundOpacity?: number
  /** How this overlay enters at its own start time — omitted means appears
   *  instantly, the original behavior. See TimedCaption in autoEdit.ts for
   *  the actual rendering (a time-varying overlay position/alpha, or a
   *  progressive reveal crop for 'typewriter'). */
  animation?: 'slide-down' | 'slide-up' | 'fade' | 'bounce' | 'shake' | 'blur-in' | 'typewriter'
  animationDuration?: number
}

function overlayToTimedCaption(o: Overlay): TimedCaption {
  return {
    text: o.text, start: o.start, end: o.end, position: o.position, size: o.size, kind: o.kind,
    color: o.color, bold: o.bold, outlineColor: o.outlineColor, outlineWidth: o.outlineWidth,
    fontFamily: o.fontFamily, italic: o.italic, underline: o.underline, strikethrough: o.strikethrough,
    backgroundColor: o.backgroundColor, backgroundOpacity: o.backgroundOpacity, glow: o.glow,
    dropShadow: o.dropShadow, gradientTo: o.gradientTo, letterSpacing: o.letterSpacing,
    animation: o.animation, animationDuration: o.animationDuration,
  }
}

function isOverlayActive(o: Overlay, t: number): boolean {
  if (!o.start && !o.end) return true
  return t >= (o.start || 0) && t <= (o.end && o.end > 0 ? o.end : Infinity)
}

const POSITION_CLASS: Record<CaptionPosition, string> = {
  top: 'top-[6%] left-1/2 -translate-x-1/2',
  bottom: 'bottom-[6%] left-1/2 -translate-x-1/2',
  left: 'left-[4%] top-1/2 -translate-y-1/2',
  right: 'right-[4%] top-1/2 -translate-y-1/2',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
}
const SIZE_CLASS: Record<CaptionSize, string> = { sm: 'text-xs px-2 py-1', md: 'text-sm px-3 py-1.5', lg: 'text-lg px-4 py-2' }

function progressLabel(p: AutoEditProgress | null, fallback: string): string {
  if (!p) return fallback
  if (p.phase === 'loading') return 'Loading engine…'
  if (p.phase === 'analyzing') return 'Analyzing…'
  const pct = p.fraction != null ? ` ${Math.min(100, Math.round(p.fraction * 100))}%` : ''
  return `Rendering…${pct}`
}

/** Captures a still frame from a video Blob at a given time, as a small JPEG data URL — used for clip thumbnails. */
function captureFrame(blob: Blob, atSec: number): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    const finish = (thumb: string) => {
      URL.revokeObjectURL(url)
      resolve(thumb)
    }
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(Math.max(0, atSec), Math.max(0, (video.duration || 0) - 0.1))
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 90
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish('')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.6))
      } catch {
        finish('')
      }
    }
    video.onerror = () => finish('')
    video.src = url
  })
}

/** Reads a video Blob's real duration client-side — used right after an AI
 *  hard-bake render (loop/speed both change total length) to size the fresh
 *  single clip correctly, without waiting for a React effect/render cycle. */
function probeBlobDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve(video.duration)
      URL.revokeObjectURL(url)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the edited video.'))
    }
    video.src = url
  })
}

/** Derived, human labels for the video's place in the Editing -> Review -> Approved/Changes -> Scheduled -> Published
 *  flow. Nothing here is a new status system — it's read straight off cmo_content.stage (already has Editing/Review/
 *  Ready To Publish/Published) plus cmo_video_jobs.review_status (for "changes requested" vs "never submitted", which
 *  stage alone can't distinguish) and cmo_content.publish_date (a value means "scheduled", same as the existing
 *  Calendar's drag-to-reschedule already treats it). */
function workflowStatus(content: ContentRow, job: VideoJob | null): { emoji: string; label: string } {
  const stage = content.stage
  if (stage === 'Published') return { emoji: '🔵', label: 'Published' }
  if (stage === 'Ready To Publish') {
    return content.publish_date ? { emoji: '🟣', label: `Scheduled — ${content.publish_date}` } : { emoji: '🟢', label: 'Approved' }
  }
  if (stage === 'Review') return { emoji: '🟠', label: 'Ready for Review' }
  if (job?.review_status === 'changes_requested' && stage === 'Editing') return { emoji: '🔴', label: 'Changes Required' }
  if (stage === 'Editing') return { emoji: '🔵', label: 'Editing' }
  return { emoji: '🟡', label: stage }
}

/**
 * Maps an AI edit command onto the batchable-effect shape, or null if this
 * command can't share a filter chain with its neighbours and must run as its
 * own ffmpeg pass. See the BatchableEffect notes in autoEdit.ts for the four
 * conditions an effect has to meet.
 *
 * Deliberately a default-null lookup rather than an exhaustive switch: a new
 * effect type added to EditCommand later lands here as "not batchable" and
 * keeps rendering through its own branch in the dispatcher. Being slow is a
 * recoverable mistake; being silently skipped is not.
 *
 * durationSec is only consulted for `fade`, whose start offset is measured
 * from the end of the clip — the caller passes the post-speed-change
 * duration, since a speed command breaks a batch run and is applied first.
 */
function toBatchableEffect(cmd: EditCommand, durationSec: number): BatchableEffect | null {
  switch (cmd.type) {
    case 'crop': return { kind: 'crop', aspect: cmd.aspect }
    case 'rotate': return { kind: 'rotate', degrees: cmd.degrees }
    case 'flip': return { kind: 'flip', axis: cmd.axis }
    case 'blur': return { kind: 'blur', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'pixelate': return { kind: 'pixelate', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'auto_color': return { kind: 'autoColor', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'scratches': return { kind: 'scratches', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'retro_camera': return { kind: 'retroCamera', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'warp': return { kind: 'warp', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength } }
    case 'wave': return { kind: 'wave', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength, axis: cmd.axis } }
    case 'ripple': return { kind: 'ripple', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y } }
    case 'twirl': return { kind: 'twirl', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y } }
    case 'bulge': return { kind: 'bulge', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y } }
    case 'squeeze': return { kind: 'squeeze', opts: { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y } }
    case 'fade': return { kind: 'fade', opts: { direction: cmd.direction, duration: cmd.duration, durationSec } }
    case 'color': return {
      kind: 'color',
      opts: {
        start: cmd.start, end: cmd.end, brightness: cmd.brightness, contrast: cmd.contrast,
        saturation: cmd.saturation, grayscale: cmd.grayscale, warmth: cmd.warmth, vignette: cmd.vignette,
        exposure: cmd.exposure, highlights: cmd.highlights, shadows: cmd.shadows, tint: cmd.tint,
        sharpness: cmd.sharpness, clarity: cmd.clarity, grain: cmd.grain,
      },
    }
    default: return null
  }
}

/**
 * The manual editing workspace, opened from "Edit Video" once a first cut
 * exists. It works ON TOP of that generated video — the same edited_drive_id
 * blob — and saves into the same trim_start/trim_end (single-clip) or
 * clip_segments (joined-clip) fields Section 4 of VideoStudioPage already
 * reads/writes, via the same renderFinal/renderSegments used by Preview and
 * Export there. Text/Captions share the existing job.captions column (each
 * item just carries an extra kind/size field). Music re-uses the same Drive
 * upload path as raw/edited footage. Review and Publish re-use cmo_content's
 * existing stage/approved/publish_date fields — no parallel status system.
 */
export function VideoEditWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const contentId = Number(id)
  const navigate = useNavigate()
  const { viewer } = useViewer()
  const canReview = !!viewer?.is_owner

  const [content, setContent] = useState<ContentRow | null>(null)
  const [job, setJob] = useState<VideoJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!contentId) {
      setNotFound(true)
      setLoading(false)
      return
    }
    let cancelled = false
    Promise.all([getContent(contentId), ensureVideoJob(contentId)])
      .then(([c, j]) => {
        if (cancelled) return
        if (!c) {
          setNotFound(true)
          return
        }
        setContent(c)
        setJob(j)
      })
      .catch((e) => !cancelled && setError(errText(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [contentId])

  function handleError(err: unknown) {
    if (err instanceof GoogleDriveError) {
      setError(`${err.message} (Google Drive access is asked for once per browser session.)`)
    } else if (err instanceof AutoEditError) {
      setError(err.message)
    } else {
      setError(errText(err))
    }
  }

  const hasEdit = !!job?.edited_drive_id

  // ---------- load the actual generated video ----------
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const sourceBlobRef = useRef<Blob | null>(null)
  const sourceUrlRef = useRef('')

  // Every blob this session has ever produced for a given "source identity",
  // keyed by job.edited_drive_id once saved, or a local-<timestamp> key for
  // an AI hard-bake result not yet saved (see confirmAiEdit) — this is what
  // lets Undo jump back to an earlier AI edit's actual video instantly,
  // without re-downloading or re-rendering it.
  const sourceBlobCache = useRef<Map<string, Blob>>(new Map())
  const [currentSourceKey, setCurrentSourceKey] = useState('')

  useEffect(() => {
    if (!job?.edited_drive_id) return
    let cancelled = false
    setSourceLoading(true)
    downloadFromDrive(job.edited_drive_id)
      .then((blob) => {
        if (cancelled) return
        sourceBlobRef.current = blob
        sourceBlobCache.current.set(job.edited_drive_id, blob)
        setCurrentSourceKey(job.edited_drive_id)
        const url = URL.createObjectURL(blob)
        sourceUrlRef.current = url
        setSourceUrl(url)
      })
      .catch((err) => !cancelled && handleError(err))
      .finally(() => !cancelled && setSourceLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.edited_drive_id])

  /** Swaps the active source to a cached (or, failing that, Drive-fetched)
   *  blob — used by undo/redo/history-jump when the target snapshot points
   *  at a different video than the one currently loaded. */
  /** The blob for a source key, fetching and caching it if this session
   *  hasn't seen it yet. Shared by switchSource and the AI replay path. */
  async function getSourceBlob(sourceKey: string): Promise<Blob> {
    const cached = sourceBlobCache.current.get(sourceKey)
    if (cached) return cached
    // Only reachable if the key is a real Drive id whose blob fell out of
    // this session's cache (e.g. a page reload) — a local-* key always
    // has its blob cached at creation time, since nothing else can produce one.
    const fetched = await downloadFromDrive(sourceKey)
    sourceBlobCache.current.set(sourceKey, fetched)
    return fetched
  }

  async function switchSource(sourceKey: string): Promise<void> {
    if (sourceKey === currentSourceKey) return
    const blob = await getSourceBlob(sourceKey)
    sourceBlobRef.current = blob
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
    const url = URL.createObjectURL(blob)
    sourceUrlRef.current = url
    setSourceUrl(url)
    setCurrentSourceKey(sourceKey)
  }

  useEffect(() => () => { if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current) }, [])

  // ---------- player ----------
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function onVolumeChange(vol: number) {
    setVolume(vol)
    if (videoRef.current) videoRef.current.volume = vol
  }

  function toggleFullscreen() {
    videoRef.current?.requestFullscreen?.()
  }

  // ---------- clip/timeline state ----------
  const clipSegments = useMemo(() => parseJsonField<ClipSegmentRecord[]>(job?.clip_segments), [job?.clip_segments])
  const [mode, setMode] = useState<'segments' | 'single'>('single')
  const [clips, setClips] = useState<EditClip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // One combined undo/redo history for BOTH kinds of change this editor makes:
  // clip-level (trim/split/delete — same source video, different [start,end]
  // windows) and source-level (an AI crop/zoom/pan/speed/loop, which is a
  // genuinely different rendered video). sourceKey lets undo/redo tell which
  // kind a given step was and swap the actual video back via switchSource()
  // when it crosses a source-level step, not just restore clip boundaries.
  const [history, setHistory] = useState<HistorySnapshot[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const clipsRef = useRef<EditClip[]>([])
  useEffect(() => { clipsRef.current = clips }, [clips])

  // Multi-clip: seed the timeline straight from the segments joinClips recorded, then grab a thumbnail per clip.
  useEffect(() => {
    if (!job || clips.length) return
    if (!clipSegments?.length) return
    const init: EditClip[] = clipSegments.map((s, i) => ({
      id: `seg-${i}`,
      label: s.label || `Clip ${i + 1}`,
      start: s.start,
      end: s.end,
      cutStart: s.cutStart ?? 0,
      cutEnd: s.cutEnd ?? 0,
      deleted: false,
      thumbnail: '',
    }))
    setMode('segments')
    setClips(init)
    setHistory([{ clips: init, sourceKey: currentSourceKey, label: 'Loaded' }])
    setHistoryIndex(0)
    setSelectedId(init[0]?.id ?? null)
    if (sourceBlobRef.current) {
      init.forEach((c) => {
        captureFrame(sourceBlobRef.current!, c.start + c.cutStart + 0.2).then((thumb) => {
          if (!thumb) return
          setClips((prev) => prev.map((p) => (p.id === c.id ? { ...p, thumbnail: thumb } : p)))
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, clipSegments, sourceUrl])

  // Single-source: one block for the whole video, needs the real duration
  // (not stored on the job) before it can be drawn — waits for the <video>.
  useEffect(() => {
    if (!job || clips.length) return
    if (clipSegments?.length) return
    if (duration <= 0) return
    const init: EditClip[] = [{
      id: 'whole',
      label: content?.title || 'Clip 1',
      start: 0,
      end: duration,
      cutStart: job.trim_start || 0,
      cutEnd: job.trim_end > 0 ? Math.max(0, duration - job.trim_end) : 0,
      deleted: false,
      thumbnail: '',
    }]
    setMode('single')
    setClips(init)
    setHistory([{ clips: init, sourceKey: currentSourceKey, label: 'Loaded' }])
    setHistoryIndex(0)
    setSelectedId('whole')
    if (sourceBlobRef.current) {
      captureFrame(sourceBlobRef.current, 0.2).then((thumb) => {
        if (!thumb) return
        setClips((prev) => prev.map((p) => (p.id === 'whole' ? { ...p, thumbnail: thumb } : p)))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, clipSegments, duration, content, sourceUrl])

  const selectedClip = clips.find((c) => c.id === selectedId) ?? null
  const aliveClips = clips.filter((c) => !c.deleted)
  const aliveCount = aliveClips.length
  const totalDuration = clips.length ? clips[clips.length - 1].end : duration
  const originalDuration = totalDuration
  const editedDuration = aliveClips.reduce((sum, c) => sum + Math.max(0, (c.end - c.cutEnd) - (c.start + c.cutStart)), 0)

  // The "Starts at"/"Ends at" boxes are buffered as plain text and only
  // committed on blur/Enter — committing on every keystroke meant clearing
  // the box to type a new number briefly sent an empty string through as 0,
  // which for "Ends at" means "cut off almost the whole clip".
  const startAtValue = selectedClip ? Math.round((selectedClip.start + selectedClip.cutStart) * 10) / 10 : 0
  const endAtValue = selectedClip ? Math.round((selectedClip.end - selectedClip.cutEnd) * 10) / 10 : 0
  const [startAtInput, setStartAtInput] = useState('0')
  const [endAtInput, setEndAtInput] = useState('0')
  useEffect(() => {
    setStartAtInput(String(startAtValue))
    setEndAtInput(String(endAtValue))
  }, [selectedId, startAtValue, endAtValue])

  function commitStartAt() {
    if (selectedClip && startAtInput.trim() !== '') setStartAt(selectedClip.id, Number(startAtInput) || 0)
    else setStartAtInput(String(startAtValue))
  }

  function commitEndAt() {
    if (selectedClip && endAtInput.trim() !== '') setEndAt(selectedClip.id, Number(endAtInput) || 0)
    else setEndAtInput(String(endAtValue))
  }

  /** Pushes a clip-level change — same source video, new clip boundaries.
   *  Source-level changes (an AI hard-bake result) go through
   *  commitNewSource below instead, which also swaps the actual video. */
  function commit(next: EditClip[], label: string) {
    setClips(next)
    setHistory((h) => [...h.slice(0, historyIndex + 1), { clips: next, sourceKey: currentSourceKey, label }])
    setHistoryIndex((i) => i + 1)
    setDirty(true)
  }

  function setCutStart(clipId: string, value: number) {
    commit(clips.map((c) => (c.id === clipId ? { ...c, cutStart: Math.max(0, value) } : c)), 'Trim start')
  }

  function setCutEnd(clipId: string, value: number) {
    commit(clips.map((c) => (c.id === clipId ? { ...c, cutEnd: Math.max(0, value) } : c)), 'Trim end')
  }

  // The Trim panel shows/accepts absolute "starts at" / "ends at" times (what
  // people actually mean by "end it at 42 seconds"), converted to/from the
  // cutStart/cutEnd amounts actually stored and rendered with.
  function setStartAt(clipId: string, absTime: number) {
    const c = clips.find((x) => x.id === clipId)
    if (!c) return
    setCutStart(clipId, Math.max(0, absTime - c.start))
  }

  function setEndAt(clipId: string, absTime: number) {
    const c = clips.find((x) => x.id === clipId)
    if (!c) return
    setCutEnd(clipId, Math.max(0, c.end - absTime))
  }

  function deleteClip(clipId: string) {
    if (aliveCount <= 1) return
    const next = clips.map((c) => (c.id === clipId ? { ...c, deleted: true } : c))
    commit(next, 'Delete clip')
    if (selectedId === clipId) setSelectedId(next.find((c) => !c.deleted)?.id ?? null)
  }

  /** Splits the selected clip in two at the playhead (or its midpoint, if the
   *  playhead isn't over it) — both halves point at the SAME source video,
   *  just narrower [start,end] windows, so renderSegments handles them with
   *  zero changes; a single-clip job just gains its first clip_segments entry. */
  function splitClip(clipId: string) {
    const c = clips.find((x) => x.id === clipId)
    if (!c) return
    const effStart = c.start + c.cutStart
    const effEnd = c.end - c.cutEnd
    let splitAt = curTime > effStart && curTime < effEnd ? curTime : (effStart + effEnd) / 2
    splitAt = Math.max(effStart + 0.2, Math.min(effEnd - 0.2, splitAt))
    if (!(splitAt > effStart && splitAt < effEnd)) return

    const first: EditClip = { ...c, id: `${c.id}-a-${Date.now()}`, end: splitAt, cutEnd: 0, label: `${c.label}A` }
    const second: EditClip = { ...c, id: `${c.id}-b-${Date.now()}`, start: splitAt, cutStart: 0, label: `${c.label}B` }
    const idx = clips.findIndex((x) => x.id === clipId)
    const next = [...clips.slice(0, idx), first, second, ...clips.slice(idx + 1)]
    setMode('segments')
    commit(next, 'Split clip')
    setSelectedId(first.id)
  }

  /** Pushes a source-level change — a new rendered video (an AI crop/zoom/
   *  pan/speed/loop), replacing the clip timeline with one fresh whole-video
   *  clip and swapping the player/export source to match. Purely local:
   *  no Drive upload, no DB write — same "stays local until Save" rule the
   *  Music panel already follows for a picked-but-unsaved file. */
  async function commitNewSource(blob: Blob, newDuration: number, label: string, effectTypes?: string[], effectStack?: EditCommand[], bakedTrim?: boolean) {
    const sourceKey = `local-${Date.now()}`
    sourceBlobCache.current.set(sourceKey, blob)
    await switchSource(sourceKey)
    const newClip: EditClip = {
      id: `whole-${Date.now()}`, label: content?.title || 'Clip 1',
      start: 0, end: newDuration, cutStart: 0, cutEnd: 0, deleted: false, thumbnail: '',
    }
    setMode('single')
    setClips([newClip])
    setSelectedId(newClip.id)
    setHistory((h) => [...h.slice(0, historyIndex + 1), { clips: [newClip], sourceKey, label, effectTypes, effectStack, bakedTrim }])
    setHistoryIndex((i) => i + 1)
    setDirty(true)
  }

  async function undo() {
    if (historyIndex <= 0) return
    const i = historyIndex - 1
    const snap = history[i]
    if (snap.sourceKey !== currentSourceKey) await switchSource(snap.sourceKey)
    setHistoryIndex(i)
    setClips(snap.clips)
    setDirty(true)
  }

  async function redo() {
    if (historyIndex >= history.length - 1) return
    const i = historyIndex + 1
    const snap = history[i]
    if (snap.sourceKey !== currentSourceKey) await switchSource(snap.sourceKey)
    setHistoryIndex(i)
    setClips(snap.clips)
    setDirty(true)
  }

  /** Jumps straight to any point in the Edit History panel, not just one
   *  step at a time — same underlying mechanics as undo/redo. */
  async function jumpToHistory(i: number) {
    if (i < 0 || i >= history.length || i === historyIndex) return
    const snap = history[i]
    if (snap.sourceKey !== currentSourceKey) await switchSource(snap.sourceKey)
    setHistoryIndex(i)
    setClips(snap.clips)
    setDirty(true)
  }

  // ---------- drag-to-trim handles ----------
  const timelineTrackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ clipId: string; edge: 'start' | 'end'; startX: number; startVal: number; pxPerSec: number } | null>(null)

  function onHandleMouseDown(clipId: string, edge: 'start' | 'end', e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const clip = clipsRef.current.find((c) => c.id === clipId)
    const rect = timelineTrackRef.current?.getBoundingClientRect()
    if (!clip || !rect || !totalDuration) return
    dragRef.current = {
      clipId, edge, startX: e.clientX,
      startVal: edge === 'start' ? clip.cutStart : clip.cutEnd,
      pxPerSec: rect.width / totalDuration,
    }
    window.addEventListener('mousemove', onHandleMouseMove)
    window.addEventListener('mouseup', onHandleMouseUp)
  }

  function onHandleMouseMove(e: MouseEvent) {
    const d = dragRef.current
    if (!d) return
    const clip = clipsRef.current.find((c) => c.id === d.clipId)
    if (!clip) return
    const deltaSec = (e.clientX - d.startX) / d.pxPerSec
    const span = clip.end - clip.start
    let newCutStart = clip.cutStart
    let newCutEnd = clip.cutEnd
    if (d.edge === 'start') {
      const maxCut = Math.max(0, span - clip.cutEnd - 0.2)
      newCutStart = Math.min(maxCut, Math.max(0, d.startVal + deltaSec))
    } else {
      const maxCut = Math.max(0, span - clip.cutStart - 0.2)
      newCutEnd = Math.min(maxCut, Math.max(0, d.startVal - deltaSec))
    }
    setClips((prev) => prev.map((c) => (c.id === d.clipId ? { ...c, cutStart: newCutStart, cutEnd: newCutEnd } : c)))

    // Not a live re-render (ffmpeg can't do that fast) — just seeks the
    // already-loaded video to roughly the frame this handle now points at,
    // so dragging feels responsive even though the real trimmed result only
    // comes from clicking Preview.
    const seekTo = d.edge === 'start' ? clip.start + newCutStart : clip.end - newCutEnd
    if (videoRef.current && duration > 0) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, seekTo))
    }
  }

  function onHandleMouseUp() {
    window.removeEventListener('mousemove', onHandleMouseMove)
    window.removeEventListener('mouseup', onHandleMouseUp)
    dragRef.current = null
    commit(clipsRef.current, 'Trim')
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onHandleMouseMove)
    window.removeEventListener('mouseup', onHandleMouseUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- drag-to-adjust music range (same interaction as clip trim handles) ----------
  const audioTrackRef = useRef<HTMLDivElement>(null)
  const musicDragRef = useRef<{ edge: 'start' | 'end'; startX: number; startVal: number; pxPerSec: number } | null>(null)

  function onMusicHandleMouseDown(edge: 'start' | 'end', e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const rect = audioTrackRef.current?.getBoundingClientRect()
    if (!rect || !totalDuration) return
    const effectiveEnd = musicEndRef.current > musicStartRef.current ? musicEndRef.current : totalDuration
    musicDragRef.current = {
      edge, startX: e.clientX,
      startVal: edge === 'start' ? musicStartRef.current : effectiveEnd,
      pxPerSec: rect.width / totalDuration,
    }
    window.addEventListener('mousemove', onMusicHandleMouseMove)
    window.addEventListener('mouseup', onMusicHandleMouseUp)
  }

  function onMusicHandleMouseMove(e: MouseEvent) {
    const d = musicDragRef.current
    if (!d) return
    const deltaSec = (e.clientX - d.startX) / d.pxPerSec
    if (d.edge === 'start') {
      const effectiveEnd = musicEndRef.current > musicStartRef.current ? musicEndRef.current : totalDuration
      const maxStart = Math.max(0, effectiveEnd - 0.2)
      setMusicStart(Math.min(maxStart, Math.max(0, d.startVal + deltaSec)))
    } else {
      const minEnd = musicStartRef.current + 0.2
      setMusicEnd(Math.min(totalDuration, Math.max(minEnd, d.startVal + deltaSec)))
    }
  }

  function onMusicHandleMouseUp() {
    window.removeEventListener('mousemove', onMusicHandleMouseMove)
    window.removeEventListener('mouseup', onMusicHandleMouseUp)
    musicDragRef.current = null
    setDirty(true)
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMusicHandleMouseMove)
    window.removeEventListener('mouseup', onMusicHandleMouseUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = timelineTrackRef.current?.getBoundingClientRect()
    if (!rect || !totalDuration || !videoRef.current) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    videoRef.current.currentTime = ratio * totalDuration
  }

  // ---------- text / captions overlays ----------
  const [overlays, setOverlays] = useState<Overlay[]>([])
  const overlaysRef = useRef<Overlay[]>([])
  useEffect(() => { overlaysRef.current = overlays }, [overlays])
  const overlaysInitRef = useRef(false)

  useEffect(() => {
    if (!job || overlaysInitRef.current) return
    overlaysInitRef.current = true
    const parsed = parseJsonField<TimedCaption[]>(job.captions) ?? []
    setOverlays(parsed.map((c, i) => ({
      id: `ov-${i}-${Date.now()}`,
      kind: c.kind ?? 'caption',
      text: c.text, start: c.start || 0, end: c.end || 0,
      position: c.position ?? 'bottom', size: c.size ?? 'md',
    })))
  }, [job])

  const emptyForm: Omit<Overlay, 'id' | 'kind'> = { text: '', start: 0, end: 5, position: 'bottom', size: 'md' }
  const [textForm, setTextForm] = useState(emptyForm)
  const [captionForm, setCaptionForm] = useState({ ...emptyForm, start: 3, end: 6 })
  const [showTextForm, setShowTextForm] = useState(false)
  const [showCaptionForm, setShowCaptionForm] = useState(false)
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null)
  const editingOverlay = overlays.find((o) => o.id === editingOverlayId) ?? null

  function addOverlay(kind: 'text' | 'caption', form: typeof emptyForm) {
    if (!form.text.trim()) return
    const id = `ov-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setOverlays((prev) => [...prev, { id, kind, ...form }])
    setDirty(true)
    if (kind === 'text') { setTextForm(emptyForm); setShowTextForm(false) }
    else { setCaptionForm({ ...emptyForm, start: 3, end: 6 }); setShowCaptionForm(false) }
  }

  function updateOverlay(id: string, patch: Partial<Overlay>) {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
    setDirty(true)
  }

  function downloadCaptionsFile(format: 'srt' | 'vtt') {
    const captionCues = overlays.filter((o) => o.kind === 'caption' && o.text.trim())
    if (!captionCues.length) return
    const fileText = format === 'srt' ? toSrt(captionCues) : toVtt(captionCues)
    const blob = new Blob([fileText], { type: format === 'srt' ? 'text/srt' : 'text/vtt' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(content?.title || 'captions').replace(/[^\w-]+/g, '_')}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  function deleteOverlay(id: string) {
    setOverlays((prev) => prev.filter((o) => o.id !== id))
    setDirty(true)
    if (editingOverlayId === id) setEditingOverlayId(null)
  }

  // ---------- drag-to-adjust text/caption timing (same interaction as clip trim handles) ----------
  const textTrackRef = useRef<HTMLDivElement>(null)
  const captionTrackRef = useRef<HTMLDivElement>(null)
  const overlayDragRef = useRef<{ overlayId: string; edge: 'start' | 'end'; startX: number; startVal: number; pxPerSec: number } | null>(null)

  function onOverlayHandleMouseDown(trackRef: React.RefObject<HTMLDivElement>, overlayId: string, edge: 'start' | 'end', e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const overlay = overlaysRef.current.find((o) => o.id === overlayId)
    const rect = trackRef.current?.getBoundingClientRect()
    if (!overlay || !rect || !totalDuration) return
    const effectiveEnd = overlay.end > overlay.start ? overlay.end : totalDuration
    overlayDragRef.current = {
      overlayId, edge, startX: e.clientX,
      startVal: edge === 'start' ? overlay.start : effectiveEnd,
      pxPerSec: rect.width / totalDuration,
    }
    window.addEventListener('mousemove', onOverlayHandleMouseMove)
    window.addEventListener('mouseup', onOverlayHandleMouseUp)
  }

  function onOverlayHandleMouseMove(e: MouseEvent) {
    const d = overlayDragRef.current
    if (!d) return
    const overlay = overlaysRef.current.find((o) => o.id === d.overlayId)
    if (!overlay) return
    const deltaSec = (e.clientX - d.startX) / d.pxPerSec
    if (d.edge === 'start') {
      const effectiveEnd = overlay.end > overlay.start ? overlay.end : totalDuration
      const maxStart = Math.max(0, effectiveEnd - 0.2)
      updateOverlay(d.overlayId, { start: Math.min(maxStart, Math.max(0, d.startVal + deltaSec)) })
    } else {
      const minEnd = overlay.start + 0.2
      updateOverlay(d.overlayId, { end: Math.min(totalDuration, Math.max(minEnd, d.startVal + deltaSec)) })
    }
  }

  function onOverlayHandleMouseUp() {
    window.removeEventListener('mousemove', onOverlayHandleMouseMove)
    window.removeEventListener('mouseup', onOverlayHandleMouseUp)
    overlayDragRef.current = null
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onOverlayHandleMouseMove)
    window.removeEventListener('mouseup', onOverlayHandleMouseUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- music / audio ----------
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const [musicRemoved, setMusicRemoved] = useState(false)
  const [musicVolume, setMusicVolume] = useState(0.18)
  const [musicStart, setMusicStart] = useState(0)
  const [musicEnd, setMusicEnd] = useState(0)
  const musicStartRef = useRef(0)
  const musicEndRef = useRef(0)
  useEffect(() => { musicStartRef.current = musicStart }, [musicStart])
  useEffect(() => { musicEndRef.current = musicEnd }, [musicEnd])
  const [fadeIn, setFadeIn] = useState(0)
  const [fadeOut, setFadeOut] = useState(0)
  const [originalVolume, setOriginalVolume] = useState(1)
  const [muteOriginal, setMuteOriginal] = useState(false)
  const musicInputRef = useRef<HTMLInputElement>(null)
  const musicBlobRef = useRef<Blob | null>(null)
  const musicFormInitRef = useRef(false)

  useEffect(() => {
    if (!job || musicFormInitRef.current) return
    musicFormInitRef.current = true
    setMusicVolume(job.music_volume ?? 0.18)
    setMusicStart(job.music_start || 0)
    setMusicEnd(job.music_end || 0)
    setFadeIn(job.music_fade_in || 0)
    setFadeOut(job.music_fade_out || 0)
    setOriginalVolume(job.original_volume ?? 1)
    setMuteOriginal(!!job.mute_original_audio)
  }, [job])

  const hasMusic = !musicRemoved && (!!musicFile || !!job?.music_drive_id)
  const musicName = musicFile?.name || job?.music_name || ''

  function onPickMusic(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMusicFile(file)
    setMusicRemoved(false)
    musicBlobRef.current = null
    setDirty(true)
  }

  function removeMusic() {
    setMusicFile(null)
    setMusicRemoved(true)
    musicBlobRef.current = null
    setDirty(true)
  }

  async function getMusicBlob(): Promise<Blob | null> {
    if (musicRemoved) return null
    if (musicFile) return musicFile
    if (musicBlobRef.current) return musicBlobRef.current
    if (!job?.music_drive_id) return null
    const blob = await downloadFromDrive(job.music_drive_id)
    musicBlobRef.current = blob
    return blob
  }

  // ---------- preview render (uses the exact same render functions Export uses) ----------
  const [previewUrl, setPreviewUrl] = useState('')
  const previewUrlRef = useRef('')
  const [rendering, setRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState<AutoEditProgress | null>(null)

  function setPreview(blob: Blob | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    if (!blob) {
      previewUrlRef.current = ''
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(blob)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }

  useEffect(() => () => setPreview(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function renderPreview() {
    if (!sourceBlobRef.current || !clips.length) return
    setError('')
    setRendering(true)
    setRenderProgress(null)
    try {
      const musicBlob = await getMusicBlob()
      const captions = overlays.filter((o) => o.text.trim()).map(overlayToTimedCaption)
      const audioOpts = { musicBlob: musicBlob ?? undefined, muteOriginalAudio: muteOriginal, musicVolume, musicStart, musicEnd, fadeIn, fadeOut, originalVolume }
      const alive = clips.filter((c) => !c.deleted)
      let blob: Blob
      if (mode === 'segments') {
        const segs: SegmentTrim[] = alive.map((c) => ({ start: c.start, end: c.end, cutStart: c.cutStart, cutEnd: c.cutEnd }))
        blob = await renderSegments(sourceBlobRef.current, segs, { captions, ...audioOpts }, setRenderProgress)
      } else {
        const c = alive[0]
        const trimStart = c.cutStart
        const trimEnd = c.cutEnd > 0 ? Math.max(0.1, c.end - c.cutEnd) : 0
        blob = await renderFinal(sourceBlobRef.current, { trimStart, trimEnd, captions, ...audioOpts }, setRenderProgress)
      }
      setPreview(blob)
    } catch (err) {
      handleError(err)
    } finally {
      setRendering(false)
      setRenderProgress(null)
    }
  }

  // ---------- save (writes the same fields Section 4 / Export already use, plus captions/music) ----------
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  async function saveChanges(): Promise<VideoJob | null> {
    if (!job || !clips.length) return null
    setError('')
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        captions: JSON.stringify(overlays.filter((o) => o.text.trim()).map(overlayToTimedCaption)),
        music_volume: musicVolume, music_start: musicStart, music_end: musicEnd,
        music_fade_in: fadeIn, music_fade_out: fadeOut,
        mute_original_audio: muteOriginal ? 1 : 0, original_volume: originalVolume,
      }
      if (mode === 'segments') {
        const alive = clips.filter((c) => !c.deleted)
        const payload: ClipSegmentRecord[] = alive.map((c) => ({
          start: c.start, end: c.end, label: c.label,
          cutStart: c.cutStart || undefined, cutEnd: c.cutEnd || undefined,
        }))
        patch.clip_segments = JSON.stringify(payload)
      } else {
        const c = clips[0]
        patch.trim_start = c.cutStart
        patch.trim_end = c.cutEnd > 0 ? Math.max(0, c.end - c.cutEnd) : 0
        // A hard-bake AI edit (or anything else that lands back on a single
        // clip) makes any earlier multi-clip layout stale — without this,
        // reopening the page would resurrect old segment boundaries that no
        // longer correspond to anything in the current video.
        patch.clip_segments = ''
      }

      if (musicRemoved) {
        patch.music_drive_id = ''
        patch.music_view_url = ''
        patch.music_name = ''
      } else if (musicFile) {
        const { driveFileId, driveViewUrl } = await uploadBlobToDrive(musicFile, musicFile.name)
        patch.music_drive_id = driveFileId
        patch.music_view_url = driveViewUrl
        patch.music_name = musicFile.name
      }

      // An AI crop/zoom/pan/speed/loop result lives only in memory
      // (sourceBlobCache) until now — this is the one point it actually
      // becomes a Drive file and a DB row, same moment a picked music file
      // does. Re-keys the cache/history to the real Drive id afterward so a
      // second Save (or an Undo back to this point) doesn't re-upload it.
      if (currentSourceKey && currentSourceKey !== job.edited_drive_id) {
        const pendingBlob = sourceBlobCache.current.get(currentSourceKey)
        if (pendingBlob) {
          const { driveFileId, driveViewUrl } = await uploadBlobToDrive(pendingBlob, `${content?.title ?? 'video'} (edited).mp4`)
          patch.edited_drive_id = driveFileId
          patch.edited_view_url = driveViewUrl
          sourceBlobCache.current.set(driveFileId, pendingBlob)
          sourceBlobCache.current.delete(currentSourceKey)
          setHistory((h) => h.map((s) => (s.sourceKey === currentSourceKey ? { ...s, sourceKey: driveFileId } : s)))
          setCurrentSourceKey(driveFileId)
        }
      }

      const saved = await updateVideoJob(job.id, patch)
      setJob(saved)
      setDirty(false)
      if (musicFile) { setMusicFile(null); musicBlobRef.current = saved.music_drive_id ? null : musicBlobRef.current }
      setMusicRemoved(false)
      return saved
    } catch (err) {
      handleError(err)
      return null
    } finally {
      setSaving(false)
    }
  }

  // ---------- submit for review / approve / request changes ----------
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  async function submitForReview() {
    if (!content || !job) return
    if (!confirm(`Submit "${content.title}" for review?`)) return
    setSubmitting(true)
    setSubmitMsg('')
    setError('')
    try {
      await saveChanges()
      const [updatedContent, updatedJob] = await Promise.all([
        updateContent(content.id, { stage: 'Review' }, viewer?.name),
        updateVideoJob(job.id, {
          review_status: 'ready_for_review', review_feedback: '',
          submitted_by: viewer?.name || '', submitted_at: new Date().toISOString(),
        }),
      ])
      setContent(updatedContent)
      setJob(updatedJob)
      await logActivity('content', content.id, 'review-submitted', 'Submitted for review', viewer?.name || 'System')
      setSubmitMsg('Video submitted for review.')
    } catch (err) {
      setError(errText(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function approveVideo() {
    if (!content || !job) return
    if (!confirm('Approve this video?')) return
    setSubmitting(true)
    setError('')
    try {
      const [updatedContent, updatedJob] = await Promise.all([
        updateContent(content.id, { approved: 1 }, viewer?.name),
        updateVideoJob(job.id, {
          review_status: 'approved', review_feedback: '',
          reviewed_by: viewer?.name || '', reviewed_at: new Date().toISOString(),
        }),
      ])
      setContent(updatedContent)
      setJob(updatedJob)
      await logActivity('content', content.id, 'review-approved', 'Video approved', viewer?.name || 'System')
      setSubmitMsg('Video approved successfully.')
      loadHistory()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function sendFeedback() {
    if (!content || !job || !feedbackText.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const [updatedContent, updatedJob] = await Promise.all([
        updateContent(content.id, { stage: 'Editing', approved: 0 }, viewer?.name),
        updateVideoJob(job.id, {
          review_status: 'changes_requested', review_feedback: feedbackText.trim(),
          reviewed_by: viewer?.name || '', reviewed_at: new Date().toISOString(),
        }),
      ])
      setContent(updatedContent)
      setJob(updatedJob)
      await logActivity('content', content.id, 'review-changes-requested', feedbackText.trim(), viewer?.name || 'System')
      setSubmitMsg('Feedback sent — status set to Changes Required.')
      setShowFeedbackForm(false)
      setFeedbackText('')
      loadHistory()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- review history (reuses the existing activity log) ----------
  const [history_, setHistory_] = useState<ActivityEntry[]>([])
  function loadHistory() {
    if (!content) return
    getActivityForEntity('content', content.id)
      .then((rows) => setHistory_(rows.filter((r) => r.action.startsWith('review-'))))
      .catch(() => {})
  }
  useEffect(() => { loadHistory() }, [content?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- publish / schedule ----------
  const [platform, setPlatform] = useState<string>('Instagram')
  const [publishDate, setPublishDate] = useState('')
  const [publishTime, setPublishTime] = useState('19:00')
  const [scheduling, setScheduling] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(false)
  const platformInitRef = useRef(false)

  useEffect(() => {
    if (!content || platformInitRef.current) return
    platformInitRef.current = true
    if (content.platform && (PLATFORMS as readonly string[]).includes(content.platform)) setPlatform(content.platform)
    if (content.publish_date) {
      const [d, t] = content.publish_date.split('T')
      setPublishDate(d || '')
      if (t) setPublishTime(t.slice(0, 5))
    }
  }, [content])

  const isApprovedOrBeyond = content?.stage === 'Ready To Publish' || content?.stage === 'Published'
  const isScheduled = content?.stage === 'Ready To Publish' && !!content.publish_date

  async function scheduleForPublishing() {
    if (!content || !publishDate) return
    setScheduling(true)
    setError('')
    try {
      const iso = `${publishDate}T${publishTime}`
      const updated = await updateContent(content.id, { publish_date: iso, platform }, viewer?.name)
      setContent(updated)
      setEditingSchedule(false)
      setSubmitMsg('Scheduled for publishing.')
    } catch (err) {
      setError(errText(err))
    } finally {
      setScheduling(false)
    }
  }

  async function cancelSchedule() {
    if (!content) return
    if (!confirm('Are you sure you want to cancel this scheduled post?')) return
    setScheduling(true)
    setError('')
    try {
      const updated = await updateContent(content.id, { publish_date: '' }, viewer?.name)
      setContent(updated)
      setSubmitMsg('Schedule cancelled.')
    } catch (err) {
      setError(errText(err))
    } finally {
      setScheduling(false)
    }
  }

  // ---------- AI edit ----------
  // instruction (free text) -> interpretInstruction() [AI + validation, see
  // aiEditCommands.ts] -> aiPendingCommands (shown to the operator, nothing
  // has happened yet) -> confirmAiEdit() actually executes them, only once
  // the operator clicks Apply. Nothing here ever runs unreviewed.
  const [aiEditPrompt, setAiEditPrompt] = useState('')
  const [aiEditError, setAiEditError] = useState('')
  // A clarification is the AI asking for missing info, not a failure — kept
  // visually distinct (gold, not red) so it doesn't read as something having
  // gone wrong.
  const [aiEditQuestion, setAiEditQuestion] = useState('')
  const [aiPendingCommands, setAiPendingCommands] = useState<EditCommand[] | null>(null)
  const [aiInterpreting, setAiInterpreting] = useState(false)
  const [aiApplying, setAiApplying] = useState(false)
  const [aiProgress, setAiProgress] = useState<AutoEditProgress | null>(null)
  const [aiLastApplied, setAiLastApplied] = useState<EditCommand[] | null>(null)

  async function interpretAiEdit() {
    const instruction = aiEditPrompt.trim()
    if (!instruction) {
      setAiEditQuestion('Please enter an editing instruction.')
      setAiEditError('')
      return
    }
    setAiEditError('')
    setAiEditQuestion('')
    setAiPendingCommands(null)

    // "Undo that."/"Redo." are handled directly through the real undo/redo
    // functions, not sent to the AI at all — cheaper, instant, and ties
    // straight into the existing history stack rather than a parsed
    // approximation of it.
    const lower = instruction.toLowerCase().replace(/[.!]+$/, '').trim()
    if (/^(undo|undo that|undo the last (edit|change)|undo last (edit|change))$/.test(lower)) {
      if (historyIndex <= 0) { setAiEditQuestion('Nothing to undo yet.'); return }
      await undo()
      setAiEditPrompt('')
      return
    }
    if (/^(redo|redo that|redo the last (edit|change)|redo last (edit|change))$/.test(lower)) {
      if (historyIndex >= history.length - 1) { setAiEditQuestion('Nothing to redo.'); return }
      await redo()
      setAiEditPrompt('')
      return
    }

    setAiInterpreting(true)
    try {
      const textLayers = overlays.map((o) => ({ id: o.id, text: o.text, start: o.start, end: o.end }))
      const topSnap = historyIndex >= 0 ? history[historyIndex] : undefined
      const lastEffectType = topSnap?.effectTypes?.length === 1 ? (topSnap.effectTypes[0] as EffectType) : undefined
      const result = await interpretInstruction(instruction, { durationSec: duration || 0, hasMusic, textLayers, lastEffectType })
      // A real service failure (network/rate-limit/etc.) is a genuine error —
      // everything else (the AI asking a clarifying question, or a validated
      // instruction it just couldn't parse) is a normal outcome, not a
      // failure, and is shown as a plain question instead.
      if (result.error) {
        setAiEditError(result.error)
      } else if (result.clarification) {
        setAiEditQuestion(result.clarification)
      } else if (result.commands?.length) {
        setAiPendingCommands(result.commands)
      } else {
        setAiEditQuestion("Couldn't understand that instruction — try rephrasing it.")
      }
    } catch (err) {
      setAiEditError(errText(err))
    } finally {
      setAiInterpreting(false)
    }
  }

  function cancelAiEdit() {
    setAiPendingCommands(null)
  }

  // ---------- match a reference reel's style ----------
  // Reads the reference link's cover image (NOT the actual reel video —
  // there's no way to download that from a link), estimates a general
  // color/aspect/caption-style impression, and turns it into the same
  // reviewable command list a typed instruction produces — nothing applies
  // until the operator hits Apply, same as every other AI Edit path.
  const [styleUrl, setStyleUrl] = useState('')
  const [styleMatching, setStyleMatching] = useState(false)
  const [styleError, setStyleError] = useState('')
  const [styleVibe, setStyleVibe] = useState('')
  const [styleImagePreviewUrl, setStyleImagePreviewUrl] = useState('')
  const styleImageInputRef = useRef<HTMLInputElement>(null)
  const styleImagePreviewUrlRef = useRef('')

  useEffect(() => () => { if (styleImagePreviewUrlRef.current) URL.revokeObjectURL(styleImagePreviewUrlRef.current) }, [])

  function applyStyleProfile(profile: Awaited<ReturnType<typeof analyzeReferenceStyle>>) {
    const textLayers = overlays.map((o) => ({ id: o.id, text: o.text, start: o.start, end: o.end }))
    const commands = styleProfileToCommands(profile, { durationSec: duration || 0, hasMusic, textLayers })
    if (!commands.length) {
      setStyleError("Couldn't turn that reference's style into any changes — try a different link/image.")
      return
    }
    setStyleVibe(profile.vibe)
    setAiPendingCommands(commands)
  }

  async function matchReferenceStyle() {
    const url = styleUrl.trim()
    if (!url) { setStyleError('Paste a reference reel link first.'); return }
    setStyleError('')
    setStyleVibe('')
    setAiPendingCommands(null)
    if (styleImagePreviewUrlRef.current) { URL.revokeObjectURL(styleImagePreviewUrlRef.current); styleImagePreviewUrlRef.current = '' }
    setStyleImagePreviewUrl('')
    setStyleMatching(true)
    try {
      applyStyleProfile(await analyzeReferenceStyle(url))
    } catch (err) {
      setStyleError(errText(err))
    } finally {
      setStyleMatching(false)
    }
  }

  /** For Instagram/TikTok links, which block the server-side fetch above
   *  entirely (verified: they serve a blank, login-walled page to any
   *  non-browser request — not something to work around, since that would
   *  mean bypassing their bot-detection). The operator grabs the cover
   *  image themselves — screenshot, or "save image" from their own
   *  logged-in browser — and this analyzes that upload directly instead. */
  async function matchReferenceStyleFromImage(file: File) {
    setStyleError('')
    setStyleVibe('')
    setAiPendingCommands(null)
    // Shown immediately — this is the file the operator just picked, no
    // server round-trip needed to display it, only to analyze it.
    if (styleImagePreviewUrlRef.current) URL.revokeObjectURL(styleImagePreviewUrlRef.current)
    const localUrl = URL.createObjectURL(file)
    styleImagePreviewUrlRef.current = localUrl
    setStyleImagePreviewUrl(localUrl)
    setStyleMatching(true)
    try {
      applyStyleProfile(await analyzeReferenceStyleImage(file))
    } catch (err) {
      setStyleError(errText(err))
    } finally {
      setStyleMatching(false)
      if (styleImageInputRef.current) styleImageInputRef.current.value = ''
    }
  }

  // ---------- insert a second clip, with an optional transition ----------
  // The only AI Edit action that combines two separate video sources — every
  // other hard-bake effect transforms the one already-loaded clip in place.
  const insertClipInputRef = useRef<HTMLInputElement>(null)
  const [insertClipFile, setInsertClipFile] = useState<File | null>(null)
  const [insertAt, setInsertAt] = useState(0)
  const [insertTransition, setInsertTransition] = useState<TransitionType>('circleopen')
  const [insertDuration, setInsertDuration] = useState(1)
  const [inserting, setInserting] = useState(false)
  const [insertProgress, setInsertProgress] = useState<AutoEditProgress | null>(null)
  const [insertError, setInsertError] = useState('')

  function pickInsertClip(f: File) {
    setInsertClipFile(f)
    setInsertError('')
    // Defaults to the current playhead position — the most common case is
    // "insert clip 2 starting right where I'm looking now."
    setInsertAt(Math.min(curTime || 0, Math.max(0, totalDuration - 0.1)))
  }

  async function confirmInsertClip() {
    if (!insertClipFile || !sourceBlobRef.current) return
    setInserting(true)
    setInsertError('')
    setInsertProgress(null)
    try {
      const blob = await applyInsertClip(
        sourceBlobRef.current,
        { insertAt, newClip: insertClipFile, transition: insertTransition, duration: insertDuration },
        setInsertProgress,
      )
      const newDuration = await probeBlobDuration(blob)
      const label = insertTransition === 'none'
        ? `Insert clip at ${fmtTime(insertAt)} (hard cut)`
        : `Insert clip at ${fmtTime(insertAt)} (${TRANSITION_TYPES.find((t) => t.value === insertTransition)?.label ?? insertTransition})`
      await commitNewSource(blob, newDuration, label)
      setInsertClipFile(null)
      if (insertClipInputRef.current) insertClipInputRef.current.value = ''
    } catch (err) {
      setInsertError(err instanceof AutoEditError ? err.message : (err instanceof Error ? err.message : 'Could not insert that clip.'))
    } finally {
      setInserting(false)
    }
  }

  /**
   * Executes every pending command in order. crop/zoom/pan/speed/loop are
   * "hard-bake" operations — they re-render the actual source video (same
   * as Regenerate/Change footage elsewhere in this workspace) via the new
   * autoEdit.ts functions, upload the result to Drive, and point the job at
   * it. Doing that CLEARS clips/history rather than trying to remap old
   * clip boundaries onto a video whose duration or content just changed
   * (loop and windowed speed both change duration) — the existing
   * single-source init effect (above) rebuilds a fresh one-clip timeline
   * automatically once the new video's metadata loads, same as it does on
   * first open. trim/text/caption/audio_volume/mute/music are NOT hard-bake:
   * they just call the same state setters the Trim/Text/Captions/Audio/
   * Music panels already call, so they show up as normal, still-editable
   * state — an AI-added caption is not different from a manually-added one.
   */
  async function confirmAiEdit() {
    const commands = aiPendingCommands
    if (!commands || !job || !content) return
    setAiApplying(true)
    setAiEditError('')
    setAiProgress(null)
    try {
      type HardBakeType = 'crop' | 'zoom' | 'pan' | 'speed' | 'loop' | 'blur' | 'background_blur' | 'pixelate' | 'motion_blur' | 'directional_blur' | 'zoom_blur' | 'radial_blur' | 'spin_blur' | 'tiltshift_blur' | 'wave' | 'ripple' | 'warp' | 'twirl' | 'fisheye' | 'bulge' | 'squeeze' | 'stretch' | 'lens_distortion' | 'spin' | 'rotation' | 'bounce' | 'swing' | 'color' | 'fade' | 'rotate' | 'flip' | 'reverse' | 'audio_noise_reduction' | 'mask' | 'look' | 'glitch' | 'light' | 'lens_flare' | 'sparkle' | 'neon_glow' | 'god_rays' | 'dust' | 'scratches' | 'film_burn' | 'retro_camera' | 'rain' | 'snow' | 'fog' | 'frost' | 'motionfx' | 'audiofx' | 'datamosh' | 'auto_color' | 'chroma_key' | 'double_exposure' | 'split_screen'
      const HARD_BAKE_TYPES: HardBakeType[] = ['crop', 'zoom', 'pan', 'speed', 'loop', 'blur', 'background_blur', 'pixelate', 'motion_blur', 'directional_blur', 'zoom_blur', 'radial_blur', 'spin_blur', 'tiltshift_blur', 'wave', 'ripple', 'warp', 'twirl', 'fisheye', 'bulge', 'squeeze', 'stretch', 'lens_distortion', 'spin', 'rotation', 'bounce', 'swing', 'color', 'fade', 'rotate', 'flip', 'reverse', 'audio_noise_reduction', 'mask', 'look', 'glitch', 'light', 'lens_flare', 'sparkle', 'neon_glow', 'god_rays', 'dust', 'scratches', 'film_burn', 'retro_camera', 'rain', 'snow', 'fog', 'frost', 'motionfx', 'audiofx', 'datamosh', 'auto_color', 'chroma_key', 'double_exposure', 'split_screen']
      const isHardBake = (c: EditCommand): c is Extract<EditCommand, { type: HardBakeType }> => (HARD_BAKE_TYPES as string[]).includes(c.type)
      const hardBake = commands.filter(isHardBake)
      const soft = commands.filter((c) => !isHardBake(c))

      if (hardBake.length) {
        if (!sourceBlobRef.current) throw new Error('No source video loaded yet.')
        let blob = sourceBlobRef.current

        // Replay the whole effect list against the ORIGINAL source instead of
        // stacking this instruction on top of the last render, so a session's
        // worth of instructions costs one generation of encoding loss rather
        // than one per instruction. See HistorySnapshot.effectStack.
        //
        // Only safe when replaying is genuinely equivalent to appending:
        //  - the base snapshot has to still be in the history (index 0),
        //  - every earlier effect has to be one this build knows how to
        //    replay — a snapshot with no recorded stack (an older session, or
        //    a previous fallback) can't be reconstructed,
        //  - no earlier effect may have changed the clip's DURATION
        //    (speed/loop/reverse do), because every windowed effect after it
        //    is timed against the retimed clip, and
        //  - no trim may be involved, in either direction. The trim bake
        //    below deliberately runs BEFORE the effects, so a stack built as
        //    "effects, then trim" would replay as "trim, then effects" and
        //    every windowed effect would land at the wrong timestamp.
        // Any of those failing falls back to the old append-on-top
        // behaviour, which is always correct, just lossier. Deliberately
        // conservative: a slightly softer render is recoverable, an edit
        // silently applied at the wrong second is not.
        const RETIMING_TYPES = new Set(['speed', 'loop', 'reverse'])
        const hasPendingTrim = mode === 'single' && !!clips[0] && (clips[0].cutStart > 0 || clips[0].cutEnd > 0)
        const baseSnapshot = history[0]
        const prevSnapshot = history[historyIndex]
        const prevStack = prevSnapshot?.effectStack
        // Nothing to replay yet — the base IS the current source, so this
        // path is byte-identical to the old one, pending trim included.
        const prevIsBase = prevSnapshot === baseSnapshot
        const canReplayFromBase = !!baseSnapshot
          && (prevIsBase || (!!prevStack && !prevSnapshot?.bakedTrim && !hasPendingTrim))
          && !(prevStack ?? []).some((c) => RETIMING_TYPES.has(c.type))

        let effectStack: EditCommand[] | undefined
        let toApply: EditCommand[] = hardBake
        if (canReplayFromBase) {
          effectStack = [...(prevStack ?? []), ...hardBake]
          toApply = effectStack
          blob = await getSourceBlob(baseSnapshot.sourceKey)
        }

        // A still-pending (not yet baked-in) trim from an earlier "Trim the
        // first 3 seconds" instruction is only a cutStart/cutEnd on the
        // clip — sourceBlobRef itself is still the untrimmed video. Without
        // baking that in first, a FOLLOW-UP "Zoom from 5 to 8 seconds"
        // would zoom into 5-8s of the ORIGINAL video, not 5-8s of what the
        // operator is now actually looking at post-trim — the natural
        // reading of two sequential instructions given by example in the
        // task spec itself ("Trim the first 3 seconds" then "Zoom into the
        // product from 5 to 8 seconds"). Baking it in also means the fresh
        // clip commitNewSource creates below correctly starts at cutStart=0
        // instead of silently re-applying the same trim on top of itself.
        if (hasPendingTrim && clips[0]) {
          const c = clips[0]
          blob = await renderFinal(blob, { trimStart: c.cutStart, trimEnd: c.cutEnd > 0 ? Math.max(0.1, c.end - c.cutEnd) : 0 }, setAiProgress)
        }

        // crop/rotate/flip (geometry) first, then zoom/pan/speed, then
        // color/blur/pixelate/fade/noise-reduction (frame/audio-level
        // touch-ups), then reverse, loop last (should wrap the fully-edited
        // result, not a pre-edit segment).
        const ordered = [
          ...toApply.filter((c) => c.type === 'crop' || c.type === 'rotate' || c.type === 'flip'),
          ...toApply.filter((c) => c.type === 'zoom' || c.type === 'pan' || c.type === 'speed'),
          ...toApply.filter((c) => c.type === 'color' || c.type === 'blur' || c.type === 'background_blur' || c.type === 'pixelate' || c.type === 'motion_blur' || c.type === 'directional_blur' || c.type === 'zoom_blur' || c.type === 'radial_blur' || c.type === 'spin_blur' || c.type === 'tiltshift_blur' || c.type === 'wave' || c.type === 'ripple' || c.type === 'warp' || c.type === 'twirl' || c.type === 'fisheye' || c.type === 'bulge' || c.type === 'squeeze' || c.type === 'stretch' || c.type === 'lens_distortion' || c.type === 'spin' || c.type === 'rotation' || c.type === 'bounce' || c.type === 'swing' || c.type === 'fade' || c.type === 'audio_noise_reduction' || c.type === 'mask' || c.type === 'look' || c.type === 'glitch' || c.type === 'light' || c.type === 'lens_flare' || c.type === 'sparkle' || c.type === 'neon_glow' || c.type === 'god_rays' || c.type === 'dust' || c.type === 'scratches' || c.type === 'film_burn' || c.type === 'retro_camera' || c.type === 'rain' || c.type === 'snow' || c.type === 'fog' || c.type === 'frost' || c.type === 'motionfx' || c.type === 'audiofx' || c.type === 'datamosh' || c.type === 'auto_color' || c.type === 'chroma_key' || c.type === 'double_exposure' || c.type === 'split_screen'),
          ...toApply.filter((c) => c.type === 'reverse'),
          ...toApply.filter((c) => c.type === 'loop'),
        ]
        let bakedDurationSec = totalDuration

        // Each apply*() below is a full decode -> filter -> RE-ENCODE -> read
        // round trip, so chaining them blob-to-blob costs one generation of
        // h264 loss per effect, and that loss compounds. Effects that are a
        // plain single -vf chain can instead be spliced into ONE filter chain
        // and rendered in a single pass — same output, one generation instead
        // of N. Measured on a five-effect instruction: 37.1 dB PSNR chained
        // vs 48.4 dB batched, and ~2x faster.
        //
        // toBatchableEffect() returns null for anything not on that allowlist
        // (zoom/pan/speed, the filter_complex effects, anything needing a
        // probe or an extra input, reverse/loop, audio-only). Null means this
        // command is NOT batched and falls through to its original branch in
        // the untouched if/else chain below. That's the safety property: an
        // effect type nobody has taught the batcher about still renders
        // correctly, it just doesn't get the speedup.
        let ci = 0
        while (ci < ordered.length) {
          // Look ahead for a run of consecutive batchable effects. Any
          // duration-changing command (speed) is non-batchable and therefore
          // breaks the run, so bakedDurationSec is always already final for
          // the fades inside a run by the time the run is built.
          const batch: BatchableEffect[] = []
          let cj = ci
          while (cj < ordered.length) {
            const b = toBatchableEffect(ordered[cj], bakedDurationSec)
            if (!b) break
            batch.push(b)
            cj++
          }
          // Only worth batching two or more — a single effect goes down its
          // normal branch so it keeps its own specific error message.
          if (batch.length >= 2) {
            blob = await applyBatchedEffects(blob, batch, setAiProgress)
            ci = cj
            continue
          }

          const cmd = ordered[ci]
          ci++
          if (cmd.type === 'crop') {
            blob = await applyCropAspect(blob, cmd.aspect, setAiProgress)
          } else if (cmd.type === 'zoom') {
            const { x, y } = targetToCenter(cmd.target)
            blob = await applyZoomPan(blob, { start: cmd.start, end: cmd.end, fromScale: cmd.fromScale, toScale: cmd.toScale, fromX: x, fromY: y, toX: x, toY: y }, setAiProgress)
          } else if (cmd.type === 'pan') {
            const { fromX, fromY, toX, toY } = directionToPanPoints(cmd.direction)
            blob = await applyZoomPan(blob, { start: cmd.start, end: cmd.end, fromScale: cmd.scale, toScale: cmd.scale, fromX, fromY, toX, toY }, setAiProgress)
          } else if (cmd.type === 'speed') {
            blob = await applyWindowedSpeed(blob, cmd.start, cmd.end, cmd.factor, setAiProgress)
            bakedDurationSec = await probeBlobDuration(blob)
          } else if (cmd.type === 'loop') {
            blob = await loopVideo(blob, cmd.times, setAiProgress)
          } else if (cmd.type === 'blur') {
            blob = await applyBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'background_blur') {
            blob = await applyBackgroundBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'pixelate') {
            blob = await applyPixelate(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'motion_blur') {
            blob = await applyMotionBlur(blob, { start: cmd.start, end: cmd.end, direction: cmd.direction, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'directional_blur') {
            blob = await applyDirectionalBlur(blob, { start: cmd.start, end: cmd.end, angle: cmd.angle, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'zoom_blur') {
            blob = await applyZoomBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'radial_blur') {
            blob = await applyRadialBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'spin_blur') {
            blob = await applySpinBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'tiltshift_blur') {
            blob = await applyTiltShiftBlur(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, bandY: cmd.bandY, bandHeight: cmd.bandHeight }, setAiProgress)
          } else if (cmd.type === 'wave') {
            blob = await applyWave(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, axis: cmd.axis }, setAiProgress)
          } else if (cmd.type === 'ripple') {
            blob = await applyRipple(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'warp') {
            blob = await applyWarp(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'twirl') {
            blob = await applyTwirl(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'fisheye') {
            blob = await applyFisheye(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'bulge') {
            blob = await applyBulge(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'squeeze') {
            blob = await applySqueeze(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'stretch') {
            blob = await applyStretch(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, axis: cmd.axis }, setAiProgress)
          } else if (cmd.type === 'lens_distortion') {
            blob = await applyLensDistortion(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, mode: cmd.mode }, setAiProgress)
          } else if (cmd.type === 'spin') {
            blob = await applySpin(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, direction: cmd.direction }, setAiProgress)
          } else if (cmd.type === 'rotation') {
            blob = await applyRotation(blob, { start: cmd.start, end: cmd.end, fromDegrees: cmd.fromDegrees, toDegrees: cmd.toDegrees }, setAiProgress)
          } else if (cmd.type === 'bounce') {
            blob = await applyBounce(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'swing') {
            blob = await applySwing(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'color') {
            blob = await applyColorAdjust(blob, {
              start: cmd.start, end: cmd.end, brightness: cmd.brightness, contrast: cmd.contrast,
              saturation: cmd.saturation, grayscale: cmd.grayscale, warmth: cmd.warmth, vignette: cmd.vignette,
              exposure: cmd.exposure, highlights: cmd.highlights, shadows: cmd.shadows, tint: cmd.tint,
              sharpness: cmd.sharpness, clarity: cmd.clarity, grain: cmd.grain,
            }, setAiProgress)
          } else if (cmd.type === 'mask') {
            blob = await applyMask(blob, {
              start: cmd.start, end: cmd.end, shape: cmd.shape,
              x: cmd.x ?? 0.5, y: cmd.y ?? 0.5, size: cmd.size ?? 0.35, feather: cmd.feather ?? 0.12,
            }, setAiProgress)
          } else if (cmd.type === 'look') {
            blob = await applyLook(blob, { start: cmd.start, end: cmd.end, name: cmd.name, hueDegrees: cmd.hueDegrees }, setAiProgress)
          } else if (cmd.type === 'glitch') {
            blob = await applyGlitch(blob, { start: cmd.start, end: cmd.end, style: cmd.style, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'light') {
            blob = await applyLight(blob, { start: cmd.start, end: cmd.end, style: cmd.style, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'lens_flare') {
            blob = await applyLensFlare(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'sparkle') {
            blob = await applySparkle(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'neon_glow') {
            blob = await applyNeonGlow(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, color: cmd.color }, setAiProgress)
          } else if (cmd.type === 'god_rays') {
            blob = await applyGodRays(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength, x: cmd.x, y: cmd.y }, setAiProgress)
          } else if (cmd.type === 'dust') {
            blob = await applyDust(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'scratches') {
            blob = await applyScratches(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'film_burn') {
            blob = await applyFilmBurn(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'retro_camera') {
            blob = await applyRetroCamera(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'rain') {
            blob = await applyRain(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'snow') {
            blob = await applySnow(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'fog') {
            blob = await applyFog(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'frost') {
            blob = await applyFrost(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'motionfx') {
            blob = await applyMotionFx(blob, { start: cmd.start, end: cmd.end, style: cmd.style, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'audiofx') {
            blob = await applyAudioFx(blob, { style: cmd.style, strength: cmd.strength, direction: cmd.direction, duration: cmd.duration, preset: cmd.preset }, setAiProgress)
          } else if (cmd.type === 'datamosh') {
            blob = await applyDatamosh(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'auto_color') {
            blob = await applyAutoColor(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'chroma_key') {
            blob = await applyChromaKey(blob, { start: cmd.start, end: cmd.end, keyColor: cmd.keyColor, replacementColor: cmd.replacementColor, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'double_exposure') {
            blob = await applyDoubleExposure(blob, { start: cmd.start, end: cmd.end, strength: cmd.strength }, setAiProgress)
          } else if (cmd.type === 'split_screen') {
            blob = await applySplitScreen(blob, { start: cmd.start, end: cmd.end }, setAiProgress)
          } else if (cmd.type === 'fade') {
            blob = await applyVideoFade(blob, { direction: cmd.direction, duration: cmd.duration, durationSec: bakedDurationSec }, setAiProgress)
          } else if (cmd.type === 'rotate') {
            blob = await applyRotate(blob, cmd.degrees, setAiProgress)
          } else if (cmd.type === 'flip') {
            blob = await applyFlip(blob, cmd.axis, setAiProgress)
          } else if (cmd.type === 'reverse') {
            blob = await applyReverse(blob, setAiProgress)
          } else if (cmd.type === 'audio_noise_reduction') {
            blob = await applyNoiseReduction(blob, setAiProgress)
          }
        }

        // Local only — no Drive upload, no DB write, same as picking a music
        // file: it becomes real (uploaded, saved) when the operator clicks
        // Save, not the moment ffmpeg finishes. This is also what makes the
        // result properly undoable through the same history/undo() as every
        // other edit, and what keeps the original upload (raw_drive_id,
        // untouched by any of this) and every earlier save's Drive file
        // intact rather than replaced on every single AI instruction.
        // The label and effectTypes describe what the operator just asked
        // for, NOT the replayed stack — on a replay `ordered` also contains
        // every earlier effect, and listing those again would make each
        // history entry read as if it had re-applied everything.
        const justApplied = ordered.filter((c) => hardBake.includes(c))
        const newDuration = await probeBlobDuration(blob)
        await commitNewSource(
          blob,
          newDuration,
          justApplied.map(describeAiCommand).join(' + '),
          justApplied.map((c) => c.type),
          effectStack,
          hasPendingTrim || prevSnapshot?.bakedTrim,
        )
      }

      for (const cmd of soft) {
        if (cmd.type === 'trim') {
          if (mode !== 'single' || !clips[0]) {
            throw new Error('AI trim only works on a single-source video right now — use the Trim panel for a multi-clip timeline.')
          }
          // One combined commit, not setStartAt() then setEndAt(): those are
          // built for two separate user actions (edit the Starts-at box,
          // blur; edit the Ends-at box, blur) with a full re-render between
          // them, so each reads a fresh `clips`. Called back-to-back here in
          // the same tick, the second call would still see the PRE-first-
          // commit `clips` and silently discard the start-trim it just set.
          const c = clips[0]
          const nextClips = clips.map((x) => (
            x.id === c.id ? { ...x, cutStart: Math.max(0, cmd.start - c.start), cutEnd: Math.max(0, c.end - cmd.end) } : x
          ))
          commit(nextClips, 'Trim')
        } else if (cmd.type === 'text' || cmd.type === 'caption') {
          addOverlay(cmd.type, {
            text: cmd.text, start: cmd.start, end: cmd.end, position: cmd.position, size: cmd.size,
            fontFamily: cmd.fontFamily, color: cmd.color, bold: cmd.bold, italic: cmd.italic, underline: cmd.underline, strikethrough: cmd.strikethrough,
            outlineColor: cmd.outlineColor, outlineWidth: cmd.outlineWidth, backgroundColor: cmd.backgroundColor, backgroundOpacity: cmd.backgroundOpacity,
            animation: cmd.animation, animationDuration: cmd.animationDuration,
            dropShadow: cmd.dropShadow, gradientTo: cmd.gradientTo, letterSpacing: cmd.letterSpacing,
          })
        } else if (cmd.type === 'text_edit') {
          // Already resolved to a concrete overlayId by validateCommand —
          // only the wording changes, every style/timing property is untouched.
          updateOverlay(cmd.overlayId, { text: cmd.text })
        } else if (cmd.type === 'remove_text') {
          // Already resolved to a concrete overlayId by validateCommand
          // (using the real current layers) — nothing left to match here.
          deleteOverlay(cmd.overlayId)
        } else if (cmd.type === 'audio_volume') {
          setOriginalVolume(cmd.volume)
          setDirty(true)
        } else if (cmd.type === 'mute') {
          setMuteOriginal(cmd.muted)
          setDirty(true)
        } else if (cmd.type === 'music') {
          if (cmd.action === 'remove') removeMusic()
          else if (cmd.volume != null) { setMusicVolume(cmd.volume); setDirty(true) }
        } else if (cmd.type === 'remove_effect') {
          // validateCommand already confirmed this effect is EXACTLY the
          // top of the undo stack (ctx.lastEffectType) — removing it is
          // just stepping back one commit via the real Undo mechanism, not
          // a separate/parallel removal path.
          await undo()
        } else if (cmd.type === 'text_style') {
          // Already resolved to a concrete overlayId by validateCommand.
          // Only the fields the instruction named are in cmd at all — every
          // other property of the layer is untouched by this patch.
          updateOverlay(cmd.overlayId, {
            ...(cmd.color != null ? { color: cmd.color } : {}),
            ...(cmd.bold != null ? { bold: cmd.bold } : {}),
            ...(cmd.italic != null ? { italic: cmd.italic } : {}),
            ...(cmd.underline != null ? { underline: cmd.underline } : {}),
            ...(cmd.strikethrough != null ? { strikethrough: cmd.strikethrough } : {}),
            ...(cmd.outlineColor != null ? { outlineColor: cmd.outlineColor } : {}),
            ...(cmd.outlineWidth != null ? { outlineWidth: cmd.outlineWidth } : {}),
            ...(cmd.position != null ? { position: cmd.position } : {}),
            ...(cmd.size != null ? { size: cmd.size } : {}),
            ...(cmd.fontFamily != null ? { fontFamily: cmd.fontFamily } : {}),
            ...(cmd.backgroundColor != null ? { backgroundColor: cmd.backgroundColor } : {}),
            ...(cmd.backgroundOpacity != null ? { backgroundOpacity: cmd.backgroundOpacity } : {}),
            ...(cmd.animation != null ? { animation: cmd.animation } : {}),
            ...(cmd.animationDuration != null ? { animationDuration: cmd.animationDuration } : {}),
            ...(cmd.dropShadow != null ? { dropShadow: cmd.dropShadow } : {}),
            ...(cmd.gradientTo != null ? { gradientTo: cmd.gradientTo } : {}),
            ...(cmd.letterSpacing != null ? { letterSpacing: cmd.letterSpacing } : {}),
          })
        } else if (cmd.type === 'captions_auto') {
          if (!sourceBlobRef.current) throw new Error('No source video loaded yet.')
          const { audioBlob } = await analyzeFootage(sourceBlobRef.current, {}, setAiProgress)
          const transcript = await transcribeAudio(audioBlob)
          if (!transcript.segments.length) throw new Error('No speech was detected in this video to generate captions from.')
          const newCaptions: Overlay[] = transcript.segments.map((s, i) => ({
            id: `ov-caption-auto-${Date.now()}-${i}`, kind: 'caption', text: s.text.trim(),
            start: s.start, end: s.end, position: 'bottom', size: 'md',
          }))
          setOverlays((prev) => [...prev, ...newCaptions])
          setDirty(true)
        }
      }

      const summary = commands.map(describeAiCommand).join('; ')
      setAiLastApplied(commands)
      setAiPendingCommands(null)
      setAiEditPrompt('')
      await logActivity('content', content.id, 'ai-edit', summary, viewer?.name || 'System')
    } catch (err) {
      // handleError() alone put this in the page-level banner up near the
      // header — invisible to someone whose eyes are on the Apply button
      // right here, which just re-enables with no visible explanation. That
      // silence is exactly what makes a real, distinct failure on every
      // attempt look like "nothing is happening" and invites clicking Apply
      // again and again. Setting aiEditError puts the same message right
      // next to the button that failed.
      handleError(err)
      setAiEditError(errText(err))
    } finally {
      setAiApplying(false)
      setAiProgress(null)
    }
  }

  if (loading) {
    return (
      <Page>
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      </Page>
    )
  }

  if (notFound || !content) {
    return (
      <Page>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          Couldn't find that content piece.
        </div>
      </Page>
    )
  }

  const subtitle = [content.brand_name, content.platform, content.format].filter(Boolean).join(' ')
  const status = workflowStatus(content, job)
  const showChangesCard = job?.review_status === 'changes_requested' && content.stage === 'Editing'

  return (
    <Page>
      <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 sm:px-5 sm:py-4">
        <button
          onClick={() => navigate(`/content-studio/editing/${contentId}`)}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Project
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <span aria-hidden="true">🎬</span> {content.title}
            </h1>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <span className="badge bg-indigo-900/60 text-indigo-300">Status: {status.emoji} {status.label}</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}
      {submitMsg && (
        <div className="mb-4 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{submitMsg}</div>
      )}

      {showChangesCard && (
        <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/20 px-4 py-3">
          <h3 className="text-sm font-bold text-rose-300 mb-1">🔴 Changes Requested</h3>
          <p className="text-xs text-gray-500">Reviewer: <span className="text-gray-300">{job?.reviewed_by || 'Unknown'}</span></p>
          <p className="text-sm text-gray-300 mt-1">"{job?.review_feedback}"</p>
          <p className="text-[11px] text-gray-600 mt-1">{job?.reviewed_at ? new Date(job.reviewed_at).toLocaleString() : ''}</p>
        </div>
      )}

      {!hasEdit ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-10 text-center text-sm text-gray-400">
          No generated video yet.{' '}
          <button onClick={() => navigate(`/content-studio/editing/${contentId}`)} className="text-gold-500 hover:underline">
            Go back and generate a first cut
          </button>{' '}
          before editing.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="min-w-0 space-y-3">
            {/* ---------- video preview + live text/caption overlay ---------- */}
            <div className="relative rounded-lg border border-gray-800 bg-black overflow-hidden flex items-center justify-center">
              {sourceLoading && !sourceUrl ? (
                <div className="aspect-video w-full flex items-center justify-center"><LoadingSpinner /></div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    src={previewUrl || sourceUrl}
                    className="w-full max-h-[55vh] bg-black"
                    onTimeUpdate={(e) => setCurTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                  <style>{`
                    @keyframes ov-slide-down { from { transform: translateY(-40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
                    @keyframes ov-slide-up { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
                    @keyframes ov-fade { from { opacity: 0 } to { opacity: 1 } }
                    @keyframes ov-bounce {
                      0% { transform: translateY(-40px); opacity: 0 }
                      55% { transform: translateY(8px); opacity: 1 }
                      75% { transform: translateY(-4px) }
                      100% { transform: translateY(0) }
                    }
                    @keyframes ov-shake {
                      0%, 100% { transform: translateX(0) }
                      20% { transform: translateX(-10px) }
                      40% { transform: translateX(8px) }
                      60% { transform: translateX(-5px) }
                      80% { transform: translateX(3px) }
                    }
                    @keyframes ov-blur-in { from { filter: blur(8px); opacity: 0 } to { filter: blur(0); opacity: 1 } }
                  `}</style>
                  {overlays.filter((o) => o.text.trim() && isOverlayActive(o, curTime)).map((o) => (
                    <div
                      // React mounts a fresh DOM node each time this becomes
                      // active (the .filter() above excludes it while
                      // inactive, so re-entering means a real re-mount, not
                      // an update) — that's what makes the CSS animation
                      // below replay on every entrance.
                      key={o.id}
                      className={`absolute ${POSITION_CLASS[o.position]} ${SIZE_CLASS[o.size]} rounded-md bg-black/60 text-center max-w-[90%] pointer-events-none ${o.bold ? 'font-bold' : 'font-semibold'}`}
                      style={{
                        color: o.color ?? '#ffffff',
                        WebkitTextStroke: o.outlineWidth ? `${o.outlineWidth}px ${o.outlineColor ?? '#000000'}` : undefined,
                        fontFamily: o.fontFamily ? `"${o.fontFamily}", sans-serif` : undefined,
                        fontStyle: o.italic ? 'italic' : undefined,
                        textDecoration: [o.underline && 'underline', o.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
                        backgroundColor: (o.backgroundColor || o.backgroundOpacity != null)
                          ? `color-mix(in srgb, ${o.backgroundColor ?? '#000000'} ${Math.round((o.backgroundOpacity ?? 0.6) * 100)}%, transparent)`
                          : undefined,
                        textShadow: o.glow
                          ? [0.9, 0.5, 0.25].map((r) => `0 0 ${r * 20}px ${o.color ?? '#ffffff'}`).join(', ')
                          : undefined,
                        animation: o.animation ? `ov-${o.animation} ${o.animationDuration ?? 0.4}s ease-out` : undefined,
                      }}
                    >
                      {o.text}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 px-1">
              <button onClick={togglePlay} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {playing ? 'Pause' : 'Play'}
              </button>
              <span className="text-xs text-gray-500 tabular-nums">{fmtTime(curTime)} / {fmtTime(duration)}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => { const m = !muted; setMuted(m); if (videoRef.current) videoRef.current.muted = m }} className="text-gray-500 hover:text-gray-300">
                  {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => onVolumeChange(Number(e.target.value))} className="w-20" />
              </div>
              <button onClick={toggleFullscreen} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                <Maximize className="w-3.5 h-3.5" /> Fullscreen
              </button>
              {previewUrl && <span className="text-[11px] text-amber-400">Showing an unsaved preview</span>}
            </div>

            {/* ---------- durations ---------- */}
            {clips.length > 0 && (
              <div className="flex items-center gap-4 px-1 text-[11px] text-gray-500">
                <span>Original: <span className="text-gray-300 font-semibold">{fmtTime(originalDuration)}</span></span>
                <span>Edited: <span className="text-gold-500 font-semibold">{fmtTime(editedDuration)}</span></span>
              </div>
            )}

            {/* ---------- selected clip info ---------- */}
            {selectedClip && (
              <div className="rounded-lg border border-gray-800 p-2.5 text-[11px]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 mb-1">Selected clip</p>
                <p className="text-gray-200 font-semibold">{selectedClip.label}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-500 mt-0.5">
                  <span>Start: {fmtTime(selectedClip.start + selectedClip.cutStart)}</span>
                  <span>End: {fmtTime(selectedClip.end - selectedClip.cutEnd)}</span>
                  <span>Duration: {fmtTime(Math.max(0, (selectedClip.end - selectedClip.cutEnd) - (selectedClip.start + selectedClip.cutStart)))}</span>
                </div>
              </div>
            )}

            {/* ---------- timeline ---------- */}
            {clips.length > 0 && totalDuration > 0 && (
              <div className="rounded-lg border border-gray-800 p-3 space-y-2.5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Video</p>
                  <div className="flex gap-1">
                    {clips.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        disabled={c.deleted}
                        style={{ flexGrow: Math.max(0.3, c.end - c.start) }}
                        className={`relative h-12 rounded-md border overflow-hidden text-[11px] font-semibold transition-colors ${
                          c.deleted
                            ? 'opacity-30 border-gray-800 bg-gray-900 text-gray-600 line-through'
                            : selectedId === c.id
                              ? 'border-gold-600 bg-gold-500/20 text-gold-400'
                              : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {c.thumbnail && <img src={c.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />}
                        <span className="relative flex flex-col items-center justify-center h-full px-1 truncate">
                          <span className="truncate">{c.label}</span>
                          <span className="text-[9px] opacity-80">{fmtTime(Math.max(0, (c.end - c.cutEnd) - (c.start + c.cutStart)))}</span>
                        </span>
                        {!c.deleted && selectedId === c.id && (
                          <>
                            <span
                              onMouseDown={(e) => onHandleMouseDown(c.id, 'start', e)}
                              title="Drag to trim the start"
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-gold-500/70 hover:bg-gold-400"
                            />
                            <span
                              onMouseDown={(e) => onHandleMouseDown(c.id, 'end', e)}
                              title="Drag to trim the end"
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-gold-500/70 hover:bg-gold-400"
                            />
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* click-to-seek ruler with playhead, spans the same total width as the clip row above */}
                <div ref={timelineTrackRef} onClick={onTimelineClick} className="relative h-4 rounded bg-gray-900/60 border border-gray-800 cursor-pointer">
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-gold-500"
                    style={{ left: `${Math.min(100, (curTime / totalDuration) * 100)}%` }}
                  />
                </div>

                {overlays.some((o) => o.kind === 'text') && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Text</p>
                    <div ref={textTrackRef} className="relative h-6 rounded-md border border-gray-800 bg-gray-900/60">
                      {overlays.filter((o) => o.kind === 'text').map((o) => {
                        const left = o.start || o.end ? (o.start / totalDuration) * 100 : 0
                        const width = o.start || o.end ? Math.max(2, ((o.end - o.start) / totalDuration) * 100) : 100
                        return (
                          <div
                            key={o.id}
                            onClick={() => setEditingOverlayId(o.id)}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            className="absolute top-0.5 bottom-0.5 rounded bg-sky-900/70 border border-sky-700/60 text-sky-200 text-[10px] px-1 truncate flex items-center cursor-pointer hover:border-sky-500"
                          >
                            {o.text || 'Text'}
                            <span
                              onMouseDown={(e) => onOverlayHandleMouseDown(textTrackRef, o.id, 'start', e)}
                              title="Drag to adjust the start"
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-sky-500/70 hover:bg-sky-400"
                            />
                            <span
                              onMouseDown={(e) => onOverlayHandleMouseDown(textTrackRef, o.id, 'end', e)}
                              title="Drag to adjust the end"
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-sky-500/70 hover:bg-sky-400"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {overlays.some((o) => o.kind === 'caption') && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Captions</p>
                    <div ref={captionTrackRef} className="relative h-6 rounded-md border border-gray-800 bg-gray-900/60">
                      {overlays.filter((o) => o.kind === 'caption').map((o) => {
                        const left = o.start || o.end ? (o.start / totalDuration) * 100 : 0
                        const width = o.start || o.end ? Math.max(2, ((o.end - o.start) / totalDuration) * 100) : 100
                        return (
                          <div
                            key={o.id}
                            onClick={() => setEditingOverlayId(o.id)}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            className="absolute top-0.5 bottom-0.5 rounded bg-violet-900/70 border border-violet-700/60 text-violet-200 text-[10px] px-1 truncate flex items-center cursor-pointer hover:border-violet-500"
                          >
                            {o.text || 'Caption'}
                            <span
                              onMouseDown={(e) => onOverlayHandleMouseDown(captionTrackRef, o.id, 'start', e)}
                              title="Drag to adjust the start"
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-violet-500/70 hover:bg-violet-400"
                            />
                            <span
                              onMouseDown={(e) => onOverlayHandleMouseDown(captionTrackRef, o.id, 'end', e)}
                              title="Drag to adjust the end"
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-violet-500/70 hover:bg-violet-400"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {hasMusic && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Audio</p>
                    <div ref={audioTrackRef} className="relative h-6 rounded-md border border-gray-800 bg-gray-900/60">
                      <div
                        style={{
                          left: `${(musicStart / totalDuration) * 100}%`,
                          width: `${Math.max(2, (((musicEnd > musicStart ? musicEnd : totalDuration) - musicStart) / totalDuration) * 100)}%`,
                        }}
                        className="absolute top-0.5 bottom-0.5 rounded bg-emerald-900/70 border border-emerald-700/60 text-emerald-200 text-[10px] px-1 truncate flex items-center"
                      >
                        {musicName || 'Background Music'}
                        <span
                          onMouseDown={(e) => onMusicHandleMouseDown('start', e)}
                          title="Drag to adjust the start"
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-emerald-500/70 hover:bg-emerald-400"
                        />
                        <span
                          onMouseDown={(e) => onMusicHandleMouseDown('end', e)}
                          title="Drag to adjust the end"
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-emerald-500/70 hover:bg-emerald-400"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---------- editing tools ---------- */}
          <aside className="space-y-3">
            <div className="rounded-lg border border-gray-800 p-3">
              <h3 className="text-xs font-bold text-gray-300 mb-2 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5" /> Trim
              </h3>
              {selectedClip ? (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-600">Starts at (sec)</label>
                    <input
                      type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                      value={startAtInput}
                      onChange={(e) => setStartAtInput(e.target.value)}
                      onBlur={commitStartAt}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-600">Ends at (sec)</label>
                    <input
                      type="number" min="0" step="0.5" className="form-input py-1 text-xs"
                      value={endAtInput}
                      onChange={(e) => setEndAtInput(e.target.value)}
                      onBlur={commitEndAt}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => splitClip(selectedClip.id)}
                      className="text-[11px] font-semibold text-gold-500 hover:underline"
                    >
                      ✂ Split at playhead
                    </button>
                    <button
                      onClick={() => deleteClip(selectedClip.id)}
                      disabled={aliveCount <= 1}
                      title={aliveCount <= 1 ? "Can't delete the only clip" : undefined}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      <Trash2 className="w-3 h-3" /> Delete Clip
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-gray-600">Select a clip on the timeline to trim it.</p>
              )}
            </div>

            {/* ---------- match a reference reel ---------- */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">🔗 Match a Reference Reel</h3>
              <p className="text-[10px] text-gray-600">
                Reads the reference link's cover image (colors/aspect/caption look) — not the full video, that can't be downloaded from a link. Gets you close, not identical.
              </p>
              <input
                type="text"
                className="form-input text-xs"
                value={styleUrl}
                onChange={(e) => setStyleUrl(e.target.value)}
                placeholder="Paste a reel/short link…"
                disabled={styleMatching || aiInterpreting || aiApplying}
              />
              <button
                className="btn-secondary text-xs w-full disabled:opacity-50"
                onClick={matchReferenceStyle}
                disabled={styleMatching || aiInterpreting || aiApplying || !sourceBlobRef.current}
              >
                {styleMatching ? 'Analyzing style…' : 'Analyze & Match Style'}
              </button>
              <p className="text-[10px] text-gray-600 text-center">
                Instagram/TikTok links block this — they need a real login, and I won't try to bypass that.
              </p>
              <input
                ref={styleImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) matchReferenceStyleFromImage(f) }}
              />
              <button
                className="btn-secondary text-xs w-full disabled:opacity-50"
                onClick={() => styleImageInputRef.current?.click()}
                disabled={styleMatching || aiInterpreting || aiApplying || !sourceBlobRef.current}
              >
                {styleMatching ? 'Analyzing style…' : 'Or Upload a Screenshot of the Reel Instead'}
              </button>
              {styleImagePreviewUrl && (
                <div className="flex justify-center">
                  <img
                    src={styleImagePreviewUrl}
                    alt="Uploaded reference cover"
                    className="w-24 aspect-[9/16] object-cover rounded-md border border-gray-700"
                  />
                </div>
              )}
              {styleError && <p className="text-[11px] text-rose-400">{styleError}</p>}
              {styleVibe && (
                <p className="text-[11px] text-gray-500 italic">
                  "{styleVibe}" — review the suggested changes in AI Edit below before applying.
                </p>
              )}
            </div>

            {/* ---------- ai edit ---------- */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">✨ AI Edit</h3>
              <textarea
                className="form-input text-xs"
                rows={3}
                value={aiEditPrompt}
                onChange={(e) => setAiEditPrompt(e.target.value)}
                placeholder='e.g. "Zoom into the person from 5 to 8 seconds" or "Crop this for Instagram Reel"'
                disabled={aiInterpreting || aiApplying}
              />

              {!aiPendingCommands ? (
                <button
                  className="btn-primary text-xs w-full disabled:opacity-50"
                  onClick={interpretAiEdit}
                  disabled={aiInterpreting || aiApplying || !sourceBlobRef.current}
                >
                  {aiInterpreting ? 'Thinking…' : 'Interpret instruction'}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-md border border-gray-700 bg-gray-900/60 p-2 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Will apply:</p>
                    {aiPendingCommands.map((cmd, i) => (
                      <p key={i} className="text-[11px] text-gray-300">• {describeAiCommand(cmd)}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary text-xs flex-1 disabled:opacity-50" onClick={confirmAiEdit} disabled={aiApplying}>
                      {aiApplying ? progressLabel(aiProgress, 'Applying…') : 'Apply'}
                    </button>
                    <button className="btn-secondary text-xs" onClick={cancelAiEdit} disabled={aiApplying}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {aiEditError && <p className="text-[11px] text-rose-400">{aiEditError}</p>}
              {aiEditQuestion && <p className="text-[11px] text-gold-400">{aiEditQuestion}</p>}
              {aiLastApplied && !aiPendingCommands && (
                <div className="rounded-md border border-emerald-800/50 bg-emerald-950/30 p-2 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500">✓ AI Edit Applied</p>
                  {aiLastApplied.map((cmd, i) => {
                    const { title, lines } = describeAiCommandCard(cmd)
                    return (
                      <div key={i} className="text-[11px]">
                        <p className="font-semibold text-emerald-300">{title}</p>
                        {lines.map((line, j) => <p key={j} className="text-gray-400">{line}</p>)}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-gray-600">
                Every instruction is turned into a specific, reviewable edit before anything runs — nothing is applied without your confirmation above.
              </p>
            </div>

            {/* ---------- insert a second clip ---------- */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">🎬 Insert Clip</h3>
              <p className="text-[10px] text-gray-600">
                Cuts the video at a chosen point and continues into a second clip, with an optional transition — including a circle/iris wipe. Everything after the cut point is replaced by the new clip.
              </p>
              <input
                ref={insertClipInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickInsertClip(f) }}
              />
              <button
                className="btn-secondary text-xs w-full disabled:opacity-50"
                onClick={() => insertClipInputRef.current?.click()}
                disabled={inserting || !sourceBlobRef.current}
              >
                {insertClipFile ? `Selected: ${insertClipFile.name}` : 'Choose a second clip…'}
              </button>
              {insertClipFile && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-600">Insert at (seconds into current video)</label>
                    <input
                      type="number"
                      className="form-input text-xs"
                      min={0}
                      max={Math.max(0, totalDuration - 0.1)}
                      step={0.1}
                      value={insertAt}
                      onChange={(e) => setInsertAt(Math.max(0, Math.min(Number(e.target.value) || 0, Math.max(0, totalDuration - 0.1))))}
                      disabled={inserting}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-600">Transition</label>
                    <select
                      className="form-input text-xs"
                      value={insertTransition}
                      onChange={(e) => setInsertTransition(e.target.value as TransitionType)}
                      disabled={inserting}
                    >
                      {TRANSITION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  {insertTransition !== 'none' && (
                    <div>
                      <label className="text-[10px] text-gray-600">Transition duration (seconds)</label>
                      <input
                        type="number"
                        className="form-input text-xs"
                        min={0.1}
                        max={3}
                        step={0.1}
                        value={insertDuration}
                        onChange={(e) => setInsertDuration(Math.max(0.1, Math.min(Number(e.target.value) || 0.1, 3)))}
                        disabled={inserting}
                      />
                    </div>
                  )}
                  <button
                    className="btn-primary text-xs w-full disabled:opacity-50"
                    onClick={confirmInsertClip}
                    disabled={inserting}
                  >
                    {inserting ? progressLabel(insertProgress, 'Inserting…') : 'Insert Clip'}
                  </button>
                </div>
              )}
              {insertError && <p className="text-[11px] text-rose-400">{insertError}</p>}
            </div>

            {/* ---------- text tool ---------- */}
            <div className="rounded-lg border border-gray-800 p-3">
              <button onClick={() => setShowTextForm((s) => !s)} className="w-full flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Text</span>
                <span className="text-gray-600">{showTextForm ? '−' : '+'}</span>
              </button>
              {showTextForm && (
                <OverlayForm form={textForm} setForm={setTextForm} onSubmit={() => addOverlay('text', textForm)} submitLabel="Add Text" />
              )}
              {overlays.filter((o) => o.kind === 'text').length > 0 && (
                <div className="mt-2 space-y-1">
                  {overlays.filter((o) => o.kind === 'text').map((o) => (
                    <button key={o.id} onClick={() => setEditingOverlayId(o.id)} className="w-full text-left text-[11px] text-gray-400 hover:text-gray-200 truncate">
                      "{o.text}" · {fmtTime(o.start)}–{fmtTime(o.end)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ---------- captions tool ---------- */}
            <div className="rounded-lg border border-gray-800 p-3">
              <button onClick={() => setShowCaptionForm((s) => !s)} className="w-full flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Captions</span>
                <span className="text-gray-600">{showCaptionForm ? '−' : '+'}</span>
              </button>
              {showCaptionForm && (
                <OverlayForm form={captionForm} setForm={setCaptionForm} onSubmit={() => addOverlay('caption', captionForm)} submitLabel="Add Caption" />
              )}
              {overlays.filter((o) => o.kind === 'caption').length > 0 && (
                <div className="mt-2 space-y-1">
                  {overlays.filter((o) => o.kind === 'caption').map((o) => (
                    <button key={o.id} onClick={() => setEditingOverlayId(o.id)} className="w-full text-left text-[11px] text-gray-400 hover:text-gray-200 truncate">
                      "{o.text}" · {fmtTime(o.start)}–{fmtTime(o.end)}
                    </button>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => downloadCaptionsFile('srt')} className="text-[10px] font-semibold text-gray-500 hover:text-gold-400">Export .srt</button>
                    <button onClick={() => downloadCaptionsFile('vtt')} className="text-[10px] font-semibold text-gray-500 hover:text-gold-400">Export .vtt</button>
                  </div>
                </div>
              )}
            </div>

            {editingOverlay && (
              <div className="rounded-lg border border-gold-700/60 bg-gold-500/5 p-3">
                <h3 className="text-xs font-bold text-gold-400 mb-2">Edit {editingOverlay.kind === 'text' ? 'Text' : 'Caption'}</h3>
                <OverlayForm
                  form={editingOverlay}
                  setForm={(f) => updateOverlay(editingOverlay.id, typeof f === 'function' ? f(editingOverlay) : f)}
                  onSubmit={() => setEditingOverlayId(null)}
                  submitLabel="Save"
                />
                <button onClick={() => deleteOverlay(editingOverlay.id)} className="mt-2 text-[11px] font-semibold text-rose-400 hover:underline">
                  Delete
                </button>
              </div>
            )}

            {/* ---------- music tool ---------- */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5"><Music className="w-3.5 h-3.5" /> Background Music</h3>
              {hasMusic ? (
                <>
                  <p className="text-[11px] text-gray-400 truncate">{musicName}</p>
                  <div>
                    <label className="text-[10px] text-gray-600">Volume ({Math.round(musicVolume * 100)}%)</label>
                    <input type="range" min="0" max="1" step="0.02" value={musicVolume} onChange={(e) => { setMusicVolume(Number(e.target.value)); setDirty(true) }} className="w-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-600">Start (sec)</label>
                      <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={musicStart || ''} placeholder="0"
                        onChange={(e) => { setMusicStart(Number(e.target.value) || 0); setDirty(true) }} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-600">End (sec, blank = full)</label>
                      <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={musicEnd || ''} placeholder="0"
                        onChange={(e) => { setMusicEnd(Number(e.target.value) || 0); setDirty(true) }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-600">Fade in (sec)</label>
                      <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={fadeIn || ''} placeholder="0"
                        onChange={(e) => { setFadeIn(Number(e.target.value) || 0); setDirty(true) }} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-600">Fade out (sec)</label>
                      <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={fadeOut || ''} placeholder="0"
                        onChange={(e) => { setFadeOut(Number(e.target.value) || 0); setDirty(true) }} />
                    </div>
                  </div>
                  <button onClick={removeMusic} className="text-[11px] font-semibold text-rose-400 hover:underline">Delete Music</button>
                </>
              ) : (
                <button onClick={() => musicInputRef.current?.click()} className="btn-secondary text-xs w-full">+ Add Music</button>
              )}
              <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={onPickMusic} />
              <p className="text-[10px] text-gray-600">Upload only audio you're allowed to use — nothing here sources music automatically.</p>
            </div>

            {/* ---------- audio tool ---------- */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-gray-300">🔊 Original Video Audio</h3>
              <div>
                <label className="text-[10px] text-gray-600">Volume ({Math.round(originalVolume * 100)}%)</label>
                <input type="range" min="0" max="1" step="0.02" value={originalVolume} onChange={(e) => { setOriginalVolume(Number(e.target.value)); setDirty(true) }} disabled={muteOriginal} className="w-full" />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setMuteOriginal((m) => !m); setDirty(true) }}
                  className={`text-[11px] font-semibold rounded-md border px-2 py-1 ${muteOriginal ? 'border-rose-700 bg-rose-950/40 text-rose-300' : 'border-gray-800 text-gray-400 hover:border-gray-700'}`}
                >
                  🔇 {muteOriginal ? 'Unmute' : 'Mute'}
                </button>
                <button onClick={() => { setOriginalVolume(1); setMuteOriginal(false); setDirty(true) }} className="text-[11px] font-semibold text-gray-500 hover:text-gray-300">
                  <RotateCcw className="w-3 h-3 inline mr-1" /> Reset
                </button>
              </div>
              <p className="text-[10px] text-gray-600">Applied when you Preview or Save — click Preview to hear the actual mix.</p>
            </div>
          </aside>
        </div>
      )}

      {hasEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
          <button onClick={undo} disabled={historyIndex <= 0} className="btn-secondary text-xs disabled:opacity-40 inline-flex items-center gap-1.5">
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} className="btn-secondary text-xs disabled:opacity-40 inline-flex items-center gap-1.5">
            <Redo2 className="w-3.5 h-3.5" /> Redo
          </button>
          <button
            onClick={() => setShowHistory((s) => !s)}
            className={`text-xs font-semibold rounded-md border px-2.5 py-1.5 transition-colors ${showHistory ? 'border-gold-600 text-gold-500' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
          >
            History ({history.length})
          </button>
          <button onClick={saveChanges} disabled={saving || !dirty} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={renderPreview} disabled={rendering} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> {rendering ? progressLabel(renderProgress, 'Preview') : 'Preview'}
          </button>
          <button onClick={submitForReview} disabled={submitting} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5 ml-auto">
            <Send className="w-3.5 h-3.5" /> {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      )}

      {hasEdit && showHistory && (
        <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
          <h3 className="text-xs font-bold text-gray-300 mb-2">Edit History</h3>
          <ol className="space-y-1">
            {history.map((snap, i) => (
              <li key={i}>
                <button
                  onClick={() => jumpToHistory(i)}
                  className={`w-full text-left text-[11px] rounded px-2 py-1 transition-colors ${
                    i === historyIndex ? 'bg-gold-500/10 text-gold-500 font-semibold' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  }`}
                >
                  {i + 1}. {snap.label}{i === historyIndex ? ' (current)' : ''}
                </button>
              </li>
            ))}
          </ol>
          <p className="text-[10px] text-gray-600 mt-2">Click any step to jump straight to it — same as Undo/Redo, just not one step at a time.</p>
        </div>
      )}

      {/* ---------- review ---------- */}
      {job?.review_status && (
        <section className="mt-4 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-200 mb-2">👀 Review</h3>
          <div className="grid gap-2 sm:grid-cols-2 text-xs text-gray-500 mb-3">
            <p>Status: <span className="text-gray-200 font-semibold">{status.emoji} {status.label}</span></p>
            {job.submitted_by && <p>Submitted by: <span className="text-gray-300">{job.submitted_by}</span></p>}
            {job.submitted_at && <p>Submitted on: <span className="text-gray-300">{new Date(job.submitted_at).toLocaleString()}</span></p>}
            {job.reviewed_by && <p>Reviewer: <span className="text-gray-300">{job.reviewed_by}</span></p>}
          </div>

          {content.stage === 'Review' && (
            canReview ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button onClick={approveVideo} disabled={submitting} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button onClick={() => setShowFeedbackForm((s) => !s)} disabled={submitting} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5" /> Request Changes
                  </button>
                </div>
                {showFeedbackForm && (
                  <div className="rounded-lg border border-gray-800 p-3 space-y-2">
                    <label className="text-[11px] font-semibold text-gray-400">What needs to be changed?</label>
                    <textarea className="form-input text-xs" rows={3} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Please remove the first 3 seconds and change the opening text." />
                    <button onClick={sendFeedback} disabled={submitting || !feedbackText.trim()} className="btn-primary text-xs disabled:opacity-50">
                      Send Feedback
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-600">Waiting on a reviewer to approve or request changes.</p>
            )
          )}

          {history_.length > 0 && (
            <div className="mt-3 border-t border-gray-800 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Review History</p>
              <div className="space-y-1.5">
                {history_.map((h) => (
                  <div key={h.id} className="text-[11px]">
                    <span>{h.action === 'review-approved' ? '🟢 Approved' : h.action === 'review-changes-requested' ? '🔴 Changes Requested' : '🟠 Submitted'}</span>
                    {' '}<span className="text-gray-400">{h.actor}</span>
                    {' '}<span className="text-gray-600">{new Date(h.created_at).toLocaleString()}</span>
                    {h.action === 'review-changes-requested' && h.detail && <p className="text-gray-500 pl-4">Comment: "{h.detail}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ---------- publish ---------- */}
      {isApprovedOrBeyond && (
        <section className="mt-4 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-200 mb-2 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> Publish</h3>
          <p className="text-xs text-gray-500 mb-3">Status: <span className="text-gray-200 font-semibold">{status.emoji} {status.label}</span></p>

          {content.stage === 'Published' ? (
            <p className="text-xs text-gray-500">This piece has already been published.</p>
          ) : isScheduled && !editingSchedule ? (
            <div className="space-y-2 text-xs text-gray-400">
              <p>Platform: <span className="text-gray-200 font-semibold">{content.platform}</span></p>
              <p>Date/time: <span className="text-gray-200 font-semibold">{content.publish_date}</span></p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => navigate('/content-studio/calendar')} className="btn-secondary text-xs">View in Calendar</button>
                <button onClick={() => setEditingSchedule(true)} className="btn-secondary text-xs">Edit Schedule</button>
                <button onClick={cancelSchedule} disabled={scheduling} className="text-xs font-semibold text-rose-400 hover:underline disabled:opacity-50">Cancel Schedule</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-w-sm">
              <div>
                <label className="text-[10px] text-gray-600">Platform</label>
                <select className="form-input text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-600">Publish Date</label>
                  <input type="date" className="form-input text-xs" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600">Publish Time</label>
                  <input type="time" className="form-input text-xs" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={scheduleForPublishing} disabled={scheduling || !publishDate} className="btn-primary text-xs disabled:opacity-50">
                  {scheduling ? 'Scheduling…' : editingSchedule ? 'Save Schedule' : 'Schedule for Publishing'}
                </button>
                {editingSchedule && <button onClick={() => setEditingSchedule(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>}
              </div>
            </div>
          )}
        </section>
      )}
    </Page>
  )
}

function OverlayForm({
  form, setForm, onSubmit, submitLabel,
}: {
  form: Omit<Overlay, 'id' | 'kind'>
  setForm: (f: any) => void
  onSubmit: () => void
  submitLabel: string
}) {
  const toggleBtn = (active: boolean) =>
    `flex-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${active ? 'border-gold-600 bg-gold-500/20 text-gold-400' : 'border-gray-800 text-gray-500 hover:border-gray-700'}`

  return (
    <div className="mt-2 space-y-2">
      <div>
        <label className="text-[10px] text-gray-600">Text</label>
        <textarea className="form-input text-xs" rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Type your text here" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-600">Start (sec)</label>
          <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={form.start} onChange={(e) => setForm({ ...form, start: Number(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="text-[10px] text-gray-600">End (sec)</label>
          <input type="number" min="0" step="0.5" className="form-input py-1 text-xs" value={form.end} onChange={(e) => setForm({ ...form, end: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-600">Position</label>
        <div className="flex gap-1 mt-0.5">
          {(['top', 'center', 'bottom'] as CaptionPosition[]).map((p) => (
            <button key={p} onClick={() => setForm({ ...form, position: p })}
              className={`flex-1 rounded-md border px-2 py-1 text-[10px] font-semibold capitalize ${form.position === p ? 'border-gold-600 bg-gold-500/20 text-gold-400' : 'border-gray-800 text-gray-500 hover:border-gray-700'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-600">Size</label>
        <div className="flex gap-1 mt-0.5">
          {(['sm', 'md', 'lg'] as CaptionSize[]).map((s) => (
            <button key={s} onClick={() => setForm({ ...form, size: s })}
              className={`flex-1 rounded-md border px-2 py-1 text-[10px] font-semibold capitalize ${form.size === s ? 'border-gold-600 bg-gold-500/20 text-gold-400' : 'border-gray-800 text-gray-500 hover:border-gray-700'}`}>
              {s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-600">Style</label>
        <div className="flex gap-1 mt-0.5">
          <button type="button" onClick={() => setForm({ ...form, bold: !form.bold })} className={toggleBtn(!!form.bold)} style={{ fontWeight: 700 }}>B</button>
          <button type="button" onClick={() => setForm({ ...form, italic: !form.italic })} className={toggleBtn(!!form.italic)} style={{ fontStyle: 'italic' }}>I</button>
          <button type="button" onClick={() => setForm({ ...form, underline: !form.underline })} className={toggleBtn(!!form.underline)} style={{ textDecoration: 'underline' }}>U</button>
          <button type="button" onClick={() => setForm({ ...form, strikethrough: !form.strikethrough })} className={toggleBtn(!!form.strikethrough)} style={{ textDecoration: 'line-through' }}>S</button>
          <button type="button" onClick={() => setForm({ ...form, glow: !form.glow })} className={toggleBtn(!!form.glow)} style={{ textShadow: '0 0 4px currentColor' }}>Glow</button>
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-600">Entrance</label>
        <div className="grid grid-cols-2 gap-2 mt-0.5">
          <select
            className="form-input py-1 text-xs"
            value={form.animation ?? ''}
            onChange={(e) => setForm({ ...form, animation: (e.target.value || undefined) as Overlay['animation'] })}
          >
            <option value="">Instant (no animation)</option>
            <option value="slide-down">Slide down</option>
            <option value="slide-up">Slide up</option>
            <option value="fade">Fade</option>
            <option value="bounce">Bounce</option>
            <option value="shake">Shake</option>
            <option value="blur-in">Blur in</option>
          </select>
          <input
            type="number" min="0.1" max="3" step="0.1"
            className="form-input py-1 text-xs"
            placeholder="Duration (s)"
            value={form.animationDuration ?? ''}
            onChange={(e) => setForm({ ...form, animationDuration: e.target.value ? Number(e.target.value) : undefined })}
            disabled={!form.animation}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-600">Font</label>
          <select
            className="form-input py-1 text-xs"
            value={form.fontFamily ?? ''}
            onChange={(e) => setForm({ ...form, fontFamily: e.target.value || undefined })}
          >
            <option value="">Default</option>
            {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-600">Color</label>
          <input
            type="color"
            className="form-input py-0.5 px-1 h-[30px] w-full"
            value={form.color ?? '#ffffff'}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-600">Background</label>
          <input
            type="color"
            className="form-input py-0.5 px-1 h-[30px] w-full"
            value={form.backgroundColor ?? '#000000'}
            onChange={(e) => setForm({ ...form, backgroundColor: e.target.value })}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-600">Background opacity ({Math.round((form.backgroundOpacity ?? 0.6) * 100)}%)</label>
          <input
            type="range" min="0" max="1" step="0.05" className="w-full mt-2.5"
            value={form.backgroundOpacity ?? 0.6}
            onChange={(e) => setForm({ ...form, backgroundOpacity: Number(e.target.value) })}
          />
        </div>
      </div>
      <button onClick={onSubmit} disabled={!form.text.trim()} className="btn-primary text-xs w-full disabled:opacity-50">
        {submitLabel}
      </button>
    </div>
  )
}
