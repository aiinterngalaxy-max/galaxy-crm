export const INSTALLATION_RATES: Record<string, number> = {
  LCD_PANELS: 0,
  LOCKS:      0.10,
  _default:   0.15,
}

export const getInstallationRate = (category: string) =>
  INSTALLATION_RATES[category] ?? INSTALLATION_RATES._default

export interface LineItem {
  productId: string
  name:      string
  partCode:  string
  category:  string
  image:     string
  unitPrice: number
  qty:       number
  amount:    number
}

export interface PricingSection {
  category:             string
  itemTotal:            number
  discountPercent:      number
  discountAmount:       number
  discountedItemTotal:  number
  installRate:          number
  installCharge:        number
}

export interface PricingResult {
  lineItems:           LineItem[]
  sections:            PricingSection[]
  productSubtotal:     number
  discountPercent:     number
  discountAmount:      number
  discountedSubtotal:  number
  totalInstallation:   number
  grandSubtotal:       number
}

const CATEGORY_ORDER = [
  'ELYSIA_SWITCHES','VITRUM_SWITCHES','IR_CONTROLLERS','SENSORS',
  'CONTROLLERS','LCD_PANELS','LOCKS','NETWORKING','VDP','CURTAINS',
]

export const aggregateRoomProducts = (rooms: { products: { productId: string; qty: number }[] }[]) => {
  const map: Record<string, number> = {}
  rooms.forEach(room => {
    ;(room.products || []).forEach(({ productId, qty }) => {
      if (qty > 0) map[productId] = (map[productId] || 0) + qty
    })
  })
  return map
}

export const computePricing = (
  rooms: { products: { productId: string; qty: number }[] }[],
  products: { id: string; partCode?: string; name: string; category: string; gsp: number; imageUrl?: string; image?: string }[],
  sectionDiscounts: Record<string, number> = {}
): PricingResult => {
  const aggregated = aggregateRoomProducts(rooms)

  const lineItems: LineItem[] = Object.entries(aggregated)
    .map(([productId, qty]) => {
      const product = products.find(p => p.id === productId || p.partCode === productId)
      if (!product) return null
      const unitPrice = product.gsp
      const amount    = unitPrice * qty
      return {
        productId,
        name:      product.name,
        partCode:  product.partCode || product.id,
        category:  product.category,
        image:     product.imageUrl || (product as any).image || '',
        unitPrice,
        qty,
        amount,
      }
    })
    .filter(Boolean) as LineItem[]

  lineItems.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category)
    const bi = CATEGORY_ORDER.indexOf(b.category)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const sectionMap: Record<string, { itemTotal: number; installRate: number; discountPercent: number }> = {}
  lineItems.forEach(item => {
    if (!sectionMap[item.category]) {
      sectionMap[item.category] = {
        itemTotal:       0,
        installRate:     getInstallationRate(item.category),
        discountPercent: sectionDiscounts[item.category] ?? 0,
      }
    }
    sectionMap[item.category].itemTotal += item.amount
  })

  const sections: PricingSection[] = Object.entries(sectionMap).map(([category, sec]) => {
    const disc = sec.discountPercent / 100
    const discountedItemTotal = lineItems
      .filter(i => i.category === category)
      .reduce((s, i) => s + Math.round(i.unitPrice * (1 - disc)) * i.qty, 0)
    const discountAmount = sec.itemTotal - discountedItemTotal
    const installCharge  = Math.round(discountedItemTotal * sec.installRate)
    return { category, ...sec, discountAmount, discountedItemTotal, installCharge }
  })

  const productSubtotal    = sections.reduce((s, sec) => s + sec.itemTotal, 0)
  const discountAmount     = sections.reduce((s, sec) => s + sec.discountAmount, 0)
  const discountedSubtotal = sections.reduce((s, sec) => s + sec.discountedItemTotal, 0)
  const totalInstallation  = sections.reduce((s, sec) => s + sec.installCharge, 0)
  const grandSubtotal      = discountedSubtotal + totalInstallation
  const discountPercent    = productSubtotal > 0
    ? Math.round((discountAmount / productSubtotal) * 1000) / 10
    : 0

  return { lineItems, sections, productSubtotal, discountPercent, discountAmount, discountedSubtotal, totalInstallation, grandSubtotal }
}
