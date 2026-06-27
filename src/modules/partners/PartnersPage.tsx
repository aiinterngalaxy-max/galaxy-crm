import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Building2, Phone, MapPin, TrendingUp,
  Users, BarChart3, Star, Trash2,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatCard } from '../../components/ui/Card'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, onSnapshot, addDoc, serverTimestamp, orderBy, query, deleteDocument, limit } from '../../lib/firebase'
import { formatCurrency, formatCurrencyShort, canAccess } from '../../lib/utils'
import type { Partner, PartnerType, Lead } from '../../types'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Textarea } from '../../components/ui/Textarea'

const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  architect: 'Architect',
  interior_designer: 'Interior Designer',
  builder: 'Builder',
  consultant: 'Consultant',
  other: 'Other',
}

const PARTNER_TYPE_COLORS: Record<PartnerType, { color: string; bg: string }> = {
  architect:         { color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  interior_designer: { color: 'text-violet-400', bg: 'bg-violet-900/30' },
  builder:           { color: 'text-orange-400', bg: 'bg-orange-900/30' },
  consultant:        { color: 'text-cyan-400',   bg: 'bg-cyan-900/30' },
  other:             { color: 'text-gray-400',   bg: 'bg-gray-800' },
}

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  firmName: z.string().optional(),
  type: z.enum(['architect', 'interior_designer', 'builder', 'consultant', 'other']),
  phone: z.string().min(10, 'Valid phone required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  whatsapp: z.string().optional(),
  city: z.string().optional(),
  gstNo: z.string().min(15, 'Enter valid 15-digit GST number').max(15, 'GST number must be 15 characters'),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const TYPE_OPTIONS = [
  { value: 'architect', label: 'Architect' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'builder', label: 'Builder' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'other', label: 'Other' },
]

export function PartnersPage() {
  const { role, user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [partners, setPartners] = useState<Partner[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDelete === id) {
      await deleteDocument('partners', id)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'interior_designer' },
  })

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'partners'), orderBy('createdAt', 'desc'), limit(100)),
      snap => setPartners(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Partner))
    )
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'leads'), orderBy('createdAt', 'desc'), limit(100)),
      snap => setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
    )
    return unsub
  }, [])

  const canWrite = role && canAccess(role, 'leads')

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    try {
      await addDoc(collection(db, 'partners'), {
        ...data,
        firmName: data.firmName || null,
        email: data.email || null,
        whatsapp: data.whatsapp || null,
        city: data.city || null,
        gstNo: data.gstNo.toUpperCase(),
        notes: data.notes || null,
        status: 'active',
        totalLeads: 0,
        totalRevenue: 0,
        createdBy: user?.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Partner added!')
      reset()
      setShowForm(false)
    } catch {
      toast.error('Failed to add partner')
    } finally {
      setSaving(false)
    }
  }

  // Compute per-partner lead stats from leads collection
  const getPartnerStats = (partnerId: string) => {
    const partnerLeads = leads.filter(l => l.partnerId === partnerId)
    const won = partnerLeads.filter(l => l.status === 'won').length
    const total = partnerLeads.length
    const revenue = partnerLeads
      .filter(l => l.status === 'won')
      .reduce((sum, l) => sum + (l.estimatedBudget || 0), 0)
    const pipeline = partnerLeads
      .filter(l => !['won', 'lost'].includes(l.status))
      .reduce((sum, l) => sum + (l.estimatedBudget || 0), 0)
    return { total, won, revenue, pipeline }
  }

  const filtered = partners.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.firmName || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q)
    const matchType = !filterType || p.type === filterType
    return matchSearch && matchType
  })

  // Overall stats
  const totalPartners = partners.length
  const activePartners = partners.filter(p => p.status === 'active').length
  const totalB2BLeads = leads.filter(l => l.businessType === 'b2b').length
  const totalB2BWon = leads.filter(l => l.businessType === 'b2b' && l.status === 'won').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">B2B Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">Architects, interior designers & builders who refer projects</p>
        </div>
        {canWrite && (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>Add Partner</Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Partners" value={totalPartners} icon={<Building2 className="w-5 h-5 text-violet-400" />} iconBg="bg-violet-500/20" />
        <StatCard label="Active Partners" value={activePartners} icon={<Star className="w-5 h-5 text-gold-400" />} iconBg="bg-gold-500/20" />
        <StatCard label="B2B Leads" value={totalB2BLeads} icon={<Users className="w-5 h-5 text-blue-400" />} iconBg="bg-blue-500/20" />
        <StatCard label="B2B Converted" value={totalB2BWon} icon={<TrendingUp className="w-5 h-5 text-green-400" />} iconBg="bg-green-500/20"
          subValue={totalB2BLeads > 0 ? `${Math.round((totalB2BWon / totalB2BLeads) * 100)}% conversion` : undefined}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search by name, firm, city…"
            leftIcon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            options={[{ value: '', label: 'All Types' }, ...TYPE_OPTIONS]}
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
          />
        </div>
      </div>

      {/* Partners grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-6 h-6" />}
          title="No partners yet"
          description="Add architects, interior designers, and builders who refer projects to you"
          action={canWrite ? { label: 'Add First Partner', onClick: () => setShowForm(true) } : undefined}

        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(partner => {
            const stats = getPartnerStats(partner.id)
            const typeStyle = PARTNER_TYPE_COLORS[partner.type]

            return (
              <div
                key={partner.id}
                className="glass-card p-5 cursor-pointer hover:border-gold-500/30 transition-all"
                onClick={() => navigate(`/partners/${partner.id}`)}
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-100 truncate">{partner.firmName || partner.name}</p>
                    {partner.firmName && (
                      <p className="text-xs text-gray-500 truncate">{partner.name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={typeStyle.color} bg={typeStyle.bg}>
                      {PARTNER_TYPE_LABELS[partner.type]}
                    </Badge>
                    {isAdmin && (
                      confirmDelete === partner.id ? (
                        <button
                          onClick={e => handleDelete(partner.id, e)}
                          className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                        >
                          Confirm?
                        </button>
                      ) : (
                        <button
                          onClick={e => handleDelete(partner.id, e)}
                          className="p-1 text-gray-700 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Contact */}
                <div className="space-y-1 mb-4">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Phone className="w-3 h-3 shrink-0" />
                    <span>{partner.phone}</span>
                  </div>
                  {partner.city && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span>{partner.city}</span>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-800">
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-100">{stats.total}</p>
                    <p className="text-xs text-gray-500">Leads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-400">{stats.won}</p>
                    <p className="text-xs text-gray-500">Won</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-gold-400">{stats.revenue > 0 ? formatCurrencyShort(stats.revenue) : '—'}</p>
                    <p className="text-xs text-gray-500">Revenue</p>
                  </div>
                </div>

                {stats.pipeline > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-800 flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3 text-gray-500" />
                    <p className="text-xs text-gray-500">{formatCurrencyShort(stats.pipeline)} in pipeline</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add partner modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); reset() }}
        title="Add B2B Partner"
        description="Add an architect, interior designer, or builder who refers projects to you"
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Contact Name *" placeholder="Rajesh Kumar" error={errors.name?.message} {...register('name')} />
            <Input label="Firm / Company Name" placeholder="Rajesh Interiors" {...register('firmName')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Partner Type *" options={TYPE_OPTIONS} error={errors.type?.message} {...register('type')} />
            <Input label="City" placeholder="Mumbai" {...register('city')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Phone *" placeholder="9876543210" error={errors.phone?.message} {...register('phone')} />
            <Input label="WhatsApp" placeholder="9876543210" {...register('whatsapp')} />
          </div>

          <Input label="Email" placeholder="rajesh@example.com" type="email" error={errors.email?.message} {...register('email')} />

          <Input
            label="GST Number *"
            placeholder="22AAAAA0000A1Z5"
            error={errors.gstNo?.message}
            {...register('gstNo', { setValueAs: v => v.toUpperCase() })}
            style={{ textTransform: 'uppercase' }}
          />

          <Textarea label="Notes" placeholder="Any notes about this partner…" rows={2} {...register('notes')} />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); reset() }}>Cancel</Button>
            <Button type="submit" loading={saving}>Add Partner</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
