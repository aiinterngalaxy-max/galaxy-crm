import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore is mocked wholesale: these tests are about which write is issued for
// a quote versus a whole document, not about Firestore itself.
const getDoc = vi.hoisted(() => vi.fn())
const setDoc = vi.hoisted(() => vi.fn())
const updateDoc = vi.hoisted(() => vi.fn())
const deleteDoc = vi.hoisted(() => vi.fn())
const addDoc = vi.hoisted(() => vi.fn())

vi.mock('../firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  collection: (_db: unknown, col: string) => ({ col }),
  serverTimestamp: () => 'TS',
  getDoc, setDoc, updateDoc, deleteDoc, addDoc,
}))

const { trashQuoteDoc, restoreItem, QUOTE_TRASH_COLLECTION } = await import('../trash')

const quote = { name: 'Quote.pdf', url: 'https://res.cloudinary.com/x/q.pdf', uploadedAt: 1, size: 100 }
const other = { name: 'Other.pdf', url: 'https://res.cloudinary.com/x/o.pdf', uploadedAt: 2, size: 200 }

beforeEach(() => {
  [getDoc, setDoc, updateDoc, deleteDoc, addDoc].forEach(m => m.mockReset())
})

describe('trashQuoteDoc', () => {
  it('removes only the target quote and leaves the others', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ quoteDocuments: [quote, other] }) })

    await trashQuoteDoc('leads', 'L1', quote, 'u1', 'Riya')

    expect(updateDoc.mock.calls[0][1].quoteDocuments).toEqual([other])
  })

  it('files it under the quote collection, not the parent collection', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ quoteDocuments: [quote] }) })

    await trashQuoteDoc('leads', 'L1', quote, 'u1', 'Riya')

    const entry = addDoc.mock.calls[0][1]
    expect(entry.originalCollection).toBe(QUOTE_TRASH_COLLECTION)
    expect(entry.parentCollection).toBe('leads')
    expect(entry.originalId).toBe('L1')
    expect(entry.displayName).toBe('Quote: Quote.pdf')
    expect(entry.data).toEqual(quote)
  })

  it('never deletes the parent record', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ quoteDocuments: [quote] }) })

    await trashQuoteDoc('leads', 'L1', quote, 'u1', 'Riya')

    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('copes with a record that has no quotes array', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) })

    await trashQuoteDoc('leads', 'L1', quote, 'u1', 'Riya')

    expect(updateDoc.mock.calls[0][1].quoteDocuments).toEqual([])
  })
})

describe('restoreItem for a quote', () => {
  const trashEntry = {
    exists: () => true,
    data: () => ({
      originalCollection: QUOTE_TRASH_COLLECTION,
      originalId: 'L1',
      parentCollection: 'leads',
      data: quote,
    }),
  }

  // The whole point of the separate path: setDoc would replace the entire lead
  // document with a single quote object.
  it('pushes the quote back into the array and never calls setDoc', async () => {
    getDoc
      .mockResolvedValueOnce(trashEntry)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ quoteDocuments: [other] }) })

    await restoreItem('T1')

    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc.mock.calls[0][1].quoteDocuments).toEqual([other, quote])
  })

  it('does not duplicate the quote if it is already back', async () => {
    getDoc
      .mockResolvedValueOnce(trashEntry)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ quoteDocuments: [quote] }) })

    await restoreItem('T1')

    expect(updateDoc).not.toHaveBeenCalled()
    expect(deleteDoc).toHaveBeenCalled()
  })

  it('refuses to restore when the parent lead is gone', async () => {
    getDoc
      .mockResolvedValueOnce(trashEntry)
      .mockResolvedValueOnce({ exists: () => false })

    await expect(restoreItem('T1')).rejects.toThrow(/no longer exists/)
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('restoreItem for a normal document', () => {
  it('still uses setDoc, unchanged', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ originalCollection: 'leads', originalId: 'L9', data: { name: 'Anand' } }),
    })

    await restoreItem('T2')

    expect(setDoc).toHaveBeenCalledOnce()
    expect(setDoc.mock.calls[0][1]).toEqual({ name: 'Anand' })
  })
})
