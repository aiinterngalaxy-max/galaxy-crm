import { describe, it, expect } from 'vitest'
import { closingOf } from '../stock'

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
