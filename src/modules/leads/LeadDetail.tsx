import { useState, useEffect } from 'react'
import { trashItem } from '../../lib/trash'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MapPin, Edit2, Calendar, FileText,
  CheckCircle2, XCircle, Upload, Plus, Clock, UserCheck, ExternalLink,
  FileText as QuoteIcon, FolderOpen, Trash2, MessageSquare
} from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Input } from '../../components/ui/Input'
import { ActivityLog } from './ActivityLog'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, doc, getDoc, updateDoc, addDoc, collection, getDocs, query, where,
  serverTimestamp, Timestamp, uploadFile, deleteDoc, orderBy
} from '../../lib/firebase'
import {
  LEAD_STATUS_CONFIG, getScoreColor, getScoreBg, formatDate,
  formatCurrency, canManageLeads
} from '../../lib/utils'
import type { Lead, LeadStatus, LeadActivity, ActivityType, CallOutcome, Quotation } from '../../types'
import toast from 'react-hot-toast'

const STATUS_OPTIONS = Object.entries(LEAD_STATUS_CONFIG).map(([v, c]) => ({
  value: v, label: c.label
}))

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'call', label: 'Phone Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'note', label: 'Note' },
  { value: 'follow_up', label: 'Follow-up Scheduled' },
]

const CALL_OUTCOME_OPTIONS = [
  { value: 'answered', label: 'Answered' },
  { value: 'ringing', label: 'Ringing' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'callback_requested', label: 'Callback Requested' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
]

export function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role, isAdmin } = useAuth()
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [converting, setConverting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploadingFloorPlan, setUploadingFloorPlan] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editData, setEditData] = useState<Partial<Lead>>({})
  const [editSaving, setEditSaving] = useState(false)

  // Activity form state
  const [actType, setActType] = useState<ActivityType>('call')
  const [actNote, setActNote] = useState('')
  const [actOutcome, setActOutcome] = useState<CallOutcome | ''>('')
  const [actFollowUp, setActFollowUp] = useState('')
  const [actSubmitting, setActSubmitting] = useState(false)
  const [actPerformedBy, setActPerformedBy] = useState<string>('')
  const [bdUsers, setBdUsers] = useState<{ id: string; name: string }[]>([])

  const canEdit = role ? canManageLeads(role) : false
  const isWon = lead?.status === 'won'
  const isConverted = !!lead?.convertedToCustomerId

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const docSnap = await getDoc(doc(db, 'leads', id!))
        if (docSnap.exists()) {
          setLead({ id: docSnap.id, ...docSnap.data() } as Lead)
        }

        const actSnap = await getDocs(query(
          collection(db, 'leads', id!, 'activities'),
          orderBy('createdAt', 'desc')
        ))
        setActivities(actSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // Load linked quotations
  useEffect(() => {
    if (!id) return
    getDocs(query(collection(db, 'quotations'), where('leadId', '==', id)))
      .then(snap => setQuotations(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Quotation)))
      .catch(console.error)
  }, [id])

  // Load BD team members for "performed by" selector
  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      const users = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; role: string }))
        .filter(u => ['bd_exec', 'dept_head', 'management', 'super_admin'].includes(u.role))
        .map(u => ({ id: u.id, name: u.name }))
      setBdUsers(users)
    }).catch(console.error)
  }, [])

  const updateStatus = async (newStatus: LeadStatus) => {
    if (!lead || !id) return
    setUpdating(true)
    try {
      await updateDoc(doc(db, 'leads', id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      })
      await addDoc(collection(db, 'leads', id, 'activities'), {
        leadId: id,
        type: 'status_change',
        description: `Status changed from ${LEAD_STATUS_CONFIG[lead.status].label} to ${LEAD_STATUS_CONFIG[newStatus].label}`,
        performedBy: user?.id,
        performedByName: user?.name,
        createdAt: serverTimestamp(),
      })
      setLead(prev => prev ? { ...prev, status: newStatus } : null)
      toast.success('Status updated')
    } catch {
      toast.error('Update failed')
    } finally {
      setUpdating(false)
    }
  }

  const convertToCustomer = async () => {
    if (!lead || !id) return
    setConverting(true)
    try {
      // 1. Create customer document from lead data
      const customerRef = await addDoc(collection(db, 'customers'), {
        name: lead.name,
        email: lead.email || '',
        phone: lead.phone,
        address: lead.address || '',
        customerType: 'residential',
        tags: [],
        leadId: id,
        projectIds: [],
        quotationIds: [],
        invoiceIds: [],
        totalRevenue: 0,
        outstandingAmount: 0,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // 2. Update lead with customer reference
      await updateDoc(doc(db, 'leads', id), {
        convertedToCustomerId: customerRef.id,
        status: 'won',
        updatedAt: serverTimestamp(),
      })

      // 3. Log activity
      await addDoc(collection(db, 'leads', id, 'activities'), {
        leadId: id,
        type: 'status_change',
        description: `Lead converted to customer. Customer profile created.`,
        performedBy: user?.id,
        performedByName: user?.name,
        createdAt: serverTimestamp(),
      })

      setLead(prev => prev ? { ...prev, convertedToCustomerId: customerRef.id, status: 'won' } : null)
      toast.success('Lead converted to customer!')
      setShowConvertModal(false)

      // Navigate to customer
      navigate(`/customers/${customerRef.id}`)
    } catch (err) {
      toast.error('Conversion failed')
      console.error(err)
    } finally {
      setConverting(false)
    }
  }

  const submitActivity = async () => {
    if (!actNote.trim() || !id) return
    setActSubmitting(true)
    try {
      const performer = bdUsers.find(u => u.id === actPerformedBy) ?? { id: user?.id ?? '', name: user?.name ?? '' }
      const data: Partial<LeadActivity> = {
        leadId: id,
        type: actType,
        description: actNote,
        performedBy: performer.id,
        performedByName: performer.name,
        createdAt: serverTimestamp() as unknown as Timestamp,
      }
      if (actOutcome) data.outcome = actOutcome as CallOutcome
      if (actFollowUp) data.followUpDate = Timestamp.fromDate(new Date(actFollowUp))

      const ref = await addDoc(collection(db, 'leads', id, 'activities'), data)
      // Use current time for optimistic UI — serverTimestamp() can't be rendered locally
      const optimistic: LeadActivity = { ...data, id: ref.id, createdAt: Timestamp.fromDate(new Date()) } as LeadActivity

      if (actFollowUp) {
        await updateDoc(doc(db, 'leads', id), {
          nextFollowUp: Timestamp.fromDate(new Date(actFollowUp)),
          updatedAt: serverTimestamp(),
        })
        setLead(prev => prev ? { ...prev, nextFollowUp: Timestamp.fromDate(new Date(actFollowUp)) } : null)
      }

      setActivities(prev => [optimistic, ...prev])
      toast.success('Activity logged')
      setShowActivityForm(false)
      setActNote('')
      setActOutcome('')
      setActFollowUp('')
      setActPerformedBy('')
    } catch (err) {
      toast.error('Failed to log activity')
      console.error(err)
    } finally {
      setActSubmitting(false)
    }
  }

  const handleFloorPlanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return

    setUploadingFloorPlan(true)
    try {
      const ext = file.name.split('.').pop() ?? 'file'
      const uploadPromise = uploadFile(`leads/${id}/floor-plan-${Date.now()}.${ext}`, file)
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out after 30s')), 30000)
      )
      const url = await Promise.race([uploadPromise, timeout])
      await updateDoc(doc(db, 'leads', id), { floorPlanUrl: url, updatedAt: serverTimestamp() })
      setLead(prev => prev ? { ...prev, floorPlanUrl: url } : null)
      await addDoc(collection(db, 'leads', id, 'activities'), {
        leadId: id,
        type: 'floor_plan_upload',
        description: `Floor plan uploaded: ${file.name}`,
        performedBy: user?.id,
        performedByName: user?.name,
        createdAt: serverTimestamp(),
      })
      toast.success('Floor plan uploaded!')
    } catch (err: any) {
      console.error('Floor plan upload error:', err)
      toast.error(err?.message ?? 'Upload failed — check Storage rules or CORS config')
    } finally {
      setUploadingFloorPlan(false)
      e.target.value = ''
    }
  }

  const openEditModal = () => {
    setEditData({
      name: lead?.name,
      phone: lead?.phone,
      email: lead?.email,
      whatsapp: lead?.whatsapp,
      address: lead?.address,
      source: lead?.source,
      projectType: lead?.projectType,
      propertySize: lead?.propertySize,
      estimatedBudget: lead?.estimatedBudget,
      assignedTo: lead?.assignedTo,
      assignedToName: lead?.assignedToName,
      notes: lead?.notes,
      createdAt: lead?.createdAt,
    })
    setShowEditModal(true)
  }

  const saveEdit = async () => {
    if (!id || !lead) return
    setEditSaving(true)
    try {
      const assignedUser = bdUsers.find(u => u.id === editData.assignedTo)
      // Explicitly pick only the fields we want to update — never spread the whole editData
      const update: Record<string, any> = {
        name:            editData.name ?? lead.name,
        phone:           editData.phone ?? lead.phone,
        email:           editData.email ?? null,
        whatsapp:        editData.whatsapp ?? null,
        address:         editData.address ?? null,
        source:          editData.source ?? lead.source,
        projectType:     editData.projectType ?? null,
        propertySize:    editData.propertySize ?? null,
        estimatedBudget: editData.estimatedBudget ?? null,
        assignedTo:      editData.assignedTo ?? lead.assignedTo,
        assignedToName:  assignedUser?.name ?? lead.assignedToName,
        notes:           editData.notes ?? null,
        createdAt:       editData.createdAt ?? lead.createdAt,
        updatedAt:       serverTimestamp(),
      }
      await updateDoc(doc(db, 'leads', id), update)
      setLead(prev => prev ? { ...prev, ...update, updatedAt: prev.updatedAt } : null)
      toast.success('Lead updated!')
      setShowEditModal(false)
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err))
      console.error(err)
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteLead = async () => {
    if (!id) return
    setDeleting(true)
    try {
      await trashItem('leads', id, user?.id ?? '', user?.name ?? 'Unknown')
      toast.success('Lead deleted')
      navigate('/leads')
    } catch (err) {
      toast.error('Failed to delete lead')
      console.error(err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const deleteActivity = async (activityId: string) => {
    if (!id) return
    try {
      await deleteDoc(doc(db, 'leads', id, 'activities', activityId))
      setActivities(prev => prev.filter(a => a.id !== activityId))
      toast.success('Activity deleted')
    } catch {
      toast.error('Failed to delete activity')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-sm text-gray-600">Loading lead…</div></div>
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500">Lead not found.</p>
        <Button variant="secondary" onClick={() => navigate('/leads')}>Back to Leads</Button>
      </div>
    )
  }

  const statusCfg = LEAD_STATUS_CONFIG[lead.status]

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/leads')} className="text-gray-500 hover:text-gray-300 mt-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{lead.name}</h1>
            <Badge color={statusCfg.color} bg={statusCfg.bg} className="text-sm px-3 py-1">
              {statusCfg.label}
            </Badge>
            <span data-tour="ai-score" className={`text-sm font-bold px-2.5 py-1 rounded-lg ${getScoreBg(lead.aiScore)} ${getScoreColor(lead.aiScore)}`}>
              Score: {lead.aiScore}/100
            </span>
            {isConverted && (
              <Badge color="text-green-400" bg="bg-green-900/30" dot dotColor="bg-green-500">Converted</Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{lead.leadCode}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <Button variant="secondary" size="sm" icon={<Edit2 className="w-3.5 h-3.5" />}
              onClick={openEditModal}>
              Edit
            </Button>
          )}
          {canEdit && (
            <Button data-tour="add-btn" variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowActivityForm(true)}>
              Log Activity
            </Button>
          )}
          {isAdmin && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Delete this lead?</span>
                <Button size="sm" variant="danger" loading={deleting} onClick={handleDeleteLead}>Yes, Delete</Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          )}
          {isWon && !isConverted && canEdit && (
            <Button data-tour="convert-btn" size="sm" variant="success" icon={<UserCheck className="w-3.5 h-3.5" />}
              onClick={() => setShowConvertModal(true)}>
              Convert to Customer
            </Button>
          )}
          {isConverted && (
            <Button size="sm" variant="secondary" icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={() => navigate(`/customers/${lead.convertedToCustomerId}`)}>
              View Customer
            </Button>
          )}
        </div>
      </div>

      {/* Won Banner */}
      {isWon && !isConverted && (
        <div className="bg-green-900/20 border border-green-800/50 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-300">Lead marked as Won!</p>
              <p className="text-xs text-green-700">Convert this lead to a customer to start creating quotations and projects.</p>
            </div>
          </div>
          {canEdit && (
            <Button data-tour="convert-btn" size="sm" variant="success" icon={<UserCheck className="w-3.5 h-3.5" />}
              onClick={() => setShowConvertModal(true)}>
              Convert Now
            </Button>
          )}
        </div>
      )}

      {/* Converted Banner */}
      {isConverted && (
        <div className="bg-indigo-900/20 border border-indigo-800/50 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-indigo-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-indigo-300">Converted to Customer</p>
              <p className="text-xs text-indigo-700">This lead has been converted. Quotations and projects are managed from the customer profile.</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={() => navigate(`/customers/${lead.convertedToCustomerId}`)}>
              Customer Profile
            </Button>
            <Button size="sm" variant="secondary" icon={<QuoteIcon className="w-3.5 h-3.5" />}
              onClick={() => navigate(`/quotations?customerId=${lead.convertedToCustomerId}`)}>
              Quotations
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => navigate(`/quotations/new?customerId=${lead.convertedToCustomerId}&leadId=${id}`)}>
              New Quotation
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Details */}
        <div className="space-y-4">
          {/* Contact Info */}
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contact</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-600" />
                <a href={`tel:${lead.phone}`} className="text-gray-200 hover:text-indigo-400">{lead.phone}</a>
              </div>
              {lead.whatsapp && (
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="w-4 h-4 text-gray-600" />
                  <a href={`https://wa.me/${lead.whatsapp}`} target="_blank" rel="noopener noreferrer" className="text-gray-200 hover:text-green-400">{lead.whatsapp}</a>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-gray-600" />
                  <a href={`mailto:${lead.email}`} className="text-gray-200 hover:text-indigo-400">{lead.email}</a>
                </div>
              )}
              {lead.address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-gray-600 mt-0.5" />
                  <span className="text-gray-400">{lead.address}</span>
                </div>
              )}
              <div className="pt-1 border-t border-gray-800 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Source</span>
                  <span className="capitalize text-gray-300">{lead.source?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="text-gray-300">{lead.businessType === 'b2b' ? 'B2B — Via Partner' : 'B2C — Direct Client'}</span>
                </div>
                {lead.partnerName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Partner</span>
                    <span className="text-gray-300">{lead.partnerName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Added</span>
                  <span className="text-gray-300">{formatDate(lead.createdAt)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Project Info */}
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Project Details</h3>
            <div className="space-y-2 text-sm">
              {lead.projectType && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Project Type</span>
                  <span className="text-gray-200">{lead.projectType}</span>
                </div>
              )}
              {lead.propertySize && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Property Size</span>
                  <span className="text-gray-200">{lead.propertySize}</span>
                </div>
              )}
              {lead.estimatedBudget && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Budget</span>
                  <span className="text-green-400 font-semibold">{formatCurrency(lead.estimatedBudget)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Assigned To</span>
                <span className="text-gray-200">{lead.assignedToName || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Demo Given</span>
                <span className={lead.demoGiven ? 'text-green-400' : 'text-gray-500'}>{lead.demoGiven ? 'Yes ✓' : 'No'}</span>
              </div>
              {lead.nextFollowUp && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Follow-up</span>
                  <span className="text-yellow-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(lead.nextFollowUp, 'dd MMM, hh:mm a')}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-gray-800">
                <p className="text-gray-500 text-xs mb-1">Notes</p>
                {lead.notes
                  ? <p className="text-gray-300 text-xs leading-relaxed">{lead.notes}</p>
                  : <p className="text-gray-600 text-xs italic">No notes — add via Edit</p>
                }
              </div>
            </div>
          </Card>

          {/* Linked Quotations */}
          {quotations.length > 0 && (
            <Card>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quotations</h3>
              <div className="space-y-2">
                {quotations.map(q => (
                  <button
                    key={q.id}
                    onClick={() => navigate('/quotations')}
                    className="w-full text-left flex items-center justify-between p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
                  >
                    <div>
                      <p className="text-xs font-mono text-indigo-400">{q.quotationCode}</p>
                      <p className="text-xs text-gray-500">{formatCurrency(q.total)}</p>
                    </div>
                    <Badge
                      color={q.status === 'approved' ? 'text-green-400' : q.status === 'pending_approval' ? 'text-yellow-400' : 'text-gray-400'}
                      bg="bg-gray-800"
                    >
                      {q.status}
                    </Badge>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Status Change */}
          {canEdit && (
            <Card>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Update Status</h3>
              <div data-tour="status-buttons" className="grid grid-cols-1 gap-1.5">
                {Object.entries(LEAD_STATUS_CONFIG).map(([s, cfg]) => (
                  <button
                    key={s}
                    disabled={updating || lead.status === s}
                    onClick={() => updateStatus(s as LeadStatus)}
                    className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 ${
                      lead.status === s
                        ? `${cfg.bg} ${cfg.color} border-current`
                        : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    {lead.status === s && '→ '}{cfg.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Floor Plan */}
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Documents</h3>
            {lead.floorPlanUrl ? (
              <div className="flex items-center justify-between gap-2">
                <a href={lead.floorPlanUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                  <FileText className="w-4 h-4" />Floor Plan ↗
                </a>
                {canEdit && (
                  <label className="cursor-pointer text-xs text-gray-500 hover:text-gray-300 transition-colors">
                    <Upload className="w-3.5 h-3.5 inline mr-1" />Replace
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                      onChange={handleFloorPlanUpload} disabled={uploadingFloorPlan} />
                  </label>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <Upload className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-600">No floor plan uploaded</p>
                {canEdit && (
                  <label className={`mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 cursor-pointer transition-colors ${uploadingFloorPlan ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingFloorPlan ? 'Uploading…' : 'Upload Floor Plan'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                      onChange={handleFloorPlanUpload} disabled={uploadingFloorPlan} />
                  </label>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Activity Timeline */}
        <div data-tour="activity-timeline" className="lg:col-span-2">
          <Card padding="none">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <h3 className="section-header">Activity Timeline</h3>
            </div>
            <ActivityLog activities={activities} onDelete={canEdit ? deleteActivity : undefined} />
          </Card>
        </div>
      </div>

      {/* Convert to Customer Modal */}
      <Modal
        open={showConvertModal}
        onClose={() => setShowConvertModal(false)}
        title="Convert Lead to Customer"
        description="This will create a customer profile from this lead's data. You can then create quotations and projects for them."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConvertModal(false)}>Cancel</Button>
            <Button variant="success" onClick={convertToCustomer} loading={converting}
              icon={<UserCheck className="w-4 h-4" />}>
              Convert to Customer
            </Button>
          </>
        }
      >
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-2 text-sm">
          <p className="text-gray-400">A customer profile will be created with:</p>
          <div className="space-y-1 mt-2">
            <p className="text-gray-200 font-medium">{lead.name}</p>
            <p className="text-gray-500">{lead.phone}</p>
            {lead.email && <p className="text-gray-500">{lead.email}</p>}
            {lead.address && <p className="text-gray-500">{lead.address}</p>}
          </div>
        </div>
      </Modal>

      {/* Log Activity Modal */}
      <Modal
        open={showActivityForm}
        onClose={() => setShowActivityForm(false)}
        title="Log Activity"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowActivityForm(false)}>Cancel</Button>
            <Button onClick={submitActivity} loading={actSubmitting}>Save Activity</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Activity Type" options={ACTIVITY_TYPE_OPTIONS} value={actType}
            onChange={e => setActType(e.target.value as ActivityType)} />
          {actType === 'call' && (
            <Select label="Call Outcome" options={CALL_OUTCOME_OPTIONS} placeholder="Select outcome"
              value={actOutcome} onChange={e => setActOutcome(e.target.value as CallOutcome)} />
          )}
          <Textarea label="Notes *" placeholder="What happened? Key points discussed…"
            value={actNote} onChange={e => setActNote(e.target.value)} rows={3} />
          <Select
            label="Performed by"
            value={actPerformedBy || user?.id || ''}
            onChange={e => setActPerformedBy(e.target.value)}
            options={bdUsers.map(u => ({ value: u.id, label: u.name }))}
            placeholder={user?.name ?? 'Select team member'}
          />
          <Input label="Schedule Follow-up" type="datetime-local"
            value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} />
        </div>
      </Modal>

      {/* Edit Lead Modal */}
      <Modal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Lead"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={saveEdit} loading={editSaving}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Full Name *" value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
            <Input label="Phone" value={editData.phone ?? ''} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Email" type="email" value={editData.email ?? ''} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} />
            <Input label="WhatsApp" value={editData.whatsapp ?? ''} onChange={e => setEditData(d => ({ ...d, whatsapp: e.target.value }))} />
          </div>
          <Input label="Address / Location" value={editData.address ?? ''} onChange={e => setEditData(d => ({ ...d, address: e.target.value }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Lead Source"
              value={editData.source ?? ''}
              onChange={e => setEditData(d => ({ ...d, source: e.target.value as Lead['source'] }))}
              options={[
                { value: 'referral', label: 'Word of Mouth / Referral' },
                { value: 'partner', label: 'B2B Partner' },
                { value: 'google_ads', label: 'Google Ads' },
                { value: 'linkedin', label: 'LinkedIn' },
                { value: 'instagram', label: 'Instagram' },
                { value: 'facebook', label: 'Facebook' },
                { value: 'justdial', label: 'JustDial' },
                { value: 'indiamart', label: 'IndiaMART' },
                { value: 'cold_call', label: 'Cold Call' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <Select
              label="Assign To"
              value={editData.assignedTo ?? ''}
              onChange={e => setEditData(d => ({ ...d, assignedTo: e.target.value }))}
              options={bdUsers.map(u => ({ value: u.id, label: u.name }))}
              placeholder="Select team member"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input label="Project Type" value={editData.projectType ?? ''} onChange={e => setEditData(d => ({ ...d, projectType: e.target.value }))} />
            <Input label="Property Size" value={editData.propertySize ?? ''} onChange={e => setEditData(d => ({ ...d, propertySize: e.target.value }))} />
            <Input label="Estimated Budget (₹)" type="number" value={editData.estimatedBudget ?? ''} onChange={e => setEditData(d => ({ ...d, estimatedBudget: Number(e.target.value) || undefined }))} />
          </div>
          <Input
            label="Date Added"
            type="date"
            value={editData.createdAt ? (() => { const d = (editData.createdAt as any)?.toDate?.() ?? new Date(editData.createdAt as any); return d.toISOString().split('T')[0] })() : ''}
            onChange={e => setEditData(d => ({ ...d, createdAt: e.target.value ? Timestamp.fromDate(new Date(e.target.value)) : d.createdAt }))}
          />
          <Textarea label="Notes" placeholder="Key observations, requirements, anything important…" rows={3}
            value={editData.notes ?? ''} onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))} />
        </div>
      </Modal>
    </div>
  )
}
