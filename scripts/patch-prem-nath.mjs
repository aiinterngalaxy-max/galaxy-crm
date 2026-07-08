import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore'

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

const snap = await getDocs(query(collection(db, 'leads'), where('phone', '==', '9892112157')))
if (snap.empty) { console.log('Lead not found'); process.exit(1) }

const lead = snap.docs[0]
console.log('Found:', lead.data().name)

await updateDoc(doc(db, 'leads', lead.id), {
  campaignOwnerName:     'Prem Nath',
  campaignOwnerEvidence: "Ar. Prem Nath's studio is known for innovative design. Prem himself was very responsive and professional.",
  campaignOwnerHits:     2,
  campaignSegment:       'interior_design',
})

console.log('Patched! Refresh Call Mode now.')
process.exit(0)
