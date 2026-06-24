export interface PresetRoom {
  name: string
  type: string
  products: { productId: string; qty: number }[]
}

export interface Preset {
  label: string
  description: string
  sectionDiscounts: Record<string, number>
  rooms: PresetRoom[]
}

export const PRESETS: Record<string, Preset> = {
  '2BHK': {
    label: '2 BHK',
    description: 'Entry · Living · Dining · 2 Bedrooms · Toilets · Network',
    sectionDiscounts: { ELYSIA_SWITCHES: 25, VITRUM_SWITCHES: 25, IR_CONTROLLERS: 25, SENSORS: 25, VDP: 25, CURTAINS: 25, LOCKS: 25, LCD_PANELS: 35, NETWORKING: 0 },
    rooms: [
      { name: 'Entry', type: 'entry', products: [{ productId: 'EL-009', qty: 1 }, { productId: 'VD-001', qty: 1 }, { productId: 'LK-002', qty: 1 }] },
      { name: 'Living Room', type: 'living', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 2 }, { productId: 'CR-007', qty: 1 }, { productId: 'LC-010', qty: 1 }] },
      { name: 'Dining', type: 'dining', products: [{ productId: 'EL-004', qty: 1 }, { productId: 'EL-007', qty: 1 }] },
      { name: 'Kitchen', type: 'kitchen', products: [] },
      { name: 'Master Bedroom', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 2', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Toilets', type: 'bathroom', products: [{ productId: 'SN-001', qty: 2 }] },
      { name: 'Network', type: 'utility', products: [{ productId: 'NW-001', qty: 3 }, { productId: 'NW-003', qty: 1 }] },
    ],
  },
  '3BHK': {
    label: '3 BHK',
    description: 'Entry · Living · Dining · 3 Bedrooms · Toilets · Network',
    sectionDiscounts: { ELYSIA_SWITCHES: 25, VITRUM_SWITCHES: 25, IR_CONTROLLERS: 25, SENSORS: 25, VDP: 25, CURTAINS: 25, LOCKS: 25, LCD_PANELS: 35, NETWORKING: 0 },
    rooms: [
      { name: 'Entry', type: 'entry', products: [{ productId: 'EL-009', qty: 1 }, { productId: 'VD-001', qty: 1 }, { productId: 'LK-002', qty: 1 }] },
      { name: 'Living Room', type: 'living', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 2 }, { productId: 'CR-007', qty: 1 }, { productId: 'LC-010', qty: 1 }] },
      { name: 'Dining', type: 'dining', products: [{ productId: 'EL-004', qty: 1 }, { productId: 'EL-007', qty: 1 }] },
      { name: 'Kitchen', type: 'kitchen', products: [] },
      { name: 'Master Bedroom', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 2', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 3', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Toilets', type: 'bathroom', products: [{ productId: 'SN-001', qty: 2 }] },
      { name: 'Network', type: 'utility', products: [{ productId: 'NW-001', qty: 3 }, { productId: 'NW-003', qty: 1 }] },
    ],
  },
  '4BHK': {
    label: '4 BHK',
    description: 'Entry · Living · Dining · 4 Bedrooms · Toilets · Network',
    sectionDiscounts: { ELYSIA_SWITCHES: 25, VITRUM_SWITCHES: 25, IR_CONTROLLERS: 25, SENSORS: 25, VDP: 25, CURTAINS: 25, LOCKS: 25, LCD_PANELS: 35, NETWORKING: 0 },
    rooms: [
      { name: 'Entry', type: 'entry', products: [{ productId: 'EL-009', qty: 1 }, { productId: 'VD-001', qty: 1 }, { productId: 'LK-002', qty: 1 }] },
      { name: 'Living Room', type: 'living', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 2 }, { productId: 'CR-007', qty: 1 }, { productId: 'LC-010', qty: 1 }] },
      { name: 'Dining', type: 'dining', products: [{ productId: 'EL-004', qty: 1 }, { productId: 'EL-007', qty: 1 }] },
      { name: 'Kitchen', type: 'kitchen', products: [] },
      { name: 'Master Bedroom', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 2', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 3', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Bedroom 4', type: 'bedroom', products: [{ productId: 'EL-004', qty: 2 }, { productId: 'EL-007', qty: 1 }, { productId: 'IR-002', qty: 1 }, { productId: 'EL-012', qty: 2 }, { productId: 'CR-001', qty: 1 }, { productId: 'LC-003', qty: 1 }] },
      { name: 'Toilets', type: 'bathroom', products: [{ productId: 'SN-001', qty: 2 }] },
      { name: 'Network', type: 'utility', products: [{ productId: 'NW-001', qty: 3 }, { productId: 'NW-003', qty: 1 }] },
    ],
  },
}

export const ACTIVE_PRESETS = Object.entries(PRESETS).map(([key, v]) => ({ key, ...v }))
