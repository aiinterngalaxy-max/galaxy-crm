/**
 * Curtains assistant — demo brain.
 *
 * The Curtains module is a chat instead of a spreadsheet: staff type what they
 * did in plain words and the assistant works out the entry. This file is all of
 * the understanding and all of the data, deliberately kept out of the component
 * so the UI can be judged first and the wiring done after.
 *
 * Two things to know before this goes near production:
 *
 * 1. THE DATA IS FAKE. Everything lives in memory and resets on refresh. No
 *    Firestore read, no write, nothing shared between users. Swap MOCK_ITEMS /
 *    MOCK_TXNS for the `inventory` and `stockTransactions` collections and the
 *    rest of this file keeps working — the shapes were chosen to match.
 *
 * 2. THE UNDERSTANDING IS RULES, NOT AN LLM. Sentences are matched by pattern,
 *    not sent to a model. For a demo that is the better trade: it is instant,
 *    free, works offline, and — the real reason — it is predictable, so what you
 *    approve is what you will get every time. It handles the phrasings below and
 *    asks a question when something is missing; it will not cope with a sentence
 *    shaped in a way nobody anticipated. Point it at the CRM assistant's model
 *    when the workflow is settled, keeping the confirm step exactly as it is.
 */

// ─── Data shapes (mirroring the real collections) ─────────────────────────────

export interface CurtainItem {
  id: string
  code: string
  name: string
  /** Words staff actually say for this thing, longest matched first. */
  aliases: string[]
  stock: number
  rack: string
  supplier: string
  reorderLevel: number
}

export interface CurtainTxn {
  id: string
  /** Human-readable reference shown back to the user, e.g. CUR-000042. */
  ref: string
  /** YYYY-MM-DD */
  date: string
  time: string
  customer: string
  itemId: string
  itemName: string
  kind: 'sent' | 'returned' | 'received'
  qty: number
  remarks: string
  user: string
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return todayKey(d)
}

// ─── Demo data ────────────────────────────────────────────────────────────────

export const MOCK_ITEMS: CurtainItem[] = [
  { id: 'c1', code: 'CUR-MOTOR-STD', name: 'Curtain Motor',        aliases: ['curtain motor', 'motor'],                 stock: 200, rack: 'Rack 1', supplier: 'Somfy India',    reorderLevel: 40 },
  { id: 'c2', code: 'CUR-TRACK-3M',  name: 'Curtain Track',        aliases: ['curtain track', 'track', 'channel'],      stock: 120, rack: 'Rack 2', supplier: 'Forest Group',   reorderLevel: 30 },
  { id: 'c3', code: 'CUR-ROD-SS',    name: 'Curtain Rod',          aliases: ['curtain rod', 'rod'],                     stock: 64,  rack: 'Rack 2', supplier: 'Hettich',        reorderLevel: 20 },
  { id: 'c4', code: 'CUR-RMT-RF',    name: 'Curtain Remote',       aliases: ['curtain remote', 'remote', 'rf remote'],  stock: 18,  rack: 'Rack 3', supplier: 'Somfy India',    reorderLevel: 25 },
  { id: 'c5', code: 'CUR-BRKT',      name: 'Curtain Bracket',      aliases: ['curtain bracket', 'bracket', 'clamp'],    stock: 8,   rack: 'Rack 3', supplier: 'Local Fab',      reorderLevel: 30 },
  { id: 'c6', code: 'CUR-FAB-BO',    name: 'Blackout Fabric (m)',  aliases: ['blackout fabric', 'blackout', 'fabric'],  stock: 340, rack: 'Rack 4', supplier: 'D Decor',        reorderLevel: 50 },
  { id: 'c7', code: 'CUR-HUB-WIFI',  name: 'Curtain Wi-Fi Hub',    aliases: ['wifi hub', 'wi-fi hub', 'hub'],           stock: 0,   rack: 'Rack 1', supplier: 'Somfy India',    reorderLevel: 10 },
]

export const MOCK_CUSTOMERS: string[] = [
  'Rahul', 'Nishank Roy', 'Mukesh Bhatti', 'Harish Kothari', 'Tanish Hemmant',
  'Princes Mira Road', 'Ankit Parekh', 'Dr Milid',
]

export const MOCK_TXNS: CurtainTxn[] = [
  { id: 't1', ref: 'CUR-000007', date: todayKey(), time: '09:40', customer: 'Rahul',          itemId: 'c1', itemName: 'Curtain Motor',       kind: 'sent',     qty: 12, remarks: 'Site 3BHK Andheri', user: 'riya.galaxy' },
  { id: 't2', ref: 'CUR-000006', date: todayKey(), time: '10:15', customer: 'Nishank Roy',    itemId: 'c2', itemName: 'Curtain Track',       kind: 'sent',     qty: 8,  remarks: 'Packing',           user: 'riya.galaxy' },
  { id: 't3', ref: 'CUR-000005', date: todayKey(), time: '11:02', customer: 'Mukesh Bhatti',  itemId: 'c1', itemName: 'Curtain Motor',       kind: 'returned', qty: 3,  remarks: 'Wrong size',        user: 'riya.galaxy' },
  { id: 't4', ref: 'CUR-000004', date: daysAgo(1), time: '16:20', customer: 'Harish Kothari', itemId: 'c6', itemName: 'Blackout Fabric (m)', kind: 'sent',     qty: 45, remarks: '',                  user: 'riya.galaxy' },
  { id: 't5', ref: 'CUR-000003', date: daysAgo(2), time: '12:05', customer: 'Somfy India',    itemId: 'c1', itemName: 'Curtain Motor',       kind: 'received', qty: 50, remarks: 'PO-2291',           user: 'riya.galaxy' },
  { id: 't6', ref: 'CUR-000002', date: daysAgo(4), time: '15:35', customer: 'Nishank Roy',    itemId: 'c1', itemName: 'Curtain Motor',       kind: 'sent',     qty: 25, remarks: 'Bulk order',        user: 'riya.galaxy' },
  { id: 't7', ref: 'CUR-000001', date: daysAgo(9), time: '11:10', customer: 'Ankit Parekh',   itemId: 'c3', itemName: 'Curtain Rod',         kind: 'sent',     qty: 14, remarks: '',                  user: 'riya.galaxy' },
]

// ─── Assistant state ──────────────────────────────────────────────────────────

/**
 * `received` is stock arriving into the warehouse, `sent` is stock leaving for a
 * customer, `returned` is stock coming back from one. Received and returned both
 * add to stock but are different events, and the register has to be able to tell
 * a delivery from a supplier apart from a customer changing their mind.
 */
export type TxnKind = 'sent' | 'returned' | 'received'

export interface Draft {
  kind?: TxnKind
  /** Customer for sent/returned, supplier for received. */
  customer?: string
  itemId?: string
  qty?: number
  remarks?: string
}

/** What the assistant is waiting for, so the next message is read as an answer. */
export type Pending =
  | { type: 'txn'; draft: Draft }
  | { type: 'customer' }
  | { type: 'item'; draft: { name?: string; qty?: number } }

export interface AssistantState {
  items: CurtainItem[]
  customers: string[]
  txns: CurtainTxn[]
  pending?: Pending
}

export interface TableReply {
  kind: 'table'
  title: string
  columns: string[]
  rows: string[][]
  /** Shown instead of the table when there are no rows. */
  empty: string
}

export type BotReply =
  | { kind: 'text'; text: string }
  | { kind: 'confirm'; text: string; draft: Required<Pick<Draft, 'kind' | 'customer' | 'itemId' | 'qty'>> & Draft }
  | TableReply

export interface Interpretation {
  replies: BotReply[]
  /** Undefined clears whatever the assistant was waiting for. */
  pending?: Pending
  /** A name to add to the customer list — the caller owns the state. */
  addCustomer?: string
  /** A product to add to the catalogue. */
  addItem?: { name: string; stock: number }
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim()

export function statusOf(item: CurtainItem): 'Out of stock' | 'Low stock' | 'In stock' {
  if (item.stock <= 0) return 'Out of stock'
  if (item.stock <= item.reorderLevel) return 'Low stock'
  return 'In stock'
}

export function prettyDate(key: string): string {
  const [y, m, d] = key.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/** Longest alias wins, so "curtain track" never resolves as "curtain motor". */
export function findItem(text: string, items: CurtainItem[]): CurtainItem | undefined {
  const t = norm(text)
  let best: { item: CurtainItem; len: number } | undefined
  for (const item of items) {
    for (const alias of [...item.aliases, item.name, item.code]) {
      const a = norm(alias)
      // Plural forms: staff type "motors", the catalogue says "Motor".
      if (t.includes(a) || t.includes(`${a}s`)) {
        if (!best || a.length > best.len) best = { item, len: a.length }
      }
    }
  }
  return best?.item
}

const TITLE = (s: string) =>
  s.split(/\s+/).map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')

/** Trailing filler that clings to a captured name: "to Rahul today please". */
const NAME_STOP = /\b(today|tomorrow|yesterday|please|now|thanks|thank you|sir|madam|for|from|of|on|at|and)\b.*$/i

function cleanName(raw: string, items: CurtainItem[]): string {
  let s = raw.replace(/[.,;!?]+$/, '').trim()
  s = s.replace(NAME_STOP, '').trim()
  // Cut at a quantity or a product word, so "Rahul 20 motors" gives "Rahul".
  s = s.split(/\s\d/)[0]
  for (const item of items) {
    for (const alias of [...item.aliases, item.name]) {
      const i = s.toLowerCase().indexOf(norm(alias))
      if (i > 0) s = s.slice(0, i)
    }
  }
  return TITLE(s.trim())
}

export function findCustomer(text: string, state: AssistantState): string | undefined {
  const known = state.customers.find(c => norm(text).includes(norm(c)))
  if (known) return known

  const to = text.match(/\bto\s+([A-Za-z][A-Za-z .'&-]{1,40})/i)
  if (to) { const n = cleanName(to[1], state.items); if (n.length > 1) return n }

  const from = text.match(/\bfrom\s+([A-Za-z][A-Za-z .'&-]{1,40})/i)
  if (from) { const n = cleanName(from[1], state.items); if (n.length > 1) return n }

  const before = text.match(/^\s*([A-Za-z][A-Za-z .'&-]{1,40}?)\s+(?:has\s+)?returned\b/i)
  if (before) { const n = cleanName(before[1], state.items); if (n.length > 1) return n }

  return undefined
}

function findQty(text: string): number | undefined {
  const m = text.match(/\b(\d{1,5})\b/)
  return m ? Number(m[1]) : undefined
}

function findKind(text: string): TxnKind | undefined {
  const t = norm(text)
  // Order matters: "returned stock received back" must read as a return, and
  // "stock in" must not be mistaken for the "in" inside another word.
  if (/\b(return|returned|returning|wapas)\b/.test(t)) return 'returned'
  if (/\b(stock in|stock-in|received|receive|arrived|arrival|came in|purchased|bought|grn|inward|new stock|added stock|restock|restocked)\b/.test(t)) return 'received'
  if (/\b(sent|send|sending|issue|issued|gave|given|dispatch|dispatched|deliver|delivered|stock out|outward)\b/.test(t)) return 'sent'
  return undefined
}

export const KIND_WORD: Record<TxnKind, string> = {
  sent: 'Sent', returned: 'Returned', received: 'Received',
}

/** Who the other side of the movement is — a supplier when stock arrives. */
export function partyLabel(kind: TxnKind): string {
  return kind === 'received' ? 'Supplier' : 'Customer'
}

// ─── Table builders ───────────────────────────────────────────────────────────

function txnTable(title: string, txns: CurtainTxn[], empty: string): TableReply {
  return {
    kind: 'table',
    title,
    // Received has its own column: a delivery in the Returned column would
    // overstate what customers gave back.
    columns: ['Date', 'Customer', 'Item', 'Sent', 'Returned', 'Received', 'Remarks'],
    rows: txns.map(t => [
      prettyDate(t.date), t.customer, t.itemName,
      t.kind === 'sent' ? String(t.qty) : '—',
      t.kind === 'returned' ? String(t.qty) : '—',
      t.kind === 'received' ? String(t.qty) : '—',
      t.remarks || '—',
    ]),
    empty,
  }
}

function stockTable(title: string, items: CurtainItem[], empty: string): TableReply {
  return {
    kind: 'table',
    title,
    columns: ['Item', 'Current Stock', 'Rack', 'Status'],
    rows: items.map(i => [i.name, String(i.stock), i.rack, statusOf(i)]),
    empty,
  }
}

function lastTxnOf(itemId: string, txns: CurtainTxn[]): string {
  const t = [...txns].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).find(x => x.itemId === itemId)
  return t ? `${KIND_WORD[t.kind]} ${t.qty} · ${t.customer} · ${prettyDate(t.date)}` : 'No movement yet'
}

// ─── Understanding ────────────────────────────────────────────────────────────

const HELP = `I can record stock movements and answer questions about curtain stock. Try:
• Sent 20 Curtain Motors to Rahul
• Rahul returned 5 Curtain Motors
• Show today's transactions
• Show current stock
• Which items are low in stock?
• Search Curtain Motor`

const KIND_HINT: Record<TxnKind, string> = {
  sent: 'stock going out',
  returned: 'a return',
  received: 'stock coming in',
}

/** Is the draft complete enough to save? If not, ask for what's missing. */
function nextStep(draft: Draft, state: AssistantState): Interpretation {
  const missing: string[] = []
  if (!draft.itemId) missing.push('Which product?')
  // A delivery's supplier is already on the item, so asking would be noise.
  if (!draft.customer && draft.kind !== 'received') missing.push('Which customer?')
  if (!draft.qty) missing.push('How many?')

  if (missing.length) {
    return {
      replies: [{ kind: 'text', text: `Got it${draft.kind ? ` — ${KIND_HINT[draft.kind]}` : ''}. ${missing.join(' ')}` }],
      pending: { type: 'txn', draft },
    }
  }

  // Stock is read here, and read again when Confirm is pressed — the number in
  // the confirmation is never carried over from earlier in the conversation.
  const item = state.items.find(i => i.id === draft.itemId)!
  if (draft.kind === 'sent' && draft.qty! > item.stock) {
    return {
      replies: [{ kind: 'text', text: `Not enough stock. Only **${item.stock}** ${item.name} available — that's ${draft.qty! - item.stock} short. Give me a smaller quantity, or record the incoming stock first.` }],
      pending: { type: 'txn', draft: { ...draft, qty: undefined } },
    }
  }

  const filled: Draft = {
    ...draft,
    customer: draft.customer ?? (draft.kind === 'received' ? item.supplier : undefined),
  }

  return {
    replies: [{
      kind: 'confirm',
      text: 'I understood:',
      draft: filled as Required<Pick<Draft, 'kind' | 'customer' | 'itemId' | 'qty'>> & Draft,
    }],
  }
}

/** Merge a reply to a follow-up question into the draft it belongs to. */
function fillDraft(draft: Draft, text: string, state: AssistantState): Draft {
  const next: Draft = { ...draft }
  if (!next.kind) next.kind = findKind(text)
  if (!next.itemId) next.itemId = findItem(text, state.items)?.id
  if (!next.qty) next.qty = findQty(text)
  if (!next.customer) {
    const c = findCustomer(text, state)
    // A bare answer to "Which customer?" is just the name, with nothing to match on.
    next.customer = c ?? (next.itemId && !findItem(text, state.items) && /^[A-Za-z][A-Za-z .'&-]{1,40}$/.test(text.trim())
      ? TITLE(text.trim())
      : undefined)
  }
  return next
}

export function interpret(raw: string, state: AssistantState): Interpretation {
  const text = raw.trim()
  const t = norm(text)
  if (!t) return { replies: [{ kind: 'text', text: HELP }] }

  // ── Answering a question the assistant asked ────────────────────────────────
  if (state.pending?.type === 'customer') {
    const name = TITLE(text.replace(/[.,;!?]+$/, '').trim())
    if (state.customers.some(c => norm(c) === norm(name))) {
      return { replies: [{ kind: 'text', text: `${name} is already in the customer list.` }] }
    }
    return {
      replies: [{ kind: 'text', text: `✅ Added **${name}** to the customer list. You can now say things like "Sent 10 Curtain Motors to ${name}".` }],
      addCustomer: name,
    }
  }

  if (state.pending?.type === 'item') {
    if (/^(cancel|stop|forget it)$/i.test(t)) {
      return { replies: [{ kind: 'text', text: 'Cancelled — no item was added.' }] }
    }
    const d = state.pending.draft
    if (!d.name) {
      const name = TITLE(text.replace(/[.,;!?]+$/, '').trim())
      if (findItem(name, state.items)) {
        return { replies: [{ kind: 'text', text: `**${name}** looks like something we already stock. Say "search ${name}" to see it.` }] }
      }
      return {
        replies: [{ kind: 'text', text: `**${name}** it is. How many are in stock right now? (0 is fine.)` }],
        pending: { type: 'item', draft: { name } },
      }
    }
    const qty = findQty(text)
    if (qty === undefined) {
      return {
        replies: [{ kind: 'text', text: 'I need a number — how many are in stock right now?' }],
        pending: state.pending,
      }
    }
    return {
      replies: [{ kind: 'text', text: `✅ Added **${d.name}** with ${qty} in stock. You can now say "Sent 5 ${d.name} to Rahul".` }],
      addItem: { name: d.name!, stock: qty },
    }
  }

  if (state.pending?.type === 'txn') {
    if (/^(cancel|stop|forget it|no)$/i.test(t)) {
      return { replies: [{ kind: 'text', text: 'Cancelled — nothing was saved.' }] }
    }
    return nextStep(fillDraft(state.pending.draft, text, state), state)
  }

  // ── Questions and commands ──────────────────────────────────────────────────
  const today = todayKey()
  const todays = state.txns.filter(x => x.date === today)

  if (/\badd\b.*\bcustomer\b|\bnew customer\b/.test(t)) {
    return { replies: [{ kind: 'text', text: "Sure — what's the customer's name?" }], pending: { type: 'customer' } }
  }

  if (/\badd\b.*\b(item|product)\b|\bnew (item|product)\b/.test(t)) {
    return { replies: [{ kind: 'text', text: "Sure — what's the product called?" }], pending: { type: 'item', draft: {} } }
  }

  if (/\blow\b.*\bstock\b|\bstock\b.*\blow\b|below reorder|running out|reorder/.test(t)) {
    const low = state.items.filter(i => i.stock <= i.reorderLevel)
    return { replies: [stockTable(`Low stock (${low.length} item${low.length === 1 ? '' : 's'})`, low, 'Nothing is below its reorder level — all good.')] }
  }

  if (/\bwho\b.*(received|got|took)/.test(t)) {
    const item = findItem(text, state.items)
    const scope = todays.filter(x => x.kind === 'sent' && (!item || x.itemId === item.id))
    const label = item ? item.name : 'stock'
    if (!scope.length) return { replies: [{ kind: 'text', text: `Nobody has received ${label} today.` }] }
    return { replies: [txnTable(`Who received ${label} today`, scope, '—')] }
  }

  if (/(most|top|highest|biggest)/.test(t) && /(customer|client|buyer)/.test(t)) {
    const month = today.slice(0, 7)
    const totals = new Map<string, number>()
    state.txns.filter(x => x.date.startsWith(month) && x.kind === 'sent')
      .forEach(x => totals.set(x.customer, (totals.get(x.customer) ?? 0) + x.qty))
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
    if (!ranked.length) return { replies: [{ kind: 'text', text: 'No stock has gone out this month yet.' }] }
    return {
      replies: [
        { kind: 'text', text: `**${ranked[0][0]}** has taken the most this month — ${ranked[0][1]} units.` },
        { kind: 'table', title: 'This month by customer', columns: ['Customer', 'Units taken'], rows: ranked.map(([c, n]) => [c, String(n)]), empty: '—' },
      ],
    }
  }

  if (/\breturn/.test(t) && /(today|show|list)/.test(t) && !findQty(text)) {
    const rows = todays.filter(x => x.kind === 'returned')
    return { replies: [txnTable("Today's returns", rows, 'No returns recorded today.')] }
  }

  if (/(outward|sent|went out|dispatch)/.test(t) && /(today|show|list)/.test(t) && !findQty(text)) {
    const rows = todays.filter(x => x.kind === 'sent')
    return { replies: [txnTable("Today's outward entries", rows, 'Nothing has gone out today.')] }
  }

  if (/(today|todays)/.test(t) && /(transaction|entry|entries|movement|register)/.test(t)) {
    return { replies: [txnTable("Today's transactions", todays, 'Nothing recorded today yet.')] }
  }

  if (/\bhow many\b/.test(t) || (/\bhow much\b/.test(t) && findItem(text, state.items))) {
    const item = findItem(text, state.items)
    if (item) {
      return { replies: [{ kind: 'text', text: `**${item.stock}** ${item.name} in stock — ${item.rack}, ${statusOf(item)}. Supplier: ${item.supplier}.` }] }
    }
    return { replies: [{ kind: 'text', text: 'Which product did you mean?' }] }
  }

  if (/\bhow much stock\b|\btotal stock\b|\bstock available\b|\bavailable today\b/.test(t)) {
    const units = state.items.reduce((s, i) => s + i.stock, 0)
    const low = state.items.filter(i => i.stock <= i.reorderLevel).length
    return { replies: [{ kind: 'text', text: `**${units} units** across ${state.items.length} curtain products. ${low} need reordering.` }] }
  }

  if (/^(search|find|show me|look up|lookup)\b/.test(t) || (/\bsearch\b/.test(t) && findItem(text, state.items))) {
    const item = findItem(text, state.items)
    if (!item) {
      return { replies: [{ kind: 'text', text: `I couldn't find that product. We stock: ${state.items.map(i => i.name).join(', ')}.` }] }
    }
    return {
      replies: [{
        kind: 'table',
        title: item.name,
        columns: ['Item', 'Available Stock', 'Rack', 'Supplier', 'Last Transaction'],
        rows: [[item.name, String(item.stock), item.rack, item.supplier, lastTxnOf(item.id, state.txns)]],
        empty: '—',
      }],
    }
  }

  if (/(current|available|remaining|all)\s+stock|stock (list|report)|show stock|inventory/.test(t)) {
    return { replies: [stockTable('Current stock', state.items, 'No items yet.')] }
  }

  // ── Recording a movement ────────────────────────────────────────────────────
  const kind = findKind(text)
  const item = findItem(text, state.items)
  const qty = findQty(text)
  if (kind || (item && qty)) {
    return nextStep({ kind: kind ?? 'sent', customer: findCustomer(text, state), itemId: item?.id, qty }, state)
  }

  return { replies: [{ kind: 'text', text: `I didn't catch that.\n\n${HELP}` }] }
}

// ─── Saving ───────────────────────────────────────────────────────────────────

export type SaveResult =
  | {
      ok: true
      items: CurtainItem[]
      txns: CurtainTxn[]
      customers: string[]
      remaining: number
      txn: CurtainTxn
      message: string
    }
  | { ok: false; message: string }

function nextRef(txns: CurtainTxn[]): string {
  const highest = txns.reduce((max, t) => {
    const n = Number(t.ref?.replace(/\D/g, '') ?? 0)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `CUR-${String(highest + 1).padStart(6, '0')}`
}

/**
 * Applies a confirmed draft and reports the new stock level.
 *
 * Availability is checked here against the item as it stands *now*, not against
 * the number quoted when the message was typed. In the demo those are the same
 * thing; wired to Firestore this is the check that has to run inside the
 * transaction, because between reading and confirming, someone else can empty
 * the shelf.
 */
export function applyDraft(state: AssistantState, draft: Draft, user: string): SaveResult {
  const item = state.items.find(i => i.id === draft.itemId)
  if (!item || !draft.qty || !draft.customer || !draft.kind) {
    return { ok: false, message: "That entry is missing something — let's start it again." }
  }

  if (draft.kind === 'sent' && draft.qty > item.stock) {
    return {
      ok: false,
      message: `Not enough stock. ${item.name} is down to **${item.stock}** — nothing was saved.`,
    }
  }

  const delta = draft.kind === 'sent' ? -draft.qty : draft.qty
  const remaining = item.stock + delta

  const now = new Date()
  const txn: CurtainTxn = {
    id: `t${now.getTime()}`,
    ref: nextRef(state.txns),
    date: todayKey(now),
    time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    customer: draft.customer,
    itemId: item.id,
    itemName: item.name,
    kind: draft.kind,
    qty: draft.qty,
    remarks: draft.remarks ?? '',
    user,
  }

  const headline =
    draft.kind === 'sent' ? `${draft.qty} ${item.name} sent to ${draft.customer}`
    : draft.kind === 'returned' ? `${draft.qty} ${item.name} returned by ${draft.customer}`
    : `${draft.qty} ${item.name} received from ${draft.customer}`

  return {
    ok: true,
    items: state.items.map(i => (i.id === item.id ? { ...i, stock: remaining } : i)),
    txns: [txn, ...state.txns],
    // A supplier is not a customer — only the people we send stock to belong in
    // that list.
    customers: draft.kind === 'received' || state.customers.some(c => norm(c) === norm(draft.customer!))
      ? state.customers
      : [...state.customers, draft.customer],
    remaining,
    txn,
    message: [
      '✅ **Transaction completed**',
      headline,
      `Updated stock: **${remaining}** ${item.name}`,
      `Transaction ID: ${txn.ref}`,
      `${prettyDate(txn.date)} at ${txn.time}`,
    ].join('\n'),
  }
}

/** A brand-new product for the catalogue, ready to receive stock. */
export function buildItem(name: string, stock: number, existing: CurtainItem[]): CurtainItem {
  const code = `CUR-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12)}`
  return {
    id: `c${existing.length + 1}-${Date.now()}`,
    code,
    name,
    aliases: [name.toLowerCase()],
    stock,
    rack: 'Unassigned',
    supplier: '—',
    reorderLevel: 0,
  }
}
