import { describe, it, expect } from 'vitest'
import { getSuggestionsForRoom } from '../rulesEngine'

const products = [
  { id: 'IR-003', partCode: 'IR-003' },
  { id: 'IR-001', partCode: 'IR-001' },
  { id: 'IR-002', partCode: 'IR-002' },
  { id: 'EL-008', partCode: 'EL-008' },
  { id: 'CR-001', partCode: 'CR-001' },
  { id: 'SN-001', partCode: 'SN-001' },
]

describe('getSuggestionsForRoom', () => {
  it('returns empty for a plain room with no features', () => {
    expect(getSuggestionsForRoom({ name: 'Storage' }, products)).toHaveLength(0)
  })

  it('suggests IR-003 (preferred) when room has AC', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Bedroom', hasAC: true }, products)
    const ids = suggestions.map(s => s.productId)
    expect(ids).toContain('IR-003')
    expect(ids).not.toContain('IR-001')
  })

  it('falls back to IR-001 if IR-003 is not in catalog', () => {
    const limited = products.filter(p => p.id !== 'IR-003')
    const suggestions = getSuggestionsForRoom({ name: 'Bedroom', hasAC: true }, limited)
    expect(suggestions.map(s => s.productId)).toContain('IR-001')
  })

  it('suggests IR-002 when room has TV', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Living Room', hasTV: true }, products)
    expect(suggestions.map(s => s.productId)).toContain('IR-002')
  })

  it('suggests EL-008 when room has fan', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Bedroom', hasFan: true }, products)
    expect(suggestions.map(s => s.productId)).toContain('EL-008')
  })

  it('suggests CR-001 with qty matching curtainsCount', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Living Room', curtainsCount: 3 }, products)
    const curtain = suggestions.find(s => s.productId === 'CR-001')
    expect(curtain).toBeDefined()
    expect(curtain!.qty).toBe(3)
  })

  it('does not suggest CR-001 for curtainsCount 0', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Bedroom', curtainsCount: 0 }, products)
    expect(suggestions.find(s => s.productId === 'CR-001')).toBeUndefined()
  })

  it('suggests SN-001 for washroom room type', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Toilet', type: 'washroom' }, products)
    expect(suggestions.map(s => s.productId)).toContain('SN-001')
  })

  it('suggests SN-001 for bathroom room type', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Bath', type: 'bathroom' }, products)
    expect(suggestions.map(s => s.productId)).toContain('SN-001')
  })

  it('does not suggest SN-001 for non-washroom room type', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Bedroom', type: 'bedroom' }, products)
    expect(suggestions.find(s => s.productId === 'SN-001')).toBeUndefined()
  })

  it('groups same product from multiple rules into one suggestion', () => {
    // AC triggers IR-003; TV also could overlap — here use curtains x2 to force qty grouping
    const suggestions = getSuggestionsForRoom({ curtainsCount: 2 }, products)
    const curtain = suggestions.find(s => s.productId === 'CR-001')
    expect(curtain!.qty).toBe(2)
    expect(suggestions.filter(s => s.productId === 'CR-001')).toHaveLength(1)
  })

  it('populates reasons array for each trigger', () => {
    const suggestions = getSuggestionsForRoom({ name: 'Master Bedroom', hasAC: true }, products)
    const ir = suggestions.find(s => s.productId === 'IR-003')
    expect(ir!.reasons.length).toBeGreaterThan(0)
    expect(ir!.reasons[0]).toContain('Master Bedroom')
  })

  it('returns no suggestions when product catalog is empty', () => {
    expect(getSuggestionsForRoom({ hasAC: true, hasTV: true, hasFan: true }, [])).toHaveLength(0)
  })

  it('handles multiple features in one room', () => {
    const suggestions = getSuggestionsForRoom(
      { name: 'Living', hasTV: true, curtainsCount: 2 },
      products
    )
    const ids = suggestions.map(s => s.productId)
    expect(ids).toContain('IR-002')
    expect(ids).toContain('CR-001')
  })
})
