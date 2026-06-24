import { useState, useMemo } from 'react'
import { Search, X, Plus, Minus, CheckCircle2, Lightbulb } from 'lucide-react'
import { getSuggestionsForRoom } from '../../../lib/rulesEngine'
import { formatCurrency } from '../../../lib/utils'

const CATEGORY_LABELS: Record<string, string> = {
  ELYSIA_SWITCHES: 'Elysia Switches',
  VITRUM_SWITCHES: 'Vitrum Switches',
  IR_CONTROLLERS:  'IR Controllers',
  SENSORS:         'Sensors',
  VDP:             'Video Door Phone',
  CURTAINS:        'Curtains',
  LOCKS:           'Smart Locks',
  LCD_PANELS:      'LCD Panels',
  NETWORKING:      'Networking',
  CONTROLLERS:     'Controllers',
}

interface CRMProduct {
  id: string
  partCode?: string
  name: string
  category: string
  gsp: number
  isActive?: boolean
  imageUrl?: string
  image?: string
}

interface QuoteRoomProduct { productId: string; qty: number }

interface Props {
  roomName: string
  roomType?: string
  products: CRMProduct[]
  currentProducts: QuoteRoomProduct[]
  onSave: (products: QuoteRoomProduct[]) => void
  onClose: () => void
}

export function AddProductModal({ roomName, roomType, products, currentProducts, onSave, onClose }: Props) {
  const initQtys = () => {
    const q: Record<string, number> = {}
    currentProducts.forEach(({ productId, qty }) => { q[productId] = qty })
    return q
  }
  const [qtys, setQtys] = useState<Record<string, number>>(initQtys)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')

  const activeProducts = products.filter(p => p.isActive !== false)
  const suggestions = useMemo(
    () => getSuggestionsForRoom({ name: roomName, type: roomType }, activeProducts),
    [roomName, roomType, activeProducts]
  )
  const suggestedIds = new Set(suggestions.map(s => s.productId))

  const categories = ['ALL', ...Object.keys(CATEGORY_LABELS).filter(k => activeProducts.some(p => p.category === k))]

  const filtered = activeProducts.filter(p => {
    const matchCat = category === 'ALL' || p.category === category
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.partCode || p.id).toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  const adjust = (id: string, delta: number) => {
    setQtys(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }))
  }

  const handleSave = () => {
    const result = Object.entries(qtys)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => ({ productId, qty }))
    onSave(result)
  }

  const applySuggestions = () => {
    setQtys(prev => {
      const next = { ...prev }
      suggestions.forEach(({ productId, qty }) => { if (!next[productId]) next[productId] = qty })
      return next
    })
  }

  const totalAdded = Object.values(qtys).filter(q => q > 0).length

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
        <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl my-4 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
            <div>
              <h2 className="text-base font-semibold text-gray-100">Add Products — {roomName}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{totalAdded} type(s) selected</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="mx-6 mt-4 p-3 bg-yellow-900/20 border border-yellow-800/40 rounded-xl flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-yellow-300">Smart Suggestions</p>
                  <p className="text-xs text-yellow-500 mt-0.5">
                    {suggestions.map(s => {
                      const p = products.find(x => x.id === s.productId || x.partCode === s.productId)
                      return p?.name
                    }).filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <button onClick={applySuggestions}
                className="shrink-0 text-xs font-semibold text-yellow-400 border border-yellow-700/50 px-2.5 py-1 rounded-lg hover:bg-yellow-900/30 transition-colors">
                Apply All
              </button>
            </div>
          )}

          {/* Search + Filter */}
          <div className="px-6 pt-4 pb-2 space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or part code…"
                className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map(cat => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    category === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}>
                  {cat === 'ALL' ? 'All' : CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product list */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-2">
            {filtered.length === 0 && (
              <p className="text-center text-gray-600 text-sm py-8">No products found.</p>
            )}
            {filtered.map(p => {
              const pid = p.id
              const qty = qtys[pid] || 0
              const isSuggested = suggestedIds.has(pid) || suggestedIds.has(p.partCode || '')
              const imgSrc = p.imageUrl || (p as any).image || '/images/placeholder.png'
              return (
                <div key={pid} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  qty > 0 ? 'border-indigo-700/60 bg-indigo-900/20'
                  : isSuggested ? 'border-yellow-800/50 bg-yellow-900/10'
                  : 'border-gray-800 bg-gray-800/30 hover:border-gray-700'
                }`}>
                  <img src={imgSrc} alt={p.name}
                    className="w-11 h-11 object-contain rounded-lg bg-white/5 border border-gray-700/50 shrink-0 p-1"
                    onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-200 truncate">{p.name}</p>
                      {isSuggested && <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded-full shrink-0">Suggested</span>}
                    </div>
                    <p className="text-xs text-gray-600 font-mono">{p.partCode || p.id}</p>
                    <p className="text-xs font-semibold text-indigo-400 mt-0.5">{formatCurrency(p.gsp)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {qty > 0 ? (
                      <>
                        <button onClick={() => adjust(pid, -1)}
                          className="w-7 h-7 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 flex items-center justify-center transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-indigo-400">{qty}</span>
                        <button onClick={() => adjust(pid, 1)}
                          className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => adjust(pid, 1)}
                        className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-900/80 rounded-b-2xl shrink-0">
            <p className="text-sm text-gray-500">
              {totalAdded} type(s) · {Object.values(qtys).reduce((s, q) => s + q, 0)} units
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-400 border border-gray-700 hover:bg-gray-800 transition-colors">Cancel</button>
              <button onClick={handleSave}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-2 transition-colors">
                <CheckCircle2 className="w-4 h-4" /> Save Products
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
