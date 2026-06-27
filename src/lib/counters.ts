import { runTransaction, doc } from 'firebase/firestore'
import { db } from './firebase'

// Atomic counter using a Firestore transaction — race-condition safe.
// Replaces the pattern: getDocs(collection) → size + 1
// which fetches all documents AND produces duplicates under concurrent writes.
// Note: do NOT use Firestore increment() inside a transaction — the transaction
// already serializes reads/writes, so we compute and write the exact value directly.

const countersRef = () => doc(db, 'meta', 'counters')

async function nextSeq(field: string): Promise<number> {
  return runTransaction(db, async tx => {
    const snap = await tx.get(countersRef())
    const current = snap.exists() ? ((snap.data()[field] as number) ?? 0) : 0
    const next = current + 1
    if (snap.exists()) {
      tx.update(countersRef(), { [field]: next })
    } else {
      tx.set(countersRef(), { [field]: next })
    }
    return next
  })
}

export async function nextLeadCode(): Promise<string> {
  const seq = await nextSeq('leads')
  return `GHA-L-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export async function nextQuotationCode(): Promise<string> {
  const seq = await nextSeq('quotations')
  return `GHA-Q-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export async function nextProjectCode(): Promise<string> {
  const seq = await nextSeq('projects')
  return `GHA-P-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}
