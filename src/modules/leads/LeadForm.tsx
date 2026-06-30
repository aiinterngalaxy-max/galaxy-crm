import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, addDoc, getDocs, serverTimestamp, query, where, limit } from '../../lib/firebase'
import { Timestamp } from 'firebase/firestore'
import { nextLeadCode } from '../../lib/counters'
import { calculateLeadScore } from '../../lib/utils'
import type { User, Partner } from '../../types'
import toast from 'react-hot-toast'

const schema = z.object({
  businessType: z.enum(['b2c', 'b2b']),
  name: z.string().min(2, 'Name required'),
  phone: z.string()
    .transform(v => v.replace(/\D/g, ''))
    .pipe(z.string().length(10, 'Phone must be exactly 10 digits')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  source: z.enum(['referral', 'partner', 'google_ads', 'linkedin', 'meta_ads', 'instagram', 'facebook', 'justdial', 'indiamart', 'cold_call', 'other']),
  partnerId: z.string().optional(),
  projectType: z.string().optional(),
  propertySize: z.string().optional(),
  estimatedBudget: z.coerce.number().optional(),
  assignedTo: z.string().min(1, 'Assign to someone'),
  demoGiven: z.boolean().optional(),
  notes: z.string().optional(),
  dateAdded: z.string().min(1, 'Date is required'),
})

type FormData = z.infer<typeof schema>

interface LeadFormProps {
  onSuccess: () => void
  onCancel: () => void
  defaultValues?: Partial<FormData>
}

const SOURCE_OPTIONS = [
  { value: 'referral',   label: 'Word of Mouth / Referral' },
  { value: 'partner',    label: 'B2B Partner' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'linkedin',   label: 'LinkedIn' },
  { value: 'instagram',  label: 'Instagram' },
  { value: 'facebook',   label: 'Facebook' },
  { value: 'justdial',   label: 'JustDial' },
  { value: 'indiamart',  label: 'IndiaMART' },
  { value: 'cold_call',  label: 'Cold Calls / Msgs' },
  { value: 'other',      label: 'Other' },
]

export function LeadForm({ onSuccess, onCancel, defaultValues }: LeadFormProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [bdUsers, setBdUsers] = useState<User[]>([])
  const [partners, setPartners] = useState<Partner[]>([])

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      businessType: 'b2c',
      source: 'referral',
      assignedTo: user?.id || '',
      ...defaultValues,
    },
  })

  const businessType = watch('businessType')

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }) as User)
      setBdUsers(users.filter(u => ['bd_exec', 'dept_head', 'management', 'super_admin'].includes(u.role)))
    }).catch(console.error)

    getDocs(collection(db, 'partners')).then(snap => {
      setPartners(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Partner))
    }).catch(console.error)
  }, [])

  // Set assignedTo to logged-in user once user is available
  useEffect(() => {
    if (user?.id) setValue('assignedTo', user.id)
  }, [user?.id, setValue])

  // When switching to B2B, auto-set source to 'partner'
  useEffect(() => {
    if (businessType === 'b2b') setValue('source', 'partner')
    else if (businessType === 'b2c') setValue('source', 'referral')
  }, [businessType, setValue])

  const onSubmit = async (data: FormData) => {
    if (data.businessType === 'b2b' && !data.partnerId) {
      toast.error('Please select a B2B partner')
      return
    }
    setLoading(true)
    try {
      // Uniqueness check — exact match on normalized phone (new leads are stored digits-only)
      const normalizedPhone = data.phone.replace(/\D/g, '')
      const dupSnap = await getDocs(query(collection(db, 'leads'), where('phone', '==', normalizedPhone), limit(1)))
      if (!dupSnap.empty) {
        toast.error(`Phone ${normalizedPhone} is already used by lead "${dupSnap.docs[0].data().name}"`)
        setLoading(false)
        return
      }

      const leadCode = await nextLeadCode()

      const assignedUser = bdUsers.find(u => u.id === data.assignedTo)
      const selectedPartner = partners.find(p => p.id === data.partnerId)

      const aiScore = calculateLeadScore({
        source: data.source,
        estimatedBudget: data.estimatedBudget,
      })

      await addDoc(collection(db, 'leads'), {
        leadCode,
        status: 'new',
        businessType: data.businessType,
        source: data.source,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        whatsapp: data.whatsapp || null,
        address: data.address || null,
        projectType: data.projectType || null,
        propertySize: data.propertySize || null,
        estimatedBudget: data.estimatedBudget || null,
        assignedTo: data.assignedTo,
        assignedToName: assignedUser?.name || null,
        partnerId: selectedPartner?.id || null,
        partnerName: selectedPartner ? (selectedPartner.firmName || selectedPartner.name) : null,
        notes: data.notes || null,
        demoGiven: data.demoGiven ?? false,
        aiScore,
        aiScoreNote: `Auto-scored based on source and budget.`,
        createdBy: user?.id,
        createdAt: data.dateAdded
          ? Timestamp.fromDate(new Date(data.dateAdded))
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      toast.success('Lead created!')
      onSuccess()
    } catch (err) {
      toast.error('Failed to create lead')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const userOptions = bdUsers.map(u => ({ value: u.id, label: u.name }))
  const partnerOptions = partners
    .filter(p => p.status === 'active')
    .map(p => ({ value: p.id, label: p.firmName ? `${p.firmName} (${p.name})` : p.name }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Business type toggle */}
      <div>
        <p className="form-label mb-2">Business Type *</p>
        <div className="flex gap-3">
          {(['b2c', 'b2b'] as const).map(type => (
            <label
              key={type}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border cursor-pointer transition-all text-sm font-medium ${
                businessType === type
                  ? 'border-gold-500 bg-gold-500/10 text-gold-400'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <input type="radio" className="sr-only" value={type} {...register('businessType')} />
              {type === 'b2c' ? 'B2C — Direct Client' : 'B2B — Via Partner'}
            </label>
          ))}
        </div>
      </div>

      {/* B2B partner picker */}
      {businessType === 'b2b' && (
        <div className="p-3 rounded-lg border border-gold-500/20 bg-gold-500/5">
          <Select
            label="Partner (Architect / Designer / Builder) *"
            options={partnerOptions}
            placeholder="Select partner"
            {...register('partnerId')}
          />
          {partnerOptions.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">
              No active partners yet. <a href="/partners" className="text-gold-400 underline">Add a partner first.</a>
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label={businessType === 'b2b' ? 'Client Name *' : 'Full Name *'}
          placeholder={businessType === 'b2b' ? 'Mr. Sharma (client name only)' : 'Raj Sharma'}
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Phone *"
          placeholder="9876543210"
          type="tel"
          maxLength={10}
          error={errors.phone?.message}
          {...register('phone')}
          onChange={e => {
            const clean = e.target.value.replace(/\D/g, '').slice(0, 10)
            setValue('phone', clean, { shouldValidate: !!errors.phone })
          }}
        />
        {businessType === 'b2c' && (
          <>
            <Input label="Email" placeholder="raj@example.com" type="email" error={errors.email?.message} {...register('email')} />
            <Input label="WhatsApp" placeholder="9876543210" {...register('whatsapp')} />
          </>
        )}
      </div>

      <Input label="Address / Location" placeholder="3BHK, Andheri West, Mumbai" {...register('address')} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {businessType === 'b2c' && (
          <Select
            label="Lead Source *"
            options={SOURCE_OPTIONS.filter(s => s.value !== 'partner')}
            error={errors.source?.message}
            {...register('source')}
          />
        )}
        <Select
          label="Assign To *"
          options={userOptions}
          placeholder="Select team member"
          error={errors.assignedTo?.message}
          {...register('assignedTo')}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Input label="Project Type" placeholder="Full home automation" {...register('projectType')} />
        <Input label="Property Size" placeholder="3BHK / 2000 sqft" {...register('propertySize')} />
        <Input
          label="Estimated Budget (₹)"
          placeholder="500000"
          type="number"
          error={errors.estimatedBudget?.message}
          {...register('estimatedBudget')}
        />
      </div>

      <Input
        label="Date Added *"
        type="date"
        error={errors.dateAdded?.message}
        {...register('dateAdded')}
      />

      {/* Demo toggle */}
  <div className="flex items-center justify-between p-3 rounded-xl border border-gray-700 bg-gray-800/40">
    <div>
      <p className="text-sm font-medium text-gray-200">Demo Given</p>
      <p className="text-xs text-gray-500">Has the client been shown a product demo?</p>
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" className="sr-only peer" {...register('demoGiven')} />
      <div className="w-10 h-5 rounded-full bg-gray-700 peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
    </label>
  </div>

  <Textarea label="Notes" placeholder="Any initial observations…" rows={2} {...register('notes')} />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Create Lead</Button>
      </div>
    </form>
  )
}
