import { useState } from 'react'
import { MapPin, Calendar, Users, Car, Printer, RotateCcw, ChevronRight, Navigation, MessageCircle, ArrowLeftRight, Package, Save, Check } from 'lucide-react'
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
  const [result, setResult] = useState<QuotationResult | null>(null)
  const [localResult, setLocalResult] = useState<LocalQuotationResult | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [distLoading, setDistLoading] = useState(false)
  const [savedQuoteNo, setSavedQuoteNo] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value
    setForm(f => ({ ...f, [k]: val }))
    if (k === 'passengers') { setSelectedVehicle(null); setResult(null); setLocalResult(null) }
  }

  function setTripType(t: TripType) {
    setForm(f => ({ ...f, tripType: t, isRoundTrip: false, dropDate: '', estimatedKm: '' }))
    setSelectedVehicle(null); setResult(null); setLocalResult(null); setStep(1)
  }

  const passengers = parseInt(form.passengers) || 0
  const vehicles = getVehicles()
  const suggested = passengers > 0 ? getSuggestedVehicles(passengers, vehicles) : []
  const days = form.tripType === 'outstation' && form.pickupDate && form.dropDate
    ? daysBetween(form.pickupDate, form.dropDate) : 1
  const step1Done = form.clientName && form.pickupDate && form.pickupLocation &&
    (form.tripType === 'local' || (form.dropDate && form.dropLocation)) && form.passengers

  function recalc(v: Vehicle, km: number) {
    if (form.tripType === 'outstation') {
      setResult(calculateQuotation(v, days, km))
      setLocalResult(null)
    } else {
      setLocalResult(calculateLocalQuotation(v, km))
      setResult(null)
    }
  }

  function handleVehicleSelect(v: Vehicle) {
    setSelectedVehicle(v)
    const km = parseInt(form.estimatedKm) || (form.tripType === 'outstation' ? days * v.minKmPerDay : 80)
    recalc(v, km)
    setStep(3)
  }

  function handleKmChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, estimatedKm: e.target.value }))
    if (selectedVehicle) {
      const km = parseInt(e.target.value) || 0
      recalc(selectedVehicle, km)
    }
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

  const total = result?.total ?? localResult?.total ?? 0

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
    toast.success('Quote saved to history')
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
    const isOutstation = form.tripType === 'outstation'
    const kmLine = form.estimatedKm ? `\u{1F6E3} Distance: ${form.estimatedKm} km${form.isRoundTrip ? ' (round trip)' : ''}` : ''
    const lines = [
      `*TOPZ CAB — Quotation ${qNo}*`,
      '',
      `\u{1F4CB} *Client:* ${form.clientName}`,
      form.clientPhone ? `\u{1F4DE} *Phone:* ${form.clientPhone}` : '',
      '',
      `\u{1F697} *Vehicle:* ${selectedVehicle.name} (${selectedVehicle.seats} seats)`,
      `\u{1F4C5} *Date:* ${form.pickupDate}`,
      `\u{1F4CD} *Pickup:* ${form.pickupLocation}`,
      form.dropLocation ? `\u{1F4CD} *Drop:* ${form.dropLocation}` : '',
      isOutstation ? `\u{23F1} *Duration:* ${days} day${days > 1 ? 's' : ''}` : `\u{1F4E6} *Package:* 8hr / 80km local`,
      kmLine,
      '',
      `\u{1F4B0} *Total Amount: ${fmt(total)}*`,
      '',
      result && result.extraKm > 0 ? `_(Includes extra ${result.extraKm} km charges)_` : '',
      localResult && localResult.extraKm > 0 ? `_(Includes extra ${localResult.extraKm} km charges)_` : '',
      '',
      '_Toll, parking & taxes extra. 50% advance to confirm._',
      '_Valid for 7 days. — Topz Cab Services_',
    ].filter(Boolean).join('\n')

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, '_blank')
    toast.success('Opening WhatsApp...')
  }

  function reset() {
    setForm(EMPTY); setSelectedVehicle(null); setResult(null); setLocalResult(null)
    setStep(1); setSavedQuoteNo(''); setSaved(false)
  }

  const isLocal = form.tripType === 'local'

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>New Quotation</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Generate a trip quotation for your client</p>
        </div>
        <button onClick={reset} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {/* Trip type toggle */}
      <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        {(['outstation', 'local'] as TripType[]).map(t => (
          <button
            key={t}
            onClick={() => setTripType(t)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize"
            style={form.tripType === t
              ? { background: 'rgba(240,192,64,0.15)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.4)' }
              : { color: 'var(--text-muted)', border: '1px solid transparent' }
            }
          >
            {t === 'outstation' ? <ArrowLeftRight className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
            {t === 'outstation' ? 'Outstation' : 'Local (8hr/80km)'}
          </button>
        ))}
      </div>

      {/* Step 1 */}
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">1</span>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>
            {isLocal ? 'Local Trip & Client Details' : 'Outstation Trip & Client Details'}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Client Name *" value={form.clientName} onChange={set('clientName')} placeholder="Full name" />
          <Field label="Phone *" value={form.clientPhone} onChange={set('clientPhone')} placeholder="+91 00000 00000" />
          <Field label="Email" value={form.clientEmail} onChange={set('clientEmail')} placeholder="Optional" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={isLocal ? 'Trip Date *' : 'Pickup Date *'} type="date" value={form.pickupDate} onChange={set('pickupDate')} icon={<Calendar className="w-3.5 h-3.5" />} />
          <Field label="Pickup Location *" value={form.pickupLocation} onChange={set('pickupLocation')} placeholder="City / address" icon={<MapPin className="w-3.5 h-3.5" />} />
        </div>

        {!isLocal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Drop Date *" type="date" value={form.dropDate} onChange={set('dropDate')} min={form.pickupDate} icon={<Calendar className="w-3.5 h-3.5" />} />
            <Field label="Drop Location *" value={form.dropLocation} onChange={set('dropLocation')} placeholder="City / address" icon={<MapPin className="w-3.5 h-3.5" />} />
          </div>
        )}

        {isLocal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Drop Location (optional)" value={form.dropLocation} onChange={set('dropLocation')} placeholder="City / address" icon={<MapPin className="w-3.5 h-3.5" />} />
          </div>
        )}

        {/* Outstation: round trip toggle */}
        {!isLocal && (
          <label className="flex items-center gap-3 cursor-pointer w-fit select-none">
            <div
              onClick={() => setForm(f => ({ ...f, isRoundTrip: !f.isRoundTrip }))}
              className="w-10 h-5.5 rounded-full relative transition-colors"
              style={{ background: form.isRoundTrip ? '#f0c040' : 'rgba(255,255,255,0.1)', border: `1px solid ${form.isRoundTrip ? '#f0c040' : 'rgba(255,255,255,0.15)'}` }}
            >
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: `translateX(${form.isRoundTrip ? '22px' : '2px'})`, display: 'block' }} />
            </div>
            <span className="text-sm" style={{ color: form.isRoundTrip ? '#f0c040' : 'var(--text-muted)' }}>
              Round Trip <span className="text-xs opacity-70">(KM auto-doubled)</span>
            </span>
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="No. of Passengers *" type="number" min="1" value={form.passengers} onChange={set('passengers')} placeholder="e.g. 12" icon={<Users className="w-3.5 h-3.5" />} />
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
              {isLocal ? 'Estimated KM (optional, package: 80 km)' : 'Estimated Total KM (optional)'}
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number" min="0" value={form.estimatedKm} onChange={handleKmChange}
                  placeholder={isLocal ? 'Default: 80 km' : days > 0 ? `Min ${days * 300} km` : 'Enter after dates'}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
                  onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
                />
              </div>
              {(form.pickupLocation && form.dropLocation) && (
                <button
                  type="button" onClick={fetchDistance} disabled={distLoading}
                  title={form.isRoundTrip ? 'Auto-detect road distance (round trip × 2)' : 'Auto-detect road distance'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-40 shrink-0"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}
                >
                  <Navigation className="w-3.5 h-3.5" />
                  {distLoading ? 'Fetching...' : form.isRoundTrip ? 'Auto KM (RT)' : 'Auto KM'}
                </button>
              )}
            </div>
          </div>
        </div>

        {!isLocal && days > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-800/30">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-blue-300">
              <strong>{days} day{days > 1 ? 's' : ''}</strong> &middot; {form.pickupDate} to {form.dropDate}
              {form.isRoundTrip && <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040' }}>Round Trip</span>}
            </span>
          </div>
        )}

        {isLocal && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gold-900/20 border border-gold-800/30" style={{ background: 'rgba(240,192,64,0.06)', borderColor: 'rgba(240,192,64,0.2)' }}>
            <Package className="w-4 h-4 shrink-0" style={{ color: '#f0c040' }} />
            <span className="text-xs" style={{ color: '#f0c040' }}>
              <strong>Local Package: 8 hours / 80 km</strong> &middot; Extra km charged at vehicle rate
            </span>
          </div>
        )}

        {step1Done && step === 1 && (
          <button onClick={() => setStep(2)} className="btn-primary flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold">
            Select Vehicle <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Step 2 */}
      {(step >= 2 || selectedVehicle) && passengers > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">2</span>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>
              Select Vehicle
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>for {passengers} passenger{passengers > 1 ? 's' : ''}</span>
            </h2>
          </div>

          {suggested.length === 0 && (
            <p className="text-sm text-red-400">No vehicles available for {passengers} passengers.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {suggested.map(v => {
              const isSelected = selectedVehicle?.name === v.name
              const rate = isLocal ? v.localRate : v.perDayRate
              const rateLabel = isLocal ? '8hr pkg' : '/day'
              return (
                <button
                  key={v.name}
                  onClick={() => handleVehicleSelect(v)}
                  className="text-left rounded-xl p-4 border transition-all"
                  style={{
                    background: isSelected ? 'rgba(201,168,64,0.12)' : 'var(--glass-bg)',
                    borderColor: isSelected ? 'rgba(201,168,64,0.6)' : 'var(--glass-border)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{v.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{v.seats} seats</span>
                  </div>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{v.category}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>₹{v.ratePerKm}/km extra</span>
                    <span className="font-bold text-gold-400">{fmt(rate)}<span className="text-xs font-normal text-gray-500"> {rateLabel}</span></span>
                  </div>
                </button>
              )
            })}
          </div>

          <details className="mt-1">
            <summary className="text-xs text-gold-400 cursor-pointer hover:text-gold-300 flex items-center gap-1">
              <Car className="w-3.5 h-3.5" /> Show all {vehicles.length} vehicles
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              {vehicles.map(v => {
                const isSelected = selectedVehicle?.name === v.name
                const rate = isLocal ? v.localRate : v.perDayRate
                return (
                  <button
                    key={v.name}
                    onClick={() => handleVehicleSelect(v)}
                    className="text-left rounded-lg px-3 py-2.5 border text-xs transition-all flex items-center justify-between"
                    style={{
                      background: isSelected ? 'rgba(201,168,64,0.12)' : 'var(--glass-bg)',
                      borderColor: isSelected ? 'rgba(201,168,64,0.6)' : 'var(--glass-border)',
                      color: 'var(--text-base)',
                    }}
                  >
                    <span>{v.name} <span className="text-gray-500">({v.seats}p)</span></span>
                    <span className="text-gold-400 font-semibold">{fmt(rate)}</span>
                  </button>
                )
              })}
            </div>
          </details>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && selectedVehicle && (result || localResult) && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">3</span>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>Quotation Summary</h2>
              {savedQuoteNo && <span className="text-xs text-gray-500">{savedQuoteNo}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={saved
                  ? { background: 'rgba(52,211,153,0.15)', borderColor: 'rgba(52,211,153,0.4)', color: '#34d399' }
                  : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }
                }
              >
                {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Saved!' : 'Save'}
              </button>
              <button
                onClick={handleWhatsApp}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:scale-105"
                style={{ background: 'rgba(37,211,102,0.12)', borderColor: 'rgba(37,211,102,0.4)', color: '#25d366' }}
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button onClick={handlePrint} className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold">
                <Printer className="w-4 h-4" /> Print PDF
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Vehicle', value: selectedVehicle.name },
              isLocal
                ? { label: 'Package', value: '8hr / 80km' }
                : { label: 'Days', value: `${days} day${days > 1 ? 's' : ''}` },
              { label: 'Total KM', value: `${result?.totalKm ?? localResult?.actualKm ?? 0} km` },
              { label: 'Passengers', value: form.passengers },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Breakdown table */}
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
                    <Row
                      label={`Base rate: ${fmt(selectedVehicle.perDayRate)}/day × ${result.days} day${result.days > 1 ? 's' : ''} (incl. ${result.minKm} km)`}
                      value={fmt(result.baseCost)}
                    />
                    {result.extraKm > 0 && (
                      <Row label={`Extra km: ${result.extraKm} km × ₹${selectedVehicle.ratePerKm}/km`} value={fmt(result.extraKmCost)} />
                    )}
                  </>
                )}
                {localResult && (
                  <>
                    <Row label={`Local package: 8hr / 80km (${fmt(selectedVehicle.localRate)})`} value={fmt(localResult.baseCost)} />
                    {localResult.extraKm > 0 && (
                      <Row label={`Extra km: ${localResult.extraKm} km × ₹${selectedVehicle.ratePerKm}/km`} value={fmt(localResult.extraKmCost)} />
                    )}
                  </>
                )}
                <tr style={{ background: 'rgba(201,168,64,0.08)', borderTop: '1px solid var(--glass-border)' }}>
                  <td className="px-4 py-3 font-bold text-sm" style={{ color: 'var(--text-base)' }}>Total</td>
                  <td className="px-4 py-3 font-bold text-right text-gold-400 text-base">{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-xs space-y-1 px-1" style={{ color: 'var(--text-muted)' }}>
            {result && <p>&bull; Minimum {selectedVehicle.minKmPerDay} km/day applies. Toll, parking &amp; state taxes extra.</p>}
            {localResult && <p>&bull; Local package: 8 hours &amp; 80 km included. Extra km at ₹{selectedVehicle.ratePerKm}/km.</p>}
            {selectedVehicle.permitPerDay > 0 && <p>&bull; Permit &amp; driver allowance included in rate.</p>}
            <p>&bull; GST applicable as per government norms. Rate valid for {form.isRoundTrip ? 'round trip' : 'one-way'} trip only.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', icon, min }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string; type?: string; icon?: React.ReactNode; min?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{icon}</span>}
        <input
          type={type} value={value} onChange={onChange} placeholder={placeholder} min={min}
          className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none transition-colors"
          style={{
            background: 'var(--input-bg)', borderColor: 'var(--input-border)',
            color: 'var(--text-base)', paddingLeft: icon ? '2rem' : undefined,
          }}
          onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
        />
      </div>
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
