const BASE = '/api/topz'

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
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Quotations ───────────────────────────────────────────────────────────────

export async function getQuotations(): Promise<SavedQuotation[]> {
  return api<SavedQuotation[]>('/quotations')
}

export async function saveQuotation(q: SavedQuotation): Promise<void> {
  await api('/quotations', { method: 'POST', body: JSON.stringify(q) })
}

export async function updateQuotationStatus(id: string, status: SavedQuotation['status']): Promise<void> {
  await api(`/quotations?id=${encodeURIComponent(id)}&status=${encodeURIComponent(status)}`, { method: 'PUT' })
}

export async function deleteQuotation(id: string): Promise<void> {
  await api(`/quotations?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export async function getBookings(): Promise<Booking[]> {
  return api<Booking[]>('/bookings')
}

export async function saveBooking(b: Booking): Promise<void> {
  await api('/bookings', { method: 'POST', body: JSON.stringify(b) })
}

export async function updateBooking(b: Booking): Promise<void> {
  await saveBooking(b)
}

export async function deleteBooking(id: string): Promise<void> {
  await api(`/bookings?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
