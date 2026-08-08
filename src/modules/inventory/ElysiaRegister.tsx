import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, X, Search, NotebookPen, ArrowUpCircle, ArrowDownCircle, PackagePlus } from 'lucide-react'
import {
  db, collection, doc, getDocs, query, where, orderBy, limit, onSnapshot,
  runTransaction, serverTimestamp, Timestamp,
} from '../../lib/firebase'
import { Button } from '../../components/ui/Button'
import type { InventoryItem, StockStatus } from '../../types'
import { cn } from '../../lib/utils'
import { closingOf, txnKindOf, isOutwardKind, TXN_LABEL, type TxnKind } from '../../lib/stock'
import { describeFirestoreError } from '../../lib/errorMessage'
import toast from 'react-hot-toast'

/**
 * Elysia stock as a daily register.
 *
 * The warehouse team came from a paper register and a five-tab Google Sheet,
 * and the tabs were the problem: knowing which sheet a movement belonged in was
 * a decision they had to make before they could write anything down. Here there
 * is one button, one form, and the entry lands wherever it needs to — the item's
 * stock figures and the transaction log both update from a single save, in one
 * Firestore transaction, so the two can never disagree.
 *
 * Nothing new was added to the database for this: entries are `stockTransactions`
 * rows and stock lives on the `inventory` doc, exactly as the rest of the module
 * writes them. The Stock In / Stock Out buttons, the Transaction Log and the
 * editable sheet all keep working on the same data.
 */

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

/** Local YYYY-MM-DD. Not toISOString(), which would shift the date in IST. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toDate(ts: unknown): Date | null {
  const t = ts as { toDate?: () => Date } | undefined
  return typeof t?.toDate === 'function' ? t.toDate() : null
}

interface RegisterTxn {
  id: string
  itemId: string
  itemCode: string
  itemName: string
  customerName?: string
  /** Who carried the stock — rider, courier or staff member. */
  carrier?: string
  /** What was entered here. Older rows only have `type`. */
  txnKind?: TxnKind
  type: 'import' | 'issue'
  quantity: number
  note?: string
  /** The date the user picked, which can differ from when it was keyed in. */
  txnDate?: string
  recordedByName?: string
  createdAt?: unknown
}

/** Shared with the Transaction Log — see lib/stock.ts for why it lives there. */
const kindOf = (t: RegisterTxn): TxnKind => txnKindOf(t)
const isOutward = isOutwardKind
const KIND_LABEL = TXN_LABEL

const KIND_CHIP: Record<TxnKind, string> = {
  sent: 'text-red-400 bg-red-500/10',
  returned: 'text-green-400 bg-green-500/10',
  received: 'text-blue-400 bg-blue-500/10',
}

const DEFAULT_NOTE: Record<TxnKind, string> = {
  sent: 'Sent to customer',
  returned: 'Returned by customer',
  received: 'Stock received',
}

function dayOf(t: RegisterTxn): string {
  if (t.txnDate) return t.txnDate
  const d = toDate(t.createdAt)
  return d ? dateKey(d) : ''
}

function timeOf(t: RegisterTxn): string {
  const d = toDate(t.createdAt)
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'
}

function prettyDate(key: string): string {
  if (!key) return '—'
  const [y, m, d] = key.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/**
 * The riders and couriers stock usually goes out with. A starting list only —
 * anything typed into the field is remembered from then on, so the list grows
 * with use instead of needing someone to maintain it.
 */
const DEFAULT_CARRIERS = ['Rapido', 'Courier', 'Dheeraj', 'Amit', 'Majid', 'Sufi', 'Shahid', 'Mahavir', 'Darshan', 'Self pickup', 'Others']

type Period = 'today' | 'week' | 'month' | 'all'

/** Inclusive start of the selected period; null means no date limit. */
function periodStart(period: Period): Date | null {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'today') return midnight
  if (period === 'week') {
    // Week runs Monday–Sunday, which is how the team reads a register page.
    const daysSinceMonday = (now.getDay() + 6) % 7
    return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - daysSinceMonday)
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

/**
 * Pick from the list, or type a name that isn't on it yet.
 *
 * A plain dropdown is a dead end the first time a new client or a new rider
 * turns up, and a plain text box invites six spellings of the same person. This
 * is a dropdown with "+ Add new…" at the bottom that swaps itself for a text
 * box — so the common case is one tap and the new case is still possible,
 * without anyone having to go and set the name up somewhere else first.
 */
function PickOrAdd({
  label, value, onChange, options, placeholder, required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  required?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) ref.current?.focus() }, [adding])

  // A name saved earlier that is no longer in the list must still show, or
  // reopening a form would silently blank it.
  const list = value && !options.includes(value) ? [value, ...options] : options

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="form-label">{label}{required ? ' *' : ''}</label>
        {adding && (
          <button
            type="button"
            onClick={() => { setAdding(false); onChange('') }}
            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
          >
            pick from list
          </button>
        )}
      </div>

      {adding ? (
        <input
          ref={ref}
          className="form-input"
          placeholder={`New ${label.toLowerCase()} name`}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <select
          className="form-input"
          value={value}
          onChange={e => {
            if (e.target.value === '__add__') { onChange(''); setAdding(true); return }
            onChange(e.target.value)
          }}
        >
          <option value="">{placeholder}</option>
          {list.map(o => <option key={o} value={o}>{o}</option>)}
          <option value="__add__">+ Add new…</option>
        </select>
      )}
    </div>
  )
}

// ─── New Transaction form ──────────────────────────────────────────────────────

function NewTransactionModal({
  items, customers, suppliers, carriers, userId, userName, onClose,
}: {
  items: InventoryItem[]
  customers: string[]
  suppliers: string[]
  carriers: string[]
  userId: string
  userName: string
  onClose: () => void
}) {
  const [date, setDate] = useState(dateKey(new Date()))
  const [customer, setCustomer] = useState('')
  const [carrier, setCarrier] = useState('')
  const [kind, setKind] = useState<TxnKind>('sent')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  const item = items.find(i => i.id === itemId)
  const available = item?.closingStock ?? 0
  const quantity = Number(qty)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itemId || !item) { toast.error('Choose an item'); return }
    // A delivery's supplier is useful but not always known at the counter; who
    // a customer is, is the whole point of the entry.
    if (kind !== 'received' && !customer.trim()) { toast.error('Enter the customer'); return }
    if (!Number.isInteger(quantity) || quantity < 1) { toast.error('Enter a quantity of 1 or more'); return }
    if (kind === 'sent' && quantity > available) {
      toast.error(`Only ${available} in stock`)
      return
    }

    setSaving(true)
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, 'inventory', itemId)
        const snap = await tx.get(ref)
        if (!snap.exists()) throw new Error('This item no longer exists')
        const cur = snap.data() as InventoryItem

        const curOutward = cur.outwardQty ?? 0
        let outward = curOutward
        let imported = cur.importedQty

        if (kind === 'sent') {
          // Re-check against the stored figure: the screen may be a few seconds
          // stale, and two people dispatching the last units at once must not
          // both succeed.
          const stock = closingOf(cur)
          if (quantity > stock) throw new Error(`Only ${stock} in stock now`)
          outward = curOutward + quantity
        } else if (kind === 'received') {
          // A delivery is simply stock in — it cancels nothing.
          imported = cur.importedQty + quantity
        } else {
          // A return first cancels stock that went out. Anything beyond what is
          // still outstanding is stock arriving that never left, so it counts as
          // received — otherwise outward would go negative and inflate closing.
          outward = Math.max(0, curOutward - quantity)
          imported = cur.importedQty + (quantity - (curOutward - outward))
        }

        const closing = closingOf({ ...cur, importedQty: imported, outwardQty: outward })

        tx.update(ref, {
          outwardQty: outward,
          importedQty: imported,
          closingStock: closing,
          stockStatus: computeStatus(closing, cur.reorderLevel),
          // Keep the sheet's Client column showing who the stock last went to.
          ...(kind === 'sent' ? { clientName: customer.trim() } : {}),
          updatedAt: serverTimestamp(),
        })

        // Same shape the Stock In / Stock Out buttons write, so this entry shows
        // up in the Transaction Log alongside them instead of in a parallel world.
        tx.set(doc(collection(db, 'stockTransactions')), {
          itemId,
          itemCode: cur.itemCode,
          itemName: cur.itemName,
          type: kind === 'sent' ? 'issue' : 'import',
          txnKind: kind,
          quantity,
          customerName: customer.trim() || null,
          carrier: carrier.trim() || null,
          note: remarks.trim() || DEFAULT_NOTE[kind],
          txnDate: date,
          recordedBy: userId,
          recordedByName: userName,
          createdAt: serverTimestamp(),
        })
      })

      const who = customer.trim()
      toast.success(
        kind === 'sent' ? `${quantity} sent to ${who}`
        : kind === 'returned' ? `${quantity} returned by ${who}`
        : `${quantity} received${who ? ` from ${who}` : ''}`,
      )
      onClose()
    } catch (err) {
      toast.error(describeFirestoreError(err, 'Could not save the entry'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-md rounded-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-gold-400" />
            <h2 className="text-base font-semibold text-gray-100">New Transaction</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={save} className="space-y-4">
          {/* Type comes first: it decides whether the next field asks for a
              customer or a supplier, and whether stock goes up or down. */}
          <div>
            <label className="form-label">Transaction Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'sent', label: 'Sent', hint: 'Goes out', icon: ArrowUpCircle, color: '#ef4444' },
                { v: 'returned', label: 'Returned', hint: 'Comes back', icon: ArrowDownCircle, color: '#22c55e' },
                { v: 'received', label: 'Received', hint: 'New stock in', icon: PackagePlus, color: '#60a5fa' },
              ] as const).map(o => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setKind(o.v)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-2.5 rounded-xl border text-left transition-colors',
                    kind === o.v ? 'border-gold-500 bg-gold-500/10' : 'border-gray-800 hover:border-gray-600',
                  )}
                >
                  <o.icon className="w-4 h-4 shrink-0" style={{ color: o.color }} />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-200 truncate">{o.label}</span>
                    <span className="block text-[10px] text-gray-500 truncate">{o.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <PickOrAdd
              label={kind === 'received' ? 'Supplier' : 'Customer'}
              required={kind !== 'received'}
              value={customer}
              onChange={setCustomer}
              options={kind === 'received' ? suppliers : customers}
              placeholder={kind === 'received' ? 'Who supplied it? (optional)' : 'Select customer'}
            />
          </div>

          <PickOrAdd
            label="Carrier"
            value={carrier}
            onChange={setCarrier}
            options={carriers}
            placeholder="Who is carrying it? (optional)"
          />

          <div>
            <label className="form-label">Item *</label>
            <select className="form-input" value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">Select item</option>
              {items.map(i => (
                <option key={i.id} value={i.id}>
                  {i.itemName} — {i.closingStock} in stock{i.location ? ` (${i.location})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Quantity *</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max={kind === 'sent' && item ? available : undefined}
                placeholder="0"
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
              {item && (
                <p className={cn('mt-1 text-[11px]', kind === 'sent' && quantity > available ? 'text-red-400' : 'text-gray-500')}>
                  {available} in stock
                  {quantity > 0 && (kind === 'sent' ? available >= quantity : true)
                    ? ` → ${kind === 'sent' ? available - quantity : available + quantity} after saving`
                    : ''}
                </p>
              )}
            </div>
            <div>
              <label className="form-label">Remarks</label>
              <input className="form-input" placeholder="Optional" value={remarks} onChange={e => setRemarks(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Save Entry</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Register ──────────────────────────────────────────────────────────────────

export function ElysiaRegister({
  items, canEdit, userId, userName,
}: {
  items: InventoryItem[]
  canEdit: boolean
  userId: string
  userName: string
}) {
  const [txns, setTxns] = useState<RegisterTxn[]>([])
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const customersLoaded = useRef(false)

  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('today')
  const [customerFilter, setCustomerFilter] = useState('')
  const [itemFilter, setItemFilter] = useState('')

  // Live, so the register updates as other people record entries.
  //
  // Scoped to the last 45 days rather than the last N rows: the filters only
  // reach back a month, so anything older was being read on every visit and
  // then thrown away. `where` and `orderBy` are on the same field, so this
  // needs no composite index — nothing to deploy.
  useEffect(() => {
    const since = new Date()
    since.setDate(since.getDate() - 45)
    const q = query(
      collection(db, 'stockTransactions'),
      where('createdAt', '>=', Timestamp.fromDate(since)),
      orderBy('createdAt', 'desc'),
      limit(150),
    )
    return onSnapshot(
      q,
      snap => {
        setTxns(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RegisterTxn))
        setLoading(false)
      },
      err => {
        // An empty register and a register you aren't allowed to read look
        // identical on screen, so say which one this is.
        console.error(err)
        setLoading(false)
        toast.error(describeFirestoreError(err, "Couldn't load transactions"))
      },
    )
  }, [])

  // Fetched when the form is first opened, not on every visit to the page.
  // Most people come here to read the register, and the customer list is only
  // needed by the one dropdown inside the dialog.
  useEffect(() => {
    if (!showForm || customersLoaded.current) return
    customersLoaded.current = true
    getDocs(query(collection(db, 'customers'), limit(200)))
      .then(snap => setCustomers(snap.docs.map(d => (d.data() as { name?: string }).name ?? '').filter(Boolean)))
      .catch(console.error)
  }, [showForm])

  const itemIds = useMemo(() => new Set(items.map(i => i.id)), [items])

  /**
   * Customers and suppliers are kept apart. Both are typed into the same field,
   * but a supplier offered as a customer — and vice versa — makes both lists
   * useless within a week.
   */
  const customerOptions = useMemo(() => {
    const used = txns.filter(t => kindOf(t) !== 'received').map(t => t.customerName ?? '').filter(Boolean)
    return [...new Set([...customers, ...used])].sort((a, b) => a.localeCompare(b))
  }, [customers, txns])

  const supplierOptions = useMemo(() => {
    const used = txns.filter(t => kindOf(t) === 'received').map(t => t.customerName ?? '').filter(Boolean)
    return [...new Set(used)].sort((a, b) => a.localeCompare(b))
  }, [txns])

  /** Carriers: the starting list plus every rider already used in the register. */
  const carrierOptions = useMemo(() => {
    const used = txns.map(t => t.carrier ?? '').filter(Boolean)
    return [...new Set([...DEFAULT_CARRIERS, ...used])].sort((a, b) => a.localeCompare(b))
  }, [txns])

  /** Only names that actually appear in the register can be filtered on. */
  const customersInLog = useMemo(
    () => [...new Set(txns.filter(t => itemIds.has(t.itemId)).map(t => t.customerName ?? '').filter(Boolean))].sort(),
    [txns, itemIds],
  )

  const visible = useMemo(() => {
    const start = periodStart(period)
    const startKey = start ? dateKey(start) : null
    const q = search.trim().toLowerCase()

    return txns
      // Elysia only — the log holds every product line. Rows for items hidden by
      // the filter bar above drop out too, so both halves of the page agree.
      .filter(t => itemIds.has(t.itemId))
      .filter(t => !startKey || dayOf(t) >= startKey)
      .filter(t => !customerFilter || t.customerName === customerFilter)
      .filter(t => !itemFilter || t.itemId === itemFilter)
      .filter(t => !q || [
        t.customerName, t.carrier, t.itemName, t.itemCode, t.note, t.recordedByName,
        dayOf(t), prettyDate(dayOf(t)),
      ].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [txns, itemIds, period, customerFilter, itemFilter, search])

  const unitsOf = (k: TxnKind) =>
    visible.filter(t => kindOf(t) === k).reduce((s, t) => s + (t.quantity ?? 0), 0)
  const sentUnits = unitsOf('sent')
  const returnedUnits = unitsOf('returned')
  const receivedUnits = unitsOf('received')

  const stockRows = useMemo(
    () => [...items].sort((a, b) => a.itemName.localeCompare(b.itemName)),
    [items],
  )

  const periodLabel = period === 'today' ? "Today's Transactions"
    : period === 'week' ? "This Week's Transactions"
    : period === 'month' ? "This Month's Transactions"
    : 'All Transactions'

  const clearFilters = useCallback(() => {
    setSearch(''); setCustomerFilter(''); setItemFilter(''); setPeriod('today')
  }, [])

  return (
    <div>
      {/* ── Toolbar: one button, one search box, four period chips ───────────── */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button variant="primary" onClick={() => setShowForm(true)} className="shrink-0">
              <Plus className="w-4 h-4 mr-1.5" /> New Transaction
            </Button>
          ) : (
            <p className="text-xs text-gray-500">Read-only — your role cannot record stock movements.</p>
          )}

          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="form-input pl-9"
              placeholder="Search customer, item or date…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { v: 'today', label: 'Today' },
            { v: 'week', label: 'This Week' },
            { v: 'month', label: 'This Month' },
            { v: 'all', label: 'All' },
          ] as const).map(p => (
            <button
              key={p.v}
              onClick={() => setPeriod(p.v)}
              className={cn(
                'text-xs px-3 py-1 rounded-lg font-medium transition-colors border',
                period === p.v
                  ? 'border-gold-500 text-gold-400 bg-gold-500/10'
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400',
              )}
            >
              {p.label}
            </button>
          ))}

          <select
            className="form-input py-1 text-xs w-auto min-w-[150px]"
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
          >
            <option value="">All customers</option>
            {customersInLog.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            className="form-input py-1 text-xs w-auto min-w-[150px]"
            value={itemFilter}
            onChange={e => setItemFilter(e.target.value)}
          >
            <option value="">All items</option>
            {stockRows.map(i => <option key={i.id} value={i.id}>{i.itemName}</option>)}
          </select>

          {(search || customerFilter || itemFilter || period !== 'today') && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 underline">
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Transactions ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-200">{periodLabel}</h3>
        <p className="text-[11px] text-gray-500">
          {visible.length} entr{visible.length === 1 ? 'y' : 'ies'}
          {visible.length > 0 && (
            <>
              {' '}· <span className="text-red-400">{sentUnits} sent</span>
              {' '}· <span className="text-green-400">{returnedUnits} returned</span>
              {' '}· <span className="text-blue-400">{receivedUnits} received</span>
            </>
          )}
        </p>
      </div>

      <div className="overflow-auto table-scroll max-h-[42vh] min-h-[9rem]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--app-bg)' }}>
            <tr className="border-b border-gray-800">
              {['Date', 'Customer', 'Carrier', 'Item', 'Type', 'Qty', 'Remarks', 'User', 'Time'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-600">Loading register…</td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <NotebookPen className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    {period === 'today' ? 'Nothing recorded today yet' : 'No entries match these filters'}
                  </p>
                  {canEdit && period === 'today' && (
                    <p className="text-xs text-gray-600 mt-1">Click “New Transaction” to write the first entry</p>
                  )}
                </td>
              </tr>
            ) : visible.map(t => {
              const k = kindOf(t)
              const out = isOutward(k)
              return (
                <tr key={t.id} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{prettyDate(dayOf(t))}</td>
                  <td className="px-3 py-2 text-xs text-gray-200 font-medium">{t.customerName || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{t.carrier || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-300">{t.itemName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', KIND_CHIP[k])}>
                      {KIND_LABEL[k]}
                    </span>
                  </td>
                  <td className={cn('px-3 py-2 text-xs font-bold tabular-nums', out ? 'text-red-400' : 'text-green-400')}>
                    {out ? '−' : '+'}{t.quantity}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[220px] truncate" title={t.note}>{t.note || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{t.recordedByName || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{timeOf(t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Current stock ────────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-2 flex items-baseline justify-between gap-3 flex-wrap border-t border-gray-800">
        <h3 className="text-sm font-semibold text-gray-200">Current Stock</h3>
        <p className="text-[11px] text-gray-500">Updates automatically after every entry</p>
      </div>

      <div className="overflow-auto table-scroll max-h-[38vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--app-bg)' }}>
            <tr className="border-b border-gray-800">
              {['Item', 'Available Quantity', 'Rack', 'Status'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {stockRows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-600">No items match the filters above.</td></tr>
            ) : stockRows.map(i => {
              const closing = i.closingStock
              const color = closing <= 0 ? 'text-red-400'
                : closing <= i.reorderLevel ? 'text-yellow-400' : 'text-green-400'
              const label = closing <= 0 ? 'Out of stock'
                : closing <= i.reorderLevel ? 'Low stock' : 'In stock'
              return (
                <tr key={i.id} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-xs text-gray-200">{i.itemName}</td>
                  <td className={cn('px-3 py-2 text-xs font-bold tabular-nums', color)}>{closing}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{i.location || '—'}</td>
                  <td className={cn('px-3 py-2 text-xs font-medium whitespace-nowrap', color)}>{label}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 text-[11px] text-gray-600 border-t border-gray-800">
        {stockRows.length} item{stockRows.length === 1 ? '' : 's'} · Sent reduces stock · Returned and Received add to it
      </div>

      {showForm && (
        <NewTransactionModal
          items={stockRows}
          customers={customerOptions}
          suppliers={supplierOptions}
          carriers={carrierOptions}
          userId={userId}
          userName={userName}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
