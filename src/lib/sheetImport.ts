/**
 * Reads the team's Google Sheet exports as they actually are.
 *
 * The existing CSV importer expects columns the CRM invented. These sheets are
 * the ones the warehouse has been keeping for months, and asking anyone to
 * re-arrange 60 rows into a different layout before every upload is how an
 * import stops being used. So this maps their shape instead: Stock_Master,
 * Import_Log and Outwards, with their own headers, their own date formats and
 * their own gaps.
 *
 * Three things about the real files drive most of the code here:
 *
 * 1. STOCK_MASTER ALREADY INCLUDES THE MOVEMENTS. Its Closing equals Opening +
 *    Imported − Issued for every filled row, and its Imported/Issued totals
 *    match the two logs. So quantities come from Stock_Master alone and the
 *    logs load as history — replaying them would double every figure.
 *
 * 2. ITEM CODE IS NOT UNIQUE. "8 T" is five different products (grey, blue,
 *    rose gold, red, brown) and "SINGLE SKT" is five more. Item Name is what
 *    actually identifies a row, so that is the key, normalised for case and
 *    spacing — which is also what merges "6 TOUCH BLACK" with "6 Touch Black".
 *
 * 3. BLANK MEANS "SAME AS ABOVE". A date is written once and the rows under it
 *    belong to it. Read literally, most movements have no date at all.
 */

// ─── Shapes ───────────────────────────────────────────────────────────────────

export interface SheetItem {
  /** Normalised item name — the identity used for matching and de-duping. */
  key: string
  itemCode: string
  category: string
  itemName: string
  location: string
  opening: number
  imported: number
  issued: number
  reorder: number
}

export type MovementKind = 'received' | 'sent'

export interface SheetMovement {
  kind: MovementKind
  /** YYYY-MM-DD, or '' when the sheet never gave one. */
  date: string
  itemKey: string
  itemCode: string
  itemName: string
  category: string
  qty: number
  /** Customer for sent, "received by" for inward. */
  party: string
  carrier: string
  location: string
  status: string
  invoice: string
  purpose: string
  remarks: string
  /** Stable id for the row, so re-importing the same file changes nothing. */
  fingerprint: string
}

export interface ImportReport<T> {
  rows: T[]
  /** Rows deliberately ignored — blank spacers, template filler, no quantity. */
  skipped: number
  /** Things worth a human look before or after importing. */
  warnings: string[]
}

export type SheetKind = 'stock' | 'import' | 'outward'

// ─── Text helpers ─────────────────────────────────────────────────────────────

/** Case, spacing and punctuation all differ between the sheet and the CRM. */
export function normaliseKey(s: string): string {
  return (s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function num(s: string | undefined): number {
  const n = Number(clean(s))
  return Number.isFinite(n) ? n : 0
}

/**
 * Dates arrive as 13/6/26, 19/06/26, 08/06/2026, 2026-01-07 and once as
 * "06/-8/26". Day always comes first in the hand-typed ones; an ISO-looking
 * value is one Google Sheets auto-converted, and is taken at face value.
 */
export function parseSheetDate(raw: string | undefined): string {
  const s = clean(raw).replace(/-+/g, '-')
  if (!s) return ''

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  const dmy = s.match(/^(\d{1,2})\/-?(\d{1,2})\/-?(\d{2,4})$/)
  if (!dmy) return ''
  const [, d, m, y] = dmy
  const year = y.length === 2 ? `20${y}` : y
  const day = Number(d), month = Number(m)
  if (day < 1 || day > 31 || month < 1 || month > 12) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Which of the three sheets this is, from its header row. */
export function detectSheet(header: string[]): SheetKind | null {
  const h = header.map(c => normaliseKey(c))
  const has = (name: string) => h.includes(normaliseKey(name))
  if (has('Closing Stock') && has('Opening Stock')) return 'stock'
  if (has('Qty IN')) return 'import'
  if (has('Qty Issued')) return 'outward'
  return null
}

/**
 * The header is not always the first line — these exports carry a title row
 * ("Stock Summary", "Inwards") above it, and Outwards starts with a row of
 * spaces. Finds the real header and what kind of sheet it belongs to.
 */
export function findHeader(rows: string[][]): { index: number; kind: SheetKind } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const kind = detectSheet(rows[i])
    if (kind) return { index: i, kind }
  }
  return null
}

function columnIndex(header: string[]) {
  const norm = header.map(normaliseKey)
  return (...names: string[]): number => {
    for (const n of names) {
      const i = norm.indexOf(normaliseKey(n))
      if (i !== -1) return i
    }
    return -1
  }
}

// ─── Stock_Master ─────────────────────────────────────────────────────────────

export function parseStockMaster(rows: string[][], headerIndex: number): ImportReport<SheetItem> {
  const header = rows[headerIndex]
  const at = columnIndex(header)
  const iCode = at('Item Code'), iCat = at('Category'), iName = at('Item Name')
  const iLoc = at('Location', 'Rack'), iOpen = at('Opening Stock')
  const iImp = at('Imported Qty'), iIss = at('Issued Qty'), iReorder = at('Reorder Level')

  const byKey = new Map<string, SheetItem>()
  const warnings: string[] = []
  let skipped = 0

  for (const row of rows.slice(headerIndex + 1)) {
    const itemName = clean(row[iName])
    const itemCode = clean(row[iCode])
    if (!itemName && !itemCode) { skipped++; continue }
    // A row with only a code and nothing else is a placeholder, not stock.
    if (!itemName) { skipped++; warnings.push(`"${itemCode}" has no item name — skipped`); continue }

    const key = normaliseKey(itemName)
    const item: SheetItem = {
      key,
      itemCode: itemCode || itemName,
      category: clean(row[iCat]),
      itemName,
      location: clean(row[iLoc]),
      opening: num(row[iOpen]),
      imported: num(row[iImp]),
      issued: num(row[iIss]),
      reorder: num(row[iReorder]),
    }

    const existing = byKey.get(key)
    if (existing) {
      // Two spellings of one product. Add them together rather than letting the
      // later row silently win — a lost quantity is worse than a flagged one.
      warnings.push(`"${itemName}" appears twice in Stock_Master — quantities added together`)
      existing.opening += item.opening
      existing.imported += item.imported
      existing.issued += item.issued
      existing.reorder = Math.max(existing.reorder, item.reorder)
      existing.location ||= item.location
      continue
    }
    byKey.set(key, item)
  }

  const out = [...byKey.values()]
  for (const i of out) {
    const closing = i.opening + i.imported - i.issued
    if (closing < 0) warnings.push(`"${i.itemName}" works out to ${closing} — more issued than received`)
  }

  return { rows: out, skipped, warnings }
}

// ─── Movement logs ────────────────────────────────────────────────────────────

function fingerprintOf(m: Omit<SheetMovement, 'fingerprint'>): string {
  return [m.kind, m.date, m.itemKey, m.qty, normaliseKey(m.party), normaliseKey(m.remarks)].join('|')
}

function buildMovements(
  rows: string[][],
  headerIndex: number,
  kind: MovementKind,
  cols: {
    date: number; code: number; name: number; category: number; qty: number
    party: number; carrier: number; location: number
    status: number; invoice: number; purpose: number; remarks: number
  },
): ImportReport<SheetMovement> {
  const out: SheetMovement[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  let skipped = 0
  let lastDate = ''

  const cell = (row: string[], i: number) => (i === -1 ? '' : clean(row[i]))

  /**
   * Remarks are written one column right of their header in Import_Log — the
   * sheet has an extra empty column the heading never moved across. Read the
   * headed column, and if it is empty take the first filled cell to its right,
   * so the note survives rather than being dropped as a header mismatch.
   */
  const remarksOf = (row: string[]) => {
    const direct = cell(row, cols.remarks)
    if (direct || cols.remarks === -1) return direct
    for (let i = cols.remarks + 1; i < row.length; i++) {
      const v = clean(row[i])
      if (v) return v
    }
    return ''
  }

  for (const row of rows.slice(headerIndex + 1)) {
    const rawDate = cell(row, cols.date)
    if (rawDate) {
      const parsed = parseSheetDate(rawDate)
      if (parsed) lastDate = parsed
      else warnings.push(`Could not read the date "${rawDate}" — rows under it keep the previous date`)
    }

    const itemName = cell(row, cols.name)
    const itemCode = cell(row, cols.code)
    const qty = num(row[cols.qty])

    // Filler: the blank template rows carrying only "Name" and "Rapido", and
    // code-only placeholders with no quantity.
    if (qty <= 0) { skipped++; continue }
    if (!itemName && !itemCode) { skipped++; continue }
    if (!itemName) {
      skipped++
      warnings.push(`A ${kind === 'sent' ? 'dispatch' : 'receipt'} of ${qty} × "${itemCode}" has no item name — skipped`)
      continue
    }

    const base = {
      kind,
      date: lastDate,
      itemKey: normaliseKey(itemName),
      itemCode: itemCode || itemName,
      itemName,
      category: cell(row, cols.category),
      qty,
      party: cell(row, cols.party),
      carrier: cell(row, cols.carrier),
      location: cell(row, cols.location),
      status: cell(row, cols.status),
      invoice: cell(row, cols.invoice),
      purpose: cell(row, cols.purpose),
      remarks: remarksOf(row),
    }
    const fingerprint = fingerprintOf(base)
    if (seen.has(fingerprint)) { skipped++; continue }
    seen.add(fingerprint)
    out.push({ ...base, fingerprint })
  }

  return { rows: out, skipped, warnings }
}

export function parseImportLog(rows: string[][], headerIndex: number): ImportReport<SheetMovement> {
  const at = columnIndex(rows[headerIndex])
  return buildMovements(rows, headerIndex, 'received', {
    date: at('Date'), code: at('Item Code'), name: at('Item Name'), category: at('Category'),
    qty: at('Qty IN'), party: at('Recd By'), carrier: -1, location: at('Location'),
    status: -1, invoice: -1, purpose: -1, remarks: at('Remarks'),
  })
}

export function parseOutwards(rows: string[][], headerIndex: number): ImportReport<SheetMovement> {
  const at = columnIndex(rows[headerIndex])
  return buildMovements(rows, headerIndex, 'sent', {
    date: at('Date'), code: at('Item Code'), name: at('Item Name'), category: at('Category'),
    qty: at('Qty Issued'), party: at('Customer'), carrier: at('Carrier'),
    location: at('Site/Project'), status: at('Status'), invoice: at('Chl/ Invoice no.', 'Invoice no.', 'Chl/Invoice no.'),
    purpose: at('Purpose'), remarks: at('Remarks'),
  })
}

// ─── Cross-checks ─────────────────────────────────────────────────────────────

/**
 * Movements naming an item Stock_Master has never heard of. They still import
 * as history, but they will not line up against any stock figure, so the person
 * uploading should know before rather than after.
 */
export function unknownItems(movements: SheetMovement[], items: SheetItem[]): string[] {
  const known = new Set(items.map(i => i.key))
  const missing = new Set<string>()
  for (const m of movements) if (!known.has(m.itemKey)) missing.add(m.itemName)
  return [...missing]
}
