import { useState, useRef, useCallback, useEffect } from 'react'
import { MousePointer2, PenLine, Trash2, Check, X, Search, Sparkles, ZoomIn, ZoomOut, Package } from 'lucide-react'
import { getZoneSuggestions } from '../../../lib/zoneRules'
import { formatCurrency } from '../../../lib/utils'

// ── Zone colour palette ────────────────────────────────────────────────────────
const FILLS   = ['rgba(99,102,241,0.18)','rgba(212,175,55,0.18)','rgba(107,203,119,0.18)','rgba(255,107,107,0.18)','rgba(196,144,228,0.18)','rgba(255,159,67,0.18)','rgba(20,184,166,0.18)','rgba(244,63,94,0.18)']
const STROKES = ['#818CF8','#D4AF37','#6BCB77','#FF6B6B','#C490E4','#FF9F43','#14B8A6','#F43F5E']

const centroid = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
})
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

function toSVGPct(e: React.MouseEvent | MouseEvent, el: SVGSVGElement) {
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width)  * 100)),
    y: Math.max(0, Math.min(100, ((e.clientY - r.top)  / r.height) * 100)),
  }
}

function pointInPolygon(px: number, py: number, polygon: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

export interface FPDevice { id: string; productId: string; qty: number; x: number; y: number; zoneId: string }
export interface FPZone { id: string; name: string; fill: string; stroke: string; points: { x: number; y: number }[]; devices: FPDevice[] }

interface CRMProduct { id: string; partCode?: string; name: string; category: string; gsp: number; isActive?: boolean; imageUrl?: string; image?: string }

interface Props {
  floorPlanData: string
  zones: FPZone[]
  onZonesChange: (zones: FPZone[]) => void
  products: CRMProduct[]
}

// ── Category sidebar labels ────────────────────────────────────────────────────
const CAT_LABELS: Record<string, string> = {
  ELYSIA_SWITCHES: 'Elysia Switches', VITRUM_SWITCHES: 'Vitrum Switches',
  IR_CONTROLLERS: 'IR Controllers', SENSORS: 'Sensors', VDP: 'Video Door Phone',
  CURTAINS: 'Curtains', LOCKS: 'Smart Locks', LCD_PANELS: 'LCD Panels', NETWORKING: 'Networking',
}

function ProductSidebar({ products }: { products: CRMProduct[] }) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const filtered = products.filter(p => p.isActive !== false &&
    (p.name.toLowerCase().includes(search.toLowerCase()) || (p.partCode || p.id).toLowerCase().includes(search.toLowerCase()))
  )
  const byCategory: Record<string, CRMProduct[]> = {}
  filtered.forEach(p => { if (!byCategory[p.category]) byCategory[p.category] = []; byCategory[p.category].push(p) })

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
      <div className="px-3 py-3 shrink-0 border-b border-gray-800">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2">Products</p>
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-gray-800 border border-gray-700">
          <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none" />
        </div>
        <p className="text-[10px] mt-2 text-gray-600">Drag & drop onto the floor plan</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {Object.entries(byCategory).map(([cat, prods]) => {
          const isOpen = !collapsed[cat]
          return (
            <div key={cat}>
              <button onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-indigo-900/20 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">{CAT_LABELS[cat] || cat}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-900/40 text-indigo-400 font-bold">{prods.length}</span>
              </button>
              {isOpen && prods.map(product => {
                const imgSrc = product.imageUrl || (product as any).image || '/images/placeholder.png'
                return (
                  <div key={product.id} draggable
                    onDragStart={e => { e.dataTransfer.setData('productId', product.id); e.dataTransfer.effectAllowed = 'copy' }}
                    className="flex items-center gap-2 px-2 py-2 rounded-xl mb-1 cursor-grab active:cursor-grabbing select-none bg-gray-800/60 border border-gray-800 hover:border-indigo-700/50 transition-colors">
                    <img src={imgSrc} alt={product.name} draggable={false}
                      className="w-8 h-8 object-contain rounded-lg bg-white/5 shrink-0 p-0.5"
                      onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-gray-200 leading-tight truncate">{product.name}</p>
                      <p className="text-[10px] text-indigo-400 mt-0.5">{formatCurrency(product.gsp)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8">
            <Package className="w-8 h-8 mx-auto mb-2 text-gray-700" />
            <p className="text-xs text-gray-600">No products found</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Zone summary popup ─────────────────────────────────────────────────────────
function ZoneSummary({ zone, products, onUpdateDevice, onDeleteDevice, onClose }: {
  zone: FPZone; products: CRMProduct[]
  onUpdateDevice: (id: string, qty: number) => void
  onDeleteDevice: (id: string) => void
  onClose: () => void
}) {
  const devices = zone.devices || []
  const total = devices.reduce((s, d) => {
    const p = products.find(x => x.id === d.productId)
    return s + (p ? p.gsp * d.qty : 0)
  }, 0)
  return (
    <div className="absolute top-4 left-4 z-30 w-64 rounded-2xl overflow-hidden shadow-2xl"
      style={{ background: '#111827', border: `2px solid ${zone.stroke}` }}>
      <div className="flex items-center justify-between px-3 py-2.5"
        style={{ background: `${zone.stroke}18`, borderBottom: `1px solid ${zone.stroke}44` }}>
        <div>
          <p className="text-sm font-bold" style={{ color: zone.stroke }}>{zone.name}</p>
          {total > 0 && <p className="text-xs font-semibold text-gray-400">{formatCurrency(total)}</p>}
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 max-h-60 overflow-y-auto space-y-1.5">
        {devices.length === 0 && <p className="text-xs text-center py-4 text-gray-600">Drag products from sidebar onto this zone</p>}
        {devices.map(device => {
          const p = products.find(x => x.id === device.productId)
          if (!p) return null
          return (
            <div key={device.id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-gray-800 border border-gray-700">
              <img src={p.imageUrl || (p as any).image || '/images/placeholder.png'} alt={p.name}
                className="w-6 h-6 object-contain rounded shrink-0"
                onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />
              <span className="flex-1 text-[11px] font-medium text-gray-200 truncate">{p.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onUpdateDevice(device.id, Math.max(1, device.qty - 1))}
                  className="w-5 h-5 rounded flex items-center justify-center text-xs bg-gray-700 text-gray-400 border border-gray-600">−</button>
                <span className="w-4 text-center text-xs font-bold" style={{ color: zone.stroke }}>{device.qty}</span>
                <button onClick={() => onUpdateDevice(device.id, device.qty + 1)}
                  className="w-5 h-5 rounded flex items-center justify-center text-xs text-white" style={{ background: zone.stroke + 'cc' }}>+</button>
                <button onClick={() => onDeleteDevice(device.id)} className="w-5 h-5 rounded flex items-center justify-center ml-0.5 text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Editor ────────────────────────────────────────────────────────────────
export function FloorPlanEditor({ floorPlanData, zones, onZonesChange, products }: Props) {
  const [mode, setMode]           = useState<'select' | 'draw'>('select')
  const [drawing, setDrawing]     = useState<{ x: number; y: number }[]>([])
  const [hoverPt, setHoverPt]     = useState<{ x: number; y: number } | null>(null)
  const [naming, setNaming]       = useState<{ x: number; y: number }[] | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [selectedZoneId, setSelectedZoneId]   = useState<string | null>(null)
  const [draggingDeviceId, setDraggingDeviceId]   = useState<string | null>(null)
  const [draggingDevicePos, setDraggingDevicePos] = useState<{ x: number; y: number } | null>(null)
  const [dragOverZoneId, setDragOverZoneId]   = useState<string | null>(null)
  const [pendingSuggestion, setPendingSuggestion] = useState<{ pendingZone: FPZone; rule: ReturnType<typeof getZoneSuggestions>[0] } | null>(null)
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Record<string, boolean>>({})
  const [imgScale, setImgScale]   = useState(1.0)
  const svgRef = useRef<SVGSVGElement>(null)

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'draw' || !svgRef.current) return
    const pt = toSVGPct(e, svgRef.current)
    if (drawing.length >= 3 && dist(pt, drawing[0]) < 1.5) {
      setNaming(drawing); setDrawing([]); setHoverPt(null)
      setNameInput(`Zone ${zones.length + 1}`)
      return
    }
    setDrawing(prev => [...prev, pt])
  }, [mode, drawing, zones.length])

  const handleSvgDblClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'draw') return
    e.preventDefault()
    if (drawing.length >= 3) { setNaming(drawing); setDrawing([]); setHoverPt(null); setNameInput(`Zone ${zones.length + 1}`) }
  }, [mode, drawing, zones.length])

  const confirmZone = () => {
    if (!naming || !nameInput.trim()) return
    const idx = zones.length % FILLS.length
    const zoneId = crypto.randomUUID()
    const newZone: FPZone = { id: zoneId, name: nameInput.trim(), fill: FILLS[idx], stroke: STROKES[idx], points: naming, devices: [] }
    setNaming(null); setNameInput(''); setMode('select')
    const rules = getZoneSuggestions(nameInput.trim())
    if (rules.length > 0) {
      const initial: Record<string, boolean> = {}
      rules[0].suggestions.forEach(s => { initial[s.productId] = true })
      setPendingSuggestion({ pendingZone: newZone, rule: rules[0] })
      setAcceptedSuggestions(initial)
    } else {
      onZonesChange([...zones, newZone])
    }
  }

  const confirmSuggestions = () => {
    if (!pendingSuggestion) return
    const { pendingZone, rule } = pendingSuggestion
    const c = centroid(pendingZone.points)
    const accepted = rule.suggestions.filter(s => acceptedSuggestions[s.productId])
    const expanded = accepted.flatMap(s => Array.from({ length: s.qty }, () => ({ productId: s.productId })))
    const devices: FPDevice[] = expanded.map((d, i) => {
      const angle = (i / Math.max(expanded.length, 1)) * 2 * Math.PI
      return {
        id: crypto.randomUUID(), productId: d.productId, qty: 1, zoneId: pendingZone.id,
        x: Math.max(2, Math.min(98, c.x + (expanded.length > 1 ? Math.cos(angle) * 8 : 0))),
        y: Math.max(2, Math.min(98, c.y + (expanded.length > 1 ? Math.sin(angle) * 8 : 0))),
      }
    })
    onZonesChange([...zones, { ...pendingZone, devices }])
    setPendingSuggestion(null)
  }

  const dismissSuggestions = () => {
    if (!pendingSuggestion) return
    onZonesChange([...zones, pendingSuggestion.pendingZone])
    setPendingSuggestion(null)
  }

  const cancelZone = () => { setNaming(null); setNameInput(''); setDrawing([]); setHoverPt(null) }
  const deleteZone = (id: string) => { onZonesChange(zones.filter(z => z.id !== id)); if (selectedZoneId === id) setSelectedZoneId(null) }

  const findZoneAtPoint = useCallback((pct: { x: number; y: number }) => {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (pointInPolygon(pct.x, pct.y, zones[i].points)) return zones[i].id
    }
    return null
  }, [zones])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    if (!svgRef.current) return
    setDragOverZoneId(findZoneAtPoint(toSVGPct(e as any, svgRef.current)))
  }, [findZoneAtPoint])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const productId = e.dataTransfer.getData('productId')
    if (!productId || !svgRef.current) return
    const pct = toSVGPct(e as any, svgRef.current)
    const zoneId = findZoneAtPoint(pct)
    setDragOverZoneId(null)
    if (!zoneId) return
    const newDevice: FPDevice = { id: crypto.randomUUID(), productId, qty: 1, x: pct.x, y: pct.y, zoneId }
    onZonesChange(zones.map(z => z.id === zoneId ? { ...z, devices: [...(z.devices || []), newDevice] } : z))
    setSelectedZoneId(zoneId)
  }, [zones, onZonesChange, findZoneAtPoint])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (mode === 'draw' && svgRef.current) setHoverPt(toSVGPct(e as any, svgRef.current))
    if (draggingDeviceId && svgRef.current) setDraggingDevicePos(toSVGPct(e as any, svgRef.current))
  }, [mode, draggingDeviceId])

  const handleMouseUp = useCallback(() => {
    if (draggingDeviceId && draggingDevicePos) {
      const finalPos = draggingDevicePos
      const device = zones.flatMap(z => z.devices || []).find(d => d.id === draggingDeviceId)
      const assignedZone = device ? zones.find(z => z.id === device.zoneId) : null
      const ok = assignedZone ? pointInPolygon(finalPos.x, finalPos.y, assignedZone.points) : true
      if (ok) {
        onZonesChange(zones.map(zone => ({ ...zone, devices: (zone.devices || []).map(d => d.id === draggingDeviceId ? { ...d, ...finalPos } : d) })))
      }
    }
    setDraggingDeviceId(null); setDraggingDevicePos(null)
  }, [draggingDeviceId, draggingDevicePos, zones, onZonesChange])

  const updateDeviceQty = (deviceId: string, qty: number) => {
    onZonesChange(zones.map(z => ({ ...z, devices: (z.devices || []).map(d => d.id === deviceId ? { ...d, qty } : d) })))
  }
  const deleteDevice = (deviceId: string) => {
    onZonesChange(zones.map(z => ({ ...z, devices: (z.devices || []).filter(d => d.id !== deviceId) })))
  }

  const pts2str = (pts: { x: number; y: number }[]) => pts.map(p => `${p.x},${p.y}`).join(' ')
  const allDevices = zones.flatMap(z => (z.devices || []).map(d => ({ ...d, zone: z })))
  const selectedZone = zones.find(z => z.id === selectedZoneId)

  return (
    <div className="flex h-full relative" style={{ minHeight: '600px' }}>
      {/* Suggestion popup */}
      {pendingSuggestion && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
          <div className="w-96 rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#111827', border: `2px solid ${pendingSuggestion.pendingZone.stroke}` }}>
            <div className="px-5 py-4" style={{ background: `${pendingSuggestion.pendingZone.stroke}18`, borderBottom: `1px solid ${pendingSuggestion.pendingZone.stroke}33` }}>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4" style={{ color: pendingSuggestion.pendingZone.stroke }} />
                <p className="text-sm font-bold" style={{ color: pendingSuggestion.pendingZone.stroke }}>Smart Recommendations</p>
              </div>
              <p className="text-xs text-gray-400">
                For <strong className="text-gray-200">{pendingSuggestion.pendingZone.name}</strong> — {pendingSuggestion.rule.reason}
              </p>
            </div>
            <div className="p-4 space-y-2">
              {pendingSuggestion.rule.suggestions.map(({ productId, qty }) => {
                const product = products.find(p => p.id === productId || p.partCode === productId)
                const checked = !!acceptedSuggestions[productId]
                return (
                  <label key={productId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                    style={{ background: checked ? `${pendingSuggestion.pendingZone.stroke}10` : '#1f2937', border: `1px solid ${checked ? pendingSuggestion.pendingZone.stroke + '44' : '#374151'}` }}>
                    <input type="checkbox" checked={checked}
                      onChange={e => setAcceptedSuggestions(s => ({ ...s, [productId]: e.target.checked }))}
                      className="rounded" style={{ accentColor: pendingSuggestion.pendingZone.stroke }} />
                    {product && <img src={product.imageUrl || (product as any).image || '/images/placeholder.png'} alt={product.name}
                      className="w-8 h-8 object-contain rounded-lg bg-white/5 shrink-0 p-0.5"
                      onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-200 truncate">{product?.name || productId}</p>
                      <p className="text-[10px] text-gray-500">{productId} · Qty {qty}</p>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center gap-2 px-4 pb-4">
              <button onClick={confirmSuggestions} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: pendingSuggestion.pendingZone.stroke, color: '#0f172a' }}>
                <Check className="w-4 h-4" /> Add to Plan
              </button>
              <button onClick={dismissSuggestions} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-800 text-gray-400 border border-gray-700">
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 shrink-0 flex-wrap bg-gray-900 border-b border-gray-800">
          <div className="flex rounded-xl overflow-hidden border border-gray-700">
            {([{ m: 'select' as const, Icon: MousePointer2, label: 'Select' }, { m: 'draw' as const, Icon: PenLine, label: 'Draw Zone' }]).map(({ m, Icon, label }) => (
              <button key={m} onClick={() => { setMode(m); setDrawing([]); setHoverPt(null) }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                style={mode === m ? { background: '#4f46e5', color: '#fff' } : { background: '#111827', color: '#9ca3af' }}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700">
            <button onClick={() => setImgScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} className="text-gray-400"><ZoomOut className="w-3.5 h-3.5" /></button>
            <span className="text-xs text-gray-400 w-10 text-center">{Math.round(imgScale * 100)}%</span>
            <button onClick={() => setImgScale(s => Math.min(3, +(s + 0.25).toFixed(2)))} className="text-gray-400"><ZoomIn className="w-3.5 h-3.5" /></button>
          </div>

          {mode === 'draw' && (
            <span className="text-xs px-3 py-2 rounded-xl bg-indigo-900/20 text-indigo-400 border border-dashed border-indigo-700/50">
              {drawing.length === 0 ? 'Click to place points · click back on start node to close' : `${drawing.length} pts — click start node or double-click to close`}
            </span>
          )}
          {mode === 'select' && zones.length > 0 && (
            <span className="text-xs px-3 py-2 rounded-xl bg-gray-800 text-gray-500 border border-gray-700">
              {zones.length} zone{zones.length !== 1 ? 's' : ''} · {allDevices.length} device{allDevices.length !== 1 ? 's' : ''} placed
            </span>
          )}
        </div>

        {/* Zone name input */}
        {naming && (
          <div className="flex items-center gap-2 px-4 py-2.5 shrink-0 bg-indigo-900/10 border-b border-indigo-800/30">
            <span className="text-sm font-semibold text-indigo-400 shrink-0">Name this zone:</span>
            <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmZone(); if (e.key === 'Escape') cancelZone() }}
              className="flex-1 bg-transparent text-sm text-gray-100 outline-none px-3 py-1.5 rounded-xl border border-indigo-700/50"
              placeholder="e.g. Living Room, Master Bedroom…" />
            <button onClick={confirmZone} className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white">
              <Check className="w-3.5 h-3.5" /> Confirm
            </button>
            <button onClick={cancelZone} className="p-2 rounded-xl bg-gray-800 text-gray-500 border border-gray-700"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-auto" style={{ background: '#0a0a0f', cursor: mode === 'draw' ? 'crosshair' : draggingDeviceId ? 'grabbing' : 'default' }}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <div className="relative inline-block" style={{ transformOrigin: 'top left', transform: `scale(${imgScale})` }}
            onClick={e => { if (e.target === e.currentTarget) { setSelectedZoneId(null) } }}>
            <img src={floorPlanData} alt="Floor plan" style={{ display: 'block', maxWidth: '100%', height: 'auto', userSelect: 'none' }}
              draggable={false} />
            <svg ref={svgRef} className="absolute inset-0 w-full h-full"
              viewBox="0 0 100 100" preserveAspectRatio="none"
              onClick={handleSvgClick} onDoubleClick={handleSvgDblClick}
              onDragOver={handleDragOver} onDragLeave={() => setDragOverZoneId(null)} onDrop={handleDrop}
              style={{ pointerEvents: 'all' }}>
              {zones.map(zone => {
                const c = centroid(zone.points)
                const isDragTarget = dragOverZoneId === zone.id
                const isSelected   = selectedZoneId  === zone.id
                const deviceCount  = (zone.devices || []).length
                return (
                  <g key={zone.id} onClick={e => { if (mode !== 'select') return; e.stopPropagation(); setSelectedZoneId(isSelected ? null : zone.id) }}>
                    <polygon points={pts2str(zone.points)}
                      fill={isDragTarget ? zone.stroke.replace(')', ',0.35)').replace('#', 'rgba(') : zone.fill}
                      stroke={zone.stroke} strokeWidth={isDragTarget || isSelected ? 0.6 : 0.3}
                      strokeDasharray={isSelected ? '2 1' : 'none'}
                      style={{ transition: 'fill 0.15s', cursor: 'pointer' }} />
                    <rect x={c.x - 10} y={c.y - 3.5} width={20} height={7} rx={2} fill="rgba(0,0,0,0.75)" />
                    <text x={c.x} y={c.y + 1.2} textAnchor="middle" fontSize="2.8" fontWeight="700" fill={zone.stroke}
                      style={{ fontFamily: 'system-ui,sans-serif', pointerEvents: 'none' }}>{zone.name}</text>
                    {deviceCount > 0 && (
                      <>
                        <rect x={c.x - 6} y={c.y + 4} width={12} height={4.5} rx={2} fill={zone.stroke + '30'} />
                        <text x={c.x} y={c.y + 7.2} textAnchor="middle" fontSize="2.2" fontWeight="600" fill={zone.stroke}
                          style={{ fontFamily: 'system-ui,sans-serif', pointerEvents: 'none' }}>
                          {deviceCount} device{deviceCount !== 1 ? 's' : ''}
                        </text>
                      </>
                    )}
                    {isDragTarget && (
                      <>
                        <rect x={c.x - 4} y={c.y - 10} width={8} height={8} rx={4} fill={zone.stroke} />
                        <text x={c.x} y={c.y - 5.5} textAnchor="middle" fontSize="5" fontWeight="900" fill="#0f172a"
                          style={{ fontFamily: 'system-ui,sans-serif', pointerEvents: 'none' }}>+</text>
                      </>
                    )}
                  </g>
                )
              })}
              {drawing.length > 0 && (
                <g style={{ pointerEvents: 'none' }}>
                  {drawing.length >= 2 && <polyline points={drawing.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#818CF8" strokeWidth="0.4" strokeDasharray="2 1" />}
                  {hoverPt && <line x1={drawing[drawing.length - 1].x} y1={drawing[drawing.length - 1].y} x2={hoverPt.x} y2={hoverPt.y} stroke="#818CF8" strokeWidth="0.3" strokeDasharray="1.5 1" />}
                  {drawing.map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r={i === 0 ? 1.3 : 0.8} fill={i === 0 ? '#818CF8' : '#fff'} stroke="#818CF8" strokeWidth="0.3" />)}
                </g>
              )}
            </svg>

            {/* Device chips */}
            {allDevices.map(device => {
              const product = products.find(p => p.id === device.productId)
              if (!product) return null
              const isDragging = draggingDeviceId === device.id
              const dx = isDragging && draggingDevicePos ? draggingDevicePos.x : device.x
              const dy = isDragging && draggingDevicePos ? draggingDevicePos.y : device.y
              const imgSrc = product.imageUrl || (product as any).image || '/images/placeholder.png'
              return (
                <div key={device.id}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDraggingDeviceId(device.id) }}
                  style={{ position: 'absolute', left: `${dx}%`, top: `${dy}%`, transform: 'translate(-50%,-50%)', zIndex: 20, cursor: 'grab', userSelect: 'none', pointerEvents: 'all' }}>
                  <img src={imgSrc} alt={product.name} draggable={false}
                    style={{ width: '44px', height: '44px', objectFit: 'contain', display: 'block', mixBlendMode: 'multiply',
                      filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5))` }}
                    onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />
                </div>
              )
            })}

            {/* Selected zone popup */}
            {selectedZone && (
              <ZoneSummary zone={selectedZone} products={products}
                onUpdateDevice={updateDeviceQty} onDeleteDevice={deleteDevice}
                onClose={() => setSelectedZoneId(null)} />
            )}
          </div>
        </div>

        {/* Zone strip */}
        {zones.length > 0 && (
          <div className="flex gap-2 px-4 py-2 overflow-x-auto shrink-0 bg-gray-900 border-t border-gray-800">
            {zones.map(zone => {
              const dCount = (zone.devices || []).length
              const total  = (zone.devices || []).reduce((s, d) => {
                const p = products.find(x => x.id === d.productId)
                return s + (p ? p.gsp * d.qty : 0)
              }, 0)
              return (
                <button key={zone.id} onClick={() => setSelectedZoneId(selectedZoneId === zone.id ? null : zone.id)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl whitespace-nowrap transition-all shrink-0"
                  style={selectedZoneId === zone.id
                    ? { background: `${zone.stroke}22`, border: `1px solid ${zone.stroke}`, color: zone.stroke }
                    : { background: '#1f2937', border: '1px solid #374151', color: '#9ca3af' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: zone.stroke }} />
                  <span className="text-xs font-semibold">{zone.name}</span>
                  {dCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${zone.stroke}22`, color: zone.stroke }}>
                      {dCount} · {total > 0 ? formatCurrency(total) : '—'}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); deleteZone(zone.id) }}
                    className="w-4 h-4 flex items-center justify-center rounded-full opacity-40 hover:opacity-100 text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Product sidebar */}
      <div className="w-60 shrink-0 flex flex-col overflow-hidden">
        <ProductSidebar products={products} />
      </div>
    </div>
  )
}
