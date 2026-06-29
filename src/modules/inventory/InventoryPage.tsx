import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  Package, Plus, TrendingDown, TrendingUp, AlertTriangle,
  Search, ArrowDownCircle, ArrowUpCircle, History, X,
} from 'lucide-react'
import { Card, StatCard } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, limit, runTransaction,
} from '../../lib/firebase'
import type { InventoryItem, StockTransaction, StockStatus } from '../../types'
import toast from 'react-hot-toast'
import { cn } from '../../lib/utils'

const STATIC_CATEGORIES = ['ALL']

const STATUS_CONFIG: Record<StockStatus, { label: string; color: string; bg: string; dot: string }> = {
  in_stock:     { label: 'In Stock',     color: 'text-green-400',  bg: 'bg-green-900/30',  dot: 'bg-green-400' },
  low_stock:    { label: 'Low Stock',    color: 'text-yellow-400', bg: 'bg-yellow-900/30', dot: 'bg-yellow-400' },
  out_of_stock: { label: 'Out of Stock', color: 'text-red-400',    bg: 'bg-red-900/30',    dot: 'bg-red-400' },
}

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

// Known color names, longest/most-specific phrases first so e.g. "Rose Gold" wins over "Gold"
const KNOWN_COLORS = [
  'Champagne Gold', 'Rose Gold', 'Matt Black', 'Matt White', 'Pearl White',
  'Sandstone Beige', 'Antique Brass', 'Brushed Steel', 'Gun Metal',
  'White', 'Black', 'Silver', 'Gold', 'Ivory', 'Beige', 'Bronze', 'Brown',
  'Grey', 'Gray', 'Champagne', 'Graphite', 'Charcoal', 'Sandstone', 'Wine',
  'Blue', 'Red', 'Green', 'Copper', 'Brass', 'Cream', 'Pearl', 'Matt', 'Glossy',
]

// Vitrum two-tone finish codes, e.g. "B/G" = Black/Gold, "W/S" = White/Silver
const FINISH_CODE_MAP: Record<string, string> = { B: 'Black', W: 'White', G: 'Gold', S: 'Silver' }
const FINISH_CODE_RE = /\b([BWGS])\s*\/\s*([BWGS])\b/i
const COMBO_COLOR_RE = /\b(white|black|silver|gold|grey|gray)\s*\/\s*(white|black|silver|gold|grey|gray)\b/i

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

function extractColor(text: string): string | null {
  const combo = text.match(COMBO_COLOR_RE)
  if (combo) return `${cap(combo[1])} / ${cap(combo[2])}`

  const code = text.match(FINISH_CODE_RE)
  if (code) {
    const a = FINISH_CODE_MAP[code[1].toUpperCase()]
    const b = FINISH_CODE_MAP[code[2].toUpperCase()]
    if (a && b) return `${a} / ${b}`
  }

  const lower = text.toLowerCase()
  for (const c of KNOWN_COLORS) {
    if (lower.includes(c.toLowerCase())) return c
  }
  return null
}

function getItemColor(item: InventoryItem): string | null {
  return item.color || extractColor(item.itemName) || extractColor(item.itemCode)
}

// ─── Add Item Modal ────────────────────────────────────────────────────────────

interface AddItemModalProps {
  onClose: () => void
  userId: string
  userName: string
}

function AddItemModal({ onClose, userId, userName }: AddItemModalProps) {
  const [form, setForm] = useState({
    itemCode: '', itemName: '', category: '1T', location: '', color: '',
    openingStock: '', reorderLevel: '', productLine: 'elysia',
  })
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.itemCode.trim() || !form.itemName.trim()) {
      toast.error('Item code and name are required')
      return
    }
    setSaving(true)
    try {
      const opening = Number(form.openingStock) || 0
      const reorder = Number(form.reorderLevel) || 0
      const closing = opening
      await addDoc(collection(db, 'inventory'), {
        itemCode: form.itemCode.trim().toUpperCase(),
        category: form.category,
        itemName: form.itemName.trim(),
        location: form.location.trim(),
        color: form.color.trim(),
        productLine: form.productLine,
        openingStock: opening,
        importedQty: 0,
        issuedQty: 0,
        closingStock: closing,
        reorderLevel: reorder,
        stockStatus: computeStatus(closing, reorder),
        createdBy: userId,
        createdByName: userName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Item added')
      onClose()
    } catch {
      toast.error('Failed to add item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-md rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">Add Inventory Item</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">Product Line</label>
            <select className="form-input" value={form.productLine} onChange={e => set('productLine', e.target.value)}>
              <option value="elysia">Elysia</option>
              <option value="vitrum">Vitrum</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Item Code *</label>
              <input className="form-input" placeholder="e.g. 4T-001" value={form.itemCode} onChange={e => set('itemCode', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Category</label>
              <select className="form-input" value={form.category} onChange={e => set('category', e.target.value)}>
                {['1T','2T','3T','4T','4T KNOB','6T','8T','CITRUM','SOCKET','VITRUM','LCD','CURTAINS','OTHER'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Item Name *</label>
            <input className="form-input" placeholder="e.g. 4-Touch Panel White" value={form.itemName} onChange={e => set('itemName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Location / Warehouse</label>
              <input className="form-input" placeholder="e.g. Rack A-3" value={form.location} onChange={e => set('location', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Color</label>
              <input className="form-input" placeholder="e.g. White" value={form.color} onChange={e => set('color', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Opening Stock</label>
              <input className="form-input" type="number" min="0" placeholder="0" value={form.openingStock} onChange={e => set('openingStock', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Reorder Level</label>
              <input className="form-input" type="number" min="0" placeholder="5" value={form.reorderLevel} onChange={e => set('reorderLevel', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Add Item</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Stock Transaction Modal ───────────────────────────────────────────────────

interface StockModalProps {
  item: InventoryItem
  type: 'import' | 'issue'
  onClose: () => void
  userId: string
  userName: string
}

function StockModal({ item, type, onClose, userId, userName }: StockModalProps) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const quantity = Number(qty)
    if (!quantity || quantity <= 0) { toast.error('Enter a valid quantity'); return }
    if (type === 'issue' && quantity > item.closingStock) {
      toast.error(`Only ${item.closingStock} units available`)
      return
    }
    setSaving(true)
    try {
      await runTransaction(db, async (tx) => {
        const itemRef = doc(db, 'inventory', item.id)
        const snap = await tx.get(itemRef)
        if (!snap.exists()) throw new Error('Item not found')
        const data = snap.data() as InventoryItem
        const newImported = type === 'import' ? data.importedQty + quantity : data.importedQty
        const newIssued   = type === 'issue'  ? data.issuedQty  + quantity : data.issuedQty
        const newClosing  = data.openingStock + newImported - newIssued
        tx.update(itemRef, {
          importedQty: newImported,
          issuedQty:   newIssued,
          closingStock: newClosing,
          stockStatus: computeStatus(newClosing, data.reorderLevel),
          updatedAt: serverTimestamp(),
        })
        const txRef = doc(collection(db, 'stockTransactions'))
        tx.set(txRef, {
          itemId: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          type,
          quantity,
          note: note.trim() || null,
          recordedBy: userId,
          recordedByName: userName,
          createdAt: serverTimestamp(),
        })
      })
      toast.success(type === 'import' ? `+${quantity} units imported` : `${quantity} units issued`)
      onClose()
    } catch (err) {
      toast.error('Transaction failed')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const isImport = type === 'import'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-sm rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isImport
              ? <ArrowDownCircle className="w-5 h-5 text-green-400" />
              : <ArrowUpCircle className="w-5 h-5 text-red-400" />}
            <h2 className="text-base font-semibold text-gray-100">{isImport ? 'Stock In' : 'Issue Stock'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-gray-200">{item.itemName}</p>
          <p className="text-xs text-gray-500">{item.itemCode} · Current: <span className="text-gray-300 font-medium">{item.closingStock}</span> units</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">Quantity *</label>
            <input
              autoFocus
              className="form-input"
              type="number"
              min="1"
              max={type === 'issue' ? item.closingStock : undefined}
              placeholder="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Note (optional)</label>
            <input className="form-input" placeholder={isImport ? 'Supplier / PO ref' : 'Project / reason'} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              loading={saving}
              style={isImport ? {} : { background: '#ef4444' }}
            >
              {isImport ? 'Confirm Import' : 'Confirm Issue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Transaction Log ───────────────────────────────────────────────────────────

function TransactionLog() {
  const [txns, setTxns] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'stockTransactions'), orderBy('createdAt', 'desc'), limit(100))
    return onSnapshot(q, snap => {
      setTxns(snap.docs.map(d => ({ id: d.id, ...d.data() }) as StockTransaction))
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="p-8 text-center text-sm text-gray-600">Loading…</div>
  if (!txns.length) return <div className="p-8 text-center text-sm text-gray-600">No transactions yet</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            {['Date', 'Type', 'Item', 'Code', 'Qty', 'Note', 'By'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {txns.map(tx => (
            <tr key={tx.id} className="hover:bg-gray-800/30 transition-colors">
              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                {tx.createdAt ? new Date((tx.createdAt as { seconds: number }).seconds * 1000).toLocaleDateString('en-IN') : '—'}
              </td>
              <td className="px-4 py-3">
                <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full',
                  tx.type === 'import' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                )}>
                  {tx.type === 'import' ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                  {tx.type === 'import' ? 'Import' : 'Issue'}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-gray-200 font-medium">{tx.itemName}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{tx.itemCode}</td>
              <td className="px-4 py-3 text-xs font-semibold">
                <span className={tx.type === 'import' ? 'text-green-400' : 'text-red-400'}>
                  {tx.type === 'import' ? '+' : '-'}{tx.quantity}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate">{tx.note || '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{tx.recordedByName || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const { line } = useParams<{ line?: string }>()
  const { user, role } = useAuth()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'stock' | 'log'>('stock')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [colorFilter, setColorFilter] = useState('ALL')
  const [rackFilter, setRackFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'all' | StockStatus>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [stockModal, setStockModal] = useState<{ item: InventoryItem; type: 'import' | 'issue' } | null>(null)
  const [editingLocation, setEditingLocation] = useState<{ id: string; value: string } | null>(null)

  const saveLocation = async (itemId: string, value: string) => {
    try {
      await updateDoc(doc(db, 'inventory', itemId), { location: value.trim(), updatedAt: serverTimestamp() })
      toast.success('Location updated')
    } catch {
      toast.error('Failed to update location')
    } finally {
      setEditingLocation(null)
    }
  }

  const canManage = role ? ['super_admin', 'management', 'dept_head'].includes(role) : false
  const canIssue  = role ? ['super_admin', 'management', 'dept_head', 'project_manager'].includes(role) : false

  useEffect(() => {
    const q = query(collection(db, 'inventory'), orderBy('itemCode', 'asc'), limit(1000))
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItem))
      setLoading(false)
    })
  }, [])

  // single memo — deps are all primitives + items array, no chained memos
  const { lineItems, categories, colors, racks, filtered, stats } = useMemo(() => {
    const scoped = line
      ? items.filter(i => (i.productLine ?? 'elysia') === line)
      : items

    const cats  = Array.from(new Set(scoped.map(i => i.category))).sort()
    const cols  = Array.from(new Set(scoped.map(i => getItemColor(i)).filter((c): c is string => !!c))).sort()
    const rcks  = Array.from(new Set(scoped.map(i => i.location).filter((l): l is string => !!l))).sort()

    const rows = scoped.filter(item => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false
      if (colorFilter !== 'ALL' && getItemColor(item) !== colorFilter) return false
      if (rackFilter !== 'ALL' && item.location !== rackFilter) return false
      if (statusFilter !== 'all' && item.stockStatus !== statusFilter) return false
      if (search) {
        const s = search.toLowerCase()
        return item.itemName.toLowerCase().includes(s) || item.itemCode.toLowerCase().includes(s)
      }
      return true
    })

    return {
      lineItems: scoped,
      categories: [...STATIC_CATEGORIES, ...cats],
      colors: [...STATIC_CATEGORIES, ...cols],
      racks: [...STATIC_CATEGORIES, ...rcks],
      filtered: rows,
      stats: {
        total:      scoped.length,
        inStock:    scoped.filter(i => i.stockStatus === 'in_stock').length,
        lowStock:   scoped.filter(i => i.stockStatus === 'low_stock').length,
        outOfStock: scoped.filter(i => i.stockStatus === 'out_of_stock').length,
      },
    }
  }, [items, line, categoryFilter, colorFilter, rackFilter, statusFilter, search])

  const lineLabel = line ? (line.charAt(0).toUpperCase() + line.slice(1)) : 'All'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{lineLabel} · {lineItems.length} items tracked</p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowAdd(true)}>
            Add Item
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Items"
          value={stats.total}
          icon={<Package className="w-5 h-5 text-indigo-400" />}
          iconBg="bg-indigo-900/40"
          onClick={() => setStatusFilter('all')}
        />
        <StatCard
          label="In Stock"
          value={stats.inStock}
          icon={<TrendingUp className="w-5 h-5 text-green-400" />}
          iconBg="bg-green-900/40"
          onClick={() => setStatusFilter('in_stock')}
        />
        <StatCard
          label="Low Stock"
          value={stats.lowStock}
          subValue="At or below reorder level"
          icon={<AlertTriangle className="w-5 h-5 text-yellow-400" />}
          iconBg="bg-yellow-900/40"
          trend={stats.lowStock > 0 ? { value: 'Reorder needed', up: false } : undefined}
          onClick={() => setStatusFilter('low_stock')}
        />
        <StatCard
          label="Out of Stock"
          value={stats.outOfStock}
          icon={<TrendingDown className="w-5 h-5 text-red-400" />}
          iconBg="bg-red-900/40"
          trend={stats.outOfStock > 0 ? { value: 'Critical', up: false } : undefined}
          onClick={() => setStatusFilter('out_of_stock')}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {([['stock', 'Stock Table', Package], ['log', 'Transaction Log', History]] as const).map(([t, label, Icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <Card padding="none">
          <TransactionLog />
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                className="form-input pl-9"
                placeholder="Search item name or code…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {/* Status pills */}
            <div className="flex gap-2 flex-wrap">
              {(['all', 'in_stock', 'low_stock', 'out_of_stock'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full font-medium transition-colors border',
                    statusFilter === s
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600'
                  )}
                >
                  {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Category chips */}
          <div className="flex gap-2 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                  categoryFilter === cat
                    ? 'border-yellow-500 text-yellow-400 bg-yellow-900/20'
                    : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Color chips */}
          {colors.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {colors.map(col => (
                <button
                  key={col}
                  onClick={() => setColorFilter(col)}
                  className={cn(
                    'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                    colorFilter === col
                      ? 'border-indigo-500 text-indigo-400 bg-indigo-900/20'
                      : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                  )}
                >
                  {col}
                </button>
              ))}
            </div>
          )}

          {/* Rack chips */}
          {racks.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {racks.map(rack => (
                <button
                  key={rack}
                  onClick={() => setRackFilter(rack)}
                  className={cn(
                    'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                    rackFilter === rack
                      ? 'border-green-500 text-green-400 bg-green-900/20'
                      : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                  )}
                >
                  {rack}
                </button>
              ))}
            </div>
          )}

          {/* Table */}
          <Card padding="none">
            {loading ? (
              <div className="p-12 text-center text-sm text-gray-600">Loading inventory…</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No items found</p>
                {canManage && <p className="text-xs text-gray-600 mt-1">Add your first item using the button above</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Code', 'Category', 'Item Name', 'Color', 'Location', 'Opening', 'Imported', 'Issued', 'Closing', 'Reorder', 'Status', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {filtered.map(item => {
                      const cfg = STATUS_CONFIG[item.stockStatus]
                      return (
                        <tr key={item.id} className="hover:bg-gray-800/30 transition-colors group">
                          <td className="px-4 py-3 text-xs font-mono text-gray-300 whitespace-nowrap">{item.itemCode}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">{item.category}</span>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-gray-200 max-w-[200px]">{item.itemName}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">{getItemColor(item) || '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {editingLocation?.id === item.id ? (
                              <input
                                autoFocus
                                className="form-input py-0.5 px-2 text-xs w-28"
                                value={editingLocation.value}
                                onChange={e => setEditingLocation({ id: item.id, value: e.target.value })}
                                onBlur={() => saveLocation(item.id, editingLocation.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveLocation(item.id, editingLocation.value)
                                  if (e.key === 'Escape') setEditingLocation(null)
                                }}
                              />
                            ) : (
                              <span
                                onClick={() => setEditingLocation({ id: item.id, value: item.location || '' })}
                                className="cursor-pointer hover:text-gray-300 border-b border-dashed border-gray-700 hover:border-gray-500 transition-colors"
                                title="Click to edit location"
                              >
                                {item.location || '—'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 text-right">{item.openingStock}</td>
                          <td className="px-4 py-3 text-xs text-green-400 font-medium text-right">{item.importedQty}</td>
                          <td className="px-4 py-3 text-xs text-red-400 font-medium text-right">{item.issuedQty}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={cn(
                              'text-sm font-bold px-2 py-0.5 rounded',
                              item.stockStatus === 'out_of_stock' ? 'bg-red-900/40 text-red-300' :
                              item.stockStatus === 'low_stock'    ? 'bg-yellow-900/40 text-yellow-300' :
                                                                    'bg-green-900/40 text-green-300'
                            )}>
                              {item.closingStock}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 text-right">{item.reorderLevel}</td>
                          <td className="px-4 py-3">
                            <Badge color={cfg.color} bg={cfg.bg}>
                              <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5 inline-block', cfg.dot)} />
                              {cfg.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {canManage && (
                                <button
                                  onClick={() => setStockModal({ item, type: 'import' })}
                                  title="Stock In"
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors"
                                >
                                  <ArrowDownCircle className="w-3.5 h-3.5" /> In
                                </button>
                              )}
                              {canIssue && (
                                <button
                                  onClick={() => setStockModal({ item, type: 'issue' })}
                                  title="Issue Stock"
                                  disabled={item.closingStock <= 0}
                                  className={cn(
                                    'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
                                    item.closingStock > 0
                                      ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                                      : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                  )}
                                >
                                  <ArrowUpCircle className="w-3.5 h-3.5" /> Out
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Modals */}
      {showAdd && user && (
        <AddItemModal onClose={() => setShowAdd(false)} userId={user.id} userName={user.name} />
      )}
      {stockModal && user && (
        <StockModal
          item={stockModal.item}
          type={stockModal.type}
          onClose={() => setStockModal(null)}
          userId={user.id}
          userName={user.name}
        />
      )}
    </div>
  )
}
