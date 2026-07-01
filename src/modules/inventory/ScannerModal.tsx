import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, Check, RefreshCw, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { InventoryItem } from '../../types'

// ─── Grid config ──────────────────────────────────────────────────────────────
// Fixed 3 cols × 4 rows = 12 cells covers all variants:
//   1T → 1 cell   4T → 4 cells   6T → 6 cells   8T → 8 cells
const GRID_COLS = 3
const GRID_ROWS = 4

// ─── Otsu threshold ────────────────────────────────────────────────────────────
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]
  let sumB = 0, wB = 0, maxVar = 0, thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const v = wB * wF * (mB - mF) ** 2
    if (v > maxVar) { maxVar = v; thresh = t }
  }
  return thresh
}

// ─── Grid analysis ─────────────────────────────────────────────────────────────
// Returns which cells are "active" (contain a dark icon) and the touch count.
function analyzeGrid(
  canvas: HTMLCanvasElement,
  gx: number, gy: number, size: number
): { activeCells: boolean[][]; touchCount: number; confidence: number } {
  const empty = { activeCells: Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(false)), touchCount: 0, confidence: 0 }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty

  const imageData = ctx.getImageData(gx, gy, size, size)
  const { data, width, height } = imageData

  // Grayscale
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
  }

  const thresh = otsuThreshold(gray)

  const cellW = Math.floor(width / GRID_COLS)
  const cellH = Math.floor(height / GRID_ROWS)

  // For each cell, compute fraction of dark pixels
  const cellDark: number[][] = []
  for (let row = 0; row < GRID_ROWS; row++) {
    cellDark.push([])
    for (let col = 0; col < GRID_COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH
      const x1 = x0 + cellW, y1 = y0 + cellH
      let dark = 0, total = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (gray[y * width + x] < thresh) dark++
          total++
        }
      }
      cellDark[row].push(dark / total)
    }
  }

  // Find the max dark fraction across all cells — use it to set a relative threshold
  let maxDark = 0
  for (const row of cellDark) for (const v of row) if (v > maxDark) maxDark = v

  // A cell is "active" if it has > 20% of the darkest cell's darkness
  // AND > 1.5% dark pixels in absolute terms (to ignore empty panels)
  const ACTIVE_THRESH = Math.max(0.015, maxDark * 0.20)
  const activeCells: boolean[][] = cellDark.map(row => row.map(v => v >= ACTIVE_THRESH))

  const activeCount = activeCells.flat().filter(Boolean).length

  const VALID = [1, 4, 6, 8]
  if (activeCount === 0 || maxDark < 0.01) return empty

  const closest = VALID.reduce((a, b) => Math.abs(b - activeCount) < Math.abs(a - activeCount) ? b : a)
  const diff = Math.abs(closest - activeCount)
  const confidence = diff === 0 ? 90 : diff === 1 ? 70 : diff === 2 ? 45 : 20

  return { activeCells, touchCount: closest, confidence }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function touchLabel(count: number) { return `Elysia ${count} Touch` }
function touchModuleKey(count: number) { return `${count}T` }

// ─── Component ────────────────────────────────────────────────────────────────

interface ScannerModalProps {
  items: InventoryItem[]
  onConfirm: (item: InventoryItem, action: 'import' | 'issue') => void
  onClose: () => void
}

type Phase = 'scanning' | 'locked' | 'no_camera'

interface DetectionState {
  activeCells: boolean[][]
  touchCount: number
  confidence: number
  activeCount: number
}

export function ScannerModal({ items, onConfirm, onClose }: ScannerModalProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stableRef   = useRef<{ count: number; since: number } | null>(null)

  const [phase, setPhase]             = useState<Phase>('scanning')
  const [detection, setDetection]     = useState<DetectionState | null>(null)
  const [locked, setLocked]           = useState<{ touchCount: number } | null>(null)
  const [matchedItems, setMatchedItems] = useState<InventoryItem[]>([])
  const [cameraError, setCameraError] = useState('')

  // ── Camera ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } } })
      .then(async s => {
        stream = s
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() }
        const track = s.getVideoTracks()[0]
        if (track) {
          try { await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }) } catch { /* no torch */ }
        }
      })
      .catch(err => { setCameraError(err.message || 'Camera access denied'); setPhase('no_camera') })
    return () => { stream?.getTracks().forEach(t => t.stop()); if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // ── Analysis loop ──────────────────────────────────────────────────────────
  const runAnalysis = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 480
    canvas.width = vw; canvas.height = vh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(video, 0, 0, vw, vh)

    const size = Math.floor(Math.min(vw, vh) * 0.55)
    const gx   = Math.floor((vw - size) / 2)
    const gy   = Math.floor((vh - size) / 2)

    const result = analyzeGrid(canvas, gx, gy, size)
    const activeCount = result.activeCells.flat().filter(Boolean).length
    setDetection({ ...result, activeCount })

    if (result.touchCount > 0 && result.confidence >= 60) {
      const now = Date.now()
      if (stableRef.current?.count === result.touchCount && now - stableRef.current.since >= 1500) {
        const moduleKey = touchModuleKey(result.touchCount)
        const matches = items.filter(it => (it.productLine ?? 'elysia') === 'elysia' && it.category === moduleKey)
        setLocked({ touchCount: result.touchCount })
        setMatchedItems(matches)
        setPhase('locked')
        if (intervalRef.current) clearInterval(intervalRef.current)
      } else if (!stableRef.current || stableRef.current.count !== result.touchCount) {
        stableRef.current = { count: result.touchCount, since: now }
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
    setLocked(null); setDetection(null); setMatchedItems([])
    setPhase('scanning')
  }

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
          </div>

        ) : phase === 'locked' && locked ? (
          <div className="p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-xl font-bold text-gray-100">{touchLabel(locked.touchCount)}</p>
              <p className="text-sm text-gray-500">{matchedItems.length} variant{matchedItems.length !== 1 ? 's' : ''} in inventory</p>
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
                      <button onClick={() => { onConfirm(item, 'import'); onClose() }}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-green-900/40 text-green-400 hover:bg-green-900/60 transition-colors font-medium">
                        Stock In
                      </button>
                      <button onClick={() => { onConfirm(item, 'issue'); onClose() }}
                        disabled={item.closingStock <= 0}
                        className={cn('text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors',
                          item.closingStock > 0 ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60' : 'bg-gray-800 text-gray-600 cursor-not-allowed')}>
                        Issue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={resetScan}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors border border-gray-700 rounded-xl hover:border-gray-500">
              <RefreshCw className="w-4 h-4" /> Scan again
            </button>
          </div>

        ) : (
          // ── Live scanning ──────────────────────────────────────────────────
          <div className="relative">
            {/* Camera feed */}
            <div className="relative bg-black aspect-video overflow-hidden">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

              {/* Grid overlay — drawn in CSS, purely visual guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Dark surround */}
                <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.40)' }} />

                {/* Grid container — 55% of shorter dimension, matching analysis box */}
                <div className="relative z-10" style={{ width: '55%', paddingTop: '55%' }}>
                  <div className="absolute inset-0 rounded-xl overflow-hidden border-2"
                    style={{ borderColor: detection?.confidence && detection.confidence >= 60 ? '#22c55e' : '#C9A840' }}>

                    {/* Grid cells */}
                    <div className="absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}>
                      {Array.from({ length: GRID_ROWS }, (_, row) =>
                        Array.from({ length: GRID_COLS }, (_, col) => {
                          const active = detection?.activeCells[row]?.[col] ?? false
                          return (
                            <div
                              key={`${row}-${col}`}
                              className="border transition-colors duration-150"
                              style={{
                                borderColor: 'rgba(255,255,255,0.15)',
                                background: active ? 'rgba(250,204,21,0.45)' : 'transparent',
                              }}
                            />
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Result badge */}
              {detection && detection.touchCount > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                  <div className={cn(
                    'px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-sm border transition-all',
                    detection.confidence >= 60 ? 'bg-green-900/80 border-green-600/50 text-green-300' : 'bg-gray-900/80 border-gray-600/50 text-gray-300'
                  )}>
                    {touchLabel(detection.touchCount)}
                    <span className="ml-2 text-xs opacity-60">{detection.confidence}%</span>
                  </div>
                </div>
              )}

              {/* Stability bar */}
              {detection && detection.touchCount > 0 && detection.confidence >= 60 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-32">
                  <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ animation: 'stabilize 1.5s linear forwards' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Hidden processing canvas */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Instructions + debug */}
            <div className="px-5 py-4 space-y-1 text-center">
              <p className="text-sm text-gray-300 font-medium">Align switch icons to the grid cells</p>
              <p className="text-xs text-gray-600">Yellow cells = detected icon · locks after 1.5s</p>
              {detection && (
                <p className="text-xs text-gray-700 font-mono">
                  {detection.activeCount} cells active → {detection.touchCount > 0 ? `${detection.touchCount}T` : '–'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes stabilize { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  )
}
