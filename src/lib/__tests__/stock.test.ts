import { describe, it, expect } from 'vitest'
import { closingOf, txnKindOf, isOutwardKind, TXN_LABEL } from '../stock'

describe('closingOf', () => {
  it('adds imports and subtracts what left', () => {
    expect(closingOf({ openingStock: 10, importedQty: 5, issuedQty: 2, outwardQty: 3 })).toBe(10)
  })

  it('treats a missing outward as zero, so rows saved before the column still add up', () => {
    expect(closingOf({ openingStock: 10, importedQty: 5, issuedQty: 2 })).toBe(13)
  })

  it('can go negative rather than silently clamping', () => {
    expect(closingOf({ openingStock: 1, importedQty: 0, issuedQty: 0, outwardQty: 4 })).toBe(-3)
  })
})

describe('txnKindOf', () => {
  it('trusts the recorded kind when there is one', () => {
    expect(txnKindOf({ txnKind: 'sent', type: 'issue' })).toBe('sent')
    expect(txnKindOf({ txnKind: 'returned', type: 'import' })).toBe('returned')
    expect(txnKindOf({ txnKind: 'received', type: 'import' })).toBe('received')
  })

  it('reads an old outgoing row as Sent', () => {
    expect(txnKindOf({ type: 'issue' })).toBe('sent')
  })

  it('reads an old incoming row as Received, not Returned', () => {
    // A Stock In, a sheet edit or a CSV merge is a delivery arriving. Calling
    // it a return said a supplier was a customer sending goods back.
    expect(txnKindOf({ type: 'import' })).toBe('received')
  })

  it('ignores a kind it does not recognise', () => {
    expect(txnKindOf({ txnKind: 'nonsense', type: 'issue' })).toBe('sent')
    expect(txnKindOf({ txnKind: null, type: 'import' })).toBe('received')
  })
})

describe('isOutwardKind', () => {
  it('counts only Sent as stock leaving', () => {
    expect(isOutwardKind('sent')).toBe(true)
    expect(isOutwardKind('returned')).toBe(false)
    expect(isOutwardKind('received')).toBe(false)
  })
})

describe('TXN_LABEL', () => {
  it('names every kind', () => {
    expect(TXN_LABEL).toEqual({ sent: 'Sent', returned: 'Returned', received: 'Received' })
  })
})
