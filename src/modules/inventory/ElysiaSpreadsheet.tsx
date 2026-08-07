import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import {
  db, doc, collection, runTransaction, serverTimestamp,
} from '../../lib/firebase'
import type { InventoryItem, StockStatus } from '../../types'
import { cn } from '../../lib/utils'
import { describeFirestoreError } from '../../lib/errorMessage'
import { closingOf } from '../../lib/stock'
import { ElysiaRegister } from './ElysiaRegister'
import toast from 'react-hot-toast'

/**
 * Editable grid for Elysia stock — the same click-a-cell-and-type flow the leads
 * table uses, so the warehouse can correct figures without the Stock In / Stock
 * Out dialogs or a CSV round-trip.
 *
 * The important difference from the leads grid: a quantity edit here also writes
 * a stockTransactions record. Stock movements are the one thing in this app with
 * a real audit trail, and an inline edit that silently changed a closing figure
 * from 12 to 2 would leave ten units unaccounted for with nothing to show who
 * did it or when. Every quantity change made here appears in the Transaction Log
 * exactly like a button-driven one, tagged so it is obvious where it came from.
 */

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

/** Fields that are safe to edit freely — no stock movement, no audit needed. */
type TextField = 'itemCode' | 'itemName' | 'color' | 'material' | 'location' | 'clientName'
/** Fields that change the stock position and therefore must be logged. */
type NumField = 'openingStock' | 'importedQty' | 'issuedQty' | 'outwardQty' | 'reorderLevel'

interface CellProps {
  value: string
  onSave: (v: string) => Promise<void>
  numeric?: boolean
  readOnly?: boolean
  className?: string
  align?: 'left' | 'right'
}

function Cell({ value, onSave, numeric, readOnly, className, align = 'left' }: CellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) ref.current?.select() }, [editing])

  const commit = useCallback(async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      // Put the old value back rather than leaving a number on screen that was
      // never actually saved.
      setDraft(value)
      setEditing(false)
      toast.error(describeFirestoreError(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }, [draft, value, onSave])

  if (readOnly) {
    return <span className={cn('text-gray-400', className)}>{value || '—'}</span>
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type={numeric ? 'number' : 'text'}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={cn(
          'w-full bg-gray-700 border border-indigo-500 rounded px-1 py-0.5 text-xs text-white focus:outline-none min-w-0',
          align === 'right' && 'text-right',
        )}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title={value || 'Click to edit'}
      className={cn(
        'cursor-text hover:bg-gray-700/60 rounded px-1 py-0.5 transition-colors block truncate',
        align === 'right' && 'text-right',
        !value && 'text-gray-600 italic',
        className,
      )}
    >
      {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (value || '—')}
    </span>
  )
}

interface ViewProps {
  items: InventoryItem[]
  canEdit: boolean
  userId: string
  userName: string
}

/**
 * The Elysia section opens as a daily register, because that is what the team
 * was already doing on paper. The grid below is the same sheet as before — kept,
 * not replaced, since correcting a wrong figure is a different job from
 * recording the day's movements, and only this view can do it.
 */
export function ElysiaSpreadsheet(props: ViewProps) {
  const [view, setView] = useState<'register' | 'sheet'>('register')

  return (
    <div>
      <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
        {([
          { v: 'register', label: 'Daily Register', hint: "Today's entries" },
          { v: 'sheet', label: 'Edit Sheet', hint: 'Correct any figure' },
        ] as const).map(t => (
          <button
            key={t.v}
            onClick={() => setView(t.v)}
            title={t.hint}
            className={cn(
              'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border',
              view === t.v
                ? 'border-gold-500 text-gold-400 bg-gold-500/10'
                : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-400',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'register' ? <ElysiaRegister {...props} /> : <SheetGrid {...props} />}
    </div>
  )
}

function SheetGrid({
  items, canEdit, userId, userName,
}: ViewProps) {
  /** Plain field edit — no stock movement, so no transaction record. */
  const saveText = async (item: InventoryItem, field: TextField, value: string) => {
    await runTransaction(db, async tx => {
      tx.update(doc(db, 'inventory', item.id), {
        [field]: value.trim(),
        updatedAt: serverTimestamp(),
      })
    })
  }

  /**
   * Quantity edit. Recomputes closing and status from the stored row inside a
   * transaction (not from the copy on screen, which may be stale if someone else
   * just edited it), and writes a matching stockTransactions entry so the change
   * is visible in the Transaction Log.
   */
  const saveNumber = async (item: InventoryItem, field: NumField, raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next) || next < 0) {
      throw new Error('Enter a whole number of 0 or more')
    }

    await runTransaction(db, async tx => {
      const ref = doc(db, 'inventory', item.id)
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('This item no longer exists')
      const cur = snap.data() as InventoryItem

      const opening  = field === 'openingStock' ? next : cur.openingStock
      const imported = field === 'importedQty'  ? next : cur.importedQty
      const issued   = field === 'issuedQty'    ? next : cur.issuedQty
      const outward  = field === 'outwardQty'   ? next : (cur.outwardQty ?? 0)
      const reorder  = field === 'reorderLevel' ? next : cur.reorderLevel
      const closing  = closingOf({ openingStock: opening, importedQty: imported, issuedQty: issued, outwardQty: outward })

      tx.update(ref, {
        openingStock: opening,
        importedQty: imported,
        issuedQty: issued,
        outwardQty: outward,
        reorderLevel: reorder,
        closingStock: closing,
        stockStatus: computeStatus(closing, reorder),
        updatedAt: serverTimestamp(),
      })

      // Reorder level is a threshold, not stock, so it moves nothing and needs
      // no transaction. The other four change the stock position.
      if (field !== 'reorderLevel') {
        const before = field === 'openingStock' ? cur.openingStock
          : field === 'importedQty' ? cur.importedQty
          : field === 'issuedQty' ? cur.issuedQty : (cur.outwardQty ?? 0)
        const delta = next - before
        if (delta !== 0) {
          // Outward is stock leaving for a client, so the log names who it went
          // to — a bare "issue" row would say nothing about where it went.
          const leaving = field === 'issuedQty' || field === 'outwardQty'
          const client = cur.clientName?.trim()
          const txRef = doc(collection(db, 'stockTransactions'))
          tx.set(txRef, {
            itemId: item.id,
            itemCode: cur.itemCode,
            itemName: cur.itemName,
            // An increase in issued/outward reduces stock; everything else adds to it.
            type: (leaving ? delta > 0 : delta < 0) ? 'issue' : 'import',
            quantity: Math.abs(delta),
            note: field === 'outwardQty'
              ? `Spreadsheet edit — outward ${before} → ${next}${client ? ` (client: ${client})` : ''}`
              : `Spreadsheet edit — ${field} ${before} → ${next}`,
            recordedBy: userId,
            recordedByName: userName,
            createdAt: serverTimestamp(),
          })
        }
      }
    })
  }

  /**
   * Closing is a derived figure, so it cannot simply be written — it would drift
   * away from the columns it is the sum of. Typing one instead back-solves the
   * opening stock that makes the sum come out right, which keeps imported,
   * issued and outward intact and the row still adding up.
   */
  const saveClosing = async (item: InventoryItem, raw: string) => {
    const target = Number(raw)
    if (!Number.isFinite(target) || target < 0) {
      throw new Error('Enter a whole number of 0 or more')
    }

    await runTransaction(db, async tx => {
      const ref = doc(db, 'inventory', item.id)
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('This item no longer exists')
      const cur = snap.data() as InventoryItem

      const movements = cur.importedQty - cur.issuedQty - (cur.outwardQty ?? 0)
      const opening = target - movements
      if (opening < 0) {
        throw new Error(
          `Can't reach a closing of ${target} — ${cur.importedQty} imported already exceeds it. Correct Imported first.`,
        )
      }

      tx.update(ref, {
        openingStock: opening,
        closingStock: target,
        stockStatus: computeStatus(target, cur.reorderLevel),
        updatedAt: serverTimestamp(),
      })

      const delta = target - cur.closingStock
      if (delta !== 0) {
        const txRef = doc(collection(db, 'stockTransactions'))
        tx.set(txRef, {
          itemId: item.id,
          itemCode: cur.itemCode,
          itemName: cur.itemName,
          type: delta > 0 ? 'import' : 'issue',
          quantity: Math.abs(delta),
          note: `Spreadsheet edit — closing ${cur.closingStock} → ${target} (opening adjusted to ${opening})`,
          recordedBy: userId,
          recordedByName: userName,
          createdAt: serverTimestamp(),
        })
      }
    })
  }

  if (!items.length) {
    return (
      <div className="px-4 py-10 text-center text-sm text-gray-600">
        No items match the filters above.
      </div>
    )
  }

  const headers = ['Code', 'Item Name', 'Colour', 'Material', 'Rack', 'Client',
                   'Opening', 'Imported', 'Issued', 'Outward', 'Closing', 'Reorder', 'Status']

  return (
    <div>
      <div className="px-4 py-2.5 text-[11px] text-gray-500 border-b border-gray-800">
        {canEdit
          ? 'Click any cell to edit — every column, Closing included. Outward is stock leaving the warehouse for the client named on the row, and every quantity change is written to the Transaction Log.'
          : 'Read-only — your role cannot edit stock.'}
      </div>

      {/* Scrolls inside its own box so the horizontal bar stays on screen. */}
      <div className="overflow-auto table-scroll max-h-[calc(100vh-26rem)] min-h-[18rem]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--app-bg)' }}>
            <tr className="border-b border-gray-800">
              {headers.map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {items.map(item => {
              const closing = item.closingStock
              const statusColor =
                closing <= 0 ? 'text-red-400'
                : closing <= item.reorderLevel ? 'text-yellow-400'
                : 'text-green-400'
              const statusLabel =
                closing <= 0 ? 'Out of stock'
                : closing <= item.reorderLevel ? 'Low stock' : 'In stock'

              return (
                <tr key={item.id} className="hover:bg-gray-800/30">
                  <td className="px-2 py-2 min-w-[150px]">
                    <Cell value={item.itemCode} readOnly={!canEdit}
                      onSave={v => saveText(item, 'itemCode', v)}
                      className="font-mono text-[11px] text-gray-500" />
                  </td>

                  <td className="px-2 py-2 min-w-[190px]">
                    <Cell value={item.itemName} readOnly={!canEdit}
                      onSave={v => saveText(item, 'itemName', v)}
                      className="text-xs font-medium text-gray-200" />
                  </td>
                  <td className="px-2 py-2 min-w-[90px]">
                    <Cell value={item.color ?? ''} readOnly={!canEdit}
                      onSave={v => saveText(item, 'color', v)} className="text-xs" />
                  </td>
                  <td className="px-2 py-2 min-w-[100px]">
                    <Cell value={item.material ?? ''} readOnly={!canEdit}
                      onSave={v => saveText(item, 'material', v)} className="text-xs" />
                  </td>
                  <td className="px-2 py-2 min-w-[80px]">
                    <Cell value={item.location ?? ''} readOnly={!canEdit}
                      onSave={v => saveText(item, 'location', v)} className="text-xs" />
                  </td>
                  <td className="px-2 py-2 min-w-[140px]">
                    <Cell value={item.clientName ?? ''} readOnly={!canEdit}
                      onSave={v => saveText(item, 'clientName', v)} className="text-xs text-gray-300" />
                  </td>

                  <td className="px-2 py-2 w-20">
                    <Cell value={String(item.openingStock)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveNumber(item, 'openingStock', v)} className="text-xs text-gray-300" />
                  </td>
                  <td className="px-2 py-2 w-20">
                    <Cell value={String(item.importedQty)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveNumber(item, 'importedQty', v)} className="text-xs text-green-400" />
                  </td>
                  <td className="px-2 py-2 w-20">
                    <Cell value={String(item.issuedQty)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveNumber(item, 'issuedQty', v)} className="text-xs text-red-400" />
                  </td>

                  <td className="px-2 py-2 w-20">
                    <Cell value={String(item.outwardQty ?? 0)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveNumber(item, 'outwardQty', v)} className="text-xs text-orange-400" />
                  </td>

                  {/* Editable, but back-solved through opening stock so the row
                      keeps adding up — see saveClosing. */}
                  <td className="px-2 py-2 w-20">
                    <Cell value={String(closing)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveClosing(item, v)}
                      className={cn('text-xs font-bold tabular-nums', statusColor)} />
                  </td>

                  <td className="px-2 py-2 w-20">
                    <Cell value={String(item.reorderLevel)} numeric align="right" readOnly={!canEdit}
                      onSave={v => saveNumber(item, 'reorderLevel', v)} className="text-xs text-gray-400" />
                  </td>

                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={cn('text-xs font-medium', statusColor)}>{statusLabel}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 text-[11px] text-gray-600 border-t border-gray-800">
        {items.length} item{items.length === 1 ? '' : 's'} · Closing = Opening + Imported − Issued − Outward
      </div>
    </div>
  )
}
