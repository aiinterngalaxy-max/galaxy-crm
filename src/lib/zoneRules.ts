export interface ZoneRule {
  keywords: string[]
  label: string
  icon: string
  suggestions: { productId: string; qty: number }[]
  reason: string
}

export const ZONE_RULES: ZoneRule[] = [
  {
    keywords: ['washroom', 'toilet', 'bathroom', 'wc', 'bath', 'toilets'],
    label: 'Washroom', icon: '🚿',
    suggestions: [{ productId: 'SN-001', qty: 1 }],
    reason: 'Presence sensor for automatic lighting',
  },
  {
    keywords: ['living', 'lounge', 'drawing room', 'hall'],
    label: 'Living Room', icon: '🛋️',
    suggestions: [
      { productId: 'LC-010', qty: 1 },
      { productId: 'IR-002', qty: 1 },
      { productId: 'EL-004', qty: 2 },
      { productId: 'CR-001', qty: 2 },
    ],
    reason: 'LCD panel, IR blaster, switches & curtain motors',
  },
  {
    keywords: ['master bedroom', 'master bed'],
    label: 'Master Bedroom', icon: '🛏️',
    suggestions: [
      { productId: 'LC-003', qty: 1 },
      { productId: 'IR-002', qty: 1 },
      { productId: 'EL-004', qty: 2 },
      { productId: 'CR-001', qty: 1 },
    ],
    reason: 'LCD panel, IR controller, switches & curtain motor',
  },
  {
    keywords: ['bedroom', 'bed room'],
    label: 'Bedroom', icon: '🛏️',
    suggestions: [
      { productId: 'LC-003', qty: 1 },
      { productId: 'IR-002', qty: 1 },
      { productId: 'EL-004', qty: 2 },
      { productId: 'CR-001', qty: 1 },
    ],
    reason: 'LCD panel, IR controller, switches & curtain motor',
  },
  {
    keywords: ['kitchen'],
    label: 'Kitchen', icon: '🍳',
    suggestions: [
      { productId: 'SN-001', qty: 1 },
      { productId: 'EL-004', qty: 1 },
    ],
    reason: 'Presence sensor + switch for kitchen automation',
  },
  {
    keywords: ['passage', 'corridor', 'hallway', 'foyer', 'entry', 'entrance', 'lobby'],
    label: 'Passage / Entry', icon: '🚪',
    suggestions: [
      { productId: 'SN-001', qty: 1 },
      { productId: 'VD-001', qty: 1 },
    ],
    reason: 'Presence sensor + video door phone at entry',
  },
  {
    keywords: ['balcony', 'terrace', 'patio'],
    label: 'Balcony', icon: '🌿',
    suggestions: [{ productId: 'SN-001', qty: 1 }],
    reason: 'Presence sensor for outdoor auto lighting',
  },
  {
    keywords: ['dining'],
    label: 'Dining', icon: '🍽️',
    suggestions: [
      { productId: 'EL-004', qty: 1 },
      { productId: 'EL-007', qty: 1 },
    ],
    reason: 'Switches for dining area lighting control',
  },
  {
    keywords: ['study', 'office', 'work'],
    label: 'Study / Office', icon: '📚',
    suggestions: [
      { productId: 'LC-003', qty: 1 },
      { productId: 'IR-002', qty: 1 },
    ],
    reason: 'LCD panel + IR controller for productivity zone',
  },
]

export function getZoneSuggestions(zoneName: string): ZoneRule[] {
  const lower = zoneName.toLowerCase()
  for (const rule of ZONE_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return [rule]
  }
  return []
}
