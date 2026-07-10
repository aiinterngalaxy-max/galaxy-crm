export type VehicleType = 'car' | 'traveller' | 'bus'

export interface Vehicle {
  name: string
  category: string
  type: VehicleType
  seats: number
  minKmPerDay: number
  ratePerKm: number
  permitPerDay: number
  driverAllowancePerDay: number
  perDayRate: number
  localRate: number
}

export const VEHICLES: Vehicle[] = [
  // Cars
  { name: 'Sedan',                       category: 'Sedan',           type: 'car',       seats: 4,  minKmPerDay: 300, ratePerKm: 14, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 4700,  localRate: 1800 },
  { name: 'Ertiga',                      category: 'MUV',             type: 'car',       seats: 7,  minKmPerDay: 300, ratePerKm: 16, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 5300,  localRate: 2200 },
  { name: 'Kia Carens',                  category: 'MUV',             type: 'car',       seats: 6,  minKmPerDay: 300, ratePerKm: 19, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 6200,  localRate: 2500 },
  { name: 'Innova',                      category: 'MUV',             type: 'car',       seats: 7,  minKmPerDay: 300, ratePerKm: 18, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 5900,  localRate: 2400 },
  { name: 'Innova Crysta',               category: 'MUV',             type: 'car',       seats: 7,  minKmPerDay: 300, ratePerKm: 20, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 6500,  localRate: 2800 },
  { name: 'Fortuner',                    category: 'SUV',             type: 'car',       seats: 7,  minKmPerDay: 300, ratePerKm: 42, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 13100, localRate: 5500 },
  // Travellers
  { name: '9 Seater Winger AC',          category: 'Mini Van',        type: 'traveller', seats: 9,  minKmPerDay: 300, ratePerKm: 22, permitPerDay: 700,  driverAllowancePerDay: 600, perDayRate: 7900,  localRate: 3200 },
  { name: '9 Seater Maharaja Urbina AC', category: 'Mini Van',        type: 'traveller', seats: 9,  minKmPerDay: 300, ratePerKm: 49, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 16800, localRate: 6500 },
  { name: '13 Seater Maharaja AC',       category: 'Tempo Traveller', type: 'traveller', seats: 13, minKmPerDay: 300, ratePerKm: 35, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12600, localRate: 5000 },
  { name: '13 Seater AC TT',             category: 'Tempo Traveller', type: 'traveller', seats: 13, minKmPerDay: 300, ratePerKm: 25, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 8900,  localRate: 3800 },
  { name: '13 Seater Non-AC TT',         category: 'Tempo Traveller', type: 'traveller', seats: 13, minKmPerDay: 300, ratePerKm: 23, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 8300,  localRate: 3400 },
  { name: '17 Seater AC TT',             category: 'Tempo Traveller', type: 'traveller', seats: 17, minKmPerDay: 300, ratePerKm: 26, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 9200,  localRate: 4200 },
  { name: '16 Seater Urbina AC',         category: 'Tempo Traveller', type: 'traveller', seats: 16, minKmPerDay: 300, ratePerKm: 34, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12300, localRate: 5000 },
  { name: '20 Seater AC TT',             category: 'Tempo Traveller', type: 'traveller', seats: 20, minKmPerDay: 300, ratePerKm: 28, permitPerDay: 900,  driverAllowancePerDay: 600, perDayRate: 9900,  localRate: 4800 },
  { name: '26 Seater AC TT',             category: 'Tempo Traveller', type: 'traveller', seats: 26, minKmPerDay: 300, ratePerKm: 34, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12300, localRate: 5500 },
  { name: '26 Seater Non-AC TT',         category: 'Tempo Traveller', type: 'traveller', seats: 26, minKmPerDay: 300, ratePerKm: 32, permitPerDay: 1200, driverAllowancePerDay: 600, perDayRate: 11400, localRate: 5000 },
  // Buses
  { name: '27 Seater AC Bus',            category: 'Bus',             type: 'bus',       seats: 27, minKmPerDay: 300, ratePerKm: 39, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 13800, localRate: 6000 },
  { name: '30 Seater AC Bus',            category: 'Bus',             type: 'bus',       seats: 30, minKmPerDay: 300, ratePerKm: 40, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 14100, localRate: 6500 },
  { name: '35 Seater AC Bus',            category: 'Bus',             type: 'bus',       seats: 35, minKmPerDay: 300, ratePerKm: 47, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 16200, localRate: 7500 },
  { name: '35 Seater Non-AC Bus',        category: 'Bus',             type: 'bus',       seats: 35, minKmPerDay: 300, ratePerKm: 43, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 15000, localRate: 6800 },
  { name: '45 Seater AC Bus',            category: 'Bus',             type: 'bus',       seats: 45, minKmPerDay: 300, ratePerKm: 55, permitPerDay: 2000, driverAllowancePerDay: 700, perDayRate: 19200, localRate: 9500 },
  { name: '49 Seater AC Bus',            category: 'Bus',             type: 'bus',       seats: 49, minKmPerDay: 300, ratePerKm: 55, permitPerDay: 2000, driverAllowancePerDay: 700, perDayRate: 19200, localRate: 9500 },
  { name: '54 Seater AC Volvo Bus',      category: 'Volvo Bus',       type: 'bus',       seats: 54, minKmPerDay: 300, ratePerKm: 57, permitPerDay: 2500, driverAllowancePerDay: 700, perDayRate: 20300, localRate: 10500 },
  { name: '58 Seater AC Volvo Bus',      category: 'Volvo Bus',       type: 'bus',       seats: 58, minKmPerDay: 300, ratePerKm: 68, permitPerDay: 2500, driverAllowancePerDay: 700, perDayRate: 23600, localRate: 12000 },
]

export interface QuotationResult {
  days: number
  minKm: number
  totalKm: number
  extraKm: number
  baseCost: number
  extraKmCost: number
  total: number
}

export interface LocalQuotationResult {
  packageKm: number
  actualKm: number
  extraKm: number
  baseCost: number
  extraKmCost: number
  total: number
}

export function calculateQuotation(vehicle: Vehicle, days: number, inputKm: number): QuotationResult {
  const minKm = vehicle.minKmPerDay * days
  const totalKm = Math.max(inputKm, minKm)
  const extraKm = totalKm - minKm
  const baseCost = vehicle.perDayRate * days
  const extraKmCost = extraKm * vehicle.ratePerKm
  return { days, minKm, totalKm, extraKm, baseCost, extraKmCost, total: baseCost + extraKmCost }
}

export function calculateLocalQuotation(vehicle: Vehicle, inputKm: number): LocalQuotationResult {
  const packageKm = 80
  const actualKm = Math.max(inputKm, 0)
  const extraKm = Math.max(0, actualKm - packageKm)
  const baseCost = vehicle.localRate
  const extraKmCost = extraKm * vehicle.ratePerKm
  return { packageKm, actualKm, extraKm, baseCost, extraKmCost, total: baseCost + extraKmCost }
}

export function getSuggestedVehicles(passengers: number, all: Vehicle[] = VEHICLES): Vehicle[] {
  return all.filter(v => v.seats >= passengers)
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to)
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
}

const PRICE_KEY = 'topz-price-overrides'

type PriceField = 'ratePerKm' | 'permitPerDay' | 'driverAllowancePerDay' | 'localRate'

export function getPriceOverrides(): Record<string, Partial<Pick<Vehicle, PriceField>>> {
  try { return JSON.parse(localStorage.getItem(PRICE_KEY) ?? '{}') } catch { return {} }
}

export function setPriceOverride(name: string, field: PriceField, value: number) {
  const overrides = getPriceOverrides()
  overrides[name] = { ...overrides[name], [field]: value }
  localStorage.setItem(PRICE_KEY, JSON.stringify(overrides))
}

export function getVehicles(): Vehicle[] {
  const overrides = getPriceOverrides()
  return VEHICLES.map(v => {
    const merged = overrides[v.name] ? { ...v, ...overrides[v.name] } : { ...v }
    merged.perDayRate = merged.minKmPerDay * merged.ratePerKm + merged.permitPerDay + merged.driverAllowancePerDay
    return merged
  })
}
