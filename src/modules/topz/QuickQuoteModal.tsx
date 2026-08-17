import { useState } from 'react'
import { X, Zap, Send, Printer } from 'lucide-react'
import { saveQuotation, TOPZ_TEAM, type SavedQuotation } from './data/storage'
import { getVehicles } from './data/rateCard'
import { buildQuickQuoteMessage, openWhatsApp } from './whatsapp'
import { printQuickQuote } from './printQuickQuote'
import toast from 'react-hot-toast'

const LAST_TEAM_MEMBER_KEY = 'topz-quick-quote-last-team-member'
const uid = () => Math.random().toString(36).slice(2, 10)
const quickQuoteNo = () => `QQ-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`

interface Props {
  initial?: SavedQuotation | null
  onClose: () => void
  onSaved: (q: SavedQuotation) => void
}

const inputStyle = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-base)' }
const labelStyle = { color: 'var(--text-muted)' }

export function QuickQuoteModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial
  const vehicles = getVehicles()

  const [clientName, setClientName] = useState(initial?.clientName ?? '')
  const [clientPhone, setClientPhone] = useState(initial?.clientPhone ?? '')
  const [clientEmail, setClientEmail] = useState(initial?.clientEmail ?? '')
  const [travelDate, setTravelDate] = useState(initial?.pickupDate ?? '')
  const [returnDate, setReturnDate] = useState(initial?.dropDate && initial.dropDate !== initial.pickupDate ? initial.dropDate : '')
  const [from, setFrom] = useState(initial?.pickupLocation ?? '')
  const [to, setTo] = useState(initial?.dropLocation ?? '')
  const [isRoundTrip, setIsRoundTrip] = useState(initial?.isRoundTrip ?? false)
  const [vehicleName, setVehicleName] = useState(initial?.vehicleName ?? '')
  const [passengers, setPassengers] = useState(initial?.passengers ?? '')
  const [totalAmount, setTotalAmount] = useState(initial?.totalAmount ? String(initial.totalAmount) : '')
  const [timing, setTiming] = useState(initial?.timing ?? '')
  const [extraChargesText, setExtraChargesText] = useState(initial?.extraChargesText ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [sentBy, setSentBy] = useState(initial?.sentBy ?? localStorage.getItem(LAST_TEAM_MEMBER_KEY) ?? '')
  const [saving, setSaving] = useState(false)
  const [quoteNoPreview] = useState(initial?.quoteNo ?? quickQuoteNo())
  const [includeTnc, setIncludeTnc] = useState(false)
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(
    new Set(['toll_extra', 'valid', 'advance'])
  )
  const [showNotePicker, setShowNotePicker] = useState(false)

  function validate(): string | null {
    if (!clientName.trim()) return 'Client name is required'
    if (!clientPhone.trim()) return 'Phone number is required'
    if (!travelDate) return 'Travel date is required'
    if (!from.trim()) return 'From location is required'
    if (!to.trim()) return 'To location is required'
    if (!vehicleName) return 'Vehicle is required'
    if (!totalAmount || Number(totalAmount) <= 0) return 'Quoted amount is required'
    return null
  }

  function buildQuote(status: SavedQuotation['status']): SavedQuotation {
    const vehicle = vehicles.find(v => v.name === vehicleName)
    return {
      id: initial?.id ?? uid(),
      quoteNo: quoteNoPreview,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      status,
      tripType: 'outstation',
      isRoundTrip,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientEmail: clientEmail.trim(),
      pickupDate: travelDate,
      pickupLocation: from.trim(),
      dropDate: returnDate || travelDate,
      dropLocation: to.trim(),
      passengers: passengers.trim(),
      estimatedKm: '',
      vehicleName,
      vehicleCategory: vehicle?.category ?? '',
      units: 1,
      days: 1,
      totalAmount: Number(totalAmount),
      sentBy: sentBy || undefined,
      type: 'quick',
      source: 'WhatsApp',
      timing: timing.trim() || undefined,
      extraChargesText: extraChargesText.trim() || undefined,
      notes: notes.trim() || undefined,
      followUpDate: initial?.followUpDate,
    }
  }

  async function handleSave(sendWhatsApp: boolean) {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      if (sentBy) localStorage.setItem(LAST_TEAM_MEMBER_KEY, sentBy)
      const quote = buildQuote(sendWhatsApp ? 'sent' : (initial?.status ?? 'draft'))
      await saveQuotation(quote)
      if (sendWhatsApp) {
        openWhatsApp(quote.clientPhone, buildQuickQuoteMessage(quote))
        toast.success('Quote saved — opening WhatsApp…')
      } else {
        toast.success(isEdit ? 'Quick Quote updated' : 'Quick Quote saved')
      }
      onSaved(quote)
    } catch {
      toast.error('Failed to save quick quote')
    } finally {
      setSaving(false)
    }
  }

  function handlePrint() {
    printQuickQuote({ quote: buildQuote(initial?.status ?? 'draft'), includeTnc, selectedNotes })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: '#f0c040' }} />
            <h3 className="text-base font-bold" style={{ color: 'var(--text-base)' }}>{isEdit ? 'Edit Quick Quote' : 'Quick WhatsApp Quote'}</h3>
          </div>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        {/* Client info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Client Name *</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. ABC Travels" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Phone *</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="98XXXXXXXX" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Email</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="optional" />
          </div>
        </div>

        {/* Trip info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Travel Date *</label>
            <input type="date" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={travelDate} onChange={e => setTravelDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Return Date</label>
            <input type="date" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={returnDate} onChange={e => setReturnDate(e.target.value)} min={travelDate || undefined} />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={labelStyle}>
              <input type="checkbox" checked={isRoundTrip} onChange={e => setIsRoundTrip(e.target.checked)} />
              Round Trip
            </label>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>From *</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={from} onChange={e => setFrom(e.target.value)} placeholder="Pickup location" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>To *</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={to} onChange={e => setTo(e.target.value)} placeholder="Drop location" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Vehicle *</label>
            <select className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={vehicleName} onChange={e => setVehicleName(e.target.value)}>
              <option value="">Select vehicle…</option>
              {vehicles.map(v => <option key={v.name} value={v.name}>{v.name} ({v.seats} seater)</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Passengers</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={passengers} onChange={e => setPassengers(e.target.value)} placeholder="optional" />
          </div>
        </div>

        {/* Quotation info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Quoted Amount (₹) *</label>
            <input type="number" className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={totalAmount} onChange={e => setTotalAmount(e.target.value)} placeholder="e.g. 16800" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Timing</label>
            <input className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
              value={timing} onChange={e => setTiming(e.target.value)} placeholder="e.g. 6:30 AM – 11:00 PM" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Extra Charges / Terms</label>
            <textarea rows={2} className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none" style={inputStyle}
              value={extraChargesText} onChange={e => setExtraChargesText(e.target.value)}
              placeholder="e.g. Toll/Parking extra, Return after 11PM ₹600 extra" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Original WhatsApp Message / Notes</label>
            <textarea rows={3} className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none" style={inputStyle}
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Paste the original WhatsApp message here (optional)" />
          </div>
        </div>

        {/* Internal info */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>Team Member / Taken By</label>
          <select className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}
            value={sentBy} onChange={e => setSentBy(e.target.value)}>
            <option value="">—</option>
            {TOPZ_TEAM.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        {/* Notes + Print */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowNotePicker(p => !p)} type="button"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all"
              style={showNotePicker
                ? { background: 'rgba(240,192,64,0.12)', borderColor: 'rgba(240,192,64,0.4)', color: '#f0c040' }
                : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
              Notes ({selectedNotes.size})
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs" style={labelStyle}>
              <input type="checkbox" checked={includeTnc} onChange={e => setIncludeTnc(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-yellow-400 cursor-pointer" />
              T&amp;C
            </label>
            <button onClick={handlePrint} type="button"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ml-auto"
              style={{ borderColor: 'var(--glass-border)', color: 'var(--text-base)' }}>
              <Printer className="w-3.5 h-3.5" /> Print PDF
            </button>
          </div>
          {showNotePicker && (
            <div className="rounded-2xl p-4 space-y-2"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-base)' }}>Notes in PDF</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  { id: 'toll_extra',  label: 'Toll, parking & taxes extra' },
                  { id: 'toll_incl',   label: 'Toll included, only parking extra' },
                  { id: 'atal_setu',   label: 'Atal Setu toll extra' },
                  { id: 'border_tax',  label: 'Border / interstate tax extra' },
                  { id: 'valid',       label: 'Quotation valid for 3 days' },
                  { id: 'advance',     label: '25% advance to confirm booking' },
                  { id: 'ref_image',   label: 'Vehicle images for reference only' },
                  { id: 'inclusive',   label: 'All-inclusive — no extras' },
                  { id: 'cancel',      label: 'Cancellation policy applies' },
                ].map(n => (
                  <label key={n.id} className="flex items-center gap-2.5 cursor-pointer group">
                    <input type="checkbox"
                      checked={selectedNotes.has(n.id)}
                      onChange={e => {
                        const next = new Set(selectedNotes)
                        e.target.checked ? next.add(n.id) : next.delete(n.id)
                        setSelectedNotes(next)
                      }}
                      className="w-3.5 h-3.5 rounded accent-yellow-400 cursor-pointer shrink-0" />
                    <span className="text-xs group-hover:text-white transition-colors" style={{ color: 'var(--text-muted)' }}>{n.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
            Cancel
          </button>
          <button onClick={() => handleSave(false)} disabled={saving}
            className="flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50"
            style={{ borderColor: 'rgba(240,192,64,0.4)', color: '#f0c040' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => handleSave(true)} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#25d366,#1da851)', color: '#0a0a0a' }}>
            <Send className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save & Send WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  )
}
