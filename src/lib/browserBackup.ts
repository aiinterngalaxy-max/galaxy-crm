import { db } from './firebase'
import { collection, getDocs } from 'firebase/firestore'

/**
 * In-browser Firestore backup.
 *
 * The command-line backup needs a credential this project cannot supply: the CRM
 * signs in with Google only, so there is no email/password to give a script, and
 * a service-account key has to be downloaded by hand from the Firebase console.
 *
 * This route needs neither. The person clicking the button is already signed in,
 * so their session does the reading and the file lands in their Downloads folder.
 * Nothing to install, nothing to configure, no key to leak.
 *
 * It is read-only. There is no write, update or delete call in this file.
 *
 * The trade-off is that it is manual — a browser tab cannot run on a schedule.
 * Automated backups still want the service-account route; see MAINTENANCE.md.
 */

/** Every top-level collection, from firestore.rules plus the ones the app writes. */
const COLLECTIONS = [
  'users', 'meta', 'accessRequests',
  'leads', 'customers', 'partners',
  'quotations', 'products', 'projects', 'invoices',
  'inventory', 'nonWorkingInventory', 'stockTransactions',
  'dailyReports', 'aiDigests', 'notifications', 'auditLogs',
  'settings', 'jobDescriptions', 'candidates', 'deletedItems',
]

/**
 * Subcollections keyed by parent. Read one parent at a time via its full path:
 * firestore.rules scopes these to an exact parent, which a collectionGroup query
 * across every parent does not satisfy.
 */
const SUBCOLLECTIONS_BY_PARENT: Record<string, string[]> = {
  leads: ['activities', 'documents'],
  quotations: ['lineItems'],
  projects: ['workflow', 'milestones', 'tasks', 'orderItems', 'siteReports', 'issues'],
  invoices: ['payments'],
}

export interface BackupProgress {
  /** What is being read right now, for the button label. */
  current: string
  done: number
  total: number
}

export interface BackupResult {
  fileName: string
  totalDocuments: number
  collections: Record<string, number>
  skipped: Record<string, string>
}

/**
 * Timestamps, GeoPoints, references and bytes do not survive JSON.stringify.
 * Tag them so a restore can tell what each value used to be.
 */
function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(serialize)

  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.toDate === 'function') {
      return { __type: 'timestamp', iso: (v.toDate as () => Date)().toISOString() }
    }
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      return { __type: 'geopoint', latitude: v.latitude, longitude: v.longitude }
    }
    if (typeof v.path === 'string' && v.firestore) {
      return { __type: 'reference', path: v.path }
    }
    if (typeof v.toBase64 === 'function') {
      return { __type: 'bytes', base64: (v.toBase64 as () => string)() }
    }
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) out[k] = serialize(val)
    return out
  }

  return value
}

/**
 * Reads everything the signed-in user is allowed to see and returns it as one
 * object. A collection that errors is recorded in `skipped` and the run
 * continues — a single denied read must not cost the whole backup.
 */
export async function runBrowserBackup(
  onProgress?: (p: BackupProgress) => void,
): Promise<{ blob: Blob; result: BackupResult }> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const skipped: Record<string, string> = {}
  const parentIds: Record<string, string[]> = {}

  const subNames = Object.values(SUBCOLLECTIONS_BY_PARENT).flat()
  const total = COLLECTIONS.length + subNames.length
  let done = 0

  for (const name of COLLECTIONS) {
    onProgress?.({ current: name, done, total })
    try {
      const snap = await getDocs(collection(db, name))
      const docs = snap.docs.map(d => ({ __id: d.id, __path: d.ref.path, ...(serialize(d.data()) as object) }))
      data[name] = docs
      counts[name] = docs.length
      if (SUBCOLLECTIONS_BY_PARENT[name]) parentIds[name] = snap.docs.map(d => d.id)
    } catch (err) {
      skipped[name] = (err as { code?: string })?.code || String(err)
      data[name] = []
      counts[name] = 0
    }
    done++
  }

  for (const [parent, subs] of Object.entries(SUBCOLLECTIONS_BY_PARENT)) {
    for (const sub of subs) {
      onProgress?.({ current: `${parent}/${sub}`, done, total })
      const docs: unknown[] = []
      let denied = 0
      for (const id of parentIds[parent] ?? []) {
        try {
          const snap = await getDocs(collection(db, `${parent}/${id}/${sub}`))
          for (const d of snap.docs) {
            docs.push({ __id: d.id, __path: d.ref.path, ...(serialize(d.data()) as object) })
          }
        } catch {
          denied++
        }
      }
      data[sub] = docs
      counts[sub] = docs.length
      if (denied) skipped[sub] = `denied on ${denied} parent(s)`
      done++
    }
  }

  const totalDocuments = Object.values(counts).reduce((a, b) => a + b, 0)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `galaxy-crm-backup-${stamp}.json`

  const payload = {
    _manifest: {
      takenAt: new Date().toISOString(),
      projectId: 'galaxy-crm-7d4dc',
      source: 'in-browser backup',
      totalDocuments,
      collections: counts,
      skipped,
      note: 'Read-only export. Topz Cab is a separate Firebase project and is NOT included.',
    },
    ...data,
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  return { blob, result: { fileName, totalDocuments, collections: counts, skipped } }
}

/** Hands the finished blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
