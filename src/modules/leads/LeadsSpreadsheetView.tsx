import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Check, X, Loader2, FileText } from 'lucide-react'
import {
  db, collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs, where, limit as fsLimit,
} from '../../lib/firebase'
import { uploadQuotePdf, type QuoteUploadProgress } from '../../lib/quoteUpload'
import { useAuth } from '../../contexts/AuthContext'
import { LEAD_STATUS_CONFIG, getScoreColor, formatDate, formatDateTime, cn, calculateLeadScore } from '../../lib/utils'
import { nextLeadCode } from '../../lib/counters'
import { recalcLeadScore } from '../../lib/leadScore'
import toast from 'react-hot-toast'
import type { Lead, LeadActivity, ActivityType, LeadStatus, LeadSource, QuoteDoc } from '../../types'

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
  { value: 'breville', label: 'Breville' },
  { value: 'other', label: 'Other' },
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

// ─── Quote Slots ──────────────────────────────────────────────────────────────

const QUOTE_SLOTS = 4

// Four fixed slots holding the most recently uploaded quote PDFs, newest first.
// A filled slot opens its PDF; an empty one uploads into it, so quotes can be
// attached without leaving the list. Empty slots keep the column a steady width
// and make the quote count readable at a glance.
function QuoteSlots({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<QuoteUploadProgress | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const docs = lead.quoteDocuments ?? []
  const recent = [...docs]
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
    .slice(0, QUOTE_SLOTS)
  const extra = Math.max(0, docs.length - QUOTE_SLOTS)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setUploading(true)
    setProgress({ phase: 'uploading', fraction: 0 })
    try {
      const newDoc = await uploadQuotePdf({
        file,
        collectionName: 'leads',
        docId: lead.id,
        uploadedByName: user?.name,
        onProgress: setProgress,
      })
      const next: QuoteDoc[] = [...docs, newDoc]
      await updateDoc(doc(db, 'leads', lead.id), { quoteDocuments: next, updatedAt: serverTimestamp() })
      // Quote count feeds the score (+4 each, first three).
      await recalcLeadScore(lead.id, { quoteDocuments: next })
      toast.success('Quote uploaded')
    } catch (err: unknown) {
      console.error('Quote upload error:', err)
      toast.error(err instanceof Error ? err.message : 'Upload failed — check your connection')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  const pct = progress ? Math.round(progress.fraction * 100) : 0

  return (
    <div className="flex items-center gap-1">
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={handleUpload} className="hidden" />
      {Array.from({ length: QUOTE_SLOTS }).map((_, i) => {
        const d = recent[i]

        if (d) {
          return (
            <a
              key={i}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${d.name}${d.uploadedAt ? ` — ${formatDate(new Date(d.uploadedAt))}` : ''}${d.uploadedByName ? ` · ${d.uploadedByName}` : ''}`}
              className="w-5 h-6 rounded bg-gold-400/15 border border-gold-400/40 text-gold-400 hover:bg-gold-400/30 transition-colors flex items-center justify-center shrink-0"
            >
              <FileText className="w-3 h-3" />
            </a>
          )
        }

        // The first empty slot is the upload target; the rest are placeholders.
        const isNextSlot = i === recent.length
        if (canEdit && isNextSlot) {
          if (uploading) {
            // Show the percentage rather than a bare spinner — a large upload can
            // run for a minute and a spinner alone reads as "stuck".
            return (
              <span
                key={i}
                title={progress?.phase === 'compressing' ? 'Compressing…' : 'Uploading…'}
                className="h-6 px-1 rounded border border-gold-400/40 bg-gold-400/10 text-[9px] font-semibold text-gold-400 flex items-center justify-center shrink-0 tabular-nums min-w-[2.25rem]"
              >
                {progress?.phase === 'compressing' ? `${pct}%⇩` : `${pct}%`}
              </span>
            )
          }
          return (
            <button
              key={i}
              onClick={() => fileRef.current?.click()}
              title="Upload a quote PDF"
              className="w-5 h-6 rounded border border-dashed border-gray-600 text-gray-500 hover:border-gold-400/60 hover:text-gold-400 transition-colors flex items-center justify-center shrink-0"
            >
              <Plus className="w-3 h-3" />
            </button>
          )
        }

        return (
          <span
            key={i}
            className="w-5 h-6 rounded border border-dashed border-gray-700 shrink-0"
            title="No quote in this slot"
          />
        )
      })}
      {extra > 0 && <span className="text-[10px] text-gray-500 shrink-0">+{extra}</span>}
    </div>
  )
}

// ─── Lead Row ─────────────────────────────────────────────────────────────────

function LeadRow({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const [latestActivity, setLatestActivity] = useState<LeadActivity | null>(null)

  useEffect(() => {
    const q = query(
      collection(db, 'leads', lead.id, 'activities'),
      orderBy('createdAt', 'desc'),
      fsLimit(1),
    )
    const unsub = onSnapshot(q, snap => {
      setLatestActivity(
        snap.docs.length > 0
          ? { id: snap.docs[0].id, ...snap.docs[0].data() } as LeadActivity
          : null,
      )
    })
    return unsub
  }, [lead.id])

  const saveField = useCallback(async (field: string, value: string) => {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (field === 'estimatedBudget') {
      updates[field] = value ? Number(value) : null
    } else {
      updates[field] = value
    }
    // Reaching the Demo stage records the site visit; it is never unset.
    if (field === 'status' && value === 'demo' && !lead.demoGiven) {
      updates.demoGiven = true
    }
    await updateDoc(doc(db, 'leads', lead.id), updates)

    // budget, source and the demo flag all feed the score
    if (field === 'estimatedBudget' || field === 'source' || field === 'status') {
      await recalcLeadScore(lead.id)
    }
  }, [lead.id, lead.demoGiven])

  const statusCfg = LEAD_STATUS_CONFIG[lead.status]

  const activityTs = latestActivity?.createdAt as any
  const activityDateTimeStr = activityTs?.toDate ? formatDateTime(activityTs.toDate()) : '—'

  const followUpTs = latestActivity?.followUpDate as any
  const followUpDateStr = followUpTs?.toDate
    ? formatDate(followUpTs.toDate())
    : lead.nextFollowUp ? formatDate(lead.nextFollowUp) : '—'

  return (
    <tr
      className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors"
    >
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

      {/* Quotes — up to 4 most recently uploaded PDFs */}
      <td className="px-2 py-2 min-w-[130px]">
        <QuoteSlots lead={lead} canEdit={canEdit} />
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

      {/* Activity Date & Time */}
      <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap w-32">
        {activityDateTimeStr}
      </td>

      {/* Activity Type */}
      <td className="px-2 py-2">
        {latestActivity ? (
          <span className={cn('text-xs font-medium capitalize', ACTIVITY_TYPE_COLOR[latestActivity.type] ?? 'text-gray-400')}>
            {latestActivity.type.replace('_', ' ')}
          </span>
        ) : (
          <span className="text-xs text-gray-600">—</span>
        )}
      </td>

      {/* Activity Note */}
      <td className="px-2 py-2 text-xs text-gray-300 max-w-sm truncate" title={latestActivity?.description}>
        {latestActivity?.description || '—'}
      </td>

      {/* Follow-up Date */}
      <td className="px-2 py-2 text-xs text-yellow-400/70 whitespace-nowrap w-24">
        {followUpDateStr}
      </td>

      {/* Follow-up By */}
      <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap min-w-[100px]">
        {latestActivity?.performedByName || '—'}
      </td>
    </tr>
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
      const demoGiven = status === 'demo'
      const aiScore = calculateLeadScore({
        source,
        estimatedBudget: budget ? Number(budget) : undefined,
        demoGiven,
      })
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
        aiScoreNote: 'Auto-scored from source, budget, demo, quotes and calls.',
        demoGiven,
        callCount: 0,
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
        <td colSpan={15} className="px-4 py-2.5 text-xs text-gray-600 hover:text-gray-400 transition-colors">
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

      {/* Quotes — uploaded from Lead Detail once the lead exists */}
      <td className="px-2 py-2 text-center text-xs text-gray-600">—</td>

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

      {/* Empty cells for activity columns (new leads have no activities yet) */}
      <td />
      <td />
      <td />
      <td />
      <td />

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()

  // Size the scroll box from its own position down to the bottom of the window, so
  // its horizontal scrollbar always lands on screen. A fixed max-height cannot do
  // this: the table starts below a header and filter bar whose height varies.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const recalc = () => {
      const top = el.getBoundingClientRect().top
      const FOOTER_AND_GUTTER = 56 // the "N leads · …" strip plus breathing room
      setMaxHeight(Math.max(240, window.innerHeight - top - FOOTER_AND_GUTTER))
    }
    recalc()
    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      {/* overflow-x-scroll (not auto) keeps the bar permanently visible, making the
          extra columns discoverable. Only the bar's size is overridden — colour and
          track come from the global themed scrollbar in index.css, so every theme
          stays consistent. Height is set by the effect above. */}
      <div
        ref={scrollRef}
        style={{ maxHeight }}
        className="overflow-x-scroll overflow-y-auto [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5"
      >
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {['Name', 'Phone', 'Source', 'Status', 'Quotes', 'Budget (₹)', 'Score', 'Tier', 'Assigned To', 'Date Added', 'Date & Time', 'Type', 'Note', 'Follow-up', 'By'].map(h => (
                /* Background sits on the th, not the tr — a sticky thead does not
                   reliably paint a tr background. */
                <th key={h} className="bg-gray-800 border-b border-gray-700 px-2 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <NewLeadRow canEdit={canEdit} />
            {leads.length === 0 && !loading && (
              <tr>
                <td colSpan={15} className="px-4 py-8 text-center text-xs text-gray-600">
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
        {leads.length} leads · Click any cell to edit · Scroll sideways for more columns →
      </div>
    </div>
  )
}
