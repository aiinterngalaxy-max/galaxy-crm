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
  increment,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { logStage, warnIfPlaceholderConfig, STALL_MS, UploadStalledError } from './uploadDiagnostics'

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
export const storage = getStorage(app, `gs://${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'placeholder.appspot.com'}`)

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
  increment,
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

/**
 * Uploads with real progress and no wall-clock timeout.
 *
 * uploadBytes() gives no feedback, so large files look frozen; pairing it with a
 * Promise.race timeout was worse still — the race rejects but the transfer keeps
 * running, leaving an orphaned file in Storage. Resumable uploads report bytes
 * transferred, retry dropped chunks, and can be cancelled for real.
 *
 * Progress is reported 0..1. The returned promise resolves with the download URL.
 */
export function uploadFileResumable(
  path: string,
  data: Blob | File,
  onProgress?: (fraction: number) => void,
  contentType?: string,
): Promise<string> & { cancel: () => void } {
  warnIfPlaceholderConfig(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET)

  const task = uploadBytesResumable(ref(storage, path), data, contentType ? { contentType } : undefined)
  logStage('upload-start', { path, bytes: data.size, contentType })

  const promise = new Promise<string>((resolve, reject) => {
    // A blocked request never fires a single progress event, so the transfer sits
    // at 0% forever. Give up after STALL_MS with an error that names the likely
    // cause, and cancel the task so it cannot complete behind our back.
    let sawBytes = false
    const stallTimer = setTimeout(() => {
      if (sawBytes) return
      logStage('failed', { path, reason: 'no bytes transferred', afterMs: STALL_MS })
      try {
        task.cancel()
      } catch {
        /* already settled */
      }
      reject(new UploadStalledError())
    }, STALL_MS)

    const settle = () => clearTimeout(stallTimer)

    task.on(
      'state_changed',
      snap => {
        if (snap.totalBytes <= 0) return
        if (snap.bytesTransferred > 0 && !sawBytes) {
          sawBytes = true
          settle()
          logStage('first-byte', { path, bytes: snap.bytesTransferred })
        }
        onProgress?.(snap.bytesTransferred / snap.totalBytes)
      },
      err => {
        settle()
        logStage('failed', { path, code: (err as { code?: string }).code, message: err.message })
        reject(err)
      },
      async () => {
        settle()
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          logStage('upload-complete', { path, bytes: task.snapshot.totalBytes })
          resolve(url)
        } catch (err) {
          logStage('failed', { path, stage: 'getDownloadURL', error: String(err) })
          reject(err)
        }
      },
    )
  })

  return Object.assign(promise, { cancel: () => task.cancel() })
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
