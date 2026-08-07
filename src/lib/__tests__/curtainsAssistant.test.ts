import { describe, it, expect } from 'vitest'
import {
  interpret, applyDraft, buildItem, findItem, statusOf, todayKey,
  MOCK_ITEMS, MOCK_CUSTOMERS, MOCK_TXNS,
  type AssistantState, type BotReply, type TableReply,
} from '../curtainsAssistant'

const base = (): AssistantState => ({
  items: MOCK_ITEMS.map(i => ({ ...i })),
  customers: [...MOCK_CUSTOMERS],
  txns: MOCK_TXNS.map(t => ({ ...t })),
})

const first = (r: BotReply[]) => r[0]
const table = (r: BotReply[]): TableReply => {
  const t = r.find(x => x.kind === 'table')
  if (!t || t.kind !== 'table') throw new Error('expected a table reply')
  return t
}

describe('recording a movement', () => {
  it('understands "Sent 20 Curtain Motors to Rahul"', () => {
    const { replies } = interpret('Sent 20 Curtain Motors to Rahul', base())
    const r = first(replies)
    expect(r.kind).toBe('confirm')
    if (r.kind !== 'confirm') return
    expect(r.draft).toMatchObject({ kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 20 })
  })

  it('understands "Rahul returned 5 Curtain Motors"', () => {
    const { replies } = interpret('Rahul returned 5 Curtain Motors', base())
    const r = first(replies)
    expect(r.kind).toBe('confirm')
    if (r.kind !== 'confirm') return
    expect(r.draft).toMatchObject({ kind: 'returned', customer: 'Rahul', itemId: 'c1', qty: 5 })
  })

  it('picks the longest matching product name', () => {
    expect(findItem('sent 3 curtain track to site', MOCK_ITEMS)?.id).toBe('c2')
    expect(findItem('two curtain motors', MOCK_ITEMS)?.id).toBe('c1')
  })

  it('reads a customer who is not in the list yet', () => {
    const { replies } = interpret('Sent 4 Curtain Rods to Ramesh Traders', base())
    const r = first(replies)
    if (r.kind !== 'confirm') throw new Error('expected confirm')
    expect(r.draft.customer).toBe('Ramesh Traders')
  })

  it('refuses to send more than is in stock, and asks again', () => {
    const res = interpret('Sent 500 Curtain Remotes to Rahul', base())
    expect(first(res.replies).kind).toBe('text')
    expect((first(res.replies) as { text: string }).text).toContain('Only **18**')
    // Everything but the quantity is kept, so the user only retypes the number.
    expect(res.pending).toMatchObject({ type: 'txn', draft: { customer: 'Rahul', itemId: 'c4' } })
  })

  it('understands stock arriving, and defaults the supplier from the item', () => {
    const { replies } = interpret('Received 50 Curtain Motors', base())
    const r = first(replies)
    if (r.kind !== 'confirm') throw new Error('expected confirm')
    expect(r.draft).toMatchObject({ kind: 'received', itemId: 'c1', qty: 50, customer: 'Somfy India' })
  })

  it('reads "stock in" and "new stock arrived" as an inward movement', () => {
    for (const phrase of ['Stock in 30 Curtain Tracks', '30 Curtain Tracks arrived today']) {
      const r = first(interpret(phrase, base()).replies)
      if (r.kind !== 'confirm') throw new Error(`expected confirm for: ${phrase}`)
      expect(r.draft.kind).toBe('received')
    }
  })

  it('does not need a customer for incoming stock', () => {
    const res = interpret('Received 10 Curtain Rods', base())
    expect(first(res.replies).kind).toBe('confirm')
  })
})

describe('asking for what is missing', () => {
  it('asks instead of erroring on "Sent 20 switches"', () => {
    const res = interpret('Sent 20 switches', base())
    const r = first(res.replies)
    if (r.kind !== 'text') throw new Error('expected text')
    expect(r.text).toContain('Which product?')
    expect(r.text).toContain('Which customer?')
    expect(res.pending?.type).toBe('txn')
  })

  it('fills the draft from follow-up answers, one at a time', () => {
    const state = base()
    const q1 = interpret('Sent 20 switches', state)

    const q2 = interpret('Curtain Motor', { ...state, pending: q1.pending })
    expect(first(q2.replies).kind).toBe('text')
    expect((first(q2.replies) as { text: string }).text).toContain('Which customer?')

    const q3 = interpret('Ramesh', { ...state, pending: q2.pending })
    const r = first(q3.replies)
    if (r.kind !== 'confirm') throw new Error('expected confirm')
    expect(r.draft).toMatchObject({ kind: 'sent', customer: 'Ramesh', itemId: 'c1', qty: 20 })
  })

  it('cancels a half-finished entry', () => {
    const state = base()
    const q1 = interpret('Sent 20 switches', state)
    const res = interpret('cancel', { ...state, pending: q1.pending })
    expect((first(res.replies) as { text: string }).text).toContain('nothing was saved')
    expect(res.pending).toBeUndefined()
  })
})

describe('questions', () => {
  it("shows today's transactions", () => {
    const t = table(interpret("Show today's transactions", base()).replies)
    expect(t.columns).toEqual(['Date', 'Customer', 'Item', 'Sent', 'Returned', 'Received', 'Remarks'])
    expect(t.rows).toHaveLength(3)
  })

  it("separates today's outward entries from today's returns", () => {
    expect(table(interpret("Show today's outward entries", base()).replies).rows).toHaveLength(2)
    expect(table(interpret("Show today's returns", base()).replies).rows).toHaveLength(1)
  })

  it('shows current stock with rack and status', () => {
    const t = table(interpret('Show current stock', base()).replies)
    expect(t.columns).toEqual(['Item', 'Current Stock', 'Rack', 'Status'])
    expect(t.rows).toHaveLength(MOCK_ITEMS.length)
  })

  it('lists only low stock when asked', () => {
    const t = table(interpret('Which items are low in stock?', base()).replies)
    const names = t.rows.map(r => r[0])
    expect(names).toContain('Curtain Remote')
    expect(names).toContain('Curtain Bracket')
    expect(names).not.toContain('Curtain Motor')
  })

  it('searches one product with supplier and last movement', () => {
    const t = table(interpret('Search Curtain Motor', base()).replies)
    expect(t.columns).toEqual(['Item', 'Available Stock', 'Rack', 'Supplier', 'Last Transaction'])
    expect(t.rows[0][1]).toBe('200')
    expect(t.rows[0][3]).toBe('Somfy India')
  })

  it('answers how many of one item are available', () => {
    const r = first(interpret('How many Curtain Motors are available?', base()).replies)
    expect((r as { text: string }).text).toContain('200')
  })

  it('answers who received an item today', () => {
    const t = table(interpret('Who received Curtain Motors today?', base()).replies)
    expect(t.rows.map(r => r[1])).toEqual(['Rahul'])
  })

  it('names the biggest customer this month, counting only what went out', () => {
    // Built here rather than leaning on the demo rows, whose relative dates fall
    // into last month whenever the test runs in the first days of one.
    const state = base()
    state.txns = [
      { ...MOCK_TXNS[0], customer: 'Rahul', kind: 'sent', qty: 10, date: todayKey() },
      { ...MOCK_TXNS[0], id: 'x2', customer: 'Rahul', kind: 'sent', qty: 15, date: todayKey() },
      { ...MOCK_TXNS[0], id: 'x3', customer: 'Nishank Roy', kind: 'sent', qty: 20, date: todayKey() },
      // A delivery must not count as a customer purchase.
      { ...MOCK_TXNS[0], id: 'x4', customer: 'Somfy India', kind: 'received', qty: 99, date: todayKey() },
    ]
    const { replies } = interpret('Which customer purchased the most this month?', state)
    expect((first(replies) as { text: string }).text).toContain('Rahul')
    expect(table(replies).rows).toEqual([['Rahul', '25'], ['Nishank Roy', '20']])
  })

  it('falls back to help rather than an error', () => {
    const r = first(interpret('asdfgh', base()).replies)
    expect((r as { text: string }).text).toContain("didn't catch that")
  })
})

describe('adding a customer', () => {
  it('asks for the name, then reports it added', () => {
    const state = base()
    const ask = interpret('Add new customer', state)
    expect(ask.pending).toEqual({ type: 'customer' })

    const done = interpret('Deepak Shah', { ...state, pending: ask.pending })
    expect(done.addCustomer).toBe('Deepak Shah')
  })
})

describe('applyDraft', () => {
  const ok = (r: ReturnType<typeof applyDraft>) => {
    if (!r.ok) throw new Error(`expected a saved transaction, got: ${r.message}`)
    return r
  }

  it('reduces stock on a send and records the entry', () => {
    const res = ok(applyDraft(base(), { kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 20 }, 'riya.galaxy'))
    expect(res.remaining).toBe(180)
    expect(res.items.find(i => i.id === 'c1')?.stock).toBe(180)
    expect(res.txns[0]).toMatchObject({ customer: 'Rahul', qty: 20, kind: 'sent', date: todayKey() })
  })

  it('adds stock back on a return', () => {
    const res = ok(applyDraft(base(), { kind: 'returned', customer: 'Rahul', itemId: 'c1', qty: 5 }, 'riya.galaxy'))
    expect(res.remaining).toBe(205)
  })

  it('adds stock on a delivery', () => {
    const res = ok(applyDraft(base(), { kind: 'received', customer: 'Somfy India', itemId: 'c1', qty: 50 }, 'u'))
    expect(res.remaining).toBe(250)
    // A supplier is not a customer.
    expect(res.customers).not.toContain('Somfy India')
  })

  it('reports completion, the updated stock, an ID and the time', () => {
    const res = ok(applyDraft(base(), { kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 20 }, 'u'))
    expect(res.message).toContain('Transaction completed')
    expect(res.message).toContain('180')
    expect(res.message).toContain(res.txn.ref)
    expect(res.txn.ref).toMatch(/^CUR-\d{6}$/)
    expect(res.message).toContain(res.txn.time)
  })

  it('gives each transaction the next reference number', () => {
    const res = ok(applyDraft(base(), { kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 1 }, 'u'))
    expect(res.txn.ref).toBe('CUR-000008')
  })

  it('re-checks stock at save time and refuses when short', () => {
    const state = base()
    state.items = state.items.map(i => (i.id === 'c1' ? { ...i, stock: 5 } : i))
    const res = applyDraft(state, { kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 20 }, 'u')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toContain('Not enough stock')
  })

  it('remembers a customer it has not seen before, without duplicating', () => {
    expect(ok(applyDraft(base(), { kind: 'sent', customer: 'Ramesh', itemId: 'c1', qty: 1 }, 'u')).customers)
      .toContain('Ramesh')
    expect(ok(applyDraft(base(), { kind: 'sent', customer: 'Rahul', itemId: 'c1', qty: 1 }, 'u')).customers)
      .toHaveLength(MOCK_CUSTOMERS.length)
  })

  it('refuses an incomplete draft instead of writing half an entry', () => {
    const res = applyDraft(base(), { kind: 'sent', itemId: 'c1' }, 'u')
    expect(res.ok).toBe(false)
  })
})

describe('adding an item', () => {
  it('asks for a name then an opening quantity', () => {
    const state = base()
    const ask = interpret('Add new item', state)
    expect(ask.pending).toEqual({ type: 'item', draft: {} })

    const named = interpret('Curtain Pelmet', { ...state, pending: ask.pending })
    expect(named.pending).toMatchObject({ type: 'item', draft: { name: 'Curtain Pelmet' } })

    const done = interpret('25', { ...state, pending: named.pending })
    expect(done.addItem).toEqual({ name: 'Curtain Pelmet', stock: 25 })
  })

  it('will not add something already in the catalogue', () => {
    const state = base()
    const ask = interpret('Add new product', state)
    const res = interpret('Curtain Motor', { ...state, pending: ask.pending })
    expect((first(res.replies) as { text: string }).text).toContain('already stock')
    expect(res.addItem).toBeUndefined()
  })

  it('builds a usable catalogue row', () => {
    const item = buildItem('Curtain Pelmet', 25, MOCK_ITEMS)
    expect(item).toMatchObject({ name: 'Curtain Pelmet', stock: 25, rack: 'Unassigned' })
    expect(findItem('sent 2 curtain pelmet to rahul', [...MOCK_ITEMS, item])?.id).toBe(item.id)
  })
})

describe('statusOf', () => {
  it('flags out of stock, low stock and healthy items', () => {
    expect(statusOf(MOCK_ITEMS.find(i => i.id === 'c7')!)).toBe('Out of stock')
    expect(statusOf(MOCK_ITEMS.find(i => i.id === 'c5')!)).toBe('Low stock')
    expect(statusOf(MOCK_ITEMS.find(i => i.id === 'c1')!)).toBe('In stock')
  })
})
