import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, Check, RefreshCw, Zap } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/utils'
import type { InventoryItem } from '../../types'

// ─── CV Engine ────────────────────────────────────────────────────────────────
// Projects dark pixels onto X and Y axes, counts peaks in each projection,
// then multiplies: colPeaks × rowPeaks = icon count.
// This avoids blob-clustering distance tuning entirely.

function countPeaks(proj: Float32Array, minGapFraction: number): number {
  const len = proj.length
  if (len === 0) return 0

  // Normalise so max = 1
  const maxVal = Math.max(...proj)
  if (maxVal === 0) return 0
  const norm = proj.map(v => v / maxVal)

  // Threshold: only count columns/rows with >20% of the peak dark density
  const THRESH = 0.20
  // Minimum gap between peaks (in samples)
  const minGap = Math.max(2, Math.round(len * minGapFraction))

  let peaks = 0
  let inRegion = false
  let regionStart = 0

  for (let i = 0; i <= len; i++) {
    const active = i < len && norm[i] > THRESH
    if (active && !inRegion) {
      inRegion = true
      regionStart = i
    } else if (!active && inRegion) {
      inRegion = false
      const regionLen = i - regionStart
      // Only count as a peak if the region is wide enough (not a tiny noise spike)
      if (regionLen >= Math.max(1, Math.round(len * 0.04))) {
        peaks++
      }
    }
  }
  return peaks
}

function analyzeFrame(
  canvas: HTMLCanvasElement,
  guideBox: { x: number; y: number; w: number; h: number }
): { touchCount: number; confidence: number; rawBlobs: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { touchCount: 0, confidence: 0, rawBlobs: 0 }

  const { x, y, w, h } = guideBox
  const imageData = ctx.getImageData(x, y, w, h)
  const { data, width, height } = imageData

  // ── Grayscale ─────────────────────────────────────────────────────────────
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    )
  }

  // ── Background brightness from outer 10% border ────────────────────────
  const border = Math.floor(Math.min(width, height) * 0.10)
  let edgeSum = 0, edgeCount = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (row < border || row >= height - border || col < border || col >= width - border) {
        edgeSum += gray[row * width + col]
        edgeCount++
      }
    }
  }
  const bgBrightness = edgeCount > 0 ? edgeSum / edgeCount : 200
  const darkThreshold = bgBrightness * 0.60

  // ── Build binary dark map (ignore outer border to avoid frame artifacts) ─
  const innerX0 = border, innerX1 = width - border
  const innerY0 = border, innerY1 = height - border

  let totalDark = 0

  // ── X projection: dark pixel count per column ─────────────────────────
  const xProj = new Float32Array(width)
  // ── Y projection: dark pixel count per row ────────────────────────────
  const yProj = new Float32Array(height)

  for (let row = innerY0; row < innerY1; row++) {
    for (let col = innerX0; col < innerX1; col++) {
      if (gray[row * width + col] < darkThreshold) {
        xProj[col]++
        yProj[row]++
        totalDark++
      }
    }
  }

  // If too few or too many dark pixels → not a panel
  const darkFrac = totalDark / ((innerX1 - innerX0) * (innerY1 - innerY0))
  if (darkFrac < 0.005 || darkFrac > 0.60) {
    return { touchCount: 0, confidence: 0, rawBlobs: 0 }
  }

  // Crop projections to inner region
  const xProjInner = xProj.slice(innerX0, innerX1)
  const yProjInner = yProj.slice(innerY0, innerY1)

  // ── Count peaks in each axis ──────────────────────────────────────────
  const xPeaks = countPeaks(xProjInner, 0.08) // min 8% width gap between icon columns
  const yPeaks = countPeaks(yProjInner, 0.08)

  const rawCount = xPeaks * yPeaks

  // ── Map to nearest valid Elysia count (2T / 3T not yet supported) ────
  const VALID = [1, 4, 6, 8]
  if (rawCount === 0) return { touchCount: 0, confidence: 0, rawBlobs: 0 }

  const closest = VALID.reduce((a, b) =>
    Math.abs(b - rawCount) < Math.abs(a - rawCount) ? b : a
  )

  const diff = Math.abs(closest - rawCount)
  const confidence = diff === 0 ? 90 : diff <= 1 ? 65 : diff <= 2 ? 40 : 15

  return { touchCount: closest, confidence, rawBlobs: rawCount }
}

// ─── Label helpers ────────────────────────────────────────────────────────────

function touchLabel(count: number) {
  return `Elysia ${count} Touch`
}

function touchModuleKey(count: number) {
  return `${count}T`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ScannerModalProps {
  items: InventoryItem[]
  onConfirm: (item: InventoryItem, action: 'import' | 'issue') => void
  onClose: () => void
}

type Phase = 'scanning' | 'locked' | 'no_camera'

export function ScannerModal({ items, onConfirm, onClose }: ScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stableRef = useRef<{ count: number; since: number } | null>(null)

  const [phase, setPhase] = useState<Phase>('scanning')
  const [result, setResult] = useState<{ touchCount: number; confidence: number; rawBlobs: number } | null>(null)
  const [locked, setLocked] = useState<{ touchCount: number } | null>(null)
  const [matchedItems, setMatchedItems] = useState<InventoryItem[]>([])
  const [cameraError, setCameraError] = useState('')

  // ── Start camera ────────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } } })
      .then(async s => {
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play()
        }
        // Enable torch/flash if supported (mobile back camera)
        const track = s.getVideoTracks()[0]
        if (track) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
          } catch {
            // Torch not supported on this device — silently ignore
          }
        }
      })
      .catch(err => {
        setCameraError(err.message || 'Camera access denied')
        setPhase('no_camera')
      })

    return () => {
      stream?.getTracks().forEach(t => t.stop())
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // ── Analysis loop ───────────────────────────────────────────────────────────
  const runAnalysis = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 480
    canvas.width = vw
    canvas.height = vh

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(video, 0, 0, vw, vh)

    // Guide box: centred square, 45% of the shorter dimension
    const size = Math.floor(Math.min(vw, vh) * 0.45)
    const gx = Math.floor((vw - size) / 2)
    const gy = Math.floor((vh - size) / 2)

    const detection = analyzeFrame(canvas, { x: gx, y: gy, w: size, h: size })
    setResult(detection)

    if (detection.touchCount > 0 && detection.confidence >= 60) {
      const now = Date.now()
      if (
        stableRef.current &&
        stableRef.current.count === detection.touchCount &&
        now - stableRef.current.since >= 1500
      ) {
        // Stable for 1.5s → lock result
        const moduleKey = touchModuleKey(detection.touchCount)
        const matches = items.filter(
          it =>
            (it.productLine ?? 'elysia') === 'elysia' &&
            it.category === moduleKey
        )
        setLocked({ touchCount: detection.touchCount })
        setMatchedItems(matches)
        setPhase('locked')
        if (intervalRef.current) clearInterval(intervalRef.current)
      } else if (!stableRef.current || stableRef.current.count !== detection.touchCount) {
        stableRef.current = { count: detection.touchCount, since: now }
      }
    } else {
      stableRef.current = null
    }
  }, [items])

  useEffect(() => {
    if (phase !== 'scanning') return
    intervalRef.current = setInterval(runAnalysis, 250)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [phase, runAnalysis])

  const resetScan = () => {
    stableRef.current = null
    setLocked(null)
    setResult(null)
    setMatchedItems([])
    setPhase('scanning')
  }

  // ── Guide box dimensions for the overlay (in %) ────────────────────────────
  const guidePercent = 45 // matches the analysis box above

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="glass-card w-full max-w-lg rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-gold-400" />
            <h2 className="text-sm font-semibold text-gray-100">Elysia Switch Scanner</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'no_camera' ? (
          <div className="p-8 text-center space-y-3">
            <Camera className="w-10 h-10 text-gray-600 mx-auto" />
            <p className="text-sm font-medium text-gray-300">Camera not accessible</p>
            <p className="text-xs text-gray-500">{cameraError || 'Allow camera permission and try again'}</p>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        ) : phase === 'locked' && locked ? (
          // ── Locked result ────────────────────────────────────────────────────
          <div className="p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-xl font-bold text-gray-100">{touchLabel(locked.touchCount)}</p>
              <p className="text-sm text-gray-500">
                {matchedItems.length} variant{matchedItems.length !== 1 ? 's' : ''} in inventory
              </p>
            </div>

            {matchedItems.length === 0 ? (
              <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl p-4 text-center">
                <p className="text-sm text-yellow-400 font-medium">No inventory items found</p>
                <p className="text-xs text-yellow-700 mt-1">Add {touchLabel(locked.touchCount)} items first</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {matchedItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/50 border border-gray-700/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">{item.itemName}</p>
                      <p className="text-xs text-gray-500">{item.itemCode} · Stock: <span className={cn(
                        'font-semibold',
                        item.closingStock <= 0 ? 'text-red-400' : item.closingStock <= item.reorderLevel ? 'text-yellow-400' : 'text-green-400'
                      )}>{item.closingStock}</span></p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => { onConfirm(item, 'import'); onClose() }}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-green-900/40 text-green-400 hover:bg-green-900/60 transition-colors font-medium"
                      >
                        Stock In
                      </button>
                      <button
                        onClick={() => { onConfirm(item, 'issue'); onClose() }}
                        disabled={item.closingStock <= 0}
                        className={cn(
                          'text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors',
                          item.closingStock > 0
                            ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60'
                            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        )}
                      >
                        Issue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={resetScan}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors border border-gray-700 rounded-xl hover:border-gray-500"
            >
              <RefreshCw className="w-4 h-4" />
              Scan again
            </button>
          </div>
        ) : (
          // ── Live scanning ─────────────────────────────────────────────────────
          <div className="relative">
            {/* Camera feed */}
            <div className="relative bg-black aspect-video overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />

              {/* Guide overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Dark surround */}
                <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />

                {/* Guide box cutout (visual only) */}
                <div
                  className="relative z-10 border-2 rounded-xl"
                  style={{
                    width: `${guidePercent}%`,
                    paddingTop: `${guidePercent}%`,
                    borderColor: result && result.touchCount > 0 && result.confidence >= 60
                      ? '#22c55e'
                      : '#C9A840',
                    boxShadow: result && result.touchCount > 0 && result.confidence >= 60
                      ? '0 0 0 2px #22c55e44'
                      : '0 0 0 2px #C9A84044',
                    transition: 'border-color 0.3s, box-shadow 0.3s',
                  }}
                >
                  {/* Corner accents */}
                  {[
                    'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                    'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                    'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                  ].map((cls, i) => (
                    <div
                      key={i}
                      className={`absolute w-4 h-4 ${cls}`}
                      style={{ borderColor: 'inherit', margin: '-2px' }}
                    />
                  ))}
                </div>
              </div>

              {/* Live result badge */}
              {result && result.touchCount > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                  <div className={cn(
                    'px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-sm border transition-all',
                    result.confidence >= 60
                      ? 'bg-green-900/80 border-green-600/50 text-green-300'
                      : 'bg-gray-900/80 border-gray-600/50 text-gray-300'
                  )}>
                    {touchLabel(result.touchCount)}
                    <span className="ml-2 text-xs opacity-60">{result.confidence}%</span>
                  </div>
                </div>
              )}

              {/* Stability bar */}
              {result && result.touchCount > 0 && result.confidence >= 60 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-32">
                  <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-300"
                      style={{ width: '100%', animation: 'stabilize 1.5s linear forwards' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Hidden canvas for processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Instructions */}
            <div className="px-5 py-4 space-y-1 text-center">
              <p className="text-sm text-gray-300 font-medium">
                Hold the Elysia switch face-up inside the box
              </p>
              <p className="text-xs text-gray-600">
                Detection locks automatically when stable for 1.5s
              </p>
              {result && result.rawBlobs > 0 && (
                <p className="text-xs text-gray-700">
                  raw grid: {result.rawBlobs} icons
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes stabilize {
          from { width: 0% }
          to { width: 100% }
        }
      `}</style>
    </div>
  )
}
