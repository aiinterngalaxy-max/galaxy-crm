import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU',
  authDomain:        'galaxy-crm-7d4dc.firebaseapp.com',
  projectId:         'galaxy-crm-7d4dc',
  storageBucket:     'galaxy-crm-7d4dc.firebasestorage.app',
  messagingSenderId: '934034711347',
  appId:             '1:934034711347:web:9a43f300fcd86ebab8d446',
}
const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

function computeStatus(closing, reorder) {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

// ─── New-system Vitrum name/code builders (match InventoryPage.tsx) ──────────────
function featureWords(f) {
  const w = []
  if (f.fd > 0) w.push(f.fd === 2 ? '2 FAN DIMMER' : 'FAN DIMMER')
  if (f.ld) w.push('LIGHT DIMMER')
  if (f.skt > 0) w.push(f.skt === 2 ? '2 SOCKET' : 'SOCKET')
  if (f.usbC) w.push('USB C')
  if (f.curtain) w.push('CURTAIN')
  return w
}
function featureAbbrevs(f) {
  const c = []
  if (f.fd > 0) c.push(f.fd === 2 ? '2FD' : 'FD')
  if (f.ld) c.push('LD')
  if (f.skt > 0) c.push(f.skt === 2 ? '2SKT' : 'SKT')
  if (f.usbC) c.push('USB-C')
  if (f.curtain) c.push('CURTAIN')
  return c
}
function buildName(cat, touch, f, conn, color) {
  const touchLabel = touch ? `${touch.replace(/[^0-9]/g, '')} TOUCH` : ''
  const parts = [touchLabel, ...featureWords(f)]
  if (color) parts.push(color)
  if (conn) parts.push(conn.toUpperCase())
  return parts.filter(Boolean).join(' + ')
}
function buildCode(cat, f, conn, color) {
  const finishAbbrev = color ? color.split('/').map(c => c.trim()[0]?.toUpperCase() ?? '').join('/') : ''
  const connAbbrev = conn === 'Zigbee' ? 'ZIG' : conn === 'WiFi' ? 'WI' : ''
  return [cat, ...featureAbbrevs(f), finishAbbrev, connAbbrev].filter(Boolean).join('-')
}

// Each row: cat, touch, fd/ld/skt/usbC/curtain (features), conn, color, rack, opening, imported, issued, reorder
// Highest-value kept for the 4 collision pairs; PANEL / BACK PANEL added as literal OTHER items.
const R = (o) => ({ fd: 0, ld: false, skt: 0, usbC: false, curtain: false, conn: '', color: '', imported: 0, issued: 0, reorder: 0, ...o })

const ROWS = [
  R({ cat: '10M', touch: '10T', skt: 1, color: 'Black / Gold', rack: '4', opening: 1 }),
  R({ cat: '10M', touch: '10T', skt: 1, conn: 'Zigbee', color: 'White / Gold', rack: '4', opening: 2 }),
  R({ cat: '1M', touch: '1T', fd: 1, conn: 'Zigbee', color: 'Black / Black', rack: '4', opening: 1, issued: 4 }),
  R({ cat: '1M', touch: '1T', ld: true, conn: 'WiFi', color: 'Black / Black', rack: '4', opening: 1 }),
  R({ cat: '1M', touch: '1T', ld: true, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '1M', touch: '1T', ld: true, skt: 1, usbC: true, conn: 'WiFi', color: '', rack: '4', opening: 2 }),
  R({ cat: '1M', touch: '1T', ld: true, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '1M', touch: '1T', ld: true, conn: 'Zigbee', color: 'Black / White', rack: '3', opening: 1 }),
  R({ cat: '1M', touch: '1T', ld: true, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 2 }),
  R({ cat: '1M', touch: '1T', fd: 1, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '1M', touch: '1T', fd: 1, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '', fd: 2, color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', curtain: true, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', curtain: true, conn: 'WiFi', color: 'White / Gold', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', curtain: true, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'WiFi', color: 'Black / Silver', rack: '3', opening: 0 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 0 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'WiFi', color: '', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 5, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 7, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 2 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 4, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 2 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'WiFi', color: 'White / Gold', rack: '3', opening: 5, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', fd: 1, skt: 1, usbC: true, conn: 'Zigbee', color: 'White / Silver', rack: '3', opening: 8, reorder: 2 }),
  R({ cat: '2M', touch: '2T', ld: true, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 3, reorder: 1 }),
  R({ cat: '2M', touch: '2T', ld: true, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 2 }),
  R({ cat: '3M', touch: '3T', conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 0 }),
  R({ cat: '4M', touch: '4T', ld: true, conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 2, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 4, reorder: 1 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'Zigbee', color: 'Black / Black', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', fd: 2, conn: 'Zigbee', color: 'White / Silver', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', skt: 1, usbC: true, conn: 'WiFi', color: '', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, usbC: true, conn: 'Zigbee', color: 'Black / Silver', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, usbC: true, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, usbC: true, conn: 'Zigbee', color: 'White / Silver', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', skt: 1, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, conn: 'WiFi', color: 'Black / Silver', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '4T', skt: 1, conn: 'Zigbee', color: 'White / Silver', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', skt: 1, conn: 'Zigbee', color: 'Black / Silver', rack: '3', opening: 1 }), // 4T + TEL -> SOCKET per item name
  R({ cat: '4M', touch: '4T', conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 2 }),
  R({ cat: '4M', touch: '4T', conn: 'Zigbee', color: 'Silver / White', rack: '3', opening: 4, reorder: 1 }),
  R({ cat: '4M', touch: '5T', ld: true, conn: 'WiFi', color: '', rack: '3', opening: 1 }),
  R({ cat: '6M', touch: '6T', fd: 1, color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'WiFi', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'WiFi', color: 'White / Silver', rack: '3', opening: 1 }),
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'WiFi', color: 'Black / Black', rack: '3', opening: 1 }),
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'WiFi', color: 'Black / Silver', rack: '3', opening: 4, reorder: 1 }), // highest of (4,0)
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 2 }),
  R({ cat: '6M', touch: '6T', fd: 1, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 0 }),
  R({ cat: '7M', touch: '7T', fd: 1, skt: 1, conn: 'Zigbee', color: 'Black / Gold', rack: '3', opening: 1 }),
  R({ cat: '8M', touch: '8T', conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 1 }), // highest of (1,1)
  R({ cat: '8M', touch: '8T', skt: 1, conn: 'Zigbee', color: 'White / Gold', rack: '3', opening: 1 }),
  R({ cat: '4M', touch: '', fd: 1, skt: 1, usbC: true, color: 'Black / Black', rack: '4', opening: 1 }),
  R({ cat: '4M', touch: '', fd: 1, skt: 1, usbC: true, color: 'Black / Gold', rack: '4', opening: 1 }),
  R({ cat: '4M', touch: '', fd: 1, skt: 1, usbC: true, color: 'White / Silver', rack: '4', opening: 2 }),
  R({ cat: '4M', touch: '', fd: 1, ld: true, conn: 'WiFi', color: 'White / Gold', rack: '4', opening: 0 }),
]

// Literal accessories — no module/touch/color, kept verbatim.
const LITERALS = [
  { itemCode: 'PANEL', category: 'OTHER', itemName: 'PANEL', rack: '1', opening: 0 },
  { itemCode: 'BACK PANEL', category: 'OTHER', itemName: 'BACK PANEL', rack: '1', opening: 0 },
]

async function run() {
  console.log('Deleting all Vitrum inventory documents…')
  const snap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'vitrum')))
  for (const d of snap.docs) await deleteDoc(d.ref)
  console.log(`  Deleted ${snap.size} Vitrum documents`)

  const items = []
  const seen = new Set()
  for (const r of ROWS) {
    const f = { fd: r.fd, ld: r.ld, skt: r.skt, usbC: r.usbC, curtain: r.curtain }
    const itemCode = buildCode(r.cat, f, r.conn, r.color)
    if (seen.has(itemCode)) { console.warn(`  ! Unexpected duplicate code skipped: ${itemCode}`); continue }
    seen.add(itemCode)
    const closing = r.opening + r.imported - r.issued
    items.push({
      itemCode,
      category: r.cat,
      itemName: buildName(r.cat, r.touch, f, r.conn, r.color),
      location: r.rack ? `Rack ${r.rack}` : '',
      color: r.color || '',
      openingStock: r.opening, importedQty: r.imported, issuedQty: r.issued, reorderLevel: r.reorder,
      closingStock: closing, stockStatus: computeStatus(closing, r.reorder),
    })
  }
  for (const l of LITERALS) {
    items.push({
      itemCode: l.itemCode, category: l.category, itemName: l.itemName,
      location: l.rack ? `Rack ${l.rack}` : '', color: '',
      openingStock: l.opening, importedQty: 0, issuedQty: 0, reorderLevel: 0,
      closingStock: l.opening, stockStatus: computeStatus(l.opening, 0),
    })
  }

  console.log(`\nSeeding ${items.length} Vitrum items…`)
  for (const item of items) {
    await addDoc(collection(db, 'inventory'), {
      ...item, productLine: 'vitrum',
      createdBy: 'reset-script', createdByName: 'Vitrum Reset',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    process.stdout.write('.')
  }
  console.log(`\n\nDone! Vitrum reset to ${items.length} items.`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
