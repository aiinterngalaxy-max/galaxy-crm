const Q = '/api/topz-quotations'
const B = '/api/topz-bookings'

export const TOPZ_TEAM = ['Smita', 'Amisha', 'Bharti'] as const

export interface SavedQuotation {
  id: string
  quoteNo: string
  createdAt: string
  status: 'draft' | 'sent' | 'converted'
  tripType: 'outstation' | 'local'
  isRoundTrip: boolean
  clientName: string
  clientPhone: string
  clientEmail: string
  pickupDate: string
  pickupLocation: string
  dropDate: string
  dropLocation: string
  passengers: string
  estimatedKm: string
  vehicleName: string
  vehicleCategory: string
  days: number
  totalAmount: number
}

export interface Booking {
  id: string
  createdAt: string
  quoteNo: string
  clientName: string
  clientPhone: string
  vehicleName: string
  pickupDate: string
  dropDate: string
  pickupLocation: string
  dropLocation: string
  totalAmount: number
  advancePaid: number
  status: 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  notes: string
  tripType: 'outstation' | 'local'
  supplier?: string
  /** Profit/loss on this booking in ₹. Positive = profit, negative = loss. */
  commission: number
  /** Which team member took/handled this booking. */
  takenBy?: string
}

async function call<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Quotations ───────────────────────────────────────────────────────────────

export async function getQuotations(): Promise<SavedQuotation[]> {
  return call<SavedQuotation[]>(Q)
}

export async function saveQuotation(q: SavedQuotation): Promise<void> {
  await call(Q, { method: 'POST', body: JSON.stringify(q) })
}

export async function updateQuotationStatus(id: string, status: SavedQuotation['status']): Promise<void> {
  await call(`${Q}?id=${encodeURIComponent(id)}&status=${encodeURIComponent(status)}`, { method: 'PUT' })
}

export async function deleteQuotation(id: string): Promise<void> {
  await call(`${Q}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export async function getBookings(): Promise<Booking[]> {
  return call<Booking[]>(B)
}

export async function saveBooking(b: Booking): Promise<void> {
  await call(B, { method: 'POST', body: JSON.stringify(b) })
}

export async function updateBooking(b: Booking): Promise<void> {
  await saveBooking(b)
}

export async function deleteBooking(id: string): Promise<void> {
  await call(`${B}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
