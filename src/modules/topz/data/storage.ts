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

export interface Lead {
  id: string
  createdAt: string
  name: string
  phone: string
  email: string
  requirement: string
  status: 'new' | 'contacted' | 'quoted' | 'converted' | 'lost'
  notes: string
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
}

function getList<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] }
}
function setList<T>(key: string, list: T[]) {
  localStorage.setItem(key, JSON.stringify(list))
}

const QUOTE_KEY = 'topz-quotations'
const LEAD_KEY = 'topz-leads'
const BOOKING_KEY = 'topz-bookings'

export function getQuotations(): SavedQuotation[] { return getList(QUOTE_KEY) }
export function saveQuotation(q: SavedQuotation) {
  setList(QUOTE_KEY, [q, ...getQuotations().filter(x => x.id !== q.id)])
}
export function updateQuotationStatus(id: string, status: SavedQuotation['status']) {
  setList(QUOTE_KEY, getQuotations().map(q => q.id === id ? { ...q, status } : q))
}
export function deleteQuotation(id: string) {
  setList(QUOTE_KEY, getQuotations().filter(q => q.id !== id))
}

export function getLeads(): Lead[] { return getList(LEAD_KEY) }
export function saveLead(l: Lead) {
  setList(LEAD_KEY, [l, ...getLeads().filter(x => x.id !== l.id)])
}
export function deleteLead(id: string) {
  setList(LEAD_KEY, getLeads().filter(l => l.id !== id))
}

export function getBookings(): Booking[] { return getList(BOOKING_KEY) }
export function saveBooking(b: Booking) {
  setList(BOOKING_KEY, [b, ...getBookings().filter(x => x.id !== b.id)])
}
export function deleteBooking(id: string) {
  setList(BOOKING_KEY, getBookings().filter(b => b.id !== id))
}
