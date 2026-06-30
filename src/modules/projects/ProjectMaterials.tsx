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
  csvLabel: string          // raw text from the CSV (code or name)
  orderedQty: number
  unitPrice: number
  itemId: string            // matched inventory doc id, '' if unmatched
  auto: boolean             // whether it was auto-matched
}

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
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
  const handleFile = async (file: File) => {
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) { toast.error('CSV has no data rows'); return }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const find = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i } return -1 }
      const iCode = find('item code', 'code', 'sku')
      const iName = find('item name', 'name', 'product', 'description')
      const iQty = find('quantity', 'qty', 'ordered', 'ordered qty')
      const iPrice = find('unit price', 'price', 'rate')

      if (iCode === -1 && iName === -1) {
        toast.error('CSV needs an Item Code or Item Name column')
        return
      }

      const byCode = new Map(inventory.map(i => [i.itemCode.trim().toUpperCase(), i]))
      const byName = new Map(inventory.map(i => [i.itemName.trim().toUpperCase(), i]))

      const built: MappingRow[] = rows.slice(1).map(r => {
        const codeRaw = iCode !== -1 ? (r[iCode]?.trim() ?? '') : ''
        const nameRaw = iName !== -1 ? (r[iName]?.trim() ?? '') : ''
        const match = (codeRaw && byCode.get(codeRaw.toUpperCase())) || (nameRaw && byName.get(nameRaw.toUpperCase())) || null
        return {
          csvLabel: codeRaw || nameRaw,
          orderedQty: Number(r[iQty]) || 0,
          unitPrice: Number(r[iPrice]) || 0,
          itemId: match ? match.id : '',
          auto: !!match,
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
    const valid = mapping.filter(m => m.itemId && m.orderedQty > 0)
    if (!valid.length) { toast.error('Map at least one row to an item with a quantity'); return }
    setImporting(true)
    try {
      for (const m of valid) {
        const inv = invById.get(m.itemId)
        if (!inv) continue
        await addDoc(collection(db, 'projects', projectId, 'orderItems'), {
          itemId: m.itemId,
          itemCode: inv.itemCode,
          itemName: inv.itemName,
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
          inventory={inventory}
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

function MappingModal({ mapping, inventory, importing, onChange, onConfirm, onClose }: {
  mapping: MappingRow[]
  inventory: InventoryItem[]
  importing: boolean
  onChange: (m: MappingRow[]) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const matched = mapping.filter(m => m.itemId).length
  const set = (idx: number, patch: Partial<MappingRow>) =>
    onChange(mapping.map((m, i) => i === idx ? { ...m, ...patch } : m))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-2xl rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">
            Review mapping <span className="text-xs text-gray-500 font-normal">· {matched}/{mapping.length} matched</span>
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-gray-500">
          Each CSV row is matched to an inventory item by code or name. Fix any unmatched rows before importing — unmatched rows are skipped.
        </p>

        <div className="space-y-2">
          {mapping.map((m, idx) => (
            <div key={idx} className={cn('rounded-lg border p-3 space-y-2', m.itemId ? 'border-gray-800' : 'border-red-900/50 bg-red-900/10')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-300 font-mono truncate">{m.csvLabel}</span>
                {m.itemId
                  ? (m.auto ? <span className="text-[11px] text-green-400 shrink-0">auto-matched</span> : <span className="text-[11px] text-indigo-400 shrink-0">manual</span>)
                  : <span className="text-[11px] text-red-400 flex items-center gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> unmatched</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                <select
                  className="form-input text-xs"
                  value={m.itemId}
                  onChange={e => set(idx, { itemId: e.target.value, auto: false })}
                >
                  <option value="">— select inventory item —</option>
                  {inventory.map(i => <option key={i.id} value={i.id}>{i.itemCode} · {i.itemName}</option>)}
                </select>
                <input
                  type="number" min="0" className="form-input text-xs w-24" placeholder="Qty"
                  value={m.orderedQty || ''} onChange={e => set(idx, { orderedQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number" min="0" className="form-input text-xs w-28" placeholder="Unit ₹"
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
