import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, Check, RefreshCw, Zap, Circle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { InventoryItem } from '../../types'

// ─── Grid config ──────────────────────────────────────────────────────────────
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
function analyzeGrid(
  canvas: HTMLCanvasElement,
  gx: number, gy: number, size: number
): { activeCells: boolean[][]; touchCount: number; confidence: number; activeCount: number } {
  const empty = { activeCells: Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(false)), touchCount: 0, confidence: 0, activeCount: 0 }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty

  const imageData = ctx.getImageData(gx, gy, size, size)
  const { data, width, height } = imageData

  const gray = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
  }

  const thresh = otsuThreshold(gray)
  const cellW = Math.floor(width / GRID_COLS)
  const cellH = Math.floor(height / GRID_ROWS)

  const cellDark: number[][] = []
  for (let row = 0; row < GRID_ROWS; row++) {
    cellDark.push([])
    for (let col = 0; col < GRID_COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH
      let dark = 0, total = 0
      for (let y = y0; y < y0 + cellH; y++) {
        for (let x = x0; x < x0 + cellW; x++) {
          if (gray[y * width + x] < thresh) dark++
          total++
        }
      }
      cellDark[row].push(dark / total)
    }
  }

  let maxDark = 0
  for (const row of cellDark) for (const v of row) if (v > maxDark) maxDark = v

  const ACTIVE_THRESH = Math.max(0.015, maxDark * 0.20)
  const activeCells: boolean[][] = cellDark.map(row => row.map(v => v >= ACTIVE_THRESH))
  const activeCount = activeCells.flat().filter(Boolean).length

  const VALID = [1, 4, 6, 8]
  if (activeCount === 0 || maxDark < 0.01) return empty

  const closest = VALID.reduce((a, b) => Math.abs(b - activeCount) < Math.abs(a - activeCount) ? b : a)
  const diff = Math.abs(closest - activeCount)
  const confidence = diff === 0 ? 90 : diff === 1 ? 70 : diff === 2 ? 45 : 20

  return { activeCells, touchCount: closest, confidence, activeCount }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function touchLabel(count: number) { return `Elysia ${count} Touch` }
function touchModuleKey(count: number) { return `${count}T` }

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScannerModalProps {
  items: InventoryItem[]
  onConfirm: (item: InventoryItem, action: 'import' | 'issue') => void
  onClose: () => void
}

type Phase = 'preview' | 'result' | 'no_camera'

interface AnalysisResult {
  activeCells: boolean[][]
  touchCount: number
  confidence: number
  activeCount: number
  snapshot: string // data URL of the captured frame
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ScannerModal({ items, onConfirm, onClose }: ScannerModalProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [phase, setPhase]       = useState<Phase>('preview')
  const [result, setResult]     = useState<AnalysisResult | null>(null)
  const [matchedItems, setMatchedItems] = useState<InventoryItem[]>([])
  const [cameraError, setCameraError]   = useState('')
  const [capturing, setCapturing]       = useState(false)

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
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  // ── Capture & analyse ──────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    setCapturing(true)

    // Short flash effect then capture
    setTimeout(() => {
      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      canvas.width = vw; canvas.height = vh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) { setCapturing(false); return }
      ctx.drawImage(video, 0, 0, vw, vh)

      const size = Math.floor(Math.min(vw, vh) * 0.75)
      const gx   = Math.floor((vw - size) / 2)
      const gy   = Math.floor((vh - size) / 2)

      const analysis = analyzeGrid(canvas, gx, gy, size)
      const snapshot = canvas.toDataURL('image/jpeg', 0.85)

      if (analysis.touchCount > 0) {
        const moduleKey = touchModuleKey(analysis.touchCount)
        const matches = items.filter(it => (it.productLine ?? 'elysia') === 'elysia' && it.category === moduleKey)
        setMatchedItems(matches)
      }

      setResult({ ...analysis, snapshot })
      setPhase('result')
      setCapturing(false)
    }, 80)
  }, [items])

  const retake = () => { setResult(null); setMatchedItems([]); setPhase('preview') }

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

        {/* ── No camera ── */}
        {phase === 'no_camera' && (
          <div className="p-8 text-center space-y-3">
            <Camera className="w-10 h-10 text-gray-600 mx-auto" />
            <p className="text-sm font-medium text-gray-300">Camera not accessible</p>
            <p className="text-xs text-gray-500">{cameraError || 'Allow camera permission and try again'}</p>
          </div>
        )}

        {/* ── Preview — live camera + capture button ── */}
        {phase === 'preview' && (
          <div>
            <div className="relative bg-black aspect-video overflow-hidden">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

              {/* Flash overlay */}
              {capturing && <div className="absolute inset-0 bg-white opacity-60 z-30" />}

              {/* Guide box */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} />
                <div className="relative z-10 border-2 border-gold-400 rounded-xl"
                  style={{ width: '75%', paddingTop: '75%' }}>
                  {/* Corner accents */}
                  {['top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                    'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                    'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg'].map((cls, i) => (
                    <div key={i} className={`absolute w-5 h-5 border-gold-400 ${cls}`} style={{ borderColor: 'inherit', margin: '-2px' }} />
                  ))}
                  {/* Grid lines inside guide box */}
                  <div className="absolute inset-0 rounded-xl overflow-hidden grid"
                    style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}>
                    {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => (
                      <div key={i} className="border" style={{ borderColor: 'rgba(201,168,64,0.3)' }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5 flex flex-col items-center gap-3">
              <p className="text-sm text-gray-400 text-center">Fill the box with the switch face, then tap capture</p>
              <button
                onClick={capture}
                disabled={capturing}
                className="w-16 h-16 rounded-full border-4 border-gold-400 flex items-center justify-center hover:bg-gold-400/10 active:scale-95 transition-all disabled:opacity-50"
              >
                <Circle className="w-8 h-8 text-gold-400 fill-gold-400" />
              </button>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* ── Result — frozen photo + grid overlay ── */}
        {phase === 'result' && result && (
          <div>
            <div className="relative bg-black aspect-video overflow-hidden">
              {/* Snapshot image */}
              <img src={result.snapshot} className="w-full h-full object-cover" alt="captured" />

              {/* Grid overlay on captured photo */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.25)' }} />
                <div className="relative z-10 border-2 rounded-xl overflow-hidden"
                  style={{
                    width: '75%', paddingTop: '75%',
                    borderColor: result.confidence >= 60 ? '#22c55e' : '#ef4444'
                  }}>
                  <div className="absolute inset-0 grid"
                    style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}>
                    {Array.from({ length: GRID_ROWS }, (_, row) =>
                      Array.from({ length: GRID_COLS }, (_, col) => {
                        const active = result.activeCells[row]?.[col] ?? false
                        return (
                          <div key={`${row}-${col}`} className="border transition-colors"
                            style={{
                              borderColor: 'rgba(255,255,255,0.2)',
                              background: active ? 'rgba(250,204,21,0.50)' : 'transparent',
                            }} />
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Result badge */}
              {result.touchCount > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                  <div className={cn(
                    'px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-sm border',
                    result.confidence >= 60 ? 'bg-green-900/80 border-green-600/50 text-green-300' : 'bg-red-900/80 border-red-600/50 text-red-300'
                  )}>
                    {touchLabel(result.touchCount)}
                    <span className="ml-2 text-xs opacity-60">{result.activeCount} cells · {result.confidence}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Matched items or retry */}
            <div className="p-4 space-y-3">
              {result.touchCount === 0 ? (
                <div className="text-center py-3">
                  <p className="text-sm text-red-400 font-medium">Could not detect switch type</p>
                  <p className="text-xs text-gray-600 mt-1">Make sure the switch fills the box clearly</p>
                </div>
              ) : matchedItems.length === 0 ? (
                <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl p-3 text-center">
                  <p className="text-sm text-yellow-400 font-medium">No {touchLabel(result.touchCount)} items in inventory</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto">
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
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-green-900/40 text-green-400 hover:bg-green-900/60 font-medium">
                          Stock In
                        </button>
                        <button onClick={() => { onConfirm(item, 'issue'); onClose() }}
                          disabled={item.closingStock <= 0}
                          className={cn('text-xs px-2.5 py-1.5 rounded-lg font-medium',
                            item.closingStock > 0 ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60' : 'bg-gray-800 text-gray-600 cursor-not-allowed')}>
                          Issue
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={retake}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-xl hover:border-gray-500 transition-colors">
                <RefreshCw className="w-4 h-4" /> Retake
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
