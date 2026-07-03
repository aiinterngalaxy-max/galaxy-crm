import { useState, useEffect, useRef, useMemo } from 'react'
import { Package, Upload, Truck, X, AlertTriangle, Check, Trash2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import {
  db, collection, doc, addDoc, updateDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, runTransaction, getDocs, writeBatch,
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

interface DispatchRecord {
  id: string
  itemCode: string
  itemName: string
  quantity: number
  recordedByName: string
  createdAt: any
}

type CurtainMotorType = 'standard' | 'tabular'
type CurtainRemote    = '1ch' | '2ch' | 'tab' | 'none'
type CurtainKaan      = 'big' | 'small'

interface MappingRow {
  csvLabel: string          // raw text from the CSV (panel name or code)
  orderedQty: number
  unitPrice: number
  // Elysia fields
  module: string            // resolved/chosen Elysia module, '' if unresolved
  material: string          // defaults to Aluminium
  color: string             // defaults to Grey
  auto: boolean             // whether module was auto-resolved
  // Curtain fields
  isCurtain: boolean
  curtainType?: CurtainMotorType   // standard | tabular (for motor rows)
  curtainFeet?: number             // track length in feet (motor rows)
  curtainRemote?: CurtainRemote    // remote choice (motor rows)
  curtainKaan?: CurtainKaan        // kaan type (standard motor rows)
  curtainDirectQty?: number        // for remote/controller rows: dispatch directly
  curtainInventoryCode?: string    // itemCode to dispatch directly
}

// ─── Curtain detection ─────────────────────────────────────────────────────────

function suggestBelt(feet: number): number {
  if (feet <= 10) return 7
  if (feet <= 12) return 8
  if (feet <= 15) return 9.5
  if (feet <= 20) return 12
  return Math.ceil(feet * 0.62)
}

function detectCurtainRow(label: string): Partial<MappingRow> | null {
  const up = label.toUpperCase()
  // Tabular motor
  if (up.includes('GS/CM/003') || (up.includes('TABULAR') && up.includes('MOTOR'))) {
    return { isCurtain: true, curtainType: 'tabular', curtainFeet: 0, curtainRemote: 'none', curtainKaan: 'small' }
  }
  // Standard motor (5-wire / wifi)
  if (up.includes('GS/CM/001') || up.includes('GS/CM/002') || (up.includes('CURTAIN') && up.includes('MOTOR'))) {
    return { isCurtain: true, curtainType: 'standard', curtainFeet: 0, curtainRemote: 'none', curtainKaan: 'small' }
  }
  // Single channel remote / controller
  if (up.includes('GS/CM/004') || (up.includes('SINGLE') && up.includes('CHANNEL'))) {
    return { isCurtain: true, curtainInventoryCode: '1 CH REMOTE' }
  }
  // Double channel remote
  if (up.includes('GS/CM/005') || (up.includes('DOUBLE') && up.includes('CHANNEL'))) {
    return { isCurtain: true, curtainInventoryCode: '2 CH REMOTE' }
  }
  return null
}

function calcCurtainLines(row: MappingRow): Array<{ itemCode: string; qty: number; label: string }> {
  if (!row.isCurtain) return []
  // Direct-dispatch items (remotes/controllers)
  if (row.curtainInventoryCode) return [{ itemCode: row.curtainInventoryCode, qty: row.orderedQty, label: row.csvLabel }]
  if (!row.curtainType || !row.curtainFeet) return []

  const f      = row.curtainFeet
  const motors = f <= 19 ? 1 : 2
  const lines: Array<{ itemCode: string; qty: number; label: string }> = []

  if (row.curtainType === 'standard') {
    lines.push({ itemCode: 'MOTOR',         qty: motors,     label: 'Motor' })
    lines.push({ itemCode: 'RUNNERS(Pack)', qty: f * 3,      label: 'Runners' })
    lines.push({ itemCode: 'CARRIERS',      qty: motors,     label: 'Carriers' })
    lines.push({ itemCode: 'BRACKET',       qty: motors * 4, label: 'Bracket' })
    lines.push({ itemCode: row.curtainKaan === 'big' ? 'BIG KAAN' : 'SMALL KAAN', qty: motors * 2, label: 'Kaan' })
    lines.push({ itemCode: 'BELT',          qty: suggestBelt(f), label: 'Belt' })
  } else {
    lines.push({ itemCode: 'TABULAR', qty: motors, label: 'Tabular Motor' })
    lines.push({ itemCode: 'TABULAR HOOK [PAIR]', qty: motors * 2, label: 'Tabular Hook' })
  }

  if (row.curtainRemote && row.curtainRemote !== 'none') {
    const map: Record<string, string> = { '1ch': '1 CH REMOTE', '2ch': '2 CH REMOTE', 'tab': 'TAB REMOTE' }
    lines.push({ itemCode: map[row.curtainRemote], qty: 1, label: 'Remote' })
  }

  return lines
}

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

// ─── Elysia module/code generation (mirrors InventoryPage.tsx's Add Item logic) ──

const ELYSIA_SWITCH_MODULES = ['1T', '2T', '3T', '4T', 'D/T Knob', 'Music Knob', '4T LCD', '6T', '8T', 'Multifunctional Switch', 'Multifunctional Type-C']
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false)
  const [dispatchHistory, setDispatchHistory] = useState<DispatchRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubInv = onSnapshot(query(collection(db, 'inventory'), orderBy('itemCode')), snap => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItem))
    })
    const unsubOrders = onSnapshot(query(collection(db, 'projects', projectId, 'orderItems'), orderBy('itemName')), snap => {
      setOrderItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as OrderItem))
    })
    const unsubHistory = onSnapshot(
      query(collection(db, 'stockTransactions'), where('projectId', '==', projectId), where('type', '==', 'issue')),
      snap => {
        const records = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DispatchRecord)
        records.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setDispatchHistory(records)
      }
    )
    return () => { unsubInv(); unsubOrders(); unsubHistory() }
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
      const HEADER_KEYWORDS = ['panels', 'panel', 'panel name', 'item code', 'code', 'sku', 'item name', 'sr', 'sr.']
      const headerIdx = rows.findIndex(r =>
        r.some(c => HEADER_KEYWORDS.includes(c.trim().toLowerCase().replace(/\.+$/, '')))
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
      const iPrice = find('unit price', 'price', 'rate', 'discounted rate', 'discountd rate', 'discount rate')

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
            isCurtain: false,
          }
        }

        // Check if this is a curtain item first
        const rawLabel = panelRaw || codeRaw || nameRaw
        const curtainDetected = detectCurtainRow(rawLabel)
        if (curtainDetected) {
          return {
            csvLabel: rawLabel, orderedQty, unitPrice,
            module: 'CURTAIN', material: '', color: '', auto: true,
            ...curtainDetected,
          } as MappingRow
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
          isCurtain: false,
        }
      }).filter(m => m.csvLabel && m.orderedQty > 0)

      if (!built.length) { toast.error('No rows with quantity > 0 found'); return }
      setMapping(built)
    } catch (err) {
      toast.error('Could not read CSV')
      console.error(err)
    }
  }

  const confirmMapping = async () => {
    if (!mapping) return

    // Validate curtain rows have feet entered
    const curtainMotorRows = mapping.filter(m => m.isCurtain && m.curtainType && !m.curtainInventoryCode)
    for (const m of curtainMotorRows) {
      if (!m.curtainFeet || m.curtainFeet <= 0) {
        toast.error(`Enter track length in feet for: ${m.csvLabel.slice(0, 40)}`)
        return
      }
    }

    const elysiaValid = mapping.filter(m => !m.isCurtain && m.module && m.module !== 'CURTAIN' && m.color && m.orderedQty > 0)
    const curtainValid = mapping.filter(m => m.isCurtain)
    if (!elysiaValid.length && !curtainValid.length) {
      toast.error('No valid rows to import')
      return
    }

    setImporting(true)
    try {
      // ── Elysia rows ──────────────────────────────────────────────────────────
      for (const m of elysiaValid) {
        const itemCode = buildElysiaItemCode(m.module, m.color, m.material)
        const itemName = buildElysiaItemName(m.module, m.color)
        const existing = inventory.find(i => i.itemCode === itemCode && (i.productLine ?? 'elysia') === 'elysia')
        let itemId = existing?.id
        if (!existing) {
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
          unitPrice: m.unitPrice, orderedQty: m.orderedQty, deliveredQty: 0,
          createdAt: serverTimestamp(),
        })
      }

      // ── Curtain rows — dispatch from curtain inventory ───────────────────────
      const curtainSnap = await (async () => {
        if (!curtainValid.length) return null
        const { getDocs, query: fsQuery, where: fsWhere } = await import('firebase/firestore')
        return getDocs(fsQuery(collection(db, 'inventory'), fsWhere('productLine', '==', 'curtains')))
      })()

      if (curtainSnap) {
        const curtainMap = new Map<string, InventoryItem & { id: string }>()
        curtainSnap.docs.forEach(d => curtainMap.set(d.data().itemCode, { id: d.id, ...d.data() } as InventoryItem & { id: string }))

        const toDispatch = new Map<string, number>() // itemCode → total qty

        for (const m of curtainValid) {
          const lines = calcCurtainLines(m)
          for (const line of lines) {
            toDispatch.set(line.itemCode, (toDispatch.get(line.itemCode) ?? 0) + line.qty)
          }
        }

        for (const [itemCode, qty] of toDispatch) {
          const item = curtainMap.get(itemCode)
          if (!item) continue
          const newIssued  = (item.issuedQty ?? 0) + qty
          const newClosing = (item.openingStock ?? 0) + (item.importedQty ?? 0) - newIssued
          const newStatus  = newClosing <= 0 ? 'out_of_stock' : newClosing <= (item.reorderLevel ?? 0) ? 'low_stock' : 'in_stock'
          await updateDoc(doc(db, 'inventory', item.id), {
            issuedQty: newIssued, closingStock: newClosing, stockStatus: newStatus, updatedAt: serverTimestamp(),
          })
          // Add to project order items so it shows in dispatch log
          await addDoc(collection(db, 'projects', projectId, 'orderItems'), {
            itemId: item.id, itemCode, itemName: item.itemName,
            unitPrice: 0, orderedQty: qty, deliveredQty: qty,
            createdAt: serverTimestamp(),
          })
        }
      }

      toast.success(`Imported ${elysiaValid.length + curtainValid.length} row(s)`)
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
          projectId,
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

  // ── Bulk dispatch ─────────────────────────────────────────────────────────────
  const doBulkDispatch = async (rows: { order: OrderItem; qty: number }[]) => {
    try {
      await runTransaction(db, async (tx) => {
        const invSnaps = await Promise.all(rows.map(r => tx.get(doc(db, 'inventory', r.order.itemId))))
        for (let i = 0; i < rows.length; i++) {
          const { order, qty } = rows[i]
          const invSnap = invSnaps[i]
          if (!invSnap.exists()) throw new Error(`${order.itemCode} no longer exists`)
          const inv = invSnap.data() as InventoryItem
          if (qty > inv.closingStock) throw new Error(`Only ${inv.closingStock} of ${order.itemCode} in stock`)
          const newIssued = inv.issuedQty + qty
          const newClosing = inv.openingStock + inv.importedQty - newIssued
          tx.update(doc(db, 'inventory', order.itemId), {
            issuedQty: newIssued, closingStock: newClosing,
            stockStatus: computeStatus(newClosing, inv.reorderLevel),
            updatedAt: serverTimestamp(),
          })
          tx.update(doc(db, 'projects', projectId, 'orderItems', order.id), {
            deliveredQty: order.deliveredQty + qty,
          })
          tx.set(doc(collection(db, 'stockTransactions')), {
            itemId: order.itemId, itemCode: order.itemCode, itemName: order.itemName,
            type: 'issue', quantity: qty, projectId,
            note: `Project ${projectCode} dispatch`,
            recordedBy: userId, recordedByName: userName,
            createdAt: serverTimestamp(),
          })
        }
      })
      toast.success(`Dispatched ${rows.length} item type(s)`)
      setBulkDispatchOpen(false)
      setSelectedIds(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk dispatch failed')
    }
  }

  // ── Clear all order items ─────────────────────────────────────────────────────
  const clearOrder = async () => {
    if (!window.confirm('Delete all order items for this project? This cannot be undone.')) return
    try {
      const snap = await getDocs(query(collection(db, 'projects', projectId, 'orderItems')))
      const batch = writeBatch(db)
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      toast.success('Order cleared')
    } catch {
      toast.error('Failed to clear order')
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
        <div className="flex items-center gap-2 flex-wrap">
          {canManage && selectedIds.size > 0 && (
            <Button size="sm" variant="primary" icon={<Truck className="w-3.5 h-3.5" />} onClick={() => setBulkDispatchOpen(true)}>
              Dispatch Selected ({selectedIds.size})
            </Button>
          )}
          {canManage && (
            <>
              {orderItems.length > 0 && (
                <Button size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />} onClick={clearOrder}>
                  <span className="text-red-400">Clear Order</span>
                </Button>
              )}
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
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox"
                      className="accent-indigo-500"
                      checked={selectedIds.size === orderItems.filter(o => o.orderedQty - o.deliveredQty > 0).length && selectedIds.size > 0}
                      onChange={e => {
                        const pending = orderItems.filter(o => o.orderedQty - o.deliveredQty > 0)
                        setSelectedIds(e.target.checked ? new Set(pending.map(o => o.id)) : new Set())
                      }}
                    />
                  </th>
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
                      <td className="px-3 py-2.5">
                        {!done && (
                          <input type="checkbox" className="accent-indigo-500"
                            checked={selectedIds.has(o.id)}
                            onChange={e => setSelectedIds(s => {
                              const next = new Set(s)
                              e.target.checked ? next.add(o.id) : next.delete(o.id)
                              return next
                            })}
                          />
                        )}
                      </td>
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

      {/* Dispatch history */}
      {dispatchHistory.length > 0 && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-500 hover:text-gray-300 flex items-center justify-between"
          >
            <span>Dispatch History ({dispatchHistory.length})</span>
            <span>{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Date & Time', 'Code', 'Item', 'Qty', 'By'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {dispatchHistory.map(r => (
                    <tr key={r.id} className="hover:bg-gray-800/20">
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-400 whitespace-nowrap">{r.itemCode}</td>
                      <td className="px-4 py-2 text-xs text-gray-300">{r.itemName}</td>
                      <td className="px-4 py-2 text-xs text-green-400 font-semibold text-right">{r.quantity}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.recordedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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

      {/* Bulk dispatch modal */}
      {bulkDispatchOpen && (
        <BulkDispatchModal
          orders={orderItems.filter(o => selectedIds.has(o.id))}
          invById={invById}
          onConfirm={doBulkDispatch}
          onClose={() => setBulkDispatchOpen(false)}
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
  const set = (idx: number, patch: Partial<MappingRow>) =>
    onChange(mapping.map((m, i) => i === idx ? { ...m, ...patch } : m))

  const elysiaRows  = mapping.filter(m => !m.isCurtain)
  const curtainRows = mapping.filter(m => m.isCurtain)
  const elysiaResolved = elysiaRows.filter(m => m.module && m.module !== 'CURTAIN').length
  const curtainReady   = curtainRows.filter(m => m.curtainInventoryCode || (m.curtainFeet && m.curtainFeet > 0)).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-2xl rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">Review & Import</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        {/* ── Curtain rows ─────────────────────────────────────────── */}
        {curtainRows.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gold-400 uppercase tracking-wide flex items-center gap-2">
              🪟 Curtain Items
              <span className="text-gray-600 font-normal normal-case">— enter track length per item</span>
            </p>
            {mapping.map((m, idx) => {
              if (!m.isCurtain) return null

              // Direct-dispatch item (remote/controller — qty comes from CSV)
              if (m.curtainInventoryCode) {
                return (
                  <div key={idx} className="rounded-xl border border-gold-500/20 bg-gold-500/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-200 truncate">{m.csvLabel}</p>
                        <p className="text-xs text-gray-500 mt-0.5">→ dispatch <span className="text-gold-400 font-medium">{m.orderedQty} × {m.curtainInventoryCode}</span> from curtain stock</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 shrink-0">auto</span>
                    </div>
                  </div>
                )
              }

              // Motor row — needs feet input
              const f = m.curtainFeet ?? 0
              const motors = f <= 19 ? 1 : 2
              const preview = f > 0
                ? m.curtainType === 'standard'
                  ? `${motors} motor · ${f * 3} runners · ${motors * 4} brackets · ${motors * 2} kaan · ${suggestBelt(f)}m belt`
                  : `${motors} tabular motor · ${motors * 2} hooks`
                : null

              const needsFeet = !f || f <= 0

              return (
                <div key={idx} className={cn('rounded-xl border p-4 space-y-3', needsFeet ? 'border-amber-600/40 bg-amber-900/10' : 'border-gold-500/20 bg-gold-500/5')}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-200">{m.csvLabel}</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 mt-1 inline-block">
                        {m.curtainType === 'standard' ? '5 Wire / WiFi Motor' : 'Tabular Motor'}
                      </span>
                    </div>
                    {needsFeet
                      ? <span className="text-[11px] text-amber-400 flex items-center gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> enter feet</span>
                      : <span className="text-[11px] text-green-400 shrink-0">✓ ready</span>}
                  </div>

                  {/* Feet input */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400 whitespace-nowrap">Track length:</label>
                      <input
                        type="number" min={1}
                        className="form-input text-sm w-20 text-center"
                        placeholder="ft"
                        value={m.curtainFeet || ''}
                        onChange={e => set(idx, { curtainFeet: Number(e.target.value) || 0 })}
                      />
                      <span className="text-xs text-gray-500">ft</span>
                    </div>
                    {f > 0 && (
                      <span className={`text-xs font-medium ${motors > 1 ? 'text-amber-400' : 'text-green-400'}`}>
                        → {motors} motor{motors > 1 ? 's' : ''}
                      </span>
                    )}

                    {/* Kaan (standard only) */}
                    {m.curtainType === 'standard' && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400">Kaan:</label>
                        <select
                          className="form-input text-xs py-1"
                          value={m.curtainKaan ?? 'small'}
                          onChange={e => set(idx, { curtainKaan: e.target.value as CurtainKaan })}
                        >
                          <option value="small">Small Kaan</option>
                          <option value="big">Big Kaan</option>
                        </select>
                      </div>
                    )}

                    {/* Remote */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400">Remote:</label>
                      <select
                        className="form-input text-xs py-1"
                        value={m.curtainRemote ?? 'none'}
                        onChange={e => set(idx, { curtainRemote: e.target.value as CurtainRemote })}
                      >
                        <option value="none">No Remote</option>
                        <option value="1ch">1 Channel</option>
                        <option value="2ch">2 Channel</option>
                        <option value="tab">Tab Remote</option>
                      </select>
                    </div>
                  </div>

                  {/* Preview */}
                  {preview && (
                    <p className="text-xs text-gray-500 bg-gray-800/50 rounded-lg px-3 py-2">
                      Will dispatch: <span className="text-gray-300">{preview}</span>
                      {m.curtainRemote && m.curtainRemote !== 'none' && (
                        <span className="text-gray-300"> · 1 remote</span>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Elysia rows ──────────────────────────────────────────── */}
        {elysiaRows.length > 0 && (
          <div className="space-y-2">
            {curtainRows.length > 0 && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Switch / Socket Items</p>
            )}
            <p className="text-xs text-gray-500">
              Module resolved automatically where possible. Unresolved rows need a Module picked manually.
            </p>
            {mapping.map((m, idx) => {
              if (m.isCurtain) return null
              return (
                <div key={idx} className={cn('rounded-lg border p-3 space-y-2', m.module ? 'border-gray-800' : 'border-red-900/50 bg-red-900/10')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-300 truncate">{m.csvLabel}</span>
                    {m.module
                      ? (m.auto ? <span className="text-[11px] text-green-400 shrink-0">auto-resolved</span> : <span className="text-[11px] text-indigo-400 shrink-0">manual</span>)
                      : <span className="text-[11px] text-red-400 flex items-center gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> needs Module</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <select className="form-input text-xs col-span-2 sm:col-span-1" value={m.module} onChange={e => set(idx, { module: e.target.value, auto: false })}>
                      <option value="">— Module —</option>
                      {ELYSIA_MODULES.map(mod => <option key={mod}>{mod}</option>)}
                    </select>
                    <select className="form-input text-xs" value={m.material} onChange={e => set(idx, { material: e.target.value })}>
                      {ELYSIA_MATERIALS.map(mat => <option key={mat}>{mat}</option>)}
                    </select>
                    <select className="form-input text-xs" value={m.color} onChange={e => set(idx, { color: e.target.value })}>
                      {ELYSIA_COLORS.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input type="number" min="0" className="form-input text-xs" placeholder="Qty"
                      value={m.orderedQty || ''} onChange={e => set(idx, { orderedQty: Number(e.target.value) || 0 })} />
                    <input type="number" min="0" className="form-input text-xs" placeholder="Unit ₹"
                      value={m.unitPrice || ''} onChange={e => set(idx, { unitPrice: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="flex-1" loading={importing} onClick={onConfirm}>
            Import to Order
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk dispatch modal ───────────────────────────────────────────────────────

function BulkDispatchModal({ orders, invById, onConfirm, onClose }: {
  orders: OrderItem[]
  invById: Map<string, InventoryItem>
  onConfirm: (rows: { order: OrderItem; qty: number }[]) => Promise<void>
  onClose: () => void
}) {
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const o of orders) {
      const pending = o.orderedQty - o.deliveredQty
      const stock = invById.get(o.itemId)?.closingStock ?? 0
      init[o.id] = String(Math.min(pending, stock) || '')
    }
    return init
  })
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rows = orders.map(o => ({ order: o, qty: Number(qtys[o.id]) || 0 })).filter(r => r.qty > 0)
    if (!rows.length) { toast.error('Enter at least one quantity'); return }
    setSaving(true)
    await onConfirm(rows)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-lg rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-400" /> Bulk Dispatch
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-2">
          {orders.map(o => {
            const pending = o.orderedQty - o.deliveredQty
            const stock = invById.get(o.itemId)?.closingStock ?? 0
            return (
              <div key={o.id} className="bg-gray-800/50 rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{o.itemName}</p>
                  <p className="text-xs text-gray-500">
                    {o.itemCode} · Pending: <span className="text-yellow-400 font-medium">{pending}</span> · Stock:{' '}
                    <span className={cn('font-medium', stock < pending ? 'text-red-400' : 'text-gray-300')}>{stock}</span>
                  </p>
                </div>
                <input
                  type="number" min="0" max={Math.min(pending, stock)}
                  className="form-input text-xs w-20 shrink-0" placeholder="Qty"
                  value={qtys[o.id] ?? ''}
                  onChange={e => setQtys(q => ({ ...q, [o.id]: e.target.value }))}
                />
              </div>
            )
          })}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Confirm Dispatch</Button>
          </div>
        </form>
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
