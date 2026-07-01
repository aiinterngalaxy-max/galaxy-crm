import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'

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

const n = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? 0 : Number(v)

function status(closing, reorder) {
  if (closing <= 0)       return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

const CURTAINS = [
  { itemCode: 'MOTOR',               category: 'Motor',        itemName: 'MOTOR',               location: 'STORE', openingStock: 19, importedQty: 0, issuedQty: 20, reorderLevel: 4 },
  { itemCode: 'TABULAR',             category: 'Motor',        itemName: 'TABULAR',             location: 'STORE', openingStock: 25, importedQty: 0, issuedQty: 1,  reorderLevel: 5 },
  { itemCode: '1 CH REMOTE',         category: 'Remote',       itemName: '1 CHANNEL REMOTE',    location: 'STORE', openingStock: 6,  importedQty: 0, issuedQty: 2,  reorderLevel: 1 },
  { itemCode: '2 CH REMOTE',         category: 'Remote',       itemName: '2 CHANNEL REMOTE',    location: 'STORE', openingStock: 21, importedQty: 0, issuedQty: 1,  reorderLevel: 4 },
  { itemCode: 'TAB REMOTE',          category: 'Remote',       itemName: 'TAB REMOTE',          location: 'STORE', openingStock: 17, importedQty: 0, issuedQty: 1,  reorderLevel: 3 },
  { itemCode: 'CARRIERS',            category: 'Carriers',     itemName: 'CARRIERS',            location: 'STORE', openingStock: 27, importedQty: 0, issuedQty: 17, reorderLevel: 5 },
  { itemCode: 'DRIVER PULLEY',       category: 'Drive Pulley', itemName: 'DRIVER PULLEY',       location: 'STORE', openingStock: 3,  importedQty: 0, issuedQty: 2,  reorderLevel: 1 },
  { itemCode: 'BIG KAAN',            category: 'Drive Pulley', itemName: 'TABULAR KAN (BIG)',   location: 'STORE', openingStock: 0,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'SMALL KAAN',          category: 'Drive Pulley', itemName: 'SWING KAN (SMALL)',   location: 'STORE', openingStock: 23, importedQty: 0, issuedQty: 12, reorderLevel: 5 },
  { itemCode: 'TABULAR HOOK [PAIR]', category: 'Hook',         itemName: 'TABULAR HOOK [PAIR]', location: 'STORE', openingStock: 25, importedQty: 0, issuedQty: 0,  reorderLevel: 5 },
  { itemCode: 'TABULAR HOOK SMALL',  category: 'Hook',         itemName: 'TABULAR HOOK SMALL',  location: 'STORE', openingStock: 16, importedQty: 0, issuedQty: 0,  reorderLevel: 3 },
  { itemCode: 'RUNNERS(Pack)',        category: 'Runners',      itemName: 'RUNNERS',             location: 'STORE', openingStock: 1,  importedQty: 0, issuedQty: 465,reorderLevel: 0 },
  { itemCode: 'BELT',                category: 'Roller',       itemName: 'BELT',                location: 'STORE', openingStock: 10, importedQty: 0, issuedQty: 0,  reorderLevel: 2 },
  { itemCode: 'L TRACK',             category: 'Track',        itemName: 'L TRACK',             location: 'STORE', openingStock: 6,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'AM 35',               category: 'AM 35',        itemName: 'AM 35',               location: 'STORE', openingStock: 3,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'CLAMP',               category: 'Clamp',        itemName: 'CLAMP',               location: 'STORE', openingStock: 35, importedQty: 2, issuedQty: 2,  reorderLevel: 7 },
  { itemCode: 'BRACKET',             category: 'Bracket',      itemName: 'BRACKET',             location: 'STORE', openingStock: 0,  importedQty: 0, issuedQty: 78, reorderLevel: 0 },
]

async function seed() {
  // Fetch existing curtain items to avoid duplicates
  const existingSnap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'curtains')))
  const existingCodes = new Set(existingSnap.docs.map(d => d.data().itemCode))

  let created = 0, updated = 0

  for (const item of CURTAINS) {
    const closing = n(item.openingStock) + n(item.importedQty) - n(item.issuedQty)
    const payload = {
      ...item,
      productLine: 'curtains',
      closingStock: closing,
      stockStatus: status(closing, n(item.reorderLevel)),
      updatedAt: serverTimestamp(),
    }

    const existingDoc = existingSnap.docs.find(d => d.data().itemCode === item.itemCode)
    if (existingDoc) {
      await updateDoc(doc(db, 'inventory', existingDoc.id), payload)
      updated++
      process.stdout.write('u')
    } else {
      await addDoc(collection(db, 'inventory'), { ...payload, createdBy: 'seed', createdAt: serverTimestamp() })
      created++
      process.stdout.write('+')
    }
  }

  console.log(`\n\nDone! Created: ${created}, Updated: ${updated}`)
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
