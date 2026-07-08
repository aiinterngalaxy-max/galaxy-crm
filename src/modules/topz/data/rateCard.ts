export interface Vehicle {
  name: string
  category: string
  seats: number
  minKmPerDay: number
  ratePerKm: number
  permitPerDay: number
  driverAllowancePerDay: number
  perDayRate: number
}

export const VEHICLES: Vehicle[] = [
  // Sedans & SUVs
  { name: 'Sedan',                      category: 'Sedan',           seats: 4,  minKmPerDay: 300, ratePerKm: 14, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 4700  },
  { name: 'Ertiga',                     category: 'MUV',             seats: 7,  minKmPerDay: 300, ratePerKm: 16, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 5300  },
  { name: 'Kia Carens',                 category: 'MUV',             seats: 6,  minKmPerDay: 300, ratePerKm: 19, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 6200  },
  { name: 'Innova',                     category: 'MUV',             seats: 7,  minKmPerDay: 300, ratePerKm: 18, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 5900  },
  { name: 'Innova Crysta',              category: 'MUV',             seats: 7,  minKmPerDay: 300, ratePerKm: 20, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 6500  },
  { name: 'Fortuner',                   category: 'SUV',             seats: 7,  minKmPerDay: 300, ratePerKm: 42, permitPerDay: 0,    driverAllowancePerDay: 500, perDayRate: 13100 },
  // Mini Vans
  { name: '9 Seater Winger AC',         category: 'Mini Van',        seats: 9,  minKmPerDay: 300, ratePerKm: 22, permitPerDay: 700,  driverAllowancePerDay: 600, perDayRate: 7900  },
  { name: '9 Seater Maharaja Urbina AC',category: 'Mini Van',        seats: 9,  minKmPerDay: 300, ratePerKm: 49, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 16800 },
  // Tempo Travellers
  { name: '13 Seater Maharaja AC',      category: 'Tempo Traveller', seats: 13, minKmPerDay: 300, ratePerKm: 35, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12600 },
  { name: '13 Seater AC TT',            category: 'Tempo Traveller', seats: 13, minKmPerDay: 300, ratePerKm: 25, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 8900  },
  { name: '13 Seater Non-AC TT',        category: 'Tempo Traveller', seats: 13, minKmPerDay: 300, ratePerKm: 23, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 8300  },
  { name: '17 Seater AC TT',            category: 'Tempo Traveller', seats: 17, minKmPerDay: 300, ratePerKm: 26, permitPerDay: 800,  driverAllowancePerDay: 600, perDayRate: 9200  },
  { name: '16 Seater Urbina AC',        category: 'Tempo Traveller', seats: 16, minKmPerDay: 300, ratePerKm: 34, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12300 },
  { name: '20 Seater AC TT',            category: 'Tempo Traveller', seats: 20, minKmPerDay: 300, ratePerKm: 28, permitPerDay: 900,  driverAllowancePerDay: 600, perDayRate: 9900  },
  { name: '26 Seater AC TT',            category: 'Tempo Traveller', seats: 26, minKmPerDay: 300, ratePerKm: 34, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 12300 },
  { name: '26 Seater Non-AC TT',        category: 'Tempo Traveller', seats: 26, minKmPerDay: 300, ratePerKm: 32, permitPerDay: 1200, driverAllowancePerDay: 600, perDayRate: 11400 },
  // Buses
  { name: '27 Seater AC Bus',           category: 'Bus',             seats: 27, minKmPerDay: 300, ratePerKm: 39, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 13800 },
  { name: '30 Seater AC Bus',           category: 'Bus',             seats: 30, minKmPerDay: 300, ratePerKm: 40, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 14100 },
  { name: '35 Seater AC Bus',           category: 'Bus',             seats: 35, minKmPerDay: 300, ratePerKm: 47, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 16200 },
  { name: '35 Seater Non-AC Bus',       category: 'Bus',             seats: 35, minKmPerDay: 300, ratePerKm: 43, permitPerDay: 1500, driverAllowancePerDay: 600, perDayRate: 15000 },
  { name: '45 Seater AC Bus',           category: 'Bus',             seats: 45, minKmPerDay: 300, ratePerKm: 55, permitPerDay: 2000, driverAllowancePerDay: 700, perDayRate: 19200 },
  { name: '49 Seater AC Bus',           category: 'Bus',             seats: 49, minKmPerDay: 300, ratePerKm: 55, permitPerDay: 2000, driverAllowancePerDay: 700, perDayRate: 19200 },
  // Volvo
  { name: '54 Seater AC Volvo Bus',     category: 'Volvo Bus',       seats: 54, minKmPerDay: 300, ratePerKm: 57, permitPerDay: 2500, driverAllowancePerDay: 700, perDayRate: 20300 },
  { name: '58 Seater AC Volvo Bus',     category: 'Volvo Bus',       seats: 58, minKmPerDay: 300, ratePerKm: 68, permitPerDay: 2500, driverAllowancePerDay: 700, perDayRate: 23600 },
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

export function calculateQuotation(vehicle: Vehicle, days: number, inputKm: number): QuotationResult {
  const minKm = vehicle.minKmPerDay * days
  const totalKm = Math.max(inputKm, minKm)
  const extraKm = totalKm - minKm
  const baseCost = vehicle.perDayRate * days
  const extraKmCost = extraKm * vehicle.ratePerKm
  return { days, minKm, totalKm, extraKm, baseCost, extraKmCost, total: baseCost + extraKmCost }
}

export function getSuggestedVehicles(passengers: number): Vehicle[] {
  return VEHICLES.filter(v => v.seats >= passengers).slice(0, 6)
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to)
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
}
