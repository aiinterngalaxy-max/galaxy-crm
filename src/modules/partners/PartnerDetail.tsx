import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MapPin, MessageCircle, Building2,
  TrendingUp, Users, CheckCircle2, XCircle, Clock, Edit2, Save, X, CalendarClock,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Badge } from '../../components/ui/Badge'
import { StatCard } from '../../components/ui/Card'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { EmptyState } from '../../components/ui/EmptyState'
import { QuoteDocuments } from '../../components/QuoteDocuments'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, doc, onSnapshot, updateDoc, serverTimestamp, query, where, Timestamp } from '../../lib/firebase'
import { formatCurrency, formatCurrencyShort, formatDate, toDate, canManageLeads, LEAD_STATUS_CONFIG } from '../../lib/utils'
import type { Partner, Lead, PartnerType } from '../../types'
import toast from 'react-hot-toast'

const PARTNER_TYPE_OPTIONS = [
  { value: 'architect', label: 'Architect' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'builder', label: 'Builder' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'other', label: 'Other' },
]

const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  architect: 'Architect',
  interior_designer: 'Interior Designer',
  builder: 'Builder',
  consultant: 'Consultant',
  dealer: 'Dealer',
  other: 'Other',
}

export function PartnerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const canEdit = role ? canManageLeads(role) : false
  const [partner, setPartner] = useState<Partner | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editData, setEditData] = useState<Partial<Partner>>({})
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const [savingFollowUp, setSavingFollowUp] = useState(false)

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(doc(db, 'partners', id), snap => {
      if (snap.exists()) {
        const p = { id: snap.id, ...snap.data() } as Partner
        setPartner(p)
        setEditData(p)
      }
      setLoading(false)
    })
    return unsub
  }, [id])

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(
      query(collection(db, 'leads'), where('partnerId', '==', id)),
      snap => setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
    )
    return unsub
  }, [id])

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'partners', id), {
        ...editData,
        updatedAt: serverTimestamp(),
      })
      toast.success('Partner updated')
      setEditing(false)
    } catch {
      toast.error('Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const saveFollowUp = async () => {
    if (!id || !followUpDate) return
    setSavingFollowUp(true)
    try {
      await updateDoc(doc(db, 'partners', id), {
        nextFollowUp: Timestamp.fromDate(new Date(followUpDate)),
        followUpNote: followUpNote.trim(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Follow-up scheduled')
      setFollowUpDate('')
      setFollowUpNote('')
    } catch {
      toast.error('Failed to schedule follow-up')
    } finally {
      setSavingFollowUp(false)
    }
  }

  const clearFollowUp = async () => {
    if (!id) return
    setSavingFollowUp(true)
    try {
      await updateDoc(doc(db, 'partners', id), {
        nextFollowUp: null,
        followUpNote: '',
        updatedAt: serverTimestamp(),
      })
      toast.success('Follow-up cleared')
    } catch {
      toast.error('Failed to clear follow-up')
    } finally {
      setSavingFollowUp(false)
    }
  }

  if (loading) return <PageLoader />
  if (!partner) return (
    <div className="text-center py-20 text-gray-500">
      Partner not found. <button className="text-gold-400 underline" onClick={() => navigate('/partners')}>Go back</button>
    </div>
  )

  // Stats
  const totalLeads = leads.length
  const wonLeads   = leads.filter(l => l.status === 'won')
  const lostLeads  = leads.filter(l => l.status === 'lost')
  const activeLeads = leads.filter(l => !['won', 'lost'].includes(l.status))
  const totalRevenue = wonLeads.reduce((s, l) => s + (l.estimatedBudget || 0), 0)
  const pipelineValue = activeLeads.reduce((s, l) => s + (l.estimatedBudget || 0), 0)
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads.length / totalLeads) * 100) : 0

  // Sort leads: active first, then won, then lost
  const sortedLeads = [...leads].sort((a, b) => {
    const order = { won: 1, lost: 2 }
    const aO = ['won', 'lost'].includes(a.status) ? (order[a.status as keyof typeof order] ?? 0) : 0
    const bO = ['won', 'lost'].includes(b.status) ? (order[b.status as keyof typeof order] ?? 0) : 0
    return aO - bO
  })

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/partners')} className="text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{partner.firmName || partner.name}</h1>
          {partner.firmName && <p className="text-sm text-gray-500">{partner.name}</p>}
        </div>
        <Badge
          color={partner.status === 'active' ? 'text-green-400' : 'text-gray-400'}
          bg={partner.status === 'active' ? 'bg-green-900/30' : 'bg-gray-800'}
        >
          {partner.status === 'active' ? 'Active' : 'Inactive'}
        </Badge>
        {!editing ? (
          <Button data-tour="add-btn" variant="secondary" icon={<Edit2 className="w-4 h-4" />} size="sm" onClick={() => setEditing(true)}>Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<X className="w-4 h-4" />} size="sm" onClick={() => { setEditing(false); setEditData(partner) }}>Cancel</Button>
            <Button icon={<Save className="w-4 h-4" />} size="sm" loading={saving} onClick={handleSave}>Save</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: profile */}
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                style={{ background: '#C9A84020', color: '#C9A840', border: '1px solid #C9A84040' }}>
                {(partner.firmName || partner.name).charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-gray-100">{partner.firmName || partner.name}</p>
                <p className="text-xs text-gray-500">{PARTNER_TYPE_LABELS[partner.type]}</p>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3">
                <Input label="Contact Name" value={editData.name || ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
                <Input label="Firm Name" value={editData.firmName || ''} onChange={e => setEditData(d => ({ ...d, firmName: e.target.value }))} />
                <Select
                  label="Type"
                  options={PARTNER_TYPE_OPTIONS}
                  value={editData.type}
                  onChange={e => setEditData(d => ({ ...d, type: e.target.value as PartnerType }))}
                />
                <Input label="Phone" value={editData.phone || ''} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
                <Input label="WhatsApp" value={editData.whatsapp || ''} onChange={e => setEditData(d => ({ ...d, whatsapp: e.target.value }))} />
                <Input label="Email" type="email" value={editData.email || ''} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} />
                <Input label="City" value={editData.city || ''} onChange={e => setEditData(d => ({ ...d, city: e.target.value }))} />
                <Input label="GST Number" value={editData.gstNo || ''} onChange={e => setEditData(d => ({ ...d, gstNo: e.target.value.toUpperCase() }))} style={{ textTransform: 'uppercase' }} />
                <Select
                  label="Status"
                  options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
                  value={editData.status}
                  onChange={e => setEditData(d => ({ ...d, status: e.target.value as 'active' | 'inactive' }))}
                />
                <Textarea label="Notes" value={editData.notes || ''} onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))} rows={3} />
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5 text-sm text-gray-300">
                  <Phone className="w-4 h-4 text-gray-500 shrink-0" />
                  <span>{partner.phone}</span>
                </div>
                {partner.whatsapp && (
                  <div className="flex items-center gap-2.5 text-sm text-gray-300">
                    <MessageCircle className="w-4 h-4 text-gray-500 shrink-0" />
                    <span>{partner.whatsapp}</span>
                  </div>
                )}
                {partner.email && (
                  <div className="flex items-center gap-2.5 text-sm text-gray-300">
                    <Mail className="w-4 h-4 text-gray-500 shrink-0" />
                    <span>{partner.email}</span>
                  </div>
                )}
                {partner.city && (
                  <div className="flex items-center gap-2.5 text-sm text-gray-300">
                    <MapPin className="w-4 h-4 text-gray-500 shrink-0" />
                    <span>{partner.city}</span>
                  </div>
                )}
                {partner.gstNo && (
                  <div className="flex items-center gap-2.5 text-sm text-gray-300">
                    <Building2 className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="font-mono tracking-wide">{partner.gstNo}</span>
                  </div>
                )}
                {partner.notes && (
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <p className="text-sm text-gray-400">{partner.notes}</p>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className="text-xs text-gray-500">Partner since {formatDate(partner.createdAt)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Follow-up */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-gold-400" />
              <h3 className="text-sm font-semibold text-gray-200">Follow-up</h3>
            </div>

            {partner.nextFollowUp ? (
              <div className="mb-3">
                {(() => {
                  const followMs = toDate(partner.nextFollowUp)?.getTime() ?? 0
                  const overdue = followMs > 0 && followMs < Date.now()
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg ${overdue ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
                      <CalendarClock className="w-3.5 h-3.5" />
                      {formatDate(partner.nextFollowUp, 'dd MMM yyyy, hh:mm a')}{overdue ? ' · Overdue' : ''}
                    </span>
                  )
                })()}
                {partner.followUpNote && <p className="text-sm text-gray-400 mt-2">{partner.followUpNote}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-600 mb-3">No follow-up scheduled.</p>
            )}

            {canEdit && (
              <div className="space-y-2">
                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={e => setFollowUpDate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                />
                <input
                  type="text"
                  value={followUpNote}
                  onChange={e => setFollowUpNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
                <div className="flex gap-2">
                  <Button size="sm" icon={<Save className="w-3.5 h-3.5" />} loading={savingFollowUp} disabled={!followUpDate} onClick={saveFollowUp}>
                    {partner.nextFollowUp ? 'Update' : 'Schedule'}
                  </Button>
                  {partner.nextFollowUp && (
                    <Button size="sm" variant="secondary" disabled={savingFollowUp} onClick={clearFollowUp}>Clear</Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quote PDFs */}
          <QuoteDocuments
            collectionName="partners"
            docId={id!}
            documents={partner.quoteDocuments ?? []}
            canEdit={canEdit}
            uploadedByName={user?.name}
          />
        </div>

        {/* Right: stats + leads */}
        <div className="lg:col-span-2 space-y-5">
          {/* Stats row */}
          <div data-tour="stat-cards" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Leads" value={totalLeads} icon={<Users className="w-5 h-5 text-blue-400" />} iconBg="bg-blue-500/20" />
            <StatCard label="Won" value={wonLeads.length} icon={<CheckCircle2 className="w-5 h-5 text-green-400" />} iconBg="bg-green-500/20"
              subValue={`${conversionRate}% rate`}
            />
            <StatCard label="Revenue" value={totalRevenue > 0 ? formatCurrencyShort(totalRevenue) : '₹0'} icon={<TrendingUp className="w-5 h-5 text-gold-400" />} iconBg="bg-gold-500/20" />
            <StatCard label="Pipeline" value={pipelineValue > 0 ? formatCurrencyShort(pipelineValue) : '₹0'} icon={<Clock className="w-5 h-5 text-violet-400" />} iconBg="bg-violet-500/20" />
          </div>

          {/* Leads table */}
          <div data-tour="partner-leads" className="glass-card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">Leads from this Partner ({totalLeads})</h3>
              <Link
                to={`/leads?partnerId=${partner.id}`}
                className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
              >
                View all
              </Link>
            </div>

            {leads.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="No leads yet"
                  description="When you add a lead from this partner, it will appear here"
                />
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {sortedLeads.map(lead => {
                  const statusCfg = LEAD_STATUS_CONFIG[lead.status]
                  return (
                    <Link
                      key={lead.id}
                      to={`/leads/${lead.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{lead.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {lead.address && (
                            <p className="text-xs text-gray-500 truncate">{lead.address}</p>
                          )}
                          {lead.propertySize && (
                            <span className="text-xs text-gray-600">· {lead.propertySize}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {lead.estimatedBudget && (
                          <p className="text-sm text-gray-300 hidden sm:block">{formatCurrencyShort(lead.estimatedBudget)}</p>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color} ${statusCfg.bg}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary breakdown */}
          {totalLeads > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-4">Performance Breakdown</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-100">{wonLeads.length} Won</p>
                    <p className="text-xs text-gray-500">{formatCurrency(totalRevenue)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-900/30 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-100">{activeLeads.length} Active</p>
                    <p className="text-xs text-gray-500">{formatCurrency(pipelineValue)} pipeline</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-900/30 flex items-center justify-center">
                    <XCircle className="w-4 h-4 text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-100">{lostLeads.length} Lost</p>
                    <p className="text-xs text-gray-500">{conversionRate}% win rate</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
