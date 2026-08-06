/**
 * Local Firestore backup — reads every collection and writes it to JSON on disk.
 *
 * WHY THIS EXISTS
 * Point-in-time recovery is a Blaze-plan feature and this project is on Spark, so
 * a deleted document is gone permanently. There is no undo anywhere in the stack.
 * This script is the undo: run it and you hold a complete, timestamped copy.
 *
 * IT ONLY READS. There is no delete, no write, no update anywhere in this file.
 * Running it a hundred times cannot harm the database.
 *
 * USAGE
 *   set GALAXY_BACKUP_EMAIL=you@example.com
 *   set GALAXY_BACKUP_PASSWORD=yourpassword
 *   node scripts/backup-firestore.mjs
 *
 * Or copy BACKUP.bat.example to BACKUP.bat, fill it in once, and double-click it —
 * or let Task Scheduler double-click it for you every other day.
 *
 * Credentials are read from the environment and never written anywhere. Sign in is
 * required because the security rules deny reads to anonymous callers — which is
 * also why the delete-* scripts in this folder would fail today.
 *
 * MIRRORING (optional)
 * Set GALAXY_BACKUP_MIRROR_1 / _2 / _3 to extra directory paths (e.g. an E: drive
 * folder, or a Google Drive for desktop sync folder) and the finished, already-
 * written backup folder is copied there too — same JSON files, no separate upload
 * logic. Google Drive syncing happens on its own once the file lands in that
 * folder; this script has no network access beyond signing in to Firestore.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, collection, getDocs } from 'firebase/firestore'
import { mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { join, basename } from 'node:path'

const firebaseConfig = {
  apiKey:            'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU',
  authDomain:        'galaxy-crm-7d4dc.firebaseapp.com',
  projectId:         'galaxy-crm-7d4dc',
  storageBucket:     'galaxy-crm-7d4dc.firebasestorage.app',
  messagingSenderId: '934034711347',
  appId:             '1:934034711347:web:9a43f300fcd86ebab8d446',
}

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
 * Subcollections, keyed by the top-level parent they live under. Fetched one
 * parent at a time via a direct path (collection(db, `${parent}/${id}/${sub}`))
 * rather than collectionGroup() — firestore.rules defines these as nested
 * matches scoped to their exact parent path, which Firestore does not extend
 * to a collectionGroup query across every parent. Add here (and to
 * firestore.rules) if a new nested collection appears.
 */
const SUBCOLLECTIONS_BY_PARENT = {
  leads: ['activities', 'documents'],
  quotations: ['lineItems'],
  projects: ['workflow', 'milestones', 'tasks', 'orderItems', 'siteReports', 'issues'],
  invoices: ['payments'],
}

/**
 * Firestore returns Timestamps, GeoPoints and DocumentReferences, none of which
 * survive JSON.stringify intact. Convert them to something readable that still
 * identifies what it was, so a restore can reverse it.
 */
function serialize(value) {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(serialize)

  if (typeof value === 'object') {
    // Timestamp
    if (typeof value.toDate === 'function') {
      return { __type: 'timestamp', iso: value.toDate().toISOString() }
    }
    // GeoPoint
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude }
    }
    // DocumentReference
    if (typeof value.path === 'string' && value.firestore) {
      return { __type: 'reference', path: value.path }
    }
    // Bytes
    if (typeof value.toBase64 === 'function') {
      return { __type: 'bytes', base64: value.toBase64() }
    }
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }

  return value
}

async function dumpCollection(db, name, outDir, manifest) {
  try {
    const snap = await getDocs(collection(db, name))
    const docs = snap.docs.map(d => ({
      __id: d.id,
      __path: d.ref.path,
      ...serialize(d.data()),
    }))
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(docs, null, 2), 'utf8')
    manifest.collections[name] = docs.length
    console.log(`  ${String(docs.length).padStart(6)}  ${name}`)
    return { count: docs.length, ids: docs.map(d => d.__id) }
  } catch (err) {
    // A missing index or a denied read on one collection must not abandon the
    // rest of the backup — record it and carry on.
    const reason = err?.code || err?.message || String(err)
    manifest.skipped[name] = reason
    console.warn(`  SKIPPED  ${name} — ${reason}`)
    return { count: 0, ids: [] }
  }
}

/**
 * Fetches one subcollection across every parent document, one parent at a time,
 * so each read matches firestore.rules' nested-match path exactly. A parent
 * with no such subcollection, or that denies the read, just contributes nothing
 * — the rest of the parents still get backed up.
 */
async function dumpSubcollection(db, parentName, parentIds, subName, outDir, manifest) {
  const docs = []
  let deniedCount = 0
  for (const parentId of parentIds) {
    try {
      const snap = await getDocs(collection(db, `${parentName}/${parentId}/${subName}`))
      for (const d of snap.docs) {
        docs.push({ __id: d.id, __path: d.ref.path, ...serialize(d.data()) })
      }
    } catch (err) {
      deniedCount++
    }
  }
  writeFileSync(join(outDir, `${subName}.json`), JSON.stringify(docs, null, 2), 'utf8')
  manifest.collections[subName] = docs.length
  if (deniedCount) manifest.skipped[subName] = `denied on ${deniedCount}/${parentIds.length} parent(s)`
  console.log(`  ${String(docs.length).padStart(6)}  ${subName}  (subcollection of ${parentName})`)
  return docs.length
}

async function run() {
  const email = process.env.GALAXY_BACKUP_EMAIL
  const password = process.env.GALAXY_BACKUP_PASSWORD

  if (!email || !password) {
    console.error(
      '\nMissing credentials.\n\n' +
        'Set them first:\n' +
        '  set GALAXY_BACKUP_EMAIL=you@example.com\n' +
        '  set GALAXY_BACKUP_PASSWORD=yourpassword\n' +
        '  node scripts/backup-firestore.mjs\n\n' +
        'Or copy scripts/BACKUP.bat.example to scripts/BACKUP.bat, fill it in, and run that.\n' +
        'Use an account with management or super_admin role, or some collections will be skipped.\n',
    )
    process.exit(1)
  }

  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)

  console.log('Signing in…')
  await signInWithEmailAndPassword(getAuth(app), email, password)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), 'backups', stamp)
  mkdirSync(outDir, { recursive: true })

  const manifest = {
    takenAt: new Date().toISOString(),
    projectId: firebaseConfig.projectId,
    takenBy: email,
    collections: {},
    skipped: {},
    note: 'Read-only export. Topz Cab lives in a separate Firebase project and is NOT included.',
  }

  console.log(`\nWriting to backups/${stamp}\n`)
  console.log('  DOCS    COLLECTION')
  console.log('  ----    ----------')

  let total = 0
  const idsByCollection = {}
  for (const name of COLLECTIONS) {
    const { count, ids } = await dumpCollection(db, name, outDir, manifest)
    total += count
    idsByCollection[name] = ids
  }

  for (const [parentName, subNames] of Object.entries(SUBCOLLECTIONS_BY_PARENT)) {
    const parentIds = idsByCollection[parentName] || []
    for (const subName of subNames) {
      total += await dumpSubcollection(db, parentName, parentIds, subName, outDir, manifest)
    }
  }

  manifest.totalDocuments = total
  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const skipped = Object.keys(manifest.skipped).length
  console.log(`\nDone. ${total} documents across ${Object.keys(manifest.collections).length} collections.`)
  if (skipped) console.log(`${skipped} collection(s) skipped — see _manifest.json.`)
  console.log(`Saved to: ${outDir}\n`)

  const mirrors = [
    process.env.GALAXY_BACKUP_MIRROR_1,
    process.env.GALAXY_BACKUP_MIRROR_2,
    process.env.GALAXY_BACKUP_MIRROR_3,
  ].filter(Boolean)

  for (const mirrorRoot of mirrors) {
    try {
      const dest = join(mirrorRoot, basename(outDir))
      cpSync(outDir, dest, { recursive: true })
      console.log(`Mirrored to: ${dest}`)
    } catch (err) {
      console.warn(`Mirror to ${mirrorRoot} failed: ${err?.message || err}`)
    }
  }

  process.exit(0)
}

run().catch(err => {
  console.error('\nBackup failed:', err?.code || err?.message || err)
  if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
    console.error('Check GALAXY_BACKUP_EMAIL and GALAXY_BACKUP_PASSWORD.\n')
  }
  process.exit(1)
})
