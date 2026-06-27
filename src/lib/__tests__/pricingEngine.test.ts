import { describe, it, expect } from 'vitest'
import { computePricing, aggregateRoomProducts, getInstallationRate } from '../pricingEngine'

const mockProduct = (id: string, category: string, gsp: number) => ({
  id,
  partCode: id,
  name: `Product ${id}`,
  category,
  gsp,
})

// ─── aggregateRoomProducts ────────────────────────────────────────────────────

describe('aggregateRoomProducts', () => {
  it('returns empty map for no rooms', () => {
    expect(aggregateRoomProducts([])).toEqual({})
  })

  it('aggregates single room', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 2 }] }]
    expect(aggregateRoomProducts(rooms)).toEqual({ P1: 2 })
  })

  it('sums same product across rooms', () => {
    const rooms = [
      { products: [{ productId: 'P1', qty: 2 }] },
      { products: [{ productId: 'P1', qty: 3 }] },
    ]
    expect(aggregateRoomProducts(rooms)).toEqual({ P1: 5 })
  })

  it('aggregates different products', () => {
    const rooms = [
      { products: [{ productId: 'P1', qty: 1 }, { productId: 'P2', qty: 2 }] },
    ]
    expect(aggregateRoomProducts(rooms)).toEqual({ P1: 1, P2: 2 })
  })

  it('skips products with qty 0', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 0 }] }]
    expect(aggregateRoomProducts(rooms)).toEqual({})
  })
})

// ─── getInstallationRate ──────────────────────────────────────────────────────

describe('getInstallationRate', () => {
  it('LCD_PANELS has 0 installation rate', () => {
    expect(getInstallationRate('LCD_PANELS')).toBe(0)
  })

  it('LOCKS has 10% installation rate', () => {
    expect(getInstallationRate('LOCKS')).toBe(0.10)
  })

  it('unknown category defaults to 15%', () => {
    expect(getInstallationRate('ELYSIA_SWITCHES')).toBe(0.15)
    expect(getInstallationRate('ANYTHING_ELSE')).toBe(0.15)
  })
})

// ─── computePricing ───────────────────────────────────────────────────────────

describe('computePricing', () => {
  it('returns zeros for empty rooms', () => {
    const result = computePricing([], [])
    expect(result.productSubtotal).toBe(0)
    expect(result.grandSubtotal).toBe(0)
    expect(result.lineItems).toHaveLength(0)
    expect(result.sections).toHaveLength(0)
  })

  it('skips products not found in catalog', () => {
    const rooms = [{ products: [{ productId: 'UNKNOWN', qty: 1 }] }]
    const result = computePricing(rooms, [])
    expect(result.lineItems).toHaveLength(0)
    expect(result.productSubtotal).toBe(0)
  })

  it('computes correct subtotal for single product', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 3 }] }]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 1000)]
    const result = computePricing(rooms, products)

    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].qty).toBe(3)
    expect(result.lineItems[0].unitPrice).toBe(1000)
    expect(result.lineItems[0].amount).toBe(3000)
    expect(result.productSubtotal).toBe(3000)
  })

  it('applies 15% installation for standard category', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 1 }] }]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 10000)]
    const result = computePricing(rooms, products)

    expect(result.totalInstallation).toBe(1500) // 10000 * 0.15
    expect(result.grandSubtotal).toBe(11500)
  })

  it('applies 0% installation for LCD_PANELS', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 1 }] }]
    const products = [mockProduct('P1', 'LCD_PANELS', 10000)]
    const result = computePricing(rooms, products)

    expect(result.totalInstallation).toBe(0)
    expect(result.grandSubtotal).toBe(10000)
  })

  it('applies 10% installation for LOCKS', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 1 }] }]
    const products = [mockProduct('P1', 'LOCKS', 10000)]
    const result = computePricing(rooms, products)

    expect(result.totalInstallation).toBe(1000)
  })

  it('applies section discount correctly', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 1 }] }]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 10000)]
    const result = computePricing(rooms, products, { ELYSIA_SWITCHES: 10 })

    expect(result.discountAmount).toBe(1000)
    expect(result.discountedSubtotal).toBe(9000)
    expect(result.discountPercent).toBe(10)
  })

  it('installation is applied after discount', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 1 }] }]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 10000)]
    const result = computePricing(rooms, products, { ELYSIA_SWITCHES: 10 })

    // Discounted = 9000, installation = 9000 * 0.15 = 1350
    expect(result.totalInstallation).toBe(1350)
    expect(result.grandSubtotal).toBe(10350)
  })

  it('zero discount returns same as no discount', () => {
    const rooms = [{ products: [{ productId: 'P1', qty: 2 }] }]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 5000)]

    const withZero = computePricing(rooms, products, { ELYSIA_SWITCHES: 0 })
    const withNone = computePricing(rooms, products, {})

    expect(withZero.grandSubtotal).toBe(withNone.grandSubtotal)
    expect(withZero.discountAmount).toBe(0)
  })

  it('aggregates multiple rooms for same product', () => {
    const rooms = [
      { products: [{ productId: 'P1', qty: 2 }] },
      { products: [{ productId: 'P1', qty: 3 }] },
    ]
    const products = [mockProduct('P1', 'ELYSIA_SWITCHES', 1000)]
    const result = computePricing(rooms, products)

    expect(result.lineItems[0].qty).toBe(5)
    expect(result.productSubtotal).toBe(5000)
  })

  it('creates separate sections per category', () => {
    const rooms = [{
      products: [
        { productId: 'P1', qty: 1 },
        { productId: 'P2', qty: 1 },
      ]
    }]
    const products = [
      mockProduct('P1', 'ELYSIA_SWITCHES', 1000),
      mockProduct('P2', 'LCD_PANELS', 5000),
    ]
    const result = computePricing(rooms, products)

    expect(result.sections).toHaveLength(2)
    expect(result.productSubtotal).toBe(6000)
  })

  it('discountPercent is 0 when productSubtotal is 0', () => {
    const result = computePricing([], [])
    expect(result.discountPercent).toBe(0)
  })
})
