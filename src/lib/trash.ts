import { db } from './firebase'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp,
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

/**
 * Marks a trash entry as one quote PDF rather than a whole document.
 *
 * The generic restore path calls setDoc() on originalCollection/originalId, which
 * would overwrite an entire lead with a single quote. Quote entries carry this
 * collection name so restoreItem() can route them to the array-aware path below
 * instead.
 */
export const QUOTE_TRASH_COLLECTION = 'quoteDocuments'

/**
 * Moves one quote PDF off a lead or partner and into the recycle bin.
 *
 * The file itself is left in storage untouched — only the reference on the parent
 * record is removed, so restoring is exact and nothing is ever unrecoverable.
 */
export async function trashQuoteDoc(
  parentCollection: 'leads' | 'partners',
  parentId: string,
  quote: Record<string, unknown>,
  userId: string,
  userName: string,
): Promise<void> {
  const ref = doc(db, parentCollection, parentId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Record not found')

  const current = ((snap.data() as Record<string, unknown>).quoteDocuments ?? []) as Record<string, unknown>[]
  const remaining = current.filter(q => q.url !== quote.url)

  await addDoc(collection(db, 'deletedItems'), {
    originalCollection: QUOTE_TRASH_COLLECTION,
    originalId: parentId,
    parentCollection,
    displayName: `Quote: ${quote.name ?? 'PDF'}`,
    deletedAt: serverTimestamp(),
    deletedBy: userId,
    deletedByName: userName,
    data: quote,
  })

  await updateDoc(ref, { quoteDocuments: remaining, updatedAt: serverTimestamp() })
}

export async function restoreItem(trashId: string): Promise<void> {
  const trashRef = doc(db, 'deletedItems', trashId)
  const snap = await getDoc(trashRef)
  if (!snap.exists()) throw new Error('Trash item not found')

  const entry = snap.data() as TrashItem & { parentCollection?: string }
  const { originalCollection, originalId, data } = entry

  // A quote lives inside an array on its parent, so it is pushed back rather than
  // written as a document. Using setDoc here would replace the whole lead.
  if (originalCollection === QUOTE_TRASH_COLLECTION) {
    const parentCollection = entry.parentCollection || 'leads'
    const parentRef = doc(db, parentCollection, originalId)
    const parentSnap = await getDoc(parentRef)
    if (!parentSnap.exists()) {
      throw new Error('The record this quote belonged to no longer exists')
    }
    const current = ((parentSnap.data() as Record<string, unknown>).quoteDocuments ?? []) as Record<string, unknown>[]
    // Guard against a double restore leaving two copies.
    const already = current.some(q => q.url === (data as Record<string, unknown>).url)
    if (!already) {
      await updateDoc(parentRef, { quoteDocuments: [...current, data], updatedAt: serverTimestamp() })
    }
    await deleteDoc(trashRef)
    return
  }

  // Restore with original ID
  await setDoc(doc(db, originalCollection, originalId), data)
  await deleteDoc(trashRef)
}

export async function permanentDelete(trashId: string): Promise<void> {
  await deleteDoc(doc(db, 'deletedItems', trashId))
}
