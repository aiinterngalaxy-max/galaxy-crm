import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Plus, Minus, PackagePlus } from 'lucide-react'
import { AddProductModal } from './AddProductModal'
import { formatCurrency } from '../../../lib/utils'

const ROOM_EMOJI: Record<string, string> = {
  entry: '🚪', foyer: '🚪',
  living: '🛋️',
  dining: '🍽️',
  kitchen: '🍳',
  bedroom: '🛏️',
  bathroom: '🚿', toilet: '🚿',
  utility: '📡', network: '📡',
  study: '📚',
  balcony: '🌿',
}

function getEmoji(name: string, type: string) {
  const key = (name + ' ' + type).toLowerCase()
  for (const [k, v] of Object.entries(ROOM_EMOJI)) {
    if (key.includes(k)) return v
  }
  return '🏠'
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

interface QuoteRoom {
  id: string
  name: string
  type: string
  products: QuoteRoomProduct[]
}

interface Props {
  room: QuoteRoom
  index: number
  products: CRMProduct[]
  onChange: (room: QuoteRoom) => void
  onDelete: () => void
}

export function RoomCard({ room, index, products, onChange, onDelete }: Props) {
  const [expanded, setExpanded] = useState((room.products?.length || 0) > 0)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const roomProducts = room.products || []
  const roomTotal = roomProducts.reduce((sum, rp) => {
    const p = products.find(x => x.id === rp.productId || x.partCode === rp.productId)
    return sum + (p ? p.gsp * rp.qty : 0)
  }, 0)

  const adjustQty = (productId: string, delta: number) => {
    const updated = roomProducts
      .map(rp => rp.productId === productId ? { ...rp, qty: Math.max(0, rp.qty + delta) } : rp)
      .filter(rp => rp.qty > 0)
    onChange({ ...room, products: updated })
  }

  const emoji = getEmoji(room.name, room.type)

  return (
    <>
      <div className="rounded-2xl overflow-hidden bg-gray-900 border border-gray-800">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
          style={{ borderBottom: expanded ? '1px solid rgb(31,41,55)' : 'none' }}>
          <span className="text-lg leading-none shrink-0">{emoji}</span>
          <span className="text-xs font-bold text-gray-600 w-5 text-center shrink-0">{index + 1}</span>
          <input
            value={room.name}
            onChange={e => { e.stopPropagation(); onChange({ ...room, name: e.target.value }) }}
            onClick={e => e.stopPropagation()}
            placeholder="Room Name"
            className="flex-1 text-sm font-semibold bg-transparent border-none outline-none text-gray-100 min-w-0"
          />
          <div className="flex items-center gap-2 shrink-0">
            {roomProducts.length > 0 && (
              <span className="text-xs text-gray-500">{roomProducts.length} items</span>
            )}
            {roomTotal > 0 && (
              <span className="text-xs font-bold text-indigo-400">{formatCurrency(roomTotal)}</span>
            )}
            {!confirmDelete ? (
              <button onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
                className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button onClick={() => { onDelete(); setConfirmDelete(false) }}
                  className="text-xs px-2 py-1 rounded-lg bg-red-900/40 text-red-400 border border-red-800/50 hover:bg-red-900/60 transition-colors">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
                  Cancel
                </button>
              </div>
            )}
            <span className="text-gray-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </div>
        </div>

        {/* Body */}
        {expanded && (
          <div className="p-4 space-y-3">
            {roomProducts.length > 0 && (
              <div className="space-y-1.5">
                {roomProducts.map(rp => {
                  const p = products.find(x => x.id === rp.productId || x.partCode === rp.productId)
                  if (!p) return (
                    <div key={rp.productId} className="text-xs px-3 py-2 rounded-xl bg-gray-800 text-gray-500 border border-gray-700">
                      ⚠ Product {rp.productId} not found in catalog
                    </div>
                  )
                  const imgSrc = p.imageUrl || (p as any).image || '/images/placeholder.png'
                  return (
                    <div key={rp.productId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800/60 border border-gray-800">
                      <img src={imgSrc} alt={p.name}
                        className="w-8 h-8 object-contain rounded-lg bg-white/5 shrink-0 p-0.5"
                        onError={e => { (e.target as HTMLImageElement).src = '/images/placeholder.png' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-200 truncate">{p.name}</p>
                        <p className="text-[10px] mt-0.5 text-gray-500">
                          {formatCurrency(p.gsp)} × {rp.qty}
                          <span className="ml-2 font-semibold text-gray-400">= {formatCurrency(p.gsp * rp.qty)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => adjustQty(rp.productId, -1)}
                          className="w-6 h-6 rounded-lg flex items-center justify-center bg-gray-700 border border-gray-600 text-gray-400 hover:text-red-400 transition-colors">
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="w-7 text-center text-xs font-bold text-indigo-400">{rp.qty}</span>
                        <button onClick={() => adjustQty(rp.productId, 1)}
                          className="w-6 h-6 rounded-lg flex items-center justify-center bg-indigo-900/40 border border-indigo-700/40 text-indigo-400 hover:bg-indigo-900/60 transition-colors">
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <button onClick={() => setShowModal(true)}
              className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border-2 border-dashed border-gray-800 text-gray-600 hover:border-indigo-700/50 hover:text-indigo-400">
              <PackagePlus className="w-3.5 h-3.5" />
              {roomProducts.length > 0 ? 'Edit Products' : 'Add Products'}
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <AddProductModal
          roomName={room.name}
          roomType={room.type}
          products={products}
          currentProducts={roomProducts}
          onSave={newProducts => { onChange({ ...room, products: newProducts }); setShowModal(false) }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
