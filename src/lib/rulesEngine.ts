export interface Suggestion {
  productId: string
  qty: number
  reasons: string[]
}

type Product = { id: string; partCode?: string }
type Room = { name?: string; type?: string; hasAC?: boolean; hasTV?: boolean; hasFan?: boolean; curtainsCount?: number; controllerType?: string }

const RULES: ((room: Room, products: Product[]) => { productId: string; reason: string }[])[] = [
  (room, products) => {
    if (!room.hasAC) return []
    const p = products.find(x => x.id === 'IR-003' || x.partCode === 'IR-003') || products.find(x => x.id === 'IR-001' || x.partCode === 'IR-001')
    return p ? [{ productId: p.id, reason: `AC in "${room.name}"` }] : []
  },
  (room, products) => {
    if (!room.hasTV) return []
    const p = products.find(x => x.id === 'IR-002' || x.partCode === 'IR-002')
    return p ? [{ productId: p.id, reason: `TV in "${room.name}"` }] : []
  },
  (room, products) => {
    if (!room.hasFan) return []
    const p = products.find(x => x.id === 'EL-008' || x.partCode === 'EL-008')
    return p ? [{ productId: p.id, reason: `Fan in "${room.name}"` }] : []
  },
  (room, products) => {
    const count = parseInt(String(room.curtainsCount || 0), 10)
    if (count <= 0) return []
    const p = products.find(x => x.id === 'CR-001' || x.partCode === 'CR-001')
    return p ? Array.from({ length: count }, () => ({ productId: p.id, reason: `${count} curtain(s)` })) : []
  },
  (room, products) => {
    const t = (room.type || '').toLowerCase()
    if (!t.includes('bathroom') && !t.includes('washroom') && !t.includes('toilet')) return []
    const p = products.find(x => x.id === 'SN-001' || x.partCode === 'SN-001')
    return p ? [{ productId: p.id, reason: `Washroom: "${room.name}"` }] : []
  },
]

export const getSuggestionsForRoom = (room: Room, products: Product[]): Suggestion[] => {
  const raw = RULES.flatMap(rule => rule(room, products))
  const grouped: Record<string, Suggestion> = {}
  raw.forEach(({ productId, reason }) => {
    if (!grouped[productId]) grouped[productId] = { productId, qty: 0, reasons: [] }
    grouped[productId].qty += 1
    grouped[productId].reasons.push(reason)
  })
  return Object.values(grouped)
}
