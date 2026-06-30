import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore'

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
const snap = await getDocs(query(collection(db, 'inventory'), where('productLine', '==', 'vitrum')))
console.log('Count:', snap.size)
snap.docs.forEach(d => console.log(d.data().itemCode, '|', d.data().category, '|', d.data().itemName))
process.exit(0)
