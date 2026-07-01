// Run: node scripts/seed-general-inventory.js
// Seeds general inventory items (sensors, hubs, cameras, backboxes, etc.)

import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU",
  authDomain: "galaxy-crm-7d4dc.firebaseapp.com",
  projectId: "galaxy-crm-7d4dc",
  storageBucket: "galaxy-crm-7d4dc.firebasestorage.app",
  messagingSenderId: "934034711347",
  appId: "1:934034711347:web:9a43f300fcd86ebab8d446"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const ITEMS = [
  { itemCode: 'MOTION SENSOR',       category: 'Sensor',    itemName: 'MOTION SENSOR',                        location: 'RACK 5', openingStock: 19, importedQty: 0, issuedQty: 0, reorderLevel: 4 },
  { itemCode: 'PRESENCE SENSOR',     category: 'Sensor',    itemName: 'PRESENCE SENSOR',                      location: 'STORE',  openingStock: 84, importedQty: 0, issuedQty: 0, reorderLevel: 17 },
  { itemCode: 'WARDROBE SENSOR',      category: 'Sensor',    itemName: 'WARDROBE SENSOR',                      location: 'STORE',  openingStock: 21, importedQty: 0, issuedQty: 7,  reorderLevel: 4 },
  { itemCode: 'HUB',                  category: 'Hub',       itemName: 'HUB',                                  location: 'RACK 3', openingStock: 44, importedQty: 0, issuedQty: 4,  reorderLevel: 9 },
  { itemCode: 'SMART IR',             category: 'IR',        itemName: 'SMART IR',                             location: 'RACK 3', openingStock: 0,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'IR-RF',                category: 'IR',        itemName: 'IR - RF',                              location: 'RACK 3', openingStock: 7,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'SKT-USB-BLK',         category: 'Socket',    itemName: 'SINGLE SOCKET + USB / BLACK',          location: 'RACK 5', openingStock: 18, importedQty: 0, issuedQty: 0,  reorderLevel: 4 },
  { itemCode: 'SKT-USB-GRY',         category: 'Socket',    itemName: 'SINGLE SOCKET + USB / GREY',           location: 'RACK 5', openingStock: 9,  importedQty: 0, issuedQty: 0,  reorderLevel: 2 },
  { itemCode: 'SKT-WHT',             category: 'Socket',    itemName: 'SINGLE SOCKET / WHITE',                location: 'RACK 5', openingStock: 1,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'SKT-GRY',             category: 'Socket',    itemName: 'SINGLE SOCKET / GREY',                 location: 'RACK 5', openingStock: 13, importedQty: 0, issuedQty: 0,  reorderLevel: 3 },
  { itemCode: '2SKT-USB-BLK',        category: 'Socket',    itemName: 'DOUBLE SOCKET + USB / BLACK',          location: 'RACK 5', openingStock: 4,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: '2SKT-USB-WHT',        category: 'Socket',    itemName: 'DOUBLE SOCKET + USB / WHITE',          location: 'RACK 5', openingStock: 1,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'CYTRUM-TV-SKT',       category: 'Socket',    itemName: 'CYTRUM TV SOCKET',                     location: 'RACK 5', openingStock: 23, importedQty: 0, issuedQty: 0,  reorderLevel: 5 },
  { itemCode: '2SKT-USBC-GRY',       category: 'Socket',    itemName: 'DOUBLE SOCKET USB-C / GREY',           location: 'RACK 5', openingStock: 2,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: '2SKT-USBC-BLK',       category: 'Socket',    itemName: 'DOUBLE SOCKET USB-C / BLACK',          location: 'RACK 5', openingStock: 1,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: '2SKT-USBC-WHT',       category: 'Socket',    itemName: 'DOUBLE SOCKET USB-C / WHITE',          location: 'RACK 5', openingStock: 5,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: '2SKT-USBC-2BTN-WHT',  category: 'Socket',    itemName: 'DOUBLE SOCKET + USB-C + 2 BTN / WHITE',location: 'RACK 5', openingStock: 6,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: '2SKT-USBC-2BTN-BLK',  category: 'Socket',    itemName: 'DOUBLE SOCKET + USB-C + 2 BTN / BLACK',location: 'RACK 5', openingStock: 3,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: '2SKT-USBC-2BTN-GRY',  category: 'Socket',    itemName: 'DOUBLE SOCKET + USB-C + 2 BTN / GREY', location: 'RACK 5', openingStock: 4,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'WIFI-CAM',            category: 'Camera',    itemName: 'WIFI CAMERA',                          location: 'STORE',  openingStock: 18, importedQty: 0, issuedQty: 0,  reorderLevel: 4 },
  { itemCode: 'VDP',                 category: 'VDP',       itemName: 'VIDEO DOOR PHONE',                     location: 'STORE',  openingStock: 7,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'CEILING-FAN-MOTOR',   category: 'Fan Motor', itemName: 'CEILING FAN MOTOR',                    location: 'STORE',  openingStock: 0,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'BACKBOX-PLASTIC',     category: 'Backbox',   itemName: 'PLASTIC BACK BOX',                     location: 'STORE',  openingStock: 200,importedQty: 0, issuedQty: 0,  reorderLevel: 40 },
  { itemCode: 'BACKBOX-METAL-2M',    category: 'Backbox',   itemName: 'METAL BACK BOX 2M',                    location: 'STORE',  openingStock: 27, importedQty: 0, issuedQty: 0,  reorderLevel: 5 },
  { itemCode: 'BACKBOX-METAL-4M',    category: 'Backbox',   itemName: 'METAL BACK BOX 4M',                    location: 'STORE',  openingStock: 1,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'BACKBOX-METAL-6M',    category: 'Backbox',   itemName: 'METAL BACK BOX 6M',                    location: 'STORE',  openingStock: 3,  importedQty: 0, issuedQty: 0,  reorderLevel: 1 },
  { itemCode: 'BACKBOX-METAL-8M',    category: 'Backbox',   itemName: 'METAL BACK BOX 8M',                    location: 'STORE',  openingStock: 0,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'BACKBOX-METAL-10M',   category: 'Backbox',   itemName: 'METAL BACK BOX 10M',                   location: 'STORE',  openingStock: 9,  importedQty: 0, issuedQty: 0,  reorderLevel: 2 },
  { itemCode: 'BACKBOX-METAL-12M',   category: 'Backbox',   itemName: 'METAL BACK BOX 12M',                   location: 'STORE',  openingStock: 0,  importedQty: 0, issuedQty: 0,  reorderLevel: 0 },
  { itemCode: 'SOS-BELL',            category: 'Bell',      itemName: 'SOS BELL',                             location: 'STORE',  openingStock: 40, importedQty: 0, issuedQty: 0,  reorderLevel: 8 },
]

function computeStatus(closing, reorder) {
  if (closing <= 0) return 'out_of_stock'
  if (closing <= reorder) return 'low_stock'
  return 'in_stock'
}

async function seed() {
  console.log(`Seeding ${ITEMS.length} general inventory items...`)
  let added = 0, skipped = 0

  for (const item of ITEMS) {
    // Check for existing item with same code in general line
    const existing = await getDocs(
      query(collection(db, 'inventory'), where('itemCode', '==', item.itemCode), where('productLine', '==', 'general'))
    )
    if (!existing.empty) { console.log(`  SKIP  ${item.itemCode}`); skipped++; continue }

    const closingStock = item.openingStock + item.importedQty - item.issuedQty
    await addDoc(collection(db, 'inventory'), {
      itemCode:     item.itemCode,
      itemName:     item.itemName,
      category:     item.category,
      location:     item.location,
      productLine:  'general',
      openingStock: item.openingStock,
      importedQty:  item.importedQty,
      issuedQty:    item.issuedQty,
      closingStock,
      reorderLevel: item.reorderLevel,
      stockStatus:  computeStatus(closingStock, item.reorderLevel),
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
    })
    console.log(`  ADD   ${item.itemCode} — ${item.itemName} (stock: ${closingStock})`)
    added++
  }

  console.log(`\nDone. Added: ${added}  Skipped: ${skipped}`)
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
