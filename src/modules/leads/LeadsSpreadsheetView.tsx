import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronRight, ChevronDown, Plus, Check, X, Loader2 } from 'lucide-react'
import {
  db, collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs, where, limit as fsLimit,
} from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { LEAD_STATUS_CONFIG, getScoreColor, formatDate, formatDateTime, cn, calculateLeadScore } from '../../lib/utils'
import { Timestamp } from 'firebase/firestore'
import { nextLeadCode } from '../../lib/counters'
import toast from 'react-hot-toast'
import type { Lead, LeadActivity, ActivityType, LeadStatus, LeadSource } from '../../types'

// ─── Editable Cell ────────────────────────────────────────────────────────────

interface CellProps {
  value: string
  onSave: (val: string) => Promise<void>
  type?: 'text' | 'select' | 'number'
  options?: { value: string; label: string }[]
  className?: string
  readOnly?: boolean
}

function EditableCell({ value, onSave, type = 'text', options, className, readOnly }: CellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const commit = useCallback(async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch {
      toast.error('Failed to save')
      setDraft(value)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }, [draft, value, onSave])

  useEffect(() => {
    if (editing) (inputRef.current as HTMLElement | null)?.focus()
  }, [editing])

  if (readOnly) {
    return <span className={cn('text-gray-400', className)}>{value || '—'}</span>
  }

  if (editing) {
    if (type === 'select' && options) {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-full bg-gray-700 border border-indigo-500 rounded px-1 py-0.5 text-xs text-white focus:outline-none"
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type === 'number' ? 'number' : 'text'}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-full bg-gray-700 border border-indigo-500 rounded px-1 py-0.5 text-xs text-white focus:outline-none min-w-0"
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={cn(
        'cursor-text hover:bg-gray-700/60 rounded px-1 py-0.5 transition-colors block truncate',
        !value && 'text-gray-600 italic',
        className,
      )}
      title={value || 'Click to edit'}
    >
      {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (value || 'click to edit')}
    </span>
  )
}

// ─── Status options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'floor_plan', label: 'Floor Plan' },
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'partner', label: 'Partner' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'justdial', label: 'JustDial' },
  { value: 'indiamart', label: 'IndiaMart' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'other', label: 'Other' },
]

const ACTIVITY_TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'note', label: 'Note' },
  { value: 'email', label: 'Email' },
]

const ACTIVITY_TYPE_COLOR: Record<ActivityType, string> = {
  call: 'text-green-400',
  whatsapp: 'text-emerald-400',
  meeting: 'text-blue-400',
  follow_up: 'text-yellow-400',
  note: 'text-gray-400',
  status_change: 'text-indigo-400',
  floor_plan_upload: 'text-violet-400',
  email: 'text-sky-400',
}

// ─── Activity Sub-Grid ────────────────────────────────────────────────────────

function ActivitySubGrid({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const { user } = useAuth()
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [loading, setLoading] = useState(true)

  // new row state
  const [newType, setNewType] = useState<ActivityType>('call')
  const [newNote, setNewNote] = useState('')
  const [newFollowUp, setNewFollowUp] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const q = query(
      collection(db, 'leads', leadId, 'activities'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, snap => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadActivity))
      setLoading(false)
    })
    return unsub
  }, [leadId])

  const saveActivity = async () => {
    if (!newNote.trim()) { toast.error('Note is required'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'leads', leadId, 'activities'), {
        leadId,
        type: newType,
        description: newNote.trim(),
        followUpDate: newFollowUp ? Timestamp.fromDate(new Date(newFollowUp)) : null,
        performedBy: user?.id ?? '',
        performedByName: user?.name ?? '',
        createdAt: serverTimestamp(),
      })
      // update lead's updatedAt + nextFollowUp if set
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() }
      if (newFollowUp) updates.nextFollowUp = Timestamp.fromDate(new Date(newFollowUp))
      await updateDoc(doc(db, 'leads', leadId), updates)
      setNewNote('')
      setNewFollowUp('')
      setNewType('call')
      toast.success('Activity logged')
    } catch {
      toast.error('Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <tr>
        <td colSpan={10} className="px-8 py-3 bg-gray-950">
          <div className="text-xs text-gray-600 animate-pulse">Loading activities…</div>
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* Activity rows */}
      {activities.map(act => {
        const ts = act.createdAt as any
        const dateStr = ts?.toDate ? formatDateTime(ts.toDate()) : '—'
        const fuTs = act.followUpDate as any
        const fuStr = fuTs?.toDate ? formatDate(fuTs.toDate()) : ''
        return (
          <tr key={act.id} className="bg-gray-950 border-b border-gray-800/50">
            <td className="pl-10 pr-2 py-2 w-8" />
            <td className="px-2 py-2 text-xs text-gray-500">{dateStr}</td>
            <td className="px-2 py-2">
              <span className={cn('text-xs font-medium capitalize', ACTIVITY_TYPE_COLOR[act.type] ?? 'text-gray-400')}>
                {act.type.replace('_', ' ')}
              </span>
            </td>
            <td className="px-2 py-2 text-xs text-gray-300 max-w-xs truncate" colSpan={3} title={act.description}>
              {act.description}
            </td>
            <td className="px-2 py-2 text-xs text-yellow-400/70">{fuStr || '—'}</td>
            <td className="px-2 py-2 text-xs text-gray-600">{act.performedByName || '—'}</td>
            <td />
          </tr>
        )
      })}

      {/* New activity row */}
      {canEdit && (
        <tr className="bg-gray-950 border-b border-gray-800">
          <td className="pl-10 pr-2 py-2" />
          <td className="px-2 py-2 text-xs text-gray-600 italic whitespace-nowrap">+ new</td>
          <td className="px-2 py-2">
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as ActivityType)}
              className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-1 py-1 focus:outline-none focus:border-indigo-500 w-full"
            >
              {ACTIVITY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </td>
          <td className="px-2 py-2" colSpan={3}>
            <input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveActivity() }}
              placeholder="Type a note… (Enter to save)"
              className="w-full bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 placeholder-gray-700"
            />
          </td>
          <td className="px-2 py-2">
            <input
              type="date"
              value={newFollowUp}
              onChange={e => setNewFollowUp(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-1 py-1 focus:outline-none focus:border-indigo-500 w-full"
            />
          </td>
          <td className="px-2 py-2 text-xs text-gray-600">{user?.name || '—'}</td>
          <td className="px-2 py-2">
            <button
              onClick={saveActivity}
              disabled={saving}
              className="p-1 rounded bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 transition-colors disabled:opacity-50"
              title="Save activity"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
          </td>
        </tr>
      )}

      {/* Spacer */}
      <tr className="bg-gray-950">
        <td colSpan={10} className="py-1" />
      </tr>
    </>
  )
}

// ─── Lead Row ─────────────────────────────────────────────────────────────────

function LeadRow({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const saveField = useCallback(async (field: string, value: string) => {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (field === 'estimatedBudget') {
      updates[field] = value ? Number(value) : null
    } else {
      updates[field] = value
    }
    await updateDoc(doc(db, 'leads', lead.id), updates)
  }, [lead.id])

  const statusCfg = LEAD_STATUS_CONFIG[lead.status]

  return (
    <>
      <tr
        className={cn(
          'border-b border-gray-800 hover:bg-gray-800/30 transition-colors',
          expanded && 'bg-gray-800/20',
        )}
      >
        {/* Expand toggle */}
        <td className="pl-3 pr-1 py-2 w-8">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-gray-600 hover:text-gray-300 transition-colors"
            title={expanded ? 'Collapse activities' : 'Expand activities'}
          >
            {expanded
              ? <ChevronDown className="w-4 h-4" />
              : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>

        {/* Name */}
        <td className="px-2 py-2 min-w-[140px]">
          <EditableCell
            value={lead.name}
            onSave={v => saveField('name', v)}
            readOnly={!canEdit}
            className="font-medium text-gray-200 text-xs"
          />
        </td>

        {/* Phone */}
        <td className="px-2 py-2 min-w-[140px]">
          <div className="flex items-center gap-1">
            <EditableCell
              value={lead.phone}
              onSave={v => saveField('phone', v)}
              readOnly={!canEdit}
              className="text-xs"
            />
            {lead.tier && (
              <span className="text-[10px] font-semibold text-gold-400 shrink-0">({lead.tier})</span>
            )}
          </div>
        </td>

        {/* Source */}
        <td className="px-2 py-2 min-w-[110px]">
          <EditableCell
            value={lead.source?.replace('_', ' ') ?? ''}
            onSave={v => saveField('source', v)}
            type="select"
            options={SOURCE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            readOnly={!canEdit}
            className="text-xs capitalize"
          />
        </td>

        {/* Status */}
        <td className="px-2 py-2 min-w-[110px]">
          {canEdit ? (
            <EditableCell
              value={lead.status}
              onSave={v => saveField('status', v)}
              type="select"
              options={STATUS_OPTIONS}
              className={cn('text-xs font-medium', statusCfg?.color)}
            />
          ) : (
            <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', statusCfg?.color, statusCfg?.bg)}>
              {statusCfg?.label}
            </span>
          )}
        </td>

        {/* Budget */}
        <td className="px-2 py-2 min-w-[90px]">
          <EditableCell
            value={lead.estimatedBudget ? String(lead.estimatedBudget) : ''}
            onSave={v => saveField('estimatedBudget', v)}
            type="number"
            readOnly={!canEdit}
            className="text-xs text-gray-300"
          />
        </td>

        {/* Score */}
        <td className="px-2 py-2 w-16 text-center">
          <span className={cn('text-xs font-bold', getScoreColor(lead.aiScore))}>
            {lead.aiScore ?? '—'}
          </span>
        </td>

        {/* Tier */}
        <td className="px-2 py-2 w-16 text-center">
          <EditableCell
            value={lead.tier ?? ''}
            onSave={v => saveField('tier', v)}
            type="select"
            options={[
              { value: '', label: '—' },
              { value: 'T1', label: 'T1' },
              { value: 'T2', label: 'T2' },
              { value: 'T3', label: 'T3' },
              { value: 'T4', label: 'T4' },
              { value: 'T5', label: 'T5' },
            ]}
            readOnly={!canEdit}
            className="text-xs font-semibold text-gold-400"
          />
        </td>

        {/* Assigned To */}
        <td className="px-2 py-2 min-w-[110px]">
          <EditableCell
            value={lead.assignedToName ?? ''}
            onSave={v => saveField('assignedToName', v)}
            readOnly={!canEdit}
            className="text-xs"
          />
        </td>

        {/* Date Added */}
        <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap w-24">
          {formatDate(lead.createdAt)}
        </td>
      </tr>

      {/* Activity sub-grid */}
      {expanded && (
        <>
          {/* Activity header */}
          <tr className="bg-gray-950">
            <td />
            {['Date & Time', 'Type', 'Note', '', '', 'Follow-up', 'By', ''].map((h, i) => (
              <td key={i} className="px-2 pt-2 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                {h}
              </td>
            ))}
          </tr>
          <ActivitySubGrid leadId={lead.id} canEdit={canEdit} />
        </>
      )}
    </>
  )
}

// ─── New Lead Row ─────────────────────────────────────────────────────────────

function NewLeadRow({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth()
  const [active, setActive] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState<LeadSource>('cold_call')
  const [status, setStatus] = useState<LeadStatus>('new')
  const [budget, setBudget] = useState('')
  const [tier, setTier] = useState<'' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5'>('')
  const [assignedToName, setAssignedToName] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) nameRef.current?.focus()
  }, [active])

  const reset = () => {
    setName(''); setPhone(''); setSource('cold_call'); setStatus('new')
    setBudget(''); setTier(''); setAssignedToName(''); setActive(false)
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Name is required'); nameRef.current?.focus(); return }
    if (!phone.trim()) { toast.error('Phone is required'); return }
    setSaving(true)
    try {
      const normalizedPhone = phone.replace(/\D/g, '')
      const dupSnap = await getDocs(query(collection(db, 'leads'), where('phone', '==', normalizedPhone), fsLimit(1)))
      if (!dupSnap.empty) {
        toast.error(`Phone already used by "${dupSnap.docs[0].data().name}"`)
        setSaving(false)
        return
      }
      const leadCode = await nextLeadCode()
      const aiScore = calculateLeadScore({ source, estimatedBudget: budget ? Number(budget) : undefined })
      await addDoc(collection(db, 'leads'), {
        leadCode,
        status,
        source,
        name: name.trim(),
        phone: normalizedPhone,
        estimatedBudget: budget ? Number(budget) : null,
        tier: tier || null,
        assignedTo: user?.id ?? '',
        assignedToName: assignedToName.trim() || user?.name || null,
        aiScore,
        aiScoreNote: 'Auto-scored based on source and budget.',
        demoGiven: false,
        createdBy: user?.id ?? '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success(`Lead "${name.trim()}" created`)
      reset()
    } catch {
      toast.error('Failed to create lead')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') reset()
  }

  if (!canEdit) return null

  if (!active) {
    return (
      <tr
        className="border-t border-dashed border-gray-800 hover:bg-gray-800/20 cursor-pointer transition-colors"
        onClick={() => setActive(true)}
      >
        <td colSpan={10} className="px-4 py-2.5 text-xs text-gray-600 hover:text-gray-400 transition-colors">
          <span className="flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add new lead…
          </span>
        </td>
      </tr>
    )
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none'
  const selectCls = 'w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded px-1 py-1 text-xs text-gray-200 focus:outline-none'

  return (
    <tr className="border-t-2 border-indigo-500/40 bg-gray-800/10">
      <td className="pl-3 pr-1 py-2 text-gray-600 text-xs">★</td>

      {/* Name */}
      <td className="px-2 py-2 min-w-[140px]">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Full name *" className={inputCls} />
      </td>

      {/* Phone */}
      <td className="px-2 py-2 min-w-[120px]">
        <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Phone *" className={inputCls} />
      </td>

      {/* Source */}
      <td className="px-2 py-2 min-w-[110px]">
        <select value={source} onChange={e => setSource(e.target.value as LeadSource)} className={selectCls}>
          {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Status */}
      <td className="px-2 py-2 min-w-[110px]">
        <select value={status} onChange={e => setStatus(e.target.value as LeadStatus)} className={selectCls}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Budget */}
      <td className="px-2 py-2 min-w-[90px]">
        <input type="number" value={budget} onChange={e => setBudget(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Budget" className={inputCls} />
      </td>

      {/* Score — auto */}
      <td className="px-2 py-2 text-center text-xs text-gray-600">auto</td>

      {/* Tier */}
      <td className="px-2 py-2 w-16">
        <select value={tier} onChange={e => setTier(e.target.value as typeof tier)} className={selectCls}>
          <option value="">—</option>
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
          <option value="T4">T4</option>
          <option value="T5">T5</option>
        </select>
      </td>

      {/* Assigned To */}
      <td className="px-2 py-2 min-w-[110px]">
        <input value={assignedToName} onChange={e => setAssignedToName(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={user?.name ?? 'Assigned to'} className={inputCls} />
      </td>

      {/* Actions */}
      <td className="px-2 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button onClick={save} disabled={saving}
            className="p-1.5 rounded bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 transition-colors disabled:opacity-50"
            title="Save (Enter)">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={reset}
            className="p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
            title="Cancel (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Main Spreadsheet View ────────────────────────────────────────────────────

interface Props {
  leads: Lead[]
  loading: boolean
  canEdit: boolean
}

export function LeadsSpreadsheetView({ leads, loading, canEdit }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-800/60 border-b border-gray-700">
              <th className="w-8 px-3 py-2.5" />
              {['Name', 'Phone', 'Source', 'Status', 'Budget (₹)', 'Score', 'Tier', 'Assigned To', 'Date Added'].map(h => (
                <th key={h} className="px-2 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <NewLeadRow canEdit={canEdit} />
            {leads.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-xs text-gray-600">
                  No leads match the current filters.
                </td>
              </tr>
            )}
            {[...leads].sort((a, b) => {
              const aTs = (a.createdAt as any)?.toDate?.() ?? new Date(a.createdAt as any)
              const bTs = (b.createdAt as any)?.toDate?.() ?? new Date(b.createdAt as any)
              return bTs - aTs
            }).map(lead => (
              <LeadRow key={lead.id} lead={lead} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-600">
        {leads.length} leads · Click any cell to edit · Click ▶ to expand activity log
      </div>
    </div>
  )
}
