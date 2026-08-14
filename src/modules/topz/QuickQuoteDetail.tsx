import { useState } from 'react'
import { X, Pencil, MessageCircle, CalendarClock, CheckCircle, XCircle } from 'lucide-react'
import type { SavedQuotation } from './data/storage'

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_LABEL: Record<SavedQuotation['status'], string> = {
  draft: 'Draft', sent: 'WhatsApp Sent', follow_up: 'Follow-up', lost: 'Lost', converted: 'Converted',
}
const STATUS_COLOR: Record<SavedQuotation['status'], string> = {
  draft: '#9ca3af', sent: '#60a5fa', follow_up: '#fbbf24', lost: '#f87171', converted: '#34d399',
}

interface Props {
  quote: SavedQuotation
  onClose: () => void
  onEdit: () => void
  onConvert: () => void
  onWhatsApp: () => void
  onSetFollowUp: (date: string) => void
  onMarkLost: () => void
}

const rowStyle = { color: 'var(--text-muted)' }

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs" style={rowStyle}>{label}</p>
      <p className="text-sm font-medium" style={{ color: 'var(--text-base)' }}>{value || <span className="opacity-40">—</span>}</p>
    </div>
  )
}

export function QuickQuoteDetail({ quote: q, onClose, onEdit, onConvert, onWhatsApp, onSetFollowUp, onMarkLost }: Props) {
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [followUpDate, setFollowUpDate] = useState(q.followUpDate ?? '')

  const route = `${q.pickupLocation}${q.dropLocation ? ` → ${q.dropLocation}` : ''}${q.isRoundTrip ? ' (Return)' : ''}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f0c040' }}>Quick WhatsApp Quote</p>
            <h3 className="text-lg font-bold font-mono" style={{ color: 'var(--text-base)' }}>{q.quoteNo}</h3>
          </div>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: STATUS_COLOR[q.status] + '20', color: STATUS_COLOR[q.status] }}>
            {STATUS_LABEL[q.status]}
          </span>
          {q.followUpDate && q.status !== 'converted' && q.status !== 'lost' && (
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>
              Follow up {fmtDate(q.followUpDate)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Client" value={q.clientName} />
          <Field label="Phone" value={q.clientPhone} />
          <Field label="Travel Date" value={fmtDate(q.pickupDate)} />
          <Field label="Vehicle" value={`${q.vehicleName}${(q.units ?? 1) > 1 ? ` × ${q.units}` : ''}`} />
          <div className="col-span-2"><Field label="Route" value={route} /></div>
          <Field label="Amount" value={<span className="font-bold" style={{ color: '#f0c040' }}>{fmt(q.totalAmount)}</span>} />
          <Field label="Timing" value={q.timing} />
          <Field label="Passengers" value={q.passengers} />
          <Field label="Source" value={q.source ?? 'WhatsApp'} />
          <Field label="Created By" value={q.sentBy} />
          <Field label="Created" value={fmtDate(q.createdAt)} />
        </div>

        {q.extraChargesText && (
          <div>
            <p className="text-xs mb-1" style={rowStyle}>Extra Charges / Terms</p>
            <p className="text-sm whitespace-pre-line rounded-xl px-3 py-2" style={{ background: 'var(--glass-bg)', color: 'var(--text-base)' }}>{q.extraChargesText}</p>
          </div>
        )}

        {q.notes && (
          <div>
            <p className="text-xs mb-1" style={rowStyle}>Original WhatsApp Message / Notes</p>
            <p className="text-sm whitespace-pre-line rounded-xl px-3 py-2" style={{ background: 'var(--glass-bg)', color: 'var(--text-muted)' }}>{q.notes}</p>
          </div>
        )}

        {followUpOpen && (
          <div className="flex items-end gap-2 rounded-xl p-3" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)' }}>
            <div className="flex-1">
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#60a5fa' }}>Follow-up Date</label>
              <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-base)' }} />
            </div>
            <button onClick={() => { if (followUpDate) { onSetFollowUp(followUpDate); setFollowUpOpen(false) } }}
              className="px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#60a5fa', color: '#0a0a0a' }}>
              Set
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--text-base)' }}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button onClick={onWhatsApp} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
            style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)' }}>
            <MessageCircle className="w-3.5 h-3.5" /> Send WhatsApp
          </button>
          {q.status !== 'converted' && q.status !== 'lost' && (
            <button onClick={() => setFollowUpOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>
              <CalendarClock className="w-3.5 h-3.5" /> Follow Up
            </button>
          )}
          {q.status !== 'converted' && (
            <button onClick={onConvert} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }}>
              <CheckCircle className="w-3.5 h-3.5" /> Convert to Booking
            </button>
          )}
          {q.status !== 'converted' && q.status !== 'lost' && (
            <button onClick={onMarkLost} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
              <XCircle className="w-3.5 h-3.5" /> Mark Lost
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
