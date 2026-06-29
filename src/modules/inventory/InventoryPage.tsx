import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Package, Plus,
  Search, ArrowDownCircle, ArrowUpCircle, History, X, Download, Upload, FileSpreadsheet, Trash2, Pencil,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, deleteDoc,
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

function getItemType(item: InventoryItem): 'Switch' | 'Socket' {
  return item.category?.toUpperCase() === 'SOCKET' ? 'Socket' : 'Switch'
}

// Switch items store their module directly as category. Socket items all share category "SOCKET",
// so the specific module (Single Socket USB C, etc) is recovered from the item name prefix instead.
function getItemModule(item: InventoryItem): string {
  if (getItemType(item) === 'Switch') return item.category
  return ELYSIA_SOCKET_MODULES.find(m => item.itemName.toUpperCase().startsWith(m.toUpperCase())) ?? ''
}

function extractRackNumber(location: string | undefined): string {
  return location?.match(/\d+/)?.[0] ?? ''
}

function formatRack(value: string): string {
  const n = value.trim()
  return n ? `Rack ${n}` : ''
}

// ─── CSV Import/Export ──────────────────────────────────────────────────────────

const CSV_INPUT_HEADERS_BASE = ['Item Code', 'Category', 'Item Name', 'Rack', 'Opening Stock', 'Imported Qty', 'Issued Qty', 'Reorder Level']

function getCsvHeaders(line?: string): string[] {
  return line === 'elysia'
    ? ['Product', 'Module', 'Material', 'Color', 'Rack', 'Opening Stock']
    : CSV_INPUT_HEADERS_BASE
}

// Recount/data-entry template. Elysia mirrors the simplified Add Item form (Product/Module/Material/
// Color/Rack/Opening Stock) — Item Code and Item Name are derived on import, same as manual entry.
function getRecountHeaders(line?: string): string[] {
  return line === 'elysia'
    ? ['Product', 'Module', 'Material', 'Color', 'Rack', 'Opening Stock']
    : ['Item Code', 'Category', 'Item Name', 'Rack', 'Counted Stock', 'Reorder Level']
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function buildCsv(rows: string[][]): string {
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n')
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some(v => v !== '')) rows.push(row)
  }
  return rows
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Add Item Modal ────────────────────────────────────────────────────────────

const CATEGORIES_BY_LINE: Record<string, string[]> = {
  elysia: ['1T', '2T', '3T', '4T', 'D/T Knob', '4T LCD', '6T', '8T', 'Multifunctional Switch', 'CITRUM', 'SOCKET', 'OTHER'],
  vitrum: ['1M', '2M', '3M', '4M', '6M', '7M', '8M', '10M', 'OTHER'],
}

const ELYSIA_MATERIALS = ['Skin', 'Aluminium', 'PC']
const ELYSIA_COLORS = ['Grey', 'Black', 'White', 'Blue', 'Red', 'Gold', 'Silver', 'Brown']
const ELYSIA_SWITCH_MODULES = ['1T', '2T', '3T', '4T', 'D/T Knob', '4T LCD', '6T', '8T', 'Multifunctional Switch']
const ELYSIA_SOCKET_MODULES = ['Single Socket USB C', 'Single Socket 5Pin', 'Double Socket USB C', 'Double Socket 5Pin']

function buildElysiaItemName(product: 'switch' | 'socket', module: string, color: string): string {
  const c = color.trim()
  if (product === 'socket') return `${module.toUpperCase()} ${c}`.trim()
  if (module === '4T LCD') return `4 TOUCH LCD ${c}`.trim()
  if (/^\d+T$/.test(module)) {
    const n = module.replace(/[^0-9]/g, '')
    return `${n} TOUCH ${c}`.trim()
  }
  // Non-numeric special modules (D/T Knob, Multifunctional Switch, etc.)
  return `${module.toUpperCase()} ${c}`.trim()
}

function buildElysiaItemCode(module: string, color: string, material: string): string {
  const mod = module.trim().toUpperCase()
  return [mod, color.trim().toUpperCase(), material.trim().toUpperCase()].filter(Boolean).join('-')
}

interface AddItemModalProps {
  onClose: () => void
  userId: string
  userName: string
  line?: string
}

function AddItemModal({ onClose, userId, userName, line }: AddItemModalProps) {
  const fixedLine = line === 'elysia' || line === 'vitrum' ? line : null
  const isElysia = fixedLine === 'elysia'

  // Generic form (Vitrum / unscoped "All" view)
  const [form, setForm] = useState({
    itemCode: '', itemName: '', category: CATEGORIES_BY_LINE[fixedLine ?? 'vitrum'][0], location: '',
    openingStock: '', reorderLevel: '', productLine: fixedLine ?? 'vitrum',
  })

  // Simplified Elysia form: Product (Switch/Socket) + Module + Material + Color + Rack + Opening Stock —
  // Item Code/Name are derived; Reorder Level is set later via Stock In/Out.
  const [elysiaForm, setElysiaForm] = useState({
    product: 'switch' as 'switch' | 'socket',
    module: ELYSIA_SWITCH_MODULES[0],
    material: '',
    color: '',
    rack: '',
    openingStock: '',
  })

  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const categories = CATEGORIES_BY_LINE[form.productLine] ?? CATEGORIES_BY_LINE.vitrum

  const setElysiaProduct = (product: 'switch' | 'socket') => {
    setElysiaForm(f => ({
      ...f, product,
      module: product === 'switch' ? ELYSIA_SWITCH_MODULES[0] : ELYSIA_SOCKET_MODULES[0],
    }))
  }

  const handleSubmitElysia = async (e: React.FormEvent) => {
    e.preventDefault()
    const { product, module, material, color, rack, openingStock } = elysiaForm
    if (!color.trim()) {
      toast.error('Color is required')
      return
    }
    setSaving(true)
    try {
      const opening = Number(openingStock) || 0
      await addDoc(collection(db, 'inventory'), {
        itemCode: buildElysiaItemCode(module, color, material),
        category: product === 'socket' ? 'SOCKET' : module,
        itemName: buildElysiaItemName(product, module, color),
        location: formatRack(rack),
        material, color: color.trim(), productLine: 'elysia',
        openingStock: opening,
        importedQty: 0,
        issuedQty: 0,
        closingStock: opening,
        reorderLevel: 0,
        stockStatus: computeStatus(opening, 0),
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

  const handleSubmitGeneric = async (e: React.FormEvent) => {
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
        location: formatRack(form.location),
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

        {isElysia ? (
          <form onSubmit={handleSubmitElysia} className="space-y-4">
            <div>
              <label className="form-label">Product</label>
              <div className="grid grid-cols-2 gap-2">
                {(['switch', 'socket'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setElysiaProduct(p)}
                    className={cn(
                      'text-sm px-3 py-2 rounded-lg font-medium border capitalize transition-colors',
                      elysiaForm.product === p
                        ? 'border-pink-500 text-pink-400 bg-pink-900/20'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Module</label>
                <select
                  className="form-input"
                  value={elysiaForm.module}
                  onChange={e => setElysiaForm(f => ({ ...f, module: e.target.value }))}
                >
                  {(elysiaForm.product === 'switch' ? ELYSIA_SWITCH_MODULES : ELYSIA_SOCKET_MODULES).map(m => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Material</label>
                <select
                  className="form-input"
                  value={elysiaForm.material}
                  onChange={e => setElysiaForm(f => ({ ...f, material: e.target.value }))}
                >
                  <option value="">—</option>
                  {ELYSIA_MATERIALS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Color *</label>
              <select
                className="form-input"
                value={elysiaForm.color}
                onChange={e => setElysiaForm(f => ({ ...f, color: e.target.value }))}
              >
                <option value="">—</option>
                {ELYSIA_COLORS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Rack</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  placeholder="e.g. 2"
                  value={elysiaForm.rack}
                  onChange={e => setElysiaForm(f => ({ ...f, rack: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Opening Stock</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={elysiaForm.openingStock}
                  onChange={e => setElysiaForm(f => ({ ...f, openingStock: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>Add Item</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitGeneric} className="space-y-4">
            {fixedLine ? (
              <div>
                <label className="form-label">Product Line</label>
                <div className="form-input flex items-center text-gray-300 capitalize">{fixedLine}</div>
              </div>
            ) : (
              <div>
                <label className="form-label">Product Line</label>
                <select
                  className="form-input"
                  value={form.productLine}
                  onChange={e => {
                    const productLine = e.target.value
                    setForm(f => ({ ...f, productLine, category: CATEGORIES_BY_LINE[productLine][0] }))
                  }}
                >
                  <option value="elysia">Elysia</option>
                  <option value="vitrum">Vitrum</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Item Code *</label>
                <input className="form-input" placeholder="e.g. 4T-001" value={form.itemCode} onChange={e => set('itemCode', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Category</label>
                <select className="form-input" value={form.category} onChange={e => set('category', e.target.value)}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Item Name *</label>
              <input className="form-input" placeholder="e.g. 4 TOUCH WHITE" value={form.itemName} onChange={e => set('itemName', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Rack</label>
              <input className="form-input" type="number" min="0" placeholder="e.g. 2" value={form.location} onChange={e => set('location', e.target.value)} />
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
        )}
      </div>
    </div>
  )
}

// ─── Edit Item Modal ────────────────────────────────────────────────────────────

interface EditItemModalProps {
  item: InventoryItem
  onClose: () => void
}

function EditItemModal({ item, onClose }: EditItemModalProps) {
  const isElysia = (item.productLine ?? 'elysia') === 'elysia'
  const initialType = getItemType(item)

  const [elysiaForm, setElysiaForm] = useState({
    product: (initialType === 'Socket' ? 'socket' : 'switch') as 'switch' | 'socket',
    module: initialType === 'Switch'
      ? item.category
      : (ELYSIA_SOCKET_MODULES.find(m => item.itemName.toUpperCase().startsWith(m.toUpperCase())) ?? ELYSIA_SOCKET_MODULES[0]),
    material: item.material || '',
    color: getItemColor(item) || '',
    rack: extractRackNumber(item.location),
  })

  const [genericForm, setGenericForm] = useState({
    category: item.category,
    itemName: item.itemName,
    rack: extractRackNumber(item.location),
    reorderLevel: String(item.reorderLevel),
  })

  const [saving, setSaving] = useState(false)
  const genericCategories = CATEGORIES_BY_LINE[item.productLine ?? 'vitrum'] ?? CATEGORIES_BY_LINE.vitrum

  const setElysiaProduct = (product: 'switch' | 'socket') => {
    setElysiaForm(f => ({
      ...f, product,
      module: product === 'switch' ? ELYSIA_SWITCH_MODULES[0] : ELYSIA_SOCKET_MODULES[0],
    }))
  }

  const handleSubmitElysia = async (e: React.FormEvent) => {
    e.preventDefault()
    const { product, module, material, color, rack } = elysiaForm
    if (!color.trim()) {
      toast.error('Color is required')
      return
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'inventory', item.id), {
        itemCode: buildElysiaItemCode(module, color, material),
        category: product === 'socket' ? 'SOCKET' : module,
        itemName: buildElysiaItemName(product, module, color),
        location: formatRack(rack),
        material, color: color.trim(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Item updated')
      onClose()
    } catch {
      toast.error('Failed to update item')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmitGeneric = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!genericForm.itemName.trim()) {
      toast.error('Item name is required')
      return
    }
    setSaving(true)
    try {
      const reorder = Number(genericForm.reorderLevel) || 0
      await updateDoc(doc(db, 'inventory', item.id), {
        category: genericForm.category,
        itemName: genericForm.itemName.trim(),
        location: formatRack(genericForm.rack),
        reorderLevel: reorder,
        stockStatus: computeStatus(item.closingStock, reorder),
        updatedAt: serverTimestamp(),
      })
      toast.success('Item updated')
      onClose()
    } catch {
      toast.error('Failed to update item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-md rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">Edit Inventory Item</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        {isElysia ? (
          <form onSubmit={handleSubmitElysia} className="space-y-4">
            <div>
              <label className="form-label">Product</label>
              <div className="grid grid-cols-2 gap-2">
                {(['switch', 'socket'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setElysiaProduct(p)}
                    className={cn(
                      'text-sm px-3 py-2 rounded-lg font-medium border capitalize transition-colors',
                      elysiaForm.product === p
                        ? 'border-pink-500 text-pink-400 bg-pink-900/20'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Module</label>
                <select
                  className="form-input"
                  value={elysiaForm.module}
                  onChange={e => setElysiaForm(f => ({ ...f, module: e.target.value }))}
                >
                  {(elysiaForm.product === 'switch' ? ELYSIA_SWITCH_MODULES : ELYSIA_SOCKET_MODULES).map(m => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Material</label>
                <select
                  className="form-input"
                  value={elysiaForm.material}
                  onChange={e => setElysiaForm(f => ({ ...f, material: e.target.value }))}
                >
                  <option value="">—</option>
                  {ELYSIA_MATERIALS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Color *</label>
              <select
                className="form-input"
                value={elysiaForm.color}
                onChange={e => setElysiaForm(f => ({ ...f, color: e.target.value }))}
              >
                <option value="">—</option>
                {ELYSIA_COLORS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Rack</label>
              <input
                className="form-input"
                type="number"
                min="0"
                placeholder="e.g. 2"
                value={elysiaForm.rack}
                onChange={e => setElysiaForm(f => ({ ...f, rack: e.target.value }))}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>Save Changes</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitGeneric} className="space-y-4">
            <div>
              <label className="form-label">Item Code</label>
              <div className="form-input flex items-center text-gray-500">{item.itemCode}</div>
            </div>
            <div>
              <label className="form-label">Category</label>
              <select
                className="form-input"
                value={genericForm.category}
                onChange={e => setGenericForm(f => ({ ...f, category: e.target.value }))}
              >
                {genericCategories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Item Name *</label>
              <input
                className="form-input"
                value={genericForm.itemName}
                onChange={e => setGenericForm(f => ({ ...f, itemName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Rack</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  placeholder="e.g. 2"
                  value={genericForm.rack}
                  onChange={e => setGenericForm(f => ({ ...f, rack: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Reorder Level</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={genericForm.reorderLevel}
                  onChange={e => setGenericForm(f => ({ ...f, reorderLevel: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>Save Changes</Button>
            </div>
          </form>
        )}
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
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [colorFilter, setColorFilter] = useState('ALL')
  const [rackFilter, setRackFilter] = useState('ALL')
  const [materialFilter, setMaterialFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'all' | StockStatus>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [stockModal, setStockModal] = useState<{ item: InventoryItem; type: 'import' | 'issue' } | null>(null)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editingLocation, setEditingLocation] = useState<{ id: string; value: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const saveLocation = async (itemId: string, value: string) => {
    try {
      await updateDoc(doc(db, 'inventory', itemId), { location: formatRack(value), updatedAt: serverTimestamp() })
      toast.success('Rack updated')
    } catch {
      toast.error('Failed to update location')
    } finally {
      setEditingLocation(null)
    }
  }

  const canManage = role ? ['super_admin', 'management', 'dept_head'].includes(role) : false
  const canIssue  = role ? ['super_admin', 'management', 'dept_head', 'project_manager'].includes(role) : false
  const canDelete = role === 'super_admin'

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!window.confirm(`Delete "${item.itemName}" (${item.itemCode})? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'inventory', item.id))
      toast.success('Item deleted')
    } catch {
      toast.error('Failed to delete item')
    }
  }

  useEffect(() => {
    const q = query(collection(db, 'inventory'), orderBy('itemCode', 'asc'), limit(1000))
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItem))
      setLoading(false)
    })
  }, [])

  // single memo — deps are all primitives + items array, no chained memos
  const { lineItems, types, materials, colors, modules, racks, filtered } = useMemo(() => {
    const scoped = line
      ? items.filter(i => (i.productLine ?? 'elysia') === line)
      : items

    const typs = Array.from(new Set(scoped.map(getItemType))).sort()
    const mats = Array.from(new Set(scoped.map(i => i.material).filter((m): m is string => !!m))).sort()
    const cols = Array.from(new Set(scoped.map(i => getItemColor(i)).filter((c): c is string => !!c))).sort()
    // Modules: switch sub-categories (1T, 4T, CITRUM, etc) for Switch, or the Single/Double Socket
    // variant recovered from the item name for Socket. Scoped to the selected Type so picking Socket
    // shows socket modules and Switch shows switch modules, never both.
    const typeScoped = typeFilter === 'ALL' ? scoped : scoped.filter(i => getItemType(i) === typeFilter)
    const mods = Array.from(new Set(typeScoped.map(getItemModule).filter(Boolean))).sort()
    const rcks = Array.from(new Set(scoped.map(i => i.location).filter((l): l is string => !!l))).sort()

    const rows = scoped.filter(item => {
      if (typeFilter !== 'ALL' && getItemType(item) !== typeFilter) return false
      if (materialFilter !== 'ALL' && item.material !== materialFilter) return false
      if (colorFilter !== 'ALL' && getItemColor(item) !== colorFilter) return false
      if (categoryFilter !== 'ALL' && getItemModule(item) !== categoryFilter) return false
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
      types: [...STATIC_CATEGORIES, ...typs],
      materials: [...STATIC_CATEGORIES, ...mats],
      colors: [...STATIC_CATEGORIES, ...cols],
      modules: [...STATIC_CATEGORIES, ...mods],
      racks: [...STATIC_CATEGORIES, ...rcks],
      filtered: rows,
    }
  }, [items, line, typeFilter, categoryFilter, colorFilter, rackFilter, materialFilter, statusFilter, search])

  const lineLabel = line ? (line.charAt(0).toUpperCase() + line.slice(1)) : 'All'

  const handleExport = () => {
    if (line === 'elysia') {
      const rows = [
        [...getCsvHeaders(line), 'Closing Stock', 'Stock Status'],
        ...lineItems.map(i => [
          getItemType(i), getItemModule(i), i.material || '', getItemColor(i) || '',
          extractRackNumber(i.location), String(i.openingStock),
          String(i.closingStock), STATUS_CONFIG[i.stockStatus].label,
        ]),
      ]
      downloadCsv(`elysia-export-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows))
      return
    }

    const rows = [
      [...getCsvHeaders(line), 'Closing Stock', 'Stock Status'],
      ...lineItems.map(i => [
        i.itemCode, i.category, i.itemName,
        extractRackNumber(i.location),
        String(i.openingStock), String(i.importedQty), String(i.issuedQty), String(i.reorderLevel),
        String(i.closingStock), STATUS_CONFIG[i.stockStatus].label,
      ]),
    ]
    downloadCsv(`${line ?? 'inventory'}-export-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows))
  }

  const handleDownloadTemplate = () => {
    if (line === 'elysia') {
      // Mirrors the simplified Add Item form: Product/Module/Material/Color/Rack/Opening Stock.
      // Item Code and Item Name are derived on import, same as manual entry.
      const itemRows = [...lineItems]
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
        .map(i => [
          getItemType(i), getItemModule(i), i.material || '', getItemColor(i) || '',
          extractRackNumber(i.location), String(i.closingStock),
        ])

      const exampleRows = [
        ['Switch', ELYSIA_SWITCH_MODULES[0], ELYSIA_MATERIALS[0], ELYSIA_COLORS[0], '2', '10'],
        ['Socket', ELYSIA_SOCKET_MODULES[0], ELYSIA_MATERIALS[0], ELYSIA_COLORS[0], '5', '5'],
      ]

      const rows = [getRecountHeaders(line), ...itemRows, ...exampleRows]
      downloadCsv(`elysia-data-entry-template-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows))
      return
    }

    // Vitrum: pre-filled with every current item so a physical recount just means filling in
    // "Counted Stock" per row, instead of retyping the whole catalog from scratch.
    const itemRows = [...lineItems]
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
      .map(i => [i.itemCode, i.category, i.itemName, extractRackNumber(i.location), String(i.closingStock), String(i.reorderLevel)])

    const exampleCategory = CATEGORIES_BY_LINE[line ?? 'vitrum']?.[0] ?? 'OTHER'
    const exampleRow = ['NEW-ITEM-CODE', exampleCategory, 'New Item Found During Count', '2', '0', '0']

    const rows = [getRecountHeaders(line), ...itemRows, exampleRow]
    downloadCsv(`${line ?? 'inventory'}-recount-template-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows))
  }

  const handleImportFile = async (file: File) => {
    if (!line) {
      toast.error('Open the Elysia or Vitrum page to import')
      return
    }
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length < 2) {
        toast.error('CSV has no data rows')
        return
      }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const idx = (name: string) => header.indexOf(name.toLowerCase())

      // Elysia's simplified data-entry format: Product/Module/Material/Color/Rack/Opening Stock.
      // Item Code and Item Name are derived the same way as the Add Item form.
      if (line === 'elysia' && idx('product') !== -1 && idx('module') !== -1) {
        const iProduct = idx('product'), iModule = idx('module'), iMat2 = idx('material')
        const iColor2 = idx('color'), iRack2 = idx('rack'), iOpen2 = idx('opening stock')

        let created2 = 0, updated2 = 0, skipped2 = 0
        for (const row of rows.slice(1)) {
          const productRaw = row[iProduct]?.trim().toLowerCase()
          const product: 'switch' | 'socket' = productRaw === 'socket' ? 'socket' : 'switch'
          const module = row[iModule]?.trim()
          const color = row[iColor2]?.trim() ?? ''
          if (!module || !color) { skipped2++; continue }

          const material = row[iMat2]?.trim() ?? ''
          const location = formatRack(row[iRack2]?.trim() ?? '')
          const opening = Number(row[iOpen2]) || 0
          const itemCode = buildElysiaItemCode(module, color, material)
          const itemName = buildElysiaItemName(product, module, color)
          const category = product === 'socket' ? 'SOCKET' : module

          const existing = items.find(it => it.itemCode === itemCode && (it.productLine ?? 'elysia') === 'elysia')
          if (existing) {
            await updateDoc(doc(db, 'inventory', existing.id), {
              category, itemName, location, material, color,
              openingStock: opening, importedQty: 0, issuedQty: 0,
              closingStock: opening, stockStatus: computeStatus(opening, existing.reorderLevel), updatedAt: serverTimestamp(),
            })
            updated2++
          } else {
            await addDoc(collection(db, 'inventory'), {
              itemCode, category, itemName, location, material, color, productLine: 'elysia',
              openingStock: opening, importedQty: 0, issuedQty: 0,
              closingStock: opening, reorderLevel: 0, stockStatus: computeStatus(opening, 0),
              createdBy: user?.id ?? 'import', createdByName: user?.name ?? 'CSV Import',
              createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            })
            created2++
          }
        }
        toast.success(`Import done — ${created2} added, ${updated2} updated${skipped2 ? `, ${skipped2} skipped` : ''}`)
        return
      }

      const iCode = idx('item code'), iCat = idx('category'), iName = idx('item name')
      const iRack = idx('rack') !== -1 ? idx('rack') : idx('location')
      const iMat = idx('material')
      const iColor = idx('color')
      const iCounted = idx('counted stock')
      const iOpen = idx('opening stock'), iImp = idx('imported qty'), iIss = idx('issued qty'), iReorder = idx('reorder level')
      const isRecount = iCounted !== -1

      if (iCode === -1 || iName === -1) {
        toast.error('CSV must include Item Code and Item Name columns')
        return
      }

      let created = 0, updated = 0, skipped = 0
      for (const row of rows.slice(1)) {
        const itemCode = row[iCode]?.trim().toUpperCase()
        if (!itemCode) { skipped++; continue }

        const itemName = row[iName]?.trim() || itemCode
        const category = (iCat !== -1 ? row[iCat]?.trim() : '') || (CATEGORIES_BY_LINE[line]?.[0] ?? 'OTHER')
        const rackRaw = iRack !== -1 ? (row[iRack]?.trim() ?? '') : ''
        const location = formatRack(extractRackNumber(rackRaw) || rackRaw)
        const material = line === 'elysia' && iMat !== -1 ? (row[iMat]?.trim() ?? '') : ''
        const color = line === 'elysia' && iColor !== -1 ? (row[iColor]?.trim() ?? '') : ''
        const reorder = Number(row[iReorder]) || 0
        const existing = items.find(it => it.itemCode === itemCode && (it.productLine ?? 'elysia') === line)

        if (isRecount) {
          // Recount: Counted Stock is the actual physical count, so it fully replaces the running
          // ledger — opening resets to the counted number and imported/issued reset to 0.
          const counted = Number(row[iCounted]) || 0
          if (existing) {
            await updateDoc(doc(db, 'inventory', existing.id), {
              category, itemName, location, material, color,
              openingStock: counted, importedQty: 0, issuedQty: 0, reorderLevel: reorder,
              closingStock: counted, stockStatus: computeStatus(counted, reorder), updatedAt: serverTimestamp(),
            })
            updated++
          } else {
            await addDoc(collection(db, 'inventory'), {
              itemCode, category, itemName, location, material, color, productLine: line,
              openingStock: counted, importedQty: 0, issuedQty: 0, reorderLevel: reorder,
              closingStock: counted, stockStatus: computeStatus(counted, reorder),
              createdBy: user?.id ?? 'import', createdByName: user?.name ?? 'CSV Import',
              createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            })
            created++
          }
          continue
        }

        const csvOpening = Number(row[iOpen]) || 0
        const csvImported = Number(row[iImp]) || 0
        const csvIssued = Number(row[iIss]) || 0

        if (existing) {
          // Imported/Issued from the CSV are deltas added on top of existing totals — opening stock is the
          // original baseline and isn't re-applied from the file on every import.
          const importedQty = existing.importedQty + csvImported
          const issuedQty = existing.issuedQty + csvIssued
          const closingStock = existing.openingStock + importedQty - issuedQty
          await updateDoc(doc(db, 'inventory', existing.id), {
            category, itemName, location, material, color,
            importedQty, issuedQty, reorderLevel: reorder,
            closingStock, stockStatus: computeStatus(closingStock, reorder), updatedAt: serverTimestamp(),
          })
          updated++
        } else {
          const closingStock = csvOpening + csvImported - csvIssued
          await addDoc(collection(db, 'inventory'), {
            itemCode, category, itemName, location, material, color, productLine: line,
            openingStock: csvOpening, importedQty: csvImported, issuedQty: csvIssued, reorderLevel: reorder,
            closingStock, stockStatus: computeStatus(closingStock, reorder),
            createdBy: user?.id ?? 'import', createdByName: user?.name ?? 'CSV Import',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
          created++
        }
      }
      toast.success(`Import done — ${created} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`)
    } catch (err) {
      toast.error('Import failed')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{lineLabel} · {lineItems.length} items tracked</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="ghost" size="sm" icon={<Download className="w-4 h-4" />} onClick={handleExport}>
              Export CSV
            </Button>
            {line && (
              <>
                <Button variant="ghost" size="sm" icon={<FileSpreadsheet className="w-4 h-4" />} onClick={handleDownloadTemplate}>
                  Template
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Upload className="w-4 h-4" />}
                  loading={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import CSV
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleImportFile(f)
                    e.target.value = ''
                  }}
                />
              </>
            )}
            <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowAdd(true)}>
              Add Item
            </Button>
          </div>
        )}
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

          {/* Type chips (Switch / Socket) */}
          {types.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider mb-1.5">Type</p>
              <div className="flex gap-2 flex-wrap">
                {types.map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                      typeFilter === t
                        ? 'border-pink-500 text-pink-400 bg-pink-900/20'
                        : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Material chips */}
          {materials.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider mb-1.5">Material</p>
              <div className="flex gap-2 flex-wrap">
                {materials.map(mat => (
                  <button
                    key={mat}
                    onClick={() => setMaterialFilter(mat)}
                    className={cn(
                      'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                      materialFilter === mat
                        ? 'border-purple-500 text-purple-400 bg-purple-900/20'
                        : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                    )}
                  >
                    {mat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color chips */}
          {colors.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider mb-1.5">Color</p>
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
            </div>
          )}

          {/* Module chips (1T, 4T, CITRUM, etc) */}
          {modules.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider mb-1.5">Module</p>
              <div className="flex gap-2 flex-wrap">
                {modules.map(mod => (
                  <button
                    key={mod}
                    onClick={() => setCategoryFilter(mod)}
                    className={cn(
                      'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                      categoryFilter === mod
                        ? 'border-yellow-500 text-yellow-400 bg-yellow-900/20'
                        : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                    )}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rack chips */}
          {racks.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider mb-1.5">Rack</p>
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
                      {['Code', 'Category', 'Item Name', 'Color', 'Material', 'Rack', 'Opening', 'Imported', 'Issued', 'Closing', 'Reorder', 'Status', ''].map(h => (
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
                          <td className="px-4 py-3 text-xs text-gray-400">{item.material || '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {editingLocation?.id === item.id ? (
                              <input
                                autoFocus
                                type="number"
                                min="0"
                                className="form-input py-0.5 px-2 text-xs w-20"
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
                                onClick={() => setEditingLocation({ id: item.id, value: extractRackNumber(item.location) })}
                                className="cursor-pointer hover:text-gray-300 border-b border-dashed border-gray-700 hover:border-gray-500 transition-colors"
                                title="Click to edit rack"
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
                              {canManage && (
                                <button
                                  onClick={() => setEditingItem(item)}
                                  title="Edit Item"
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:bg-indigo-900/50 hover:text-indigo-400 transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => handleDeleteItem(item)}
                                  title="Delete Item"
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:bg-red-900/50 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
        <AddItemModal onClose={() => setShowAdd(false)} userId={user.id} userName={user.name} line={line} />
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
      {editingItem && (
        <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}
