import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, query, where, orderBy, limit, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'

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

async function unlogLast() {
  // Get all b2b cold_call leads
  const leadsSnap = await getDocs(query(collection(db, 'leads'), where('businessType', '==', 'b2b')))
  const leads = leadsSnap.docs.filter(d => d.data().source === 'cold_call')

  console.log(`Scanning ${leads.length} B2B leads for most recent activity…`)

  let latestActivity = null
  let latestLeadId   = null
  let latestLeadName = null

  for (const lead of leads) {
    const actSnap = await getDocs(
      query(collection(db, 'leads', lead.id, 'activities'), orderBy('createdAt', 'desc'), limit(1))
    )
    if (actSnap.empty) continue
    const act = actSnap.docs[0]
    const actData = act.data()
    const ts = actData.createdAt?.toMillis?.() ?? 0

    if (!latestActivity || ts > latestActivity.ts) {
      latestActivity = { id: act.id, ts, ...actData }
      latestLeadId   = lead.id
      latestLeadName = lead.data().name
    }
  }

  if (!latestActivity) {
    console.log('No activity logs found.')
    process.exit(0)
  }

  const time = new Date(latestActivity.ts).toLocaleString('en-IN')
  console.log(`\nFound latest activity:`)
  console.log(`  Lead   : ${latestLeadName} (${latestLeadId})`)
  console.log(`  Type   : ${latestActivity.type}`)
  console.log(`  Outcome: ${latestActivity.outcome}`)
  console.log(`  Notes  : ${latestActivity.description}`)
  console.log(`  At     : ${time}`)
  console.log(`\nDeleting activity and reverting lead status to 'new'…`)

  await deleteDoc(doc(db, 'leads', latestLeadId, 'activities', latestActivity.id))
  await updateDoc(doc(db, 'leads', latestLeadId), {
    status: 'new',
    updatedAt: serverTimestamp(),
  })

  console.log('Done. Activity deleted and lead reverted to new.')
  process.exit(0)
}

unlogLast().catch(err => { console.error(err); process.exit(1) })
