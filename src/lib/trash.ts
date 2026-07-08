import { db } from './firebase'
import {
  doc, getDoc, setDoc, deleteDoc, collection, addDoc, serverTimestamp,
} from 'firebase/firestore'

export interface TrashItem {
  id: string
  originalCollection: string
  originalId: string
  displayName: string
  deletedAt: unknown
  deletedBy: string
  deletedByName: string
  data: Record<string, unknown>
}

const LABEL_MAP: Record<string, string> = {
  leads: 'Lead',
  customers: 'Customer',
  projects: 'Project',
  quotations: 'Quotation',
  partners: 'Partner',
  candidates: 'Candidate',
  jobDescriptions: 'Job Description',
  inventory: 'Inventory Item',
  nonWorkingInventory: 'Non-Working Item',
}

function displayName(collectionName: string, data: Record<string, unknown>): string {
  const type = LABEL_MAP[collectionName] ?? collectionName
  const name = (data.name ?? data.title ?? data.quotationCode ?? data.projectCode ?? data.leadCode ?? '') as string
  return name ? `${type}: ${name}` : type
}

export async function trashItem(
  collectionName: string,
  docId: string,
  userId: string,
  userName: string
): Promise<void> {
  const ref = doc(db, collectionName, docId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Document not found')

  const data = snap.data() as Record<string, unknown>

  await addDoc(collection(db, 'deletedItems'), {
    originalCollection: collectionName,
    originalId: docId,
    displayName: displayName(collectionName, data),
    deletedAt: serverTimestamp(),
    deletedBy: userId,
    deletedByName: userName,
    data,
  })

  await deleteDoc(ref)
}

export async function restoreItem(trashId: string): Promise<void> {
  const trashRef = doc(db, 'deletedItems', trashId)
  const snap = await getDoc(trashRef)
  if (!snap.exists()) throw new Error('Trash item not found')

  const { originalCollection, originalId, data } = snap.data() as TrashItem

  // Restore with original ID
  await setDoc(doc(db, originalCollection, originalId), data)
  await deleteDoc(trashRef)
}

export async function permanentDelete(trashId: string): Promise<void> {
  await deleteDoc(doc(db, 'deletedItems', trashId))
}
