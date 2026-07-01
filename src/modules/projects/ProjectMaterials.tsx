import { useState, useEffect, useRef, useMemo } from 'react'
import { Package, Upload, Truck, X, AlertTriangle, Check } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import {
  db, collection, doc, addDoc, updateDoc, onSnapshot, query, orderBy,
  serverTimestamp, runTransaction,
} from '../../lib/firebase'
import type { InventoryItem, StockStatus } from '../../types'
import { formatCurrency } from '../../lib/utils'
import toast from 'react-hot-toast'
import { cn } from '../../lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  itemId: string
  itemCode: string
  itemName: string
  unitPrice: number
  orderedQty: number
  deliveredQty: number
}

interface MappingRow {
  csvLabel: string          // raw text from the CSV (panel name or code)
  orderedQty: number
  unitPrice: number
  module: string            // resolved/chosen Elysia module, '' if unresolved
  material: string          // defaults to Aluminium
  color: string             // defaults to Grey
  auto: boolean             // whether module was auto-resolved (dictionary or exact code match)
}

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

// ─── Elysia module/code generation (mirrors InventoryPage.tsx's Add Item logic) ──

const ELYSIA_SWITCH_MODULES = ['1T', '2T', '3T', '4T', 'D/T Knob', 'Music Knob', '4T LCD', '6T', '8T', 'Multifunctional Switch']
const ELYSIA_SOCKET_MODULES = ['Single Socket USB C', 'Single Socket 5Pin', 'Single Socket 3Pin', 'Double Socket USB C', 'Double Socket 5Pin', 'Apple Wire Socket']
const ELYSIA_MODULES = [...ELYSIA_SWITCH_MODULES, ...ELYSIA_SOCKET_MODULES]
const ELYSIA_MATERIALS = ['Aluminium', 'Skin', 'PC']
const ELYSIA_COLORS = ['Grey', 'Black', 'White', 'Blue', 'Red', 'Gold', 'Silver', 'Brown', 'Orange']

function isSocketModule(module: string): boolean {
  return ELYSIA_SOCKET_MODULES.some(m => m.toUpperCase() === module.toUpperCase())
}

function buildElysiaItemName(module: string, color: string): string {
  const c = color.trim()
  if (isSocketModule(module)) return `${module.toUpperCase()} ${c}`.trim()
  if (module === '4T LCD') return `4 TOUCH LCD ${c}`.trim()
  if (/^\d+T$/.test(module)) {
    const n = module.replace(/[^0-9]/g, '')
    return `${n} TOUCH ${c}`.trim()
  }
  return `${module.toUpperCase()} ${c}`.trim()
}

function buildElysiaItemCode(module: string, color: string, material: string): string {
  return [module.trim().toUpperCase(), color.trim().toUpperCase(), material.trim().toUpperCase()].filter(Boolean).join('-')
}

// Reverse: figure out an existing item's module from its category/name (category = module for
// switches, but is always literally "SOCKET" for sockets — recover the real module from the name).
function moduleOfItem(item: InventoryItem): string {
  if (item.category.toUpperCase() !== 'SOCKET') return item.category
  return ELYSIA_SOCKET_MODULES.find(m => item.itemName.toUpperCase().startsWith(m.toUpperCase())) ?? ''
}

// ─── Panel name → Module dictionary ──────────────────────────────────────────────
// Translates quotation sheet "Panel" descriptions (sales copy) into actual inventory modules.
// Exact-match only on a normalized string — no fuzzy guessing, unmapped rows need a manual pick.

function normalizePanelName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

const PANEL_DICTIONARY: Record<string, string> = {
  // 1T
  [normalizePanelName('Zero fire 1 Key Switch')]: '1T',
  // 2T
  [normalizePanelName('Zero fire 2 key switches')]: '2T',
  [normalizePanelName('Zero fire 2 key switch')]: '2T',
  // 3T
  [normalizePanelName('Zero fire 3 key switches')]: '3T',
  [normalizePanelName('Zero fire 3 key switch')]: '3T',
  // 4T
  [normalizePanelName('Zero fire 4 key switches')]: '4T',
  [normalizePanelName('Zero fire 4 key switch')]: '4T',
  // 4T LCD
  [normalizePanelName('Zero-fire 4 -key switch (4-way load control)')]: '4T LCD',
  [normalizePanelName('Zero-fire 4 -key switch( 4-way load)')]: '4T LCD',
  [normalizePanelName('Zero-fire 4 -key switch (4-way load)')]: '4T LCD',
  // 6T
  [normalizePanelName('Zero-fire 6-key switches (2-way scenario + 4-way load control)')]: '6T',
  [normalizePanelName('Zero-fire 6-switch (2-scenario + 4-load)')]: '6T',
  // 8T
  [normalizePanelName('Zero-fire 8-key switches (4-way scenario + 4-way load control)')]: '8T',
  [normalizePanelName('Zero-fire 8-switch (4-scenario + 4-load)')]: '8T',
  // D/T Knob
  [normalizePanelName('Galaxy Intelligent Dimming Switch With 2 Way Composite Switch')]: 'D/T Knob',
  [normalizePanelName('Intelligent Dimming Switch With Knob')]: 'D/T Knob',
  // Sockets
  [normalizePanelName('Single Socket - USB')]: 'Single Socket USB C',
  [normalizePanelName('Single Socket')]: 'Single Socket USB C',
  [normalizePanelName('Double Socket - USB')]: 'Double Socket USB C',
  [normalizePanelName('Double Socket')]: 'Double Socket USB C',
  [normalizePanelName('Flexi Wired Charger USB + C')]: 'Apple Wire Socket',
  [normalizePanelName('Wired Charger (USB + C)')]: 'Apple Wire Socket',
  // "Galaxy Intelligent Fan Controller With 1 Switch" intentionally left unmapped for now.
}

// Minimal RFC-4180-ish CSV parser (mirrors the inventory page parser).
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

interface ProjectMaterialsProps {
  projectId: string
  projectCode: string
  canManage: boolean
  userId: string
  userName: string
}

export function ProjectMaterials({ projectId, projectCode, canManage, userId, userName }: ProjectMaterialsProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mapping, setMapping] = useState<MappingRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [dispatchTarget, setDispatchTarget] = useState<OrderItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubInv = onSnapshot(query(collection(db, 'inventory'), orderBy('itemCode')), snap => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItem))
    })
    const unsubOrders = onSnapshot(query(collection(db, 'projects', projectId, 'orderItems'), orderBy('itemName')), snap => {
      setOrderItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as OrderItem))
    })
    return () => { unsubInv(); unsubOrders() }
  }, [projectId])

  const invById = useMemo(() => new Map(inventory.map(i => [i.id, i])), [inventory])

  // ── CSV upload → build mapping rows ──────────────────────────────────────────
  // Two input styles, auto-detected by header:
  //  - Exact: an Item Code (or Item Name) column matches a real inventory item directly.
  //  - Quotation: a Panel name + total quantity column (Rooms/Quantity) — resolved via the
  //    Panel→Module dictionary, with Material/Color defaulting to Aluminium/Grey.
  const handleFile = async (file: File) => {
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) { toast.error('CSV has no data rows'); return }

      // Dynamically find the header row — quotation sheets often have title/client/date
      // rows above the actual column headers (e.g. row 5 is "Sr | Panels | Module | ...").
      const HEADER_KEYWORDS = ['panels', 'panel', 'item code', 'code', 'sku', 'item name', 'sr']
      const headerIdx = rows.findIndex(r =>
        r.some(c => HEADER_KEYWORDS.includes(c.trim().toLowerCase()))
      )
      if (headerIdx === -1) {
        toast.error('Could not find header row — CSV must have a Panels, Item Code, or Item Name column')
        return
      }

      const header = rows[headerIdx].map(h => h.trim().toLowerCase())
      const find = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i } return -1 }
      const iCode = find('item code', 'code', 'sku')
      const iName = find('item name', 'name', 'product', 'description')
      const iPanel = find('panels', 'panel', 'panel name')
      const iQty = find('quantity', 'qty', 'ordered', 'ordered qty', 'rooms', 'total qty')
      const iPrice = find('unit price', 'price', 'rate')

      if (iCode === -1 && iName === -1 && iPanel === -1) {
        toast.error('CSV needs an Item Code, Item Name, or Panels column')
        return
      }

      const byCode = new Map(inventory.map(i => [i.itemCode.trim().toUpperCase(), i]))
      const byName = new Map(inventory.map(i => [i.itemName.trim().toUpperCase(), i]))

      const built: MappingRow[] = rows.slice(headerIdx + 1).map(r => {
        const codeRaw = iCode !== -1 ? (r[iCode]?.trim() ?? '') : ''
        const nameRaw = iName !== -1 ? (r[iName]?.trim() ?? '') : ''
        const panelRaw = iPanel !== -1 ? (r[iPanel]?.trim() ?? '') : ''
        const orderedQty = Number(r[iQty]) || 0
        const unitPrice = Number(r[iPrice]) || 0

        // Exact code/name match against a real inventory item — reverse-derive its module so it's pre-filled.
        const exact = (codeRaw && byCode.get(codeRaw.toUpperCase())) || (nameRaw && byName.get(nameRaw.toUpperCase())) || null
        if (exact) {
          return {
            csvLabel: codeRaw || nameRaw,
            orderedQty, unitPrice,
            module: moduleOfItem(exact),
            material: exact.material || 'Aluminium',
            color: exact.color || 'Grey',
            auto: true,
          }
        }

        // Quotation-style: resolve Panel name via the dictionary, default Material/Color.
        const dictModule = panelRaw ? PANEL_DICTIONARY[normalizePanelName(panelRaw)] : undefined
        return {
          csvLabel: panelRaw || codeRaw || nameRaw,
          orderedQty, unitPrice,
          module: dictModule ?? '',
          material: 'Aluminium',
          color: 'Grey',
          auto: !!dictModule,
        }
      }).filter(m => m.csvLabel)

      if (!built.length) { toast.error('No usable rows found'); return }
      setMapping(built)
    } catch (err) {
      toast.error('Could not read CSV')
      console.error(err)
    }
  }

  const confirmMapping = async () => {
    if (!mapping) return
    const valid = mapping.filter(m => m.module && m.color && m.orderedQty > 0)
    if (!valid.length) { toast.error('Pick a Module + Color and quantity for at least one row'); return }
    setImporting(true)
    try {
      for (const m of valid) {
        const itemCode = buildElysiaItemCode(m.module, m.color, m.material)
        const itemName = buildElysiaItemName(m.module, m.color)
        const existing = inventory.find(i => i.itemCode === itemCode && (i.productLine ?? 'elysia') === 'elysia')

        let itemId = existing?.id
        if (!existing) {
          // Item doesn't exist in inventory yet — create it at 0 stock so it's trackable
          // (and can be stocked in later) instead of silently dropping the order line.
          const category = isSocketModule(m.module) ? 'SOCKET' : m.module
          const newRef = await addDoc(collection(db, 'inventory'), {
            itemCode, category, itemName, location: '',
            material: m.material, color: m.color, productLine: 'elysia',
            openingStock: 0, importedQty: 0, issuedQty: 0, closingStock: 0, reorderLevel: 0,
            stockStatus: computeStatus(0, 0),
            createdBy: userId, createdByName: userName,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
          itemId = newRef.id
        }

        await addDoc(collection(db, 'projects', projectId, 'orderItems'), {
          itemId, itemCode, itemName,
          unitPrice: m.unitPrice,
          orderedQty: m.orderedQty,
          deliveredQty: 0,
          createdAt: serverTimestamp(),
        })
      }
      toast.success(`${valid.length} item(s) added to order`)
      setMapping(null)
    } catch (err) {
      toast.error('Failed to save order')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  // ── Dispatch (partial delivery) → deduct stock + log transaction ──────────────
  const doDispatch = async (order: OrderItem, qty: number) => {
    const pending = order.orderedQty - order.deliveredQty
    if (qty <= 0 || qty > pending) { toast.error(`Enter 1–${pending} units`); return }
    try {
      await runTransaction(db, async (tx) => {
        const invRef = doc(db, 'inventory', order.itemId)
        const orderRef = doc(db, 'projects', projectId, 'orderItems', order.id)
        const invSnap = await tx.get(invRef)
        if (!invSnap.exists()) throw new Error('Inventory item no longer exists')
        const inv = invSnap.data() as InventoryItem
        if (qty > inv.closingStock) throw new Error(`Only ${inv.closingStock} in stock`)

        const newIssued = inv.issuedQty + qty
        const newClosing = inv.openingStock + inv.importedQty - newIssued
        tx.update(invRef, {
          issuedQty: newIssued,
          closingStock: newClosing,
          stockStatus: computeStatus(newClosing, inv.reorderLevel),
          updatedAt: serverTimestamp(),
        })
        tx.update(orderRef, { deliveredQty: order.deliveredQty + qty })
        const txRef = doc(collection(db, 'stockTransactions'))
        tx.set(txRef, {
          itemId: order.itemId,
          itemCode: order.itemCode,
          itemName: order.itemName,
          type: 'issue',
          quantity: qty,
          note: `Project ${projectCode} dispatch`,
          recordedBy: userId,
          recordedByName: userName,
          createdAt: serverTimestamp(),
        })
      })
      toast.success(`Dispatched ${qty} × ${order.itemCode}`)
      setDispatchTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dispatch failed')
      console.error(err)
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let ordered = 0, delivered = 0, orderValue = 0, deliveredValue = 0
    for (const o of orderItems) {
      ordered += o.orderedQty
      delivered += o.deliveredQty
      orderValue += o.orderedQty * o.unitPrice
      deliveredValue += o.deliveredQty * o.unitPrice
    }
    return { ordered, delivered, pending: ordered - delivered, orderValue, deliveredValue, pendingValue: orderValue - deliveredValue }
  }, [orderItems])

  return (
    <Card padding="none">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Package className="w-4 h-4 text-indigo-400" /> Materials &amp; Delivery
        </h3>
        {canManage && (
          <>
            <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => fileRef.current?.click()}>
              Upload Order (CSV)
            </Button>
            <input
              ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
          </>
        )}
      </div>

      {orderItems.length === 0 ? (
        <p className="p-6 text-xs text-gray-600 text-center">
          No order uploaded yet. Upload a CSV with <span className="text-gray-400">Item Code</span> (or Item Name) and{' '}
          <span className="text-gray-400">Quantity</span> columns — optionally a Unit Price.
        </p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-800/50 border-b border-gray-800">
            <Stat label="Ordered" value={String(totals.ordered)} />
            <Stat label="Delivered" value={String(totals.delivered)} accent="text-green-400" />
            <Stat label="Pending" value={String(totals.pending)} accent={totals.pending > 0 ? 'text-yellow-400' : 'text-gray-300'} />
            <Stat label="Pending Value" value={formatCurrency(totals.pendingValue)} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Code', 'Item', 'Ordered', 'Delivered', 'Pending', 'In Stock', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {orderItems.map(o => {
                  const pending = o.orderedQty - o.deliveredQty
                  const stock = invById.get(o.itemId)?.closingStock ?? 0
                  const done = pending <= 0
                  return (
                    <tr key={o.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-2.5 text-xs font-mono text-gray-300 whitespace-nowrap">{o.itemCode}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-200">{o.itemName}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 text-right">{o.orderedQty}</td>
                      <td className="px-4 py-2.5 text-xs text-green-400 text-right">{o.deliveredQty}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn('text-xs font-semibold', done ? 'text-gray-500' : 'text-yellow-400')}>{pending}</span>
                      </td>
                      <td className={cn('px-4 py-2.5 text-xs text-right', stock < pending ? 'text-red-400' : 'text-gray-400')}>{stock}</td>
                      <td className="px-4 py-2.5 text-right">
                        {done ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-400"><Check className="w-3.5 h-3.5" /> Done</span>
                        ) : canManage ? (
                          <button
                            onClick={() => setDispatchTarget(o)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-900/30 text-indigo-400 hover:bg-indigo-900/50 transition-colors"
                          >
                            <Truck className="w-3.5 h-3.5" /> Dispatch
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Mapping review modal */}
      {mapping && (
        <MappingModal
          mapping={mapping}
          importing={importing}
          onChange={setMapping}
          onConfirm={confirmMapping}
          onClose={() => setMapping(null)}
        />
      )}

      {/* Dispatch modal */}
      {dispatchTarget && (
        <DispatchModal
          order={dispatchTarget}
          stock={invById.get(dispatchTarget.itemId)?.closingStock ?? 0}
          onConfirm={qty => doDispatch(dispatchTarget, qty)}
          onClose={() => setDispatchTarget(null)}
        />
      )}
    </Card>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-900 px-4 py-3">
      <p className="text-[11px] font-medium text-gray-600 uppercase tracking-wider">{label}</p>
      <p className={cn('text-lg font-bold mt-0.5', accent ?? 'text-gray-200')}>{value}</p>
    </div>
  )
}

// ─── Mapping review modal ──────────────────────────────────────────────────────

function MappingModal({ mapping, importing, onChange, onConfirm, onClose }: {
  mapping: MappingRow[]
  importing: boolean
  onChange: (m: MappingRow[]) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const matched = mapping.filter(m => m.module).length
  const set = (idx: number, patch: Partial<MappingRow>) =>
    onChange(mapping.map((m, i) => i === idx ? { ...m, ...patch } : m))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-2xl rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">
            Review mapping <span className="text-xs text-gray-500 font-normal">· {matched}/{mapping.length} resolved</span>
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-gray-500">
          Each row's Module is resolved from the panel/code automatically where possible. Material and Color default to Aluminium/Grey — adjust any row before importing. Unresolved rows need a Module picked manually.
        </p>

        <div className="space-y-2">
          {mapping.map((m, idx) => (
            <div key={idx} className={cn('rounded-lg border p-3 space-y-2', m.module ? 'border-gray-800' : 'border-red-900/50 bg-red-900/10')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-300 truncate">{m.csvLabel}</span>
                {m.module
                  ? (m.auto ? <span className="text-[11px] text-green-400 shrink-0">auto-resolved</span> : <span className="text-[11px] text-indigo-400 shrink-0">manual</span>)
                  : <span className="text-[11px] text-red-400 flex items-center gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> needs Module</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <select
                  className="form-input text-xs col-span-2 sm:col-span-1"
                  value={m.module}
                  onChange={e => set(idx, { module: e.target.value, auto: false })}
                >
                  <option value="">— Module —</option>
                  {ELYSIA_MODULES.map(mod => <option key={mod}>{mod}</option>)}
                </select>
                <select
                  className="form-input text-xs"
                  value={m.material}
                  onChange={e => set(idx, { material: e.target.value })}
                >
                  {ELYSIA_MATERIALS.map(mat => <option key={mat}>{mat}</option>)}
                </select>
                <select
                  className="form-input text-xs"
                  value={m.color}
                  onChange={e => set(idx, { color: e.target.value })}
                >
                  {ELYSIA_COLORS.map(c => <option key={c}>{c}</option>)}
                </select>
                <input
                  type="number" min="0" className="form-input text-xs" placeholder="Qty"
                  value={m.orderedQty || ''} onChange={e => set(idx, { orderedQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number" min="0" className="form-input text-xs" placeholder="Unit ₹"
                  value={m.unitPrice || ''} onChange={e => set(idx, { unitPrice: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="flex-1" loading={importing} onClick={onConfirm}>Import to Order</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Dispatch modal ────────────────────────────────────────────────────────────

function DispatchModal({ order, stock, onConfirm, onClose }: {
  order: OrderItem
  stock: number
  onConfirm: (qty: number) => void
  onClose: () => void
}) {
  const pending = order.orderedQty - order.deliveredQty
  const [qty, setQty] = useState(String(Math.min(pending, stock) || ''))
  const [saving, setSaving] = useState(false)
  const max = Math.min(pending, stock)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onConfirm(Number(qty))
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-sm rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2"><Truck className="w-5 h-5 text-indigo-400" /> Dispatch</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-gray-200">{order.itemName}</p>
          <p className="text-xs text-gray-500">
            {order.itemCode} · Pending: <span className="text-yellow-400 font-medium">{pending}</span> · In stock: <span className={cn('font-medium', stock < pending ? 'text-red-400' : 'text-gray-300')}>{stock}</span>
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="form-label">Quantity to dispatch *</label>
            <input
              autoFocus type="number" min="1" max={max} className="form-input"
              value={qty} onChange={e => setQty(e.target.value)}
            />
            {stock < pending && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Stock ({stock}) is below pending ({pending}) — dispatch what's available now, rest stays pending.
              </p>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving} disabled={max <= 0}>Confirm Dispatch</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
