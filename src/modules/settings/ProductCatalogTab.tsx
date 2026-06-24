import { useState, useEffect } from 'react'
import { Search, Plus, Package, ToggleLeft, ToggleRight, Upload, Edit2, Check, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { db, collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from '../../lib/firebase'
import { formatCurrency } from '../../lib/utils'
import rawProducts from '../../data/products.json'
import toast from 'react-hot-toast'

interface CatalogProduct {
  id: string
  firestoreId?: string
  name: string
  category: string
  subcategory?: string
  brand: string
  partCode: string
  gsp: number
  price: number
  image: string
  description: string
  active: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  ELYSIA_SWITCHES: 'Elysia Switches',
  VITRUM_SWITCHES: 'Vitrum Switches',
  LCD_PANELS: 'LCD Panels',
  CURTAINS: 'Curtains',
  LOCKS: 'Smart Locks',
  NETWORKING: 'Networking',
  IR_CONTROLLERS: 'IR Controllers',
  SENSORS: 'Sensors',
  VDP: 'Video Door Phone',
  CONTROLLERS: 'Controllers',
}

const CATEGORY_COLORS: Record<string, string> = {
  ELYSIA_SWITCHES: 'text-amber-400 bg-amber-900/30',
  VITRUM_SWITCHES: 'text-emerald-400 bg-emerald-900/30',
  LCD_PANELS: 'text-yellow-400 bg-yellow-900/30',
  CURTAINS: 'text-cyan-400 bg-cyan-900/30',
  LOCKS: 'text-red-400 bg-red-900/30',
  NETWORKING: 'text-blue-400 bg-blue-900/30',
  IR_CONTROLLERS: 'text-orange-400 bg-orange-900/30',
  SENSORS: 'text-purple-400 bg-purple-900/30',
  VDP: 'text-green-400 bg-green-900/30',
  CONTROLLERS: 'text-teal-400 bg-teal-900/30',
}

export function ProductCatalogTab() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('ALL')
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [editPriceVal, setEditPriceVal] = useState('')

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'products'))
      if (snap.empty) {
        // Show raw JSON products (not yet seeded)
        setProducts(rawProducts as CatalogProduct[])
      } else {
        setProducts(snap.docs.map(d => ({ ...(d.data() as CatalogProduct), firestoreId: d.id })))
      }
    } catch (err) {
      console.error(err)
      setProducts(rawProducts as CatalogProduct[])
    } finally {
      setLoading(false)
    }
  }

  const seedProducts = async () => {
    setSeeding(true)
    try {
      const snap = await getDocs(collection(db, 'products'))
      if (!snap.empty) {
        toast('Products already seeded')
        setSeeding(false)
        return
      }
      for (const p of rawProducts) {
        await addDoc(collection(db, 'products'), {
          ...p,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      toast.success(`${rawProducts.length} products added to catalog!`)
      loadProducts()
    } catch (err) {
      toast.error('Seeding failed')
      console.error(err)
    } finally {
      setSeeding(false)
    }
  }

  const toggleActive = async (p: CatalogProduct) => {
    if (!p.firestoreId) {
      toast.error('Seed products first')
      return
    }
    try {
      await updateDoc(doc(db, 'products', p.firestoreId), {
        active: !p.active,
        updatedAt: serverTimestamp(),
      })
      setProducts(prev => prev.map(x => x.firestoreId === p.firestoreId ? { ...x, active: !x.active } : x))
    } catch {
      toast.error('Update failed')
    }
  }

  const savePrice = async (p: CatalogProduct) => {
    const newPrice = Number(editPriceVal)
    if (!newPrice || !p.firestoreId) return
    try {
      await updateDoc(doc(db, 'products', p.firestoreId), {
        gsp: newPrice,
        price: newPrice,
        updatedAt: serverTimestamp(),
      })
      setProducts(prev => prev.map(x => x.firestoreId === p.firestoreId ? { ...x, gsp: newPrice, price: newPrice } : x))
      toast.success('Price updated')
    } catch {
      toast.error('Update failed')
    } finally {
      setEditingPrice(null)
    }
  }

  const isSeeded = products.some(p => !!p.firestoreId)

  const categories = ['ALL', ...Object.keys(CATEGORY_LABELS)]

  const filtered = products.filter(p => {
    const matchCat = activeCategory === 'ALL' || p.category === activeCategory
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.partCode.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || '').toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const categoryCount = (cat: string) =>
    cat === 'ALL' ? products.length : products.filter(p => p.category === cat).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{products.length} products · {products.filter(p => p.active).length} active</p>
        </div>
        <div className="flex gap-2">
          {!isSeeded && (
            <Button
              icon={<Upload className="w-4 h-4" />}
              loading={seeding}
              onClick={seedProducts}
            >
              Seed {rawProducts.length} Products
            </Button>
          )}
        </div>
      </div>

      {!isSeeded && (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl px-4 py-3 text-sm text-yellow-300">
          Products shown from local data. Click <strong>Seed Products</strong> to save them to the database.
        </div>
      )}

      {/* Search */}
      <Input
        placeholder="Search by name, part code, brand…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        leftIcon={<Search className="w-4 h-4" />}
      />

      {/* Category tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {cat === 'ALL' ? 'All' : CATEGORY_LABELS[cat]} ({categoryCount(cat)})
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="text-center py-12 text-sm text-gray-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(p => {
            const colorClass = CATEGORY_COLORS[p.category] || 'text-gray-400 bg-gray-800'
            const isEditing = editingPrice === (p.firestoreId || p.id)
            return (
              <div
                key={p.firestoreId || p.id}
                className={`bg-gray-900 border rounded-xl overflow-hidden flex flex-col transition-all ${
                  p.active ? 'border-gray-800 hover:border-gray-700' : 'border-gray-800/50 opacity-50'
                }`}
              >
                {/* Image */}
                <div className="relative bg-gray-800 aspect-square flex items-center justify-center p-3">
                  <img
                    src={p.image}
                    alt={p.name}
                    className="w-full h-full object-contain"
                    onError={e => {
                      (e.target as HTMLImageElement).src = '/images/products/placeholder.png'
                      ;(e.target as HTMLImageElement).onerror = null
                    }}
                  />
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleActive(p)}
                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-200 transition-colors"
                    title={p.active ? 'Deactivate' : 'Activate'}
                  >
                    {p.active
                      ? <ToggleRight className="w-5 h-5 text-green-400" />
                      : <ToggleLeft className="w-5 h-5 text-gray-600" />
                    }
                  </button>
                </div>

                {/* Info */}
                <div className="p-3 flex flex-col gap-1.5 flex-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-fit ${colorClass}`}>
                    {CATEGORY_LABELS[p.category] || p.category}
                  </span>
                  <p className="text-xs font-semibold text-gray-200 leading-snug line-clamp-2">{p.name}</p>
                  <p className="text-[10px] text-gray-500">{p.partCode}</p>

                  {/* Price */}
                  <div className="mt-auto pt-2 border-t border-gray-800">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          type="number"
                          value={editPriceVal}
                          onChange={e => setEditPriceVal(e.target.value)}
                          className="form-input text-xs py-1 flex-1 min-w-0"
                          onKeyDown={e => {
                            if (e.key === 'Enter') savePrice(p)
                            if (e.key === 'Escape') setEditingPrice(null)
                          }}
                        />
                        <button onClick={() => savePrice(p)} className="text-green-400 hover:text-green-300">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingPrice(null)} className="text-gray-500 hover:text-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-indigo-400">{formatCurrency(p.gsp)}</span>
                        <button
                          onClick={() => {
                            setEditingPrice(p.firestoreId || p.id)
                            setEditPriceVal(String(p.gsp))
                          }}
                          className="text-gray-600 hover:text-gray-300 transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-600">
          <Package className="w-8 h-8 mx-auto mb-3 opacity-30" />
          No products match your search
        </div>
      )}
    </div>
  )
}
