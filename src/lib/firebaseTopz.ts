import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const topzConfig = {
  apiKey:            import.meta.env.VITE_TOPZ_API_KEY,
  authDomain:        import.meta.env.VITE_TOPZ_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_TOPZ_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_TOPZ_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_TOPZ_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_TOPZ_APP_ID,
}

// Use a named app so it doesn't conflict with the Galaxy CRM default app
const topzApp = getApps().find(a => a.name === 'topz') ?? initializeApp(topzConfig, 'topz')

export const dbTopz = getFirestore(topzApp)
