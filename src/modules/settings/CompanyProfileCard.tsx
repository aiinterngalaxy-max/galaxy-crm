import { useState, useEffect } from 'react'
import { Building2, Save } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { db, doc, getDoc, setDoc, serverTimestamp } from '../../lib/firebase'
import toast from 'react-hot-toast'
import type { CompanyProfile } from '../../types'

const PROFILE_REF = () => doc(db, 'settings', 'accountsCompanyProfile')

const EMPTY: CompanyProfile = { name: '', address: '', gstin: '', phone: '', email: '', updatedAt: null as never }

/**
 * Galaxy's own letterhead for Accounts-generated invoices: name, address,
 * GSTIN, contact. Deliberately starts blank and is never pre-filled — this
 * repo's own invoice files have disagreed with each other on the company's
 * GSTIN, so it needs a human to confirm the real one rather than the app
 * guessing between them.
 *
 * Gated to management by the caller, matching firestore.rules' settings/{id}
 * write rule — everyone in Accounts can read this (needed to generate an
 * invoice), only management can change it.
 */
export function CompanyProfileCard() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getDoc(PROFILE_REF()).then(snap => {
      if (snap.exists()) setProfile(snap.data() as CompanyProfile)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const set = (field: keyof CompanyProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile(p => ({ ...p, [field]: e.target.value }))

  const save = async () => {
    if (!profile.name.trim() || !profile.address.trim() || !profile.gstin.trim()) {
      toast.error('Name, address and GSTIN are required — these print on every generated invoice')
      return
    }
    setSaving(true)
    try {
      await setDoc(PROFILE_REF(), { ...profile, updatedAt: serverTimestamp() })
      toast.success('Company profile saved')
    } catch {
      toast.error('Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-3 mb-2">
        <Building2 className="w-5 h-5 text-indigo-400" />
        <h3 className="text-sm font-semibold text-gray-200">Company profile (Accounts invoices)</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Printed as the seller's letterhead on every invoice Accounts generates from Documents Upload.
        Confirm these are correct — an invoice with the wrong GSTIN is a real compliance problem, not a typo to fix later.
      </p>

      {loading ? (
        <p className="text-xs text-gray-600">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Company Name *" value={profile.name} onChange={set('name')} placeholder="Galaxy Home Automation LLP" />
          <Input label="GSTIN *" value={profile.gstin} onChange={set('gstin')} placeholder="27AAAAA0000A1Z5" />
          <div className="sm:col-span-2">
            <Input label="Address *" value={profile.address} onChange={set('address')} placeholder="Full registered address" />
          </div>
          <Input label="Phone" value={profile.phone ?? ''} onChange={set('phone')} placeholder="Optional" />
          <Input label="Email" value={profile.email ?? ''} onChange={set('email')} placeholder="Optional" />
        </div>
      )}

      <Button onClick={save} loading={saving} size="sm" icon={<Save className="w-3.5 h-3.5" />} className="mt-4">
        Save company profile
      </Button>
    </Card>
  )
}
