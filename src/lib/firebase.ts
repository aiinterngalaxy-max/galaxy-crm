import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  QueryConstraint,
  writeBatch,
  arrayUnion,
  runTransaction,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'

// Firebase config — reads from .env file. Falls back to placeholder so the
// login page renders and shows setup instructions when not yet configured.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'PLACEHOLDER_API_KEY',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'placeholder.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'placeholder-project',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'placeholder.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '1:000000000000:web:placeholder',
}

export const isFirebaseConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

// ─── Auth ───────────────────────────────────────────────────────────────────────

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ hd: '' }) // allow all domains; restrict to company domain in production

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)
export const signOut = () => firebaseSignOut(auth)

// ─── Firestore Helpers ─────────────────────────────────────────────────────────

export {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  runTransaction,
  type QueryConstraint,
}

// Generic add document (returns id)
export async function addDocument<T extends object>(
  collectionName: string,
  data: T
): Promise<string> {
  const colRef = collection(db, collectionName)
  const docRef = await addDoc(colRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

// Generic update document
export async function updateDocument(
  collectionName: string,
  docId: string,
  data: Partial<Record<string, unknown>>
): Promise<void> {
  const docRef = doc(db, collectionName, docId)
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

// Generic delete document
export async function deleteDocument(
  collectionName: string,
  docId: string
): Promise<void> {
  await deleteDoc(doc(db, collectionName, docId))
}

// Generic get document
export async function getDocument<T>(
  collectionName: string,
  docId: string
): Promise<T | null> {
  const snap = await getDoc(doc(db, collectionName, docId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as T
}

// Generic get collection
export async function getCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> {
  const q = query(collection(db, collectionName), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
}

// ─── Storage Helpers ───────────────────────────────────────────────────────────

export async function uploadFile(
  path: string,
  file: File
): Promise<string> {
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}

export async function uploadBase64(path: string, base64: string, mimeType: string): Promise<string> {
  const byteString = atob(base64.split(',')[1])
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i)
  const blob = new Blob([ab], { type: mimeType })
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, blob)
  return getDownloadURL(storageRef)
}

// ─── Code Generators ───────────────────────────────────────────────────────────

export function generateLeadCode(seq: number): string {
  return `GHA-L-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export function generateQuotationCode(seq: number): string {
  return `GHA-Q-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export function generateProjectCode(seq: number): string {
  return `GHA-P-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export function generateInvoiceCode(seq: number): string {
  return `GHA-INV-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}
