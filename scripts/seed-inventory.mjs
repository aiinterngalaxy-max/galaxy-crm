import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore'

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

function status(closing, reorder) {
  if (closing <= 0)       return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

const items = [
  { itemCode: '1 T GREY',          category: '1T',      itemName: '1 TOUCH GREY',              location: 'Rack 2', openingStock: 0,  importedQty: 10, issuedQty: 0, reorderLevel: 2 },
  { itemCode: '2 T BLACK',         category: '2T',      itemName: '2 T BLACK',                 location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2 T WHITE',         category: '2T',      itemName: '2 T WHITE',                 location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '3 T WHITE',         category: '3T',      itemName: '3 TOUCH WHITE',             location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4 T LCD BLACK',     category: '4T',      itemName: '4 TOUCH LCD BLACK',         location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4 T BLACK',         category: '4T',      itemName: '4 TOUCH BLACK',             location: 'Rack 2', openingStock: 2,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4 T GREY',          category: '4T',      itemName: '4 TOUCH GREY',              location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4 T WHITE',         category: '4T',      itemName: '4 TOUCH WHITE',             location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T KNOB BLK Z',     category: '4T',      itemName: '4 TOUCH + KNOB ZIG BLACK',  location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T KNOB GREY Z',    category: '4T',      itemName: '4 TOUCH + KNOB ZIG GREY',   location: 'Rack 2', openingStock: 2,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T KNOB BLUE Z',    category: '4T',      itemName: '4 TOUCH + KNOB ZIG BLUE',   location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T KNOB RED Z',     category: '4T',      itemName: '4 TOUCH + KNOB ZIG RED',    location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T KNOB WHITE Z',   category: '4T KNOB', itemName: '4 TOUCH KNOB ZIG WHITE',    location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T LCD BLK',        category: '4T KNOB', itemName: '4 TOUCH + LCD BLACK',       location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T LCD WAVE',       category: '4T',      itemName: '4 TOUCH + LCD WAVE',        location: 'Rack 2', openingStock: 0,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6 T GREY',          category: '6T',      itemName: '6 TOUCH GREY',              location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T GREY',           category: '8T',      itemName: '8 TOUCH GREY',              location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T BLUE',           category: '8T',      itemName: '8 TOUCH BLUE',              location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T GOLD',           category: '8T',      itemName: '8 TOUCH GOLD',              location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T RED',            category: '8T',      itemName: '8 TOUCH RED',               location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'MUSIC KNOB',        category: '4T KNOB', itemName: 'MUSIC KNOB BLACK',          location: 'Rack 2', openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T SQ LCD GREY',    category: 'CITRUM',  itemName: '4T SQUARE LCD GREY',        location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T SQ LCD RED',     category: 'CITRUM',  itemName: '4T SQUARE LCD RED',         location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T SQ LCD WHITE',   category: 'CITRUM',  itemName: '4T SQUARE LCD WHITE',       location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T SQ LCD BLACK',   category: 'CITRUM',  itemName: '4T SQUARE LCD BLACK',       location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T RECT LCD GREY',  category: 'CITRUM',  itemName: '4T RECTANGLE LCD GREY',     location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T RECT LCD WHITE', category: 'CITRUM',  itemName: '4T RECTANGLE LCD WHITE',    location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'SINGLE SKT GREY',   category: 'SOCKET',  itemName: 'SINGLE SKT GREY',           location: '',       openingStock: 2,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'SINGLE SKT GOLD',   category: 'SOCKET',  itemName: 'SINGLE SKT GOLD',           location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'SINGLE SKT WHITE',  category: 'SOCKET',  itemName: 'SINGLE SKT WHITE',          location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'SINGLE SKT BLACK',  category: 'SOCKET',  itemName: 'SINGLE SKT BLACK',          location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'DOUBLE SKT GREY',   category: 'SOCKET',  itemName: 'DOUBLE SKT GREY',           location: '',       openingStock: 2,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'DOUBLE SKT WHITE',  category: 'SOCKET',  itemName: 'DOUBLE SKT WHITE',          location: '',       openingStock: 1,  importedQty: 0,  issuedQty: 0, reorderLevel: 0 },
]

async function seed() {
  console.log(`Seeding ${items.length} inventory items…`)
  for (const item of items) {
    const closing = item.openingStock + item.importedQty - item.issuedQty
    await addDoc(collection(db, 'inventory'), {
      ...item,
      closingStock: closing,
      stockStatus:  status(closing, item.reorderLevel),
      createdBy:    'seed',
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
    })
    console.log(`  ✓ ${item.itemCode} — ${item.itemName}`)
  }
  console.log('Done!')
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
