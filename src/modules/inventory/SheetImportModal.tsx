import { useState, useMemo } from 'react'
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { db, collection, doc, writeBatch, serverTimestamp, Timestamp } from '../../lib/firebase'
import type { InventoryItem, StockStatus } from '../../types'
import { cn } from '../../lib/utils'
import { describeFirestoreError } from '../../lib/errorMessage'
import {
  findHeader, normaliseKey, parseStockMaster, parseImportLog, parseOutwards, unknownItems,
  type SheetItem, type SheetMovement,
} from '../../lib/sheetImport'
import { parseCsv } from '../../lib/csv'
import toast from 'react-hot-toast'

/**
 * Loads the team's three Google Sheet exports.
 *
 * Nothing is written until the preview has been read and Import pressed. The
 * preview is the point of the screen: it says what will change before anything
 * does, because an import that silently created sixty duplicate products would
 * take longer to undo than to do.
 */

function computeStatus(closing: number, reorder: number): StockStatus {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

/**
 * A movement's document id is derived from the row itself, so importing the
 * same file twice writes over the same document instead of adding a second
 * copy. No read is needed to know whether a row is already in — which matters
 * on a daily read quota.
 */
function movementDocId(fingerprint: string): string {
  let h = 2166136261
  for (let i = 0; i < fingerprint.length; i++) {
    h ^= fingerprint.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `sheet_${(h >>> 0).toString(36)}_${fingerprint.length.toString(36)}`
}

/** Everything the sheet said, kept readable in one line on the log. */
function noteOf(m: SheetMovement): string {
  const bits = [
    m.remarks,
    m.purpose && `Purpose: ${m.purpose}`,
    m.status && `Status: ${m.status}`,
    m.invoice && `Invoice: ${m.invoice}`,
    m.location && `Location: ${m.location}`,
  ].filter(Boolean)
  return bits.join(' · ') || (m.kind === 'sent' ? 'Issued' : 'Stock received')
}

interface Parsed {
  items: SheetItem[]
  movements: SheetMovement[]
  warnings: string[]
  files: string[]
  skipped: number
}

const EMPTY: Parsed = { items: [], movements: [], warnings: [], files: [], skipped: 0 }

export function SheetImportModal({
  items, userId, userName, onClose,
}: {
  items: InventoryItem[]
  userId: string
  userName: string
  onClose: () => void
}) {
  const [parsed, setParsed] = useState<Parsed>(EMPTY)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  /** Existing products, keyed the same way the sheet rows are. */
  const existingByKey = useMemo(
    () => new Map(items.map(i => [normaliseKey(i.itemName), i])),
    [items],
  )

  const plan = useMemo(() => {
    const matched = parsed.items.filter(i => existingByKey.has(i.key))
    const created = parsed.items.filter(i => !existingByKey.has(i.key))
    const orphans = unknownItems(
      parsed.movements,
      // A movement can also match a product already in the CRM, not just one in
      // the uploaded Stock_Master.
      [...parsed.items, ...items.map(i => ({ key: normaliseKey(i.itemName) } as SheetItem))],
    )
    return { matched, created, orphans }
  }, [parsed, existingByKey, items])

  const readFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setReading(true)
    setDone(null)
    try {
      const next: Parsed = { ...EMPTY, items: [], movements: [], warnings: [], files: [] }
      for (const file of Array.from(list)) {
        const rows = parseCsv(await file.text())
        const found = findHeader(rows)
        if (!found) {
          next.warnings.push(`${file.name}: not one of the three sheets — ignored`)
          continue
        }
        if (found.kind === 'stock') {
          const r = parseStockMaster(rows, found.index)
          next.items.push(...r.rows)
          next.warnings.push(...r.warnings)
          next.skipped += r.skipped
          next.files.push(`${file.name} → Stock Master (${r.rows.length} products)`)
        } else {
          const r = found.kind === 'import'
            ? parseImportLog(rows, found.index)
            : parseOutwards(rows, found.index)
          next.movements.push(...r.rows)
          next.warnings.push(...r.warnings)
          next.skipped += r.skipped
          next.files.push(`${file.name} → ${found.kind === 'import' ? 'Import Log' : 'Outwards'} (${r.rows.length} entries)`)
        }
      }
      setParsed(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read those files')
    } finally {
      setReading(false)
    }
  }

  const runImport = async () => {
    setImporting(true)
    try {
      // Item ids as they will be after the write, so movements can point at the
      // products created in this same run.
      const idByKey = new Map<string, string>()
      const codeByKey = new Map<string, string>()
      const nameByKey = new Map<string, string>()
      for (const [key, item] of existingByKey) {
        idByKey.set(key, item.id)
        codeByKey.set(key, item.itemCode)
        nameByKey.set(key, item.itemName)
      }

      let batch = writeBatch(db)
      let queued = 0
      const flush = async (force = false) => {
        // Firestore caps a batch at 500 writes.
        if (force || queued >= 400) { await batch.commit(); batch = writeBatch(db); queued = 0 }
      }

      let updated = 0, created = 0
      for (const s of parsed.items) {
        const closing = s.opening + s.imported - s.issued
        const existing = existingByKey.get(s.key)
        const common = {
          category: s.category || 'OTHER',
          itemName: s.itemName,
          location: s.location,
          openingStock: s.opening,
          importedQty: s.imported,
          issuedQty: s.issued,
          // The sheet has no outward column; its Issued already covers what left.
          outwardQty: 0,
          closingStock: closing,
          reorderLevel: s.reorder,
          stockStatus: computeStatus(closing, s.reorder),
          updatedAt: serverTimestamp(),
        }

        if (existing) {
          batch.update(doc(db, 'inventory', existing.id), common)
          updated++
        } else {
          const ref = doc(collection(db, 'inventory'))
          batch.set(ref, {
            ...common,
            itemCode: s.itemCode,
            productLine: 'elysia',
            createdBy: userId,
            createdByName: userName,
            createdAt: serverTimestamp(),
          })
          idByKey.set(s.key, ref.id)
          codeByKey.set(s.key, s.itemCode)
          nameByKey.set(s.key, s.itemName)
          created++
        }
        queued++
        await flush()
      }

      let history = 0, unmatched = 0
      for (const m of parsed.movements) {
        const itemId = idByKey.get(m.itemKey)
        if (!itemId) { unmatched++; continue }

        // Dated in the past on purpose: the log is ordered by when the movement
        // happened, not when it was uploaded.
        const when = m.date ? new Date(`${m.date}T12:00:00`) : null
        batch.set(doc(db, 'stockTransactions', movementDocId(m.fingerprint)), {
          itemId,
          itemCode: codeByKey.get(m.itemKey) ?? m.itemCode,
          itemName: nameByKey.get(m.itemKey) ?? m.itemName,
          type: m.kind === 'sent' ? 'issue' : 'import',
          txnKind: m.kind,
          quantity: m.qty,
          customerName: m.party || null,
          carrier: m.carrier || null,
          note: noteOf(m),
          txnDate: m.date || null,
          // Kept so a later screen can show the sheet's own columns as columns.
          sheetStatus: m.status || null,
          sheetInvoice: m.invoice || null,
          sheetPurpose: m.purpose || null,
          sheetLocation: m.location || null,
          // History, not a new movement: these quantities are already counted in
          // Stock Master, so nothing here changes stock.
          historical: true,
          importSource: 'google-sheet',
          recordedBy: userId,
          recordedByName: m.party && m.kind === 'received' ? m.party : userName,
          createdAt: when ? Timestamp.fromDate(when) : serverTimestamp(),
        })
        history++
        queued++
        await flush()
      }

      await flush(true)

      setDone(
        `${updated} products updated, ${created} added. ${history} movements loaded into the Transaction Log`
        + (unmatched ? `, ${unmatched} skipped for having no matching product.` : '.'),
      )
      toast.success('Import finished')
    } catch (err) {
      toast.error(describeFirestoreError(err, 'Import failed'))
    } finally {
      setImporting(false)
    }
  }

  const nothingToDo = parsed.items.length === 0 && parsed.movements.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-2xl rounded-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-gold-400" />
            <h2 className="text-base font-semibold text-gray-100">Import from Google Sheets</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-gray-500">
          Upload Stock_Master, Import_Log and Outwards exactly as they come out of Google Sheets — all three
          at once, or one at a time. Nothing is saved until you press Import.
        </p>

        <label className={cn(
          'flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed cursor-pointer transition-colors',
          'border-gray-700 hover:border-gold-500/60',
        )}>
          <Upload className="w-6 h-6 text-gray-600" />
          <span className="text-xs text-gray-400">{reading ? 'Reading…' : 'Choose CSV files'}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={e => readFiles(e.target.files)}
          />
        </label>

        {parsed.files.length > 0 && (
          <div className="space-y-1">
            {parsed.files.map(f => (
              <p key={f} className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> {f}
              </p>
            ))}
          </div>
        )}

        {!nothingToDo && (
          <div className="rounded-xl border border-gray-800 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-200">What will happen</p>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>· <span className="text-gray-200 font-medium">{plan.matched.length}</span> existing products updated with the sheet's quantities</li>
              <li>· <span className="text-gray-200 font-medium">{plan.created.length}</span> new products added</li>
              <li>· <span className="text-gray-200 font-medium">{parsed.movements.length}</span> past movements loaded into the Transaction Log</li>
              <li>· <span className="text-gray-200 font-medium">{parsed.skipped}</span> blank or placeholder rows ignored</li>
            </ul>
            <p className="text-[11px] text-gray-600 pt-1">
              Stock levels come from Stock_Master only. The two logs load as history — their quantities are
              already counted in Stock_Master, so replaying them would double every figure.
            </p>
          </div>
        )}

        {plan.orphans.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {plan.orphans.length} movement{plan.orphans.length === 1 ? '' : 's'} name a product that is in neither list
            </p>
            <p className="text-[11px] text-amber-200/70">{plan.orphans.join(', ')}</p>
            <p className="text-[11px] text-amber-200/50 mt-1">These rows will be skipped.</p>
          </div>
        )}

        {parsed.warnings.length > 0 && (
          <details className="rounded-xl border border-gray-800 p-3">
            <summary className="text-xs text-gray-400 cursor-pointer">{parsed.warnings.length} things worth checking</summary>
            <ul className="text-[11px] text-gray-500 space-y-1 mt-2">
              {parsed.warnings.map((w, i) => <li key={i}>· {w}</li>)}
            </ul>
          </details>
        )}

        {done && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
            <p className="text-xs text-green-300">{done}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            loading={importing}
            disabled={nothingToDo || !!done}
            onClick={runImport}
          >
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}
