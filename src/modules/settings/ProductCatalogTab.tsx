import { useState, useEffect, useRef } from 'react'
import { Search, Package, ToggleLeft, ToggleRight, Upload, Edit2, X, ImagePlus, Save } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { db, collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from '../../lib/firebase'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
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
  LCD_PANELS: 'LCD Smart Panels',
  CURTAINS: 'Curtain Motors',
  LOCKS: 'Smart Locks',
  NETWORKING: 'Networking',
  IR_CONTROLLERS: 'IR Controllers',
  SENSORS: 'Sensors',
  VDP: 'Video Door Phone',
  CONTROLLERS: 'Controllers / Hubs',
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

function EditProductModal({ product, onClose, onSave }: {
  product: CatalogProduct
  onClose: () => void
  onSave: (updated: CatalogProduct) => void
}) {
  const [form, setForm] = useState({ ...product })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imagePreview, setImagePreview] = useState(product.image)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof CatalogProduct, value: string | number | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleImageFile = async (file: File) => {
    setUploading(true)
    try {
      const storage = getStorage()
      const path = `products/${Date.now()}_${file.name}`
      const snap = await uploadBytes(storageRef(storage, path), file)
      const url = await getDownloadURL(snap.ref)
      setForm(prev => ({ ...prev, image: url }))
      setImagePreview(url)
      toast.success('Image uploaded')
    } catch {
      toast.error('Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!form.firestoreId) { toast.error('Seed products first'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'products', form.firestoreId), {
        name: form.name,
        category: form.category,
        subcategory: form.subcategory || '',
        brand: form.brand,
        partCode: form.partCode,
        gsp: Number(form.gsp),
        price: Number(form.gsp),
        image: form.image,
        description: form.description,
        active: form.active,
        updatedAt: serverTimestamp(),
      })
      toast.success('Product updated')
      onSave({ ...form, gsp: Number(form.gsp), price: Number(form.gsp) })
      onClose()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
        <div className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl my-4">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-800">
            <h2 className="text-base font-semibold text-gray-100">Edit Product</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="form-label mb-2">Product Image</label>
              <div className="flex gap-3 items-start">
                <div className="w-24 h-24 bg-gray-800 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-gray-700">
                  {imagePreview
                    ? <img src={imagePreview} alt="" className="w-full h-full object-contain p-1" onError={() => setImagePreview('')} />
                    : <ImagePlus className="w-8 h-8 text-gray-600" />}
                </div>
                <div className="flex-1 space-y-2">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
                  <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />}
                    loading={uploading} onClick={() => fileRef.current?.click()}>
                    Upload Image
                  </Button>
                  <p className="text-xs text-gray-500">or paste URL below</p>
                  <input className="form-input text-xs py-1.5 w-full"
                    placeholder="https://… or /images/products/…"
                    value={form.image}
                    onChange={e => { set('image', e.target.value); setImagePreview(e.target.value) }} />
                </div>
              </div>
            </div>

            <div>
              <label className="form-label">Product Name *</label>
              <input className="form-input mt-1 w-full" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Category</label>
                <select className="form-input mt-1 w-full text-sm" value={form.category} onChange={e => set('category', e.target.value)}>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Subcategory</label>
                <input className="form-input mt-1 w-full" value={form.subcategory || ''} onChange={e => set('subcategory', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Brand</label>
                <input className="form-input mt-1 w-full" value={form.brand} onChange={e => set('brand', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Part Code</label>
                <input className="form-input mt-1 w-full" value={form.partCode} onChange={e => set('partCode', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="form-label">Rate / GSP (₹)</label>
              <input type="number" className="form-input mt-1 w-full" value={form.gsp} onChange={e => set('gsp', Number(e.target.value))} />
            </div>

            <div>
              <label className="form-label">Description</label>
              <textarea className="form-input mt-1 w-full" rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
            </div>

            <div className="flex items-center justify-between py-2 border-t border-gray-800">
              <span className="text-sm text-gray-300">Active in catalog</span>
              <button onClick={() => set('active', !form.active)}>
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-green-400" />
                  : <ToggleLeft className="w-8 h-8 text-gray-600" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 pb-5">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button icon={<Save className="w-4 h-4" />} loading={saving} onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductCatalogTab() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('ALL')
  const [editing, setEditing] = useState<CatalogProduct | null>(null)

  useEffect(() => { loadProducts() }, [])

  const loadProducts = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'products'))
      if (snap.empty) {
        setProducts(rawProducts as CatalogProduct[])
      } else {
        setProducts(snap.docs.map(d => ({ ...(d.data() as CatalogProduct), firestoreId: d.id })))
      }
    } catch {
      setProducts(rawProducts as CatalogProduct[])
    } finally {
      setLoading(false)
    }
  }

  const seedProducts = async () => {
    setSeeding(true)
    try {
      const snap = await getDocs(collection(db, 'products'))
      if (!snap.empty) { toast('Products already seeded'); setSeeding(false); return }
      for (const p of rawProducts) {
        await addDoc(collection(db, 'products'), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      }
      toast.success(`${rawProducts.length} products added!`)
      loadProducts()
    } catch {
      toast.error('Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  const toggleActive = async (p: CatalogProduct) => {
    if (!p.firestoreId) { toast.error('Seed products first'); return }
    try {
      await updateDoc(doc(db, 'products', p.firestoreId), { active: !p.active, updatedAt: serverTimestamp() })
      setProducts(prev => prev.map(x => x.firestoreId === p.firestoreId ? { ...x, active: !x.active } : x))
    } catch { toast.error('Update failed') }
  }

  const handleSaved = (updated: CatalogProduct) => {
    setProducts(prev => prev.map(x => x.firestoreId === updated.firestoreId ? updated : x))
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{products.length} products · {products.filter(p => p.active).length} active</p>
        {!isSeeded && (
          <Button icon={<Upload className="w-4 h-4" />} loading={seeding} onClick={seedProducts}>
            Seed {rawProducts.length} Products
          </Button>
        )}
      </div>

      {!isSeeded && (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl px-4 py-3 text-sm text-yellow-300">
          Products shown from local data. Click <strong>Seed Products</strong> to save them to the database.
        </div>
      )}

      <Input placeholder="Search by name, part code, brand…" value={search}
        onChange={e => setSearch(e.target.value)} leftIcon={<Search className="w-4 h-4" />} />

      <div className="flex gap-1.5 flex-wrap">
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === cat ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {cat === 'ALL' ? 'All' : CATEGORY_LABELS[cat]}
            {' '}({cat === 'ALL' ? products.length : products.filter(p => p.category === cat).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(p => {
            const colorClass = CATEGORY_COLORS[p.category] || 'text-gray-400 bg-gray-800'
            return (
              <div key={p.firestoreId || p.id}
                className={`bg-gray-900 border rounded-xl overflow-hidden flex flex-col transition-all ${
                  p.active ? 'border-gray-800 hover:border-gray-700' : 'border-gray-800/50 opacity-50'
                }`}>
                {/* Image */}
                <div className="relative bg-gray-800 aspect-square flex items-center justify-center p-3">
                  <img src={p.image} alt={p.name} className="w-full h-full object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <button onClick={() => toggleActive(p)} className="absolute top-2 right-2 transition-colors"
                    title={p.active ? 'Deactivate' : 'Activate'}>
                    {p.active
                      ? <ToggleRight className="w-5 h-5 text-green-400" />
                      : <ToggleLeft className="w-5 h-5 text-gray-600" />}
                  </button>
                  <button onClick={() => setEditing(p)}
                    className="absolute top-2 left-2 w-6 h-6 bg-gray-900/80 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-indigo-600 transition-all">
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Info */}
                <div className="p-3 flex flex-col gap-1 flex-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-fit ${colorClass}`}>
                    {CATEGORY_LABELS[p.category] || p.category}
                  </span>
                  <p className="text-xs font-semibold text-gray-200 leading-snug line-clamp-2 mt-0.5">{p.name}</p>
                  <p className="text-[10px] text-gray-500">{p.brand}</p>
                  <p className="text-[10px] text-gray-600 font-mono">{p.partCode}</p>
                  <div className="mt-auto pt-2 border-t border-gray-800 flex items-center justify-between">
                    <span className="text-sm font-bold text-indigo-400">{formatCurrency(p.gsp)}</span>
                    <button onClick={() => setEditing(p)} className="text-gray-600 hover:text-gray-300 transition-colors">
                      <Edit2 className="w-3 h-3" />
                    </button>
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

      {editing && (
        <EditProductModal product={editing} onClose={() => setEditing(null)} onSave={handleSaved} />
      )}
    </div>
  )
}
