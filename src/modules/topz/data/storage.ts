import {
  collection, doc, setDoc, deleteDoc, getDocs,
  query, orderBy, Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { dbTopz } from '../../../lib/firebaseTopz'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toISO(val: unknown): string {
  if (!val) return new Date().toISOString()
  if (val instanceof Timestamp) return val.toDate().toISOString()
  return String(val)
}

// ─── Quotations ───────────────────────────────────────────────────────────────

const quotesCol = () => collection(dbTopz, 'quotations')

export async function getQuotations(): Promise<SavedQuotation[]> {
  const snap = await getDocs(query(quotesCol(), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => {
    const data = d.data()
    return { ...data, id: d.id, createdAt: toISO(data.createdAt) } as SavedQuotation
  })
}

export async function saveQuotation(q: SavedQuotation): Promise<void> {
  const { id, ...rest } = q
  await setDoc(doc(quotesCol(), id), { ...rest, createdAt: serverTimestamp() })
}

export async function updateQuotationStatus(id: string, status: SavedQuotation['status']): Promise<void> {
  await setDoc(doc(quotesCol(), id), { status }, { merge: true })
}

export async function deleteQuotation(id: string): Promise<void> {
  await deleteDoc(doc(quotesCol(), id))
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

const bookingsCol = () => collection(dbTopz, 'bookings')

export async function getBookings(): Promise<Booking[]> {
  const snap = await getDocs(query(bookingsCol(), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => {
    const data = d.data()
    return { ...data, id: d.id, createdAt: toISO(data.createdAt) } as Booking
  })
}

export async function saveBooking(b: Booking): Promise<void> {
  const { id, ...rest } = b
  await setDoc(doc(bookingsCol(), id), { ...rest, createdAt: serverTimestamp() })
}

export async function updateBooking(b: Booking): Promise<void> {
  await saveBooking(b)
}

export async function deleteBooking(id: string): Promise<void> {
  await deleteDoc(doc(bookingsCol(), id))
}
