import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where, deleteDoc } from 'firebase/firestore'

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

async function run() {
  console.log('Deleting all Elysia inventory documents…')
  const snap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'elysia')))
  for (const d of snap.docs) {
    await deleteDoc(d.ref)
  }
  console.log(`Deleted ${snap.size} Elysia inventory documents.`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
