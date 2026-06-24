import React, { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from '../lib/firebase'
import type { User, UserRole } from '../types'

interface AuthContextValue {
  firebaseUser: FirebaseUser | null
  user: User | null
  role: UserRole | null
  loading: boolean
  isManagement: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  user: null,
  role: null,
  loading: true,
  isManagement: false,
  isAdmin: false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false)
      return
    }

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser)

      if (!fbUser) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        const userDocRef = doc(db, 'users', fbUser.uid)
        const userSnap = await getDoc(userDocRef)

        if (userSnap.exists()) {
          const data = userSnap.data() as Omit<User, 'id'>
          setUser({ id: fbUser.uid, ...data })
          await setDoc(userDocRef, { lastLoginAt: serverTimestamp() }, { merge: true })
        } else {
          // First login — set to pending, admin must approve
          const newUser: Omit<User, 'id'> = {
            name: fbUser.displayName || 'New User',
            email: fbUser.email || '',
            role: 'pending',
            department: 'business_development',
            isActive: false,
            avatarUrl: fbUser.photoURL || undefined,
            createdAt: serverTimestamp() as ReturnType<typeof serverTimestamp> as User['createdAt'],
            lastLoginAt: serverTimestamp() as ReturnType<typeof serverTimestamp> as User['lastLoginAt'],
          }
          await setDoc(userDocRef, newUser)
          setUser({ id: fbUser.uid, ...newUser } as User)

          // Create access request so admin can approve
          await addDoc(collection(db, 'accessRequests'), {
            userId: fbUser.uid,
            userName: fbUser.displayName || 'New User',
            userEmail: fbUser.email || '',
            userAvatar: fbUser.photoURL || '',
            status: 'pending',
            createdAt: serverTimestamp(),
          })
        }
      } catch (err) {
        console.error('Error fetching user profile:', err)
      } finally {
        setLoading(false)
      }
    })

    return unsub
  }, [])

  const role = user?.role ?? null
  const isManagement = role === 'management' || role === 'super_admin'
  const isAdmin = role === 'super_admin'

  return (
    <AuthContext.Provider value={{ firebaseUser, user, role, loading, isManagement, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
