import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, addDoc, getDocs, serverTimestamp, generateLeadCode } from '../../lib/firebase'
import { calculateLeadScore } from '../../lib/utils'
import type { User } from '../../types'
import toast from 'react-hot-toast'

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Valid phone required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  source: z.enum(['instagram', 'referral', 'website', 'walk_in', 'cold_call', 'linkedin', 'whatsapp', 'other']),
  projectType: z.string().optional(),
  propertySize: z.string().optional(),
  estimatedBudget: z.coerce.number().optional(),
  assignedTo: z.string().min(1, 'Assign to someone'),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface LeadFormProps {
  onSuccess: () => void
  onCancel: () => void
  defaultValues?: Partial<FormData>
}

const SOURCE_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other' },
]

export function LeadForm({ onSuccess, onCancel, defaultValues }: LeadFormProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [bdUsers, setBdUsers] = useState<User[]>([])

  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      source: 'walk_in',
      assignedTo: user?.id || '',
      ...defaultValues,
    },
  })

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }) as User)
      setBdUsers(users.filter(u => ['bd_exec', 'dept_head', 'management', 'super_admin'].includes(u.role)))
    }).catch(console.error)
  }, [])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      // Get lead count for code generation
      const snap = await getDocs(collection(db, 'leads'))
      const seq = snap.size + 1

      const assignedUser = bdUsers.find(u => u.id === data.assignedTo)
      const aiScore = calculateLeadScore({
        source: data.source,
        estimatedBudget: data.estimatedBudget,
      })

      await addDoc(collection(db, 'leads'), {
        leadCode: generateLeadCode(seq),
        status: 'new',
        source: data.source,
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        whatsapp: data.whatsapp || null,
        address: data.address || null,
        projectType: data.projectType || null,
        propertySize: data.propertySize || null,
        estimatedBudget: data.estimatedBudget || null,
        assignedTo: data.assignedTo,
        assignedToName: assignedUser?.name || null,
        aiScore,
        aiScoreNote: `Auto-scored based on source and budget.`,
        createdBy: user?.id,
        createdAt: serverTimestamp(),
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Full Name *" placeholder="Raj Sharma" error={errors.name?.message} {...register('name')} />
        <Input label="Phone *" placeholder="9876543210" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" placeholder="raj@example.com" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="WhatsApp" placeholder="9876543210" {...register('whatsapp')} />
      </div>

      <Input label="Address / Location" placeholder="3BHK, Andheri West, Mumbai" {...register('address')} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Lead Source *"
          options={SOURCE_OPTIONS}
          error={errors.source?.message}
          {...register('source')}
        />
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

      <Textarea label="Notes" placeholder="Any initial observations…" rows={2} {...register('notes')} />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Create Lead</Button>
      </div>
    </form>
  )
}
