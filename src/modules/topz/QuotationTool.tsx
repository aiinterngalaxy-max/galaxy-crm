import { useState } from 'react'
import { MapPin, Calendar, Users, Car, Printer, RotateCcw, Navigation, MessageCircle, ArrowLeftRight, Package, Save, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { getVehicles, calculateQuotation, calculateLocalQuotation, getSuggestedVehicles, daysBetween, type Vehicle, type QuotationResult, type LocalQuotationResult } from './data/rateCard'
import { printQuotation } from './printQuotation'
import { saveQuotation } from './data/storage'
import toast from 'react-hot-toast'

type TripType = 'outstation' | 'local'

interface FormState {
  tripType: TripType
  isRoundTrip: boolean
  clientName: string
  clientPhone: string
  clientEmail: string
  pickupDate: string
  pickupLocation: string
  dropDate: string
  dropLocation: string
  passengers: string
  estimatedKm: string
}

const EMPTY: FormState = {
  tripType: 'outstation', isRoundTrip: false,
  clientName: '', clientPhone: '', clientEmail: '',
  pickupDate: '', pickupLocation: '', dropDate: '', dropLocation: '',
  passengers: '', estimatedKm: '',
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const uid = () => Math.random().toString(36).slice(2, 10)
const quoteNo = () => `TOPZ-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`

export function QuotationTool() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [vehicleOpen, setVehicleOpen] = useState(false)
  const [result, setResult] = useState<QuotationResult | null>(null)
  const [localResult, setLocalResult] = useState<LocalQuotationResult | null>(null)
  const [distLoading, setDistLoading] = useState(false)
  const [savedQuoteNo, setSavedQuoteNo] = useState('')
  const [saved, setSaved] = useState(false)

  const vehicles = getVehicles()
  const passengers = parseInt(form.passengers) || 0
  const suggested = passengers > 0 ? getSuggestedVehicles(passengers, vehicles) : vehicles
  const isLocal = form.tripType === 'local'
  const days = !isLocal && form.pickupDate && form.dropDate
    ? daysBetween(form.pickupDate, form.dropDate) : 1
  const total = result?.total ?? localResult?.total ?? 0

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value
    setForm(f => ({ ...f, [k]: val }))
    if (k === 'passengers') { setSelectedVehicle(null); setResult(null); setLocalResult(null) }
  }

  function setTripType(t: TripType) {
    setForm(f => ({ ...f, tripType: t, isRoundTrip: false, dropDate: '', estimatedKm: '' }))
    setSelectedVehicle(null); setResult(null); setLocalResult(null)
  }

  function recalc(v: Vehicle, km: number) {
    if (form.tripType === 'outstation') {
      setResult(calculateQuotation(v, days, km)); setLocalResult(null)
    } else {
      setLocalResult(calculateLocalQuotation(v, km)); setResult(null)
    }
  }

  function handleVehicleSelect(v: Vehicle) {
    setSelectedVehicle(v)
    setVehicleOpen(false)
    const km = parseInt(form.estimatedKm) || (isLocal ? 80 : days * v.minKmPerDay)
    recalc(v, km)
  }

  function handleKmChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, estimatedKm: e.target.value }))
    if (selectedVehicle) recalc(selectedVehicle, parseInt(e.target.value) || 0)
  }

  async function fetchDistance() {
    if (!form.pickupLocation || !form.dropLocation) return
    setDistLoading(true)
    try {
      const r = await fetch(`/api/distance?from=${encodeURIComponent(form.pickupLocation)}&to=${encodeURIComponent(form.dropLocation)}`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      const km = form.isRoundTrip ? d.km * 2 : d.km
      setForm(f => ({ ...f, estimatedKm: String(km) }))
      if (selectedVehicle) recalc(selectedVehicle, km)
    } catch (e: any) {
      toast.error('Could not fetch distance: ' + e.message)
    } finally {
      setDistLoading(false)
    }
  }

  async function doSave(qNo: string) {
    if (!selectedVehicle) return
    await saveQuotation({
      id: uid(), quoteNo: qNo, createdAt: new Date().toISOString(), status: 'draft',
      tripType: form.tripType, isRoundTrip: form.isRoundTrip,
      clientName: form.clientName, clientPhone: form.clientPhone, clientEmail: form.clientEmail,
      pickupDate: form.pickupDate, pickupLocation: form.pickupLocation,
      dropDate: form.dropDate, dropLocation: form.dropLocation,
      passengers: form.passengers, estimatedKm: form.estimatedKm,
      vehicleName: selectedVehicle.name, vehicleCategory: selectedVehicle.category,
      days, totalAmount: total,
    })
  }

  async function handleSave() {
    if (!selectedVehicle) return
    const qNo = savedQuoteNo || quoteNo()
    setSavedQuoteNo(qNo)
    await doSave(qNo)
    setSaved(true)
    toast.success('Quote saved')
    setTimeout(() => setSaved(false), 2000)
  }

  async function handlePrint() {
    if (!selectedVehicle) return
    const qNo = savedQuoteNo || quoteNo()
    setSavedQuoteNo(qNo)
    await doSave(qNo)
    printQuotation({ form, vehicle: selectedVehicle, result, localResult, days, quoteNo: qNo })
  }

  async function handleWhatsApp() {
    if (!selectedVehicle || !form.clientPhone) { toast.error('Client phone number required'); return }
    const qNo = savedQuoteNo || quoteNo()
    setSavedQuoteNo(qNo)
    await doSave(qNo)
    const phone = form.clientPhone.replace(/\D/g, '').replace(/^0/, '91').replace(/^(?!91)/, '91')
    const lines = [
      `*TOPZ CAB — Quotation ${qNo}*`, '',
      `\u{1F4CB} *Client:* ${form.clientName}`,
      form.clientPhone ? `\u{1F4DE} *Phone:* ${form.clientPhone}` : '',
      '',
      `\u{1F697} *Vehicle:* ${selectedVehicle.name} (${selectedVehicle.seats} seats)`,
      `\u{1F4C5} *Date:* ${form.pickupDate}`,
      `\u{1F4CD} *Pickup:* ${form.pickupLocation}`,
      form.dropLocation ? `\u{1F4CD} *Drop:* ${form.dropLocation}` : '',
      isLocal ? `\u{1F4E6} *Package:* 8hr / 80km local` : `\u{23F1} *Duration:* ${days} day${days > 1 ? 's' : ''}`,
      form.estimatedKm ? `\u{1F6E3} Distance: ${form.estimatedKm} km${form.isRoundTrip ? ' (round trip)' : ''}` : '',
      '', `\u{1F4B0} *Total Amount: ${fmt(total)}*`, '',
      '_Toll, parking & taxes extra. 50% advance to confirm._',
      '_Valid for 7 days. — Topz Cab Services_',
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, '_blank')
    toast.success('Opening WhatsApp...')
  }

  function reset() {
    setForm(EMPTY); setSelectedVehicle(null); setResult(null); setLocalResult(null)
    setSavedQuoteNo(''); setSaved(false); setVehicleOpen(false)
  }

  const showSummary = selectedVehicle && (result || localResult)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>New Quotation</h1>
        <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Main booking card */}
      <div className="glass-card rounded-2xl overflow-hidden">

        {/* ── Row 1: Vehicle + Trip type + Round trip ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 gap-4 flex-wrap">
          {/* Vehicle selector */}
          <div className="relative">
            <button
              onClick={() => setVehicleOpen(o => !o)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all min-w-[200px]"
              style={{
                background: selectedVehicle ? 'rgba(201,168,64,0.08)' : 'var(--glass-bg)',
                borderColor: selectedVehicle ? 'rgba(201,168,64,0.5)' : 'var(--glass-border)',
              }}
            >
              <Car className="w-5 h-5 shrink-0" style={{ color: '#f0c040' }} />
              <div className="text-left flex-1">
                <p className="font-bold text-base leading-tight" style={{ color: 'var(--text-base)' }}>
                  {selectedVehicle ? selectedVehicle.name : 'Select Vehicle'}
                </p>
                {selectedVehicle && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedVehicle.seats} seats · {selectedVehicle.category}</p>
                )}
              </div>
              <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)', transform: vehicleOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {/* Vehicle dropdown */}
            {vehicleOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 rounded-2xl border shadow-2xl z-50 overflow-hidden"
                style={{ background: 'var(--surface)', borderColor: 'var(--glass-border)' }}>
                <div className="p-2 border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  <p className="text-xs px-2 py-1 font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {passengers > 0 ? `Suggested for ${passengers} passengers` : 'All vehicles'}
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {(passengers > 0 ? suggested : vehicles).map(v => {
                    const rate = isLocal ? v.localRate : v.perDayRate
                    return (
                      <button
                        key={v.name}
                        onClick={() => handleVehicleSelect(v)}
                        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gold-500/10 transition-colors border-b last:border-b-0"
                        style={{ borderColor: 'var(--glass-border)' }}
                      >
                        <div>
                          <p className="font-medium text-sm" style={{ color: 'var(--text-base)' }}>{v.name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.seats} seats · {v.category}</p>
                        </div>
                        <span className="text-sm font-bold" style={{ color: '#f0c040' }}>{fmt(rate)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {/* Trip type pills */}
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              {(['outstation', 'local'] as TripType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTripType(t)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={form.tripType === t
                    ? { background: 'rgba(240,192,64,0.15)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.4)' }
                    : { color: 'var(--text-muted)', border: '1px solid transparent' }
                  }
                >
                  {t === 'outstation' ? <ArrowLeftRight className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                  {t === 'outstation' ? 'Outstation' : 'Local 8hr'}
                </button>
              ))}
            </div>

            {/* Round trip toggle */}
            {!isLocal && (
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  onClick={() => setForm(f => ({ ...f, isRoundTrip: !f.isRoundTrip }))}
                  className="relative transition-colors"
                  style={{
                    width: 44, height: 24, borderRadius: 12,
                    background: form.isRoundTrip ? '#f0c040' : 'rgba(255,255,255,0.1)',
                    border: `1px solid ${form.isRoundTrip ? '#f0c040' : 'rgba(255,255,255,0.15)'}`,
                  }}
                >
                  <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform block"
                    style={{ transform: `translateX(${form.isRoundTrip ? '22px' : '3px'})` }} />
                </div>
                <span className="text-sm font-medium" style={{ color: form.isRoundTrip ? '#f0c040' : 'var(--text-muted)' }}>
                  Round trip
                </span>
              </label>
            )}
          </div>
        </div>

        {/* ── Row 2: Pickup / Drop location bar ── */}
        <div className="mx-5 mb-4 flex rounded-xl overflow-hidden border-2 transition-all"
          style={{ borderColor: 'rgba(201,168,64,0.25)' }}>
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <MapPin className="w-4 h-4" style={{ color: '#f0c040' }} />
            </div>
            <input
              type="text" value={form.pickupLocation} onChange={set('pickupLocation')}
              placeholder="Pickup location"
              className="w-full py-3.5 pl-9 pr-4 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--text-base)' }}
            />
            <label className="absolute bottom-1 left-9 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>From</label>
          </div>
          <div className="w-px self-stretch my-2" style={{ background: 'var(--glass-border)' }} />
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <MapPin className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <input
              type="text" value={form.dropLocation} onChange={set('dropLocation')}
              placeholder={isLocal ? 'Drop location (optional)' : 'Drop location'}
              className="w-full py-3.5 pl-9 pr-4 text-sm bg-transparent focus:outline-none"
              style={{ color: 'var(--text-base)' }}
            />
            <label className="absolute bottom-1 left-9 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>To</label>
          </div>
        </div>

        {/* ── Row 3: Date / Passengers / KM ── */}
        <div className="mx-5 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InputBox label={isLocal ? 'Trip Date' : 'Pickup Date'} icon={<Calendar className="w-3.5 h-3.5" />}>
            <input type="date" value={form.pickupDate} onChange={set('pickupDate')}
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>

          {!isLocal && (
            <InputBox label="Drop Date" icon={<Calendar className="w-3.5 h-3.5" />}>
              <input type="date" value={form.dropDate} onChange={set('dropDate')} min={form.pickupDate}
                className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
            </InputBox>
          )}

          <InputBox label="Passengers" icon={<Users className="w-3.5 h-3.5" />}>
            <input type="number" min="1" value={form.passengers} onChange={set('passengers')} placeholder="0"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>

          <InputBox label={isLocal ? 'Est. KM (default 80)' : 'Est. Total KM'} icon={<Navigation className="w-3.5 h-3.5" />}>
            <div className="flex items-center gap-1">
              <input type="number" min="0" value={form.estimatedKm} onChange={handleKmChange}
                placeholder={isLocal ? '80' : '—'}
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
              {form.pickupLocation && form.dropLocation && (
                <button onClick={fetchDistance} disabled={distLoading}
                  className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040' }}>
                  {distLoading ? '...' : 'Auto'}
                </button>
              )}
            </div>
          </InputBox>
        </div>

        {/* ── Row 4: Client details ── */}
        <div className="mx-5 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InputBox label="Client Name" icon={null}>
            <input type="text" value={form.clientName} onChange={set('clientName')} placeholder="Full name"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
          <InputBox label="Phone" icon={null}>
            <input type="text" value={form.clientPhone} onChange={set('clientPhone')} placeholder="+91 00000 00000"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
          <InputBox label="Email (optional)" icon={null}>
            <input type="email" value={form.clientEmail} onChange={set('clientEmail')} placeholder="—"
              className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--text-base)' }} />
          </InputBox>
        </div>

        {/* Info bar */}
        {(!isLocal && days > 0 && form.pickupDate && form.dropDate) && (
          <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa' }}>
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>{days} day{days > 1 ? 's' : ''}</strong> &middot; {form.pickupDate} → {form.dropDate}
              {form.isRoundTrip && <span className="ml-2 px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040' }}>RT</span>}
            </span>
          </div>
        )}
        {isLocal && (
          <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)', color: '#f0c040' }}>
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span><strong>Local Package: 8 hours / 80 km included</strong> &middot; Extra km charged at vehicle rate</span>
          </div>
        )}

        {/* Get Quote button (when no vehicle selected) */}
        {!selectedVehicle && (
          <div className="mx-5 mb-5">
            <button
              onClick={() => setVehicleOpen(true)}
              disabled={!form.pickupLocation || !form.passengers}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e' }}
            >
              <Car className="w-4 h-4" /> Choose Vehicle & Get Quote <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Quotation Summary ── */}
      {showSummary && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-bold text-base" style={{ color: 'var(--text-base)' }}>Quotation Summary</h2>
              {savedQuoteNo && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{savedQuoteNo}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={saved
                  ? { background: 'rgba(52,211,153,0.15)', borderColor: 'rgba(52,211,153,0.4)', color: '#34d399' }
                  : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }
                }>
                {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Saved!' : 'Save'}
              </button>
              <button onClick={handleWhatsApp}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={{ background: 'rgba(37,211,102,0.12)', borderColor: 'rgba(37,211,102,0.4)', color: '#25d366' }}>
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button onClick={handlePrint} className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold">
                <Printer className="w-4 h-4" /> Print PDF
              </button>
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Vehicle', value: selectedVehicle.name },
              isLocal ? { label: 'Package', value: '8hr / 80km' } : { label: 'Days', value: `${days} day${days > 1 ? 's' : ''}` },
              { label: 'Total KM', value: `${result?.totalKm ?? localResult?.actualKm ?? 0} km` },
              { label: 'Passengers', value: form.passengers || '—' },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Breakdown */}
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--glass-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result && (
                  <>
                    <Row label={`Base rate: ${fmt(selectedVehicle.perDayRate)}/day × ${result.days} day${result.days > 1 ? 's' : ''} (incl. ${result.minKm} km)`} value={fmt(result.baseCost)} />
                    {result.extraKm > 0 && <Row label={`Extra km: ${result.extraKm} km × ₹${selectedVehicle.ratePerKm}/km`} value={fmt(result.extraKmCost)} />}
                  </>
                )}
                {localResult && (
                  <>
                    <Row label={`Local package: 8hr / 80km (${fmt(selectedVehicle.localRate)})`} value={fmt(localResult.baseCost)} />
                    {localResult.extraKm > 0 && <Row label={`Extra km: ${localResult.extraKm} km × ₹${selectedVehicle.ratePerKm}/km`} value={fmt(localResult.extraKmCost)} />}
                  </>
                )}
                <tr style={{ background: 'rgba(201,168,64,0.08)', borderTop: '1px solid var(--glass-border)' }}>
                  <td className="px-4 py-3 font-bold text-sm" style={{ color: 'var(--text-base)' }}>Total</td>
                  <td className="px-4 py-3 font-bold text-right text-gold-400 text-lg">{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-xs space-y-1 px-1" style={{ color: 'var(--text-muted)' }}>
            {result && <p>&bull; Minimum {selectedVehicle.minKmPerDay} km/day applies. Toll, parking &amp; state taxes extra.</p>}
            {localResult && <p>&bull; Local package: 8 hours &amp; 80 km included. Extra km at &#8377;{selectedVehicle.ratePerKm}/km.</p>}
            <p>&bull; GST applicable as per government norms. Rate valid for {form.isRoundTrip ? 'round trip' : 'one-way'} trip only.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function InputBox({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border px-3 pt-2 pb-2.5 transition-colors"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
      <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        {icon}<span>{label}</span>
      </label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
      <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--text-base)' }}>{label}</td>
      <td className="px-4 py-2.5 text-sm text-right font-medium" style={{ color: 'var(--text-base)' }}>{value}</td>
    </tr>
  )
}
