import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            'AIzaSyDkf5CBWbAtISfbo5bWIRJvi9qX88DyogU',
  authDomain:        'galaxy-crm-7d4dc.firebaseapp.com',
  projectId:         'galaxy-crm-7d4dc',
  storageBucket:     'galaxy-crm-7d4dc.firebasestorage.app',
  messagingSenderId: '934034711347',
  appId:             '1:934034711347:web:9a43f300fcd86ebab8d446',
}
const app = initializeApp(firebaseConfig)
const db = getFirestore(app)
const snap = await getDocs(collection(db, 'inventory'))
console.log('Count:', snap.size)
snap.docs.forEach(d => {
  const x = d.data()
  console.log(`${x.productLine ?? 'elysia'} | ${x.itemCode} | ${x.itemName} | closing:${x.closingStock}`)
})
process.exit(0)
