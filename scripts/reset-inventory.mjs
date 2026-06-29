import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore'

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

const n = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? 0 : Number(v)

// ─── Elysia ────────────────────────────────────────────────────────────────────

const ELYSIA = [
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

// ─── Vitrum ────────────────────────────────────────────────────────────────────

const VITRUM = [
  { itemCode: '10T + SKT B/G',                   category: '10M', itemName: '10 TOUCH + SOCKET B/G',                         location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '10T + SKT ZIG W/G',               category: '10M', itemName: '10 TOUCH + SOCKET W/G',                         location: 'RACK 4', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + FD ZIG B/B',                 category: '1M',  itemName: '1 TOUCH + FAN DIMMER B/B',                      location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 4, reorderLevel: 0 },
  { itemCode: '1T + LD WI B/B',                  category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER B/B',                    location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + LD WI B/G',                  category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER B/G',                    location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + LD + SKT + USB-C WI',        category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER + SOCKET + USB C',       location: 'RACK 4', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + LD WI W/S',                  category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER',                        location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '1T + LD ZIG B/W',                 category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER',                        location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + LD ZIG W/G',                 category: '1M',  itemName: '1 TOUCH + LIGHT DIMMER W/G',                    location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + FD WI B/G',                  category: '1M',  itemName: '1 TOUCH + FAN DIMMER B/G',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '1T + FD WI B/B',                  category: '1M',  itemName: '1 TOUCH + FAN DIMMER B/B',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2 FD W/S',                        category: '2M',  itemName: '2 FAN DIMMER',                                   location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + CURTAIN WI B/B',             category: '2M',  itemName: '2 TOUCH + CURTAIN B/B',                         location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + CURTAIN WI W/G',             category: '2M',  itemName: '2 TOUCH + CURTAIN W/G',                         location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + CURTAIN WI W/S',             category: '2M',  itemName: '2 TOUCH + CURTAIN',                              location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD WI W/S',                  category: '2M',  itemName: '2 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD WI B/B',                  category: '2M',  itemName: '2 TOUCH + FAN DIMMER B/B',                      location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD WI B/G',                  category: '2M',  itemName: '2 TOUCH + FAN DIMMER B/G',                      location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD WI B/S',                  category: '2M',  itemName: '2 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD ZIG B/B',                 category: '2M',  itemName: '2 TOUCH + FAN DIMMER B/B',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD ZIG B/G',                 category: '2M',  itemName: '2 TOUCH + FAN DIMMER B/G',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD ZIG W/G',                 category: '2M',  itemName: '2 TOUCH + FAN DIMMER W/G',                      location: 'RACK 3', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD + SKT WI',                category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET',                 location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD + SKT WI B/B',            category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET B/B',             location: 'RACK 3', openingStock: 5, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + SKT WI B/G',            category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET B/G',             location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + SKT WI W/S',            category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET',                 location: 'RACK 3', openingStock: 7, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + SKT ZIG B/B',           category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET B/B',             location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD + SKT ZIG W/G',           category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET W/G',             location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + USB/C + SKT WI B/B',    category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C B/B',     location: 'RACK 3', openingStock: 4, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + USB/C + SKT WI B/G',    category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C B/G',     location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD + USB/C + SKT WI W/G',    category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C W/G',     location: 'RACK 3', openingStock: 5, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + USB/C + SKT WI W/S',    category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C',         location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '2T + FD + USB/C + SKT ZIG B/B',   category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C B/B',     location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + FD + USB/C + SKT ZIG W/S',   category: '2M',  itemName: '2 TOUCH + FAN DIMMER + SOCKET + USB C',         location: 'RACK 3', openingStock: 8, importedQty: 0, issuedQty: 0, reorderLevel: 2 },
  { itemCode: '2T + LD WI B/B',                  category: '2M',  itemName: '2 TOUCH + LIGHT DIMMER B/B',                    location: 'RACK 3', openingStock: 3, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '2T + LD ZIG W/G',                 category: '2M',  itemName: '2 TOUCH + LIGHT DIMMER W/G',                    location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '3 TOUCH ZIG B/B',                 category: '3M',  itemName: '3 TOUCH B/B',                                   location: 'RACK 3', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + LD ZIG B/B',                 category: '4M',  itemName: '4 TOUCH + LIGHT DIMMER B/B',                    location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2 SKT ZIG B/G',              category: '4M',  itemName: '4 TOUCH + 2 SOCKET B/G',                        location: 'RACK 3', openingStock: 4, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '4T + 2FD WI B/B',                 category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER B/B',                    location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD WI B/G',                 category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER B/G',                    location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD WI W/S',                 category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER',                        location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD ZIG B/B',                category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER B/B',                    location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD ZIG B/G',                category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER B/G',                    location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD ZIG W/G',                category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER W/G',                    location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + 2FD ZIG W/S',                category: '4M',  itemName: '4 TOUCH + 2 FAN DIMMER',                        location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT + USB-C WI',             category: '4M',  itemName: '4 TOUCH + SOCKET + USB C',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT + USB-C ZIG B/S',        category: '4M',  itemName: '4 TOUCH + SOCKET + USB C B/S',                  location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT + USB-C ZIG W/G',        category: '4M',  itemName: '4 TOUCH + SOCKET + USB C W/G',                  location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT + USB-C ZIG W/S',        category: '4M',  itemName: '4 TOUCH + SOCKET + USB C',                      location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT WI B/G',                 category: '4M',  itemName: '4 TOUCH + SOCKET B/G',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT WI B/S',                 category: '4M',  itemName: '4 TOUCH + SOCKET B/S',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT ZIG B/G',                category: '4M',  itemName: '4 TOUCH + SOCKET B/G',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + SKT ZIG W/S',                category: '4M',  itemName: '4 TOUCH + SOCKET W/S',                          location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T + TEL ZIG B/S',                category: '4M',  itemName: '4 TOUCH + SOCKET B/S',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T WI B/B',                       category: '4M',  itemName: '4 TOUCH',                                        location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '4T ZIG S/W',                      category: '4M',  itemName: '4 TOUCH',                                        location: 'RACK 3', openingStock: 4, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '5T + LD WI',                      category: '4M',  itemName: '5 TOUCH + LIGHT DIMMER',                        location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD W/S',                     category: '6M',  itemName: '6 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD WI B/G',                  category: '6M',  itemName: '6 TOUCH + FAN DIMMER B/G',                      location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD WI W/S',                  category: '6M',  itemName: '6 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD WI B/B',                  category: '6M',  itemName: '6 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD WI B/S (4)',               category: '6M',  itemName: '6 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 4, importedQty: 0, issuedQty: 0, reorderLevel: 1 },
  { itemCode: '6T + FD WI B/S (0)',               category: '6M',  itemName: '6 TOUCH + FAN DIMMER',                          location: 'RACK 3', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD ZIG B/G',                 category: '6M',  itemName: '6 TOUCH + FAN DIMMER B/G',                      location: 'RACK 3', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '6T + FD ZIG W/G',                 category: '6M',  itemName: '6 TOUCH + FAN DIMMER W/G',                      location: 'RACK 3', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '7T + FD + SKT ZIG B/G',           category: '7M',  itemName: '7 TOUCH + FAN DIMMER + SOCKET B/G',             location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T ZIG W/G (1)',                   category: '8M',  itemName: '8 TOUCH W/G',                                   location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T + SKT ZIG W/G',                category: '8M',  itemName: '8 TOUCH + SOCKET',                              location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '8T ZIG W/G (2)',                   category: '8M',  itemName: '8 TOUCH W/G',                                   location: 'RACK 3', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'BACK PANEL',                      category: 'OTHER', itemName: 'BACK PANEL',                                   location: 'RACK 1', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'FD + SKT + USB-C B/B',            category: '4M',  itemName: 'FAN DIMMER + SOCKET + USB C',                   location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'FD + SKT + USB-C B/G',            category: '4M',  itemName: 'FAN DIMMER + SOCKET + USB C B/G',               location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'FD + SKT + USB-C W/S',            category: '4M',  itemName: 'FAN DIMMER + SOCKET + USB C',                   location: 'RACK 4', openingStock: 2, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'LD + FD WI W/G',                  category: '4M',  itemName: 'LIGHT DIMMER + FAN DIMMER',                     location: 'RACK 4', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: 'PANEL',                           category: 'OTHER', itemName: 'PANEL',                                        location: 'RACK 1', openingStock: 0, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '10T + SKT B/G ZIG',               category: '10M', itemName: '10 TOUCH + SOCKET BLACK/GOLD',                  location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
  { itemCode: '10T + SKT ZIG W/G (2)',            category: '10M', itemName: '10 TOUCH + SOCKET ZIGBEE',                      location: 'RACK 4', openingStock: 1, importedQty: 0, issuedQty: 0, reorderLevel: 0 },
]

async function reset() {
  // Delete all existing inventory
  console.log('Deleting existing inventory…')
  const snap = await getDocs(collection(db, 'inventory'))
  for (const d of snap.docs) {
    await deleteDoc(d.ref)
  }
  console.log(`  Deleted ${snap.size} documents`)

  // Seed Elysia
  console.log(`\nSeeding ${ELYSIA.length} Elysia items…`)
  for (const item of ELYSIA) {
    const closing = n(item.openingStock) + n(item.importedQty) - n(item.issuedQty)
    await addDoc(collection(db, 'inventory'), {
      ...item,
      productLine: 'elysia',
      closingStock: closing,
      stockStatus: status(closing, n(item.reorderLevel)),
      createdBy: 'seed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    process.stdout.write('.')
  }

  // Seed Vitrum
  console.log(`\n\nSeeding ${VITRUM.length} Vitrum items…`)
  for (const item of VITRUM) {
    const closing = n(item.openingStock) + n(item.importedQty) - n(item.issuedQty)
    await addDoc(collection(db, 'inventory'), {
      ...item,
      productLine: 'vitrum',
      closingStock: closing,
      stockStatus: status(closing, n(item.reorderLevel)),
      createdBy: 'seed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    process.stdout.write('.')
  }

  console.log('\n\nDone! Elysia: ' + ELYSIA.length + ', Vitrum: ' + VITRUM.length)
  process.exit(0)
}

reset().catch(err => { console.error(err); process.exit(1) })
