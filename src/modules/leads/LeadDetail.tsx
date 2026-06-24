import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MapPin, Edit2, Calendar, FileText,
  CheckCircle2, XCircle, Upload, Plus, Clock
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
  db, doc, getDoc, updateDoc, addDoc, collection,
  serverTimestamp, Timestamp
} from '../../lib/firebase'
import {
  LEAD_STATUS_CONFIG, getScoreColor, getScoreBg, formatDate,
  formatCurrency, canManageLeads
} from '../../lib/utils'
import type { Lead, LeadStatus, LeadActivity, ActivityType, CallOutcome } from '../../types'
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
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'callback_requested', label: 'Callback Requested' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
]

export function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [updating, setUpdating] = useState(false)

  // Activity form state
  const [actType, setActType] = useState<ActivityType>('call')
  const [actNote, setActNote] = useState('')
  const [actOutcome, setActOutcome] = useState<CallOutcome | ''>('')
  const [actFollowUp, setActFollowUp] = useState('')
  const [actSubmitting, setActSubmitting] = useState(false)

  const canEdit = role ? canManageLeads(role) : false

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const docSnap = await getDoc(doc(db, 'leads', id!))
        if (docSnap.exists()) {
          setLead({ id: docSnap.id, ...docSnap.data() } as Lead)
        }

        const actSnap = await import('../../lib/firebase').then(m =>
          m.getDocs(m.query(
            m.collection(db, 'leads', id!, 'activities'),
            m.orderBy('createdAt', 'desc')
          ))
        )
        setActivities(actSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const updateStatus = async (newStatus: LeadStatus) => {
    if (!lead || !id) return
    setUpdating(true)
    try {
      await updateDoc(doc(db, 'leads', id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      })
      // Log activity
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

  const submitActivity = async () => {
    if (!actNote.trim() || !id) return
    setActSubmitting(true)
    try {
      const data: Partial<LeadActivity> = {
        leadId: id,
        type: actType,
        description: actNote,
        performedBy: user?.id,
        performedByName: user?.name,
        createdAt: serverTimestamp() as unknown as Timestamp,
      }
      if (actOutcome) data.outcome = actOutcome as CallOutcome
      if (actFollowUp) data.followUpDate = Timestamp.fromDate(new Date(actFollowUp))

      const ref = await addDoc(collection(db, 'leads', id, 'activities'), data)

      // If follow-up set, update lead's nextFollowUp
      if (actFollowUp) {
        await updateDoc(doc(db, 'leads', id), {
          nextFollowUp: Timestamp.fromDate(new Date(actFollowUp)),
          updatedAt: serverTimestamp(),
        })
        setLead(prev => prev ? { ...prev, nextFollowUp: Timestamp.fromDate(new Date(actFollowUp)) } : null)
      }

      setActivities(prev => [{
        id: ref.id,
        ...data,
      } as LeadActivity, ...prev])

      toast.success('Activity logged')
      setShowActivityForm(false)
      setActNote('')
      setActOutcome('')
      setActFollowUp('')
    } catch (err) {
      toast.error('Failed to log activity')
      console.error(err)
    } finally {
      setActSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-600">Loading lead…</div>
      </div>
    )
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
        <button
          onClick={() => navigate('/leads')}
          className="text-gray-500 hover:text-gray-300 mt-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{lead.name}</h1>
            <Badge color={statusCfg.color} bg={statusCfg.bg} className="text-sm px-3 py-1">
              {statusCfg.label}
            </Badge>
            <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${getScoreBg(lead.aiScore)} ${getScoreColor(lead.aiScore)}`}>
              Score: {lead.aiScore}/100
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{lead.leadCode}</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowActivityForm(true)}
            >
              Log Activity
            </Button>
          </div>
        )}
      </div>

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
              <div className="flex items-center gap-2 text-sm text-gray-500 text-xs">
                Source: <span className="capitalize text-gray-300">{lead.source?.replace('_', ' ')}</span>
              </div>
            </div>
          </Card>

          {/* Project Info */}
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Project Details</h3>
            <div className="space-y-2 text-sm">
              {lead.projectType && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="text-gray-200">{lead.projectType}</span>
                </div>
              )}
              {lead.propertySize && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Size</span>
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
                <span className="text-gray-500">Assigned</span>
                <span className="text-gray-200">{lead.assignedToName || '—'}</span>
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
            </div>
          </Card>

          {/* Status Change */}
          {canEdit && (
            <Card>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Update Status</h3>
              <div className="grid grid-cols-1 gap-1.5">
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
              <a href={lead.floorPlanUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                <FileText className="w-4 h-4" />
                Floor Plan ↗
              </a>
            ) : (
              <div className="text-center py-4">
                <Upload className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-600">No floor plan uploaded</p>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="mt-2">Upload Floor Plan</Button>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Activity Timeline */}
        <div className="lg:col-span-2">
          <Card padding="none">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <h3 className="section-header">Activity Timeline</h3>
              {canEdit && (
                <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setShowActivityForm(true)}>
                  Log
                </Button>
              )}
            </div>
            <ActivityLog activities={activities} />
          </Card>
        </div>
      </div>

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
          <Select
            label="Activity Type"
            options={ACTIVITY_TYPE_OPTIONS}
            value={actType}
            onChange={e => setActType(e.target.value as ActivityType)}
          />
          {actType === 'call' && (
            <Select
              label="Call Outcome"
              options={CALL_OUTCOME_OPTIONS}
              placeholder="Select outcome"
              value={actOutcome}
              onChange={e => setActOutcome(e.target.value as CallOutcome)}
            />
          )}
          <Textarea
            label="Notes *"
            placeholder="What happened? Key points discussed…"
            value={actNote}
            onChange={e => setActNote(e.target.value)}
            rows={3}
          />
          <Input
            label="Schedule Follow-up"
            type="datetime-local"
            value={actFollowUp}
            onChange={e => setActFollowUp(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
