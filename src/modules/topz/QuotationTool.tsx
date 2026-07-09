import { useState, useRef } from 'react'
import { MapPin, Calendar, Users, Car, Printer, RotateCcw, ChevronRight, Navigation } from 'lucide-react'
import { getVehicles, calculateQuotation, getSuggestedVehicles, daysBetween, type Vehicle, type QuotationResult } from './data/rateCard'
import { printQuotation } from './printQuotation'

interface FormState {
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
  clientName: '', clientPhone: '', clientEmail: '',
  pickupDate: '', pickupLocation: '', dropDate: '', dropLocation: '',
  passengers: '', estimatedKm: '',
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

export function QuotationTool() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [result, setResult] = useState<QuotationResult | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    if (k === 'passengers') { setSelectedVehicle(null); setResult(null) }
  }

  const passengers = parseInt(form.passengers) || 0
  const vehicles = getVehicles()
  const suggested = passengers > 0 ? getSuggestedVehicles(passengers, vehicles) : []
  const days = form.pickupDate && form.dropDate ? daysBetween(form.pickupDate, form.dropDate) : 0
  const step1Done = form.clientName && form.pickupDate && form.pickupLocation && form.dropDate && form.dropLocation && form.passengers

  function handleVehicleSelect(v: Vehicle) {
    setSelectedVehicle(v)
    const km = parseInt(form.estimatedKm) || days * v.minKmPerDay
    setResult(calculateQuotation(v, days, km))
    setStep(3)
  }

  function handleKmChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, estimatedKm: e.target.value }))
    if (selectedVehicle && days > 0) {
      const km = parseInt(e.target.value) || days * selectedVehicle.minKmPerDay
      setResult(calculateQuotation(selectedVehicle, days, km))
    }
  }

  function handlePrint() {
    if (!selectedVehicle || !result) return
    printQuotation({ form, vehicle: selectedVehicle, result, days })
  }

  const [distLoading, setDistLoading] = useState(false)

  async function fetchDistance() {
    if (!form.pickupLocation || !form.dropLocation) return
    setDistLoading(true)
    try {
      const r = await fetch(`/api/distance?from=${encodeURIComponent(form.pickupLocation)}&to=${encodeURIComponent(form.dropLocation)}`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      const km: number = d.km
      setForm(f => ({ ...f, estimatedKm: String(km) }))
      if (selectedVehicle && days > 0) setResult(calculateQuotation(selectedVehicle, days, km))
    } catch (e: any) {
      alert('Could not fetch distance: ' + e.message)
    } finally {
      setDistLoading(false)
    }
  }

  function reset() {
    setForm(EMPTY); setSelectedVehicle(null); setResult(null); setStep(1)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>New Quotation</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Outstation trip quotation generator</p>
        </div>
        <button onClick={reset} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-800/60 text-gray-400 hover:text-gray-200 border border-gray-700/50 transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {/* Step 1 — Trip Details */}
      <div className="glass-card rounded-2xl p-5 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">1</span>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>Trip & Client Details</h2>
        </div>

        {/* Client */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Client Name *" value={form.clientName} onChange={set('clientName')} placeholder="Full name" />
          <Field label="Phone *" value={form.clientPhone} onChange={set('clientPhone')} placeholder="+91 00000 00000" />
          <Field label="Email" value={form.clientEmail} onChange={set('clientEmail')} placeholder="Optional" />
        </div>

        {/* Pickup */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Pickup Date *" type="date" value={form.pickupDate} onChange={set('pickupDate')} icon={<Calendar className="w-3.5 h-3.5" />} />
          <Field label="Pickup Location *" value={form.pickupLocation} onChange={set('pickupLocation')} placeholder="City / address" icon={<MapPin className="w-3.5 h-3.5" />} />
        </div>

        {/* Drop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Drop Date *" type="date" value={form.dropDate} onChange={set('dropDate')} min={form.pickupDate} icon={<Calendar className="w-3.5 h-3.5" />} />
          <Field label="Drop Location *" value={form.dropLocation} onChange={set('dropLocation')} placeholder="City / address" icon={<MapPin className="w-3.5 h-3.5" />} />
        </div>

        {/* Passengers + KM */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="No. of Passengers *" type="number" min="1" value={form.passengers} onChange={set('passengers')} placeholder="e.g. 12" icon={<Users className="w-3.5 h-3.5" />} />
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Estimated Total KM (optional)</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="number" min="0" value={form.estimatedKm} onChange={handleKmChange}
                  placeholder={days > 0 ? `Min ${days * 300} km for ${days} day${days > 1 ? 's' : ''}` : 'Enter after dates'}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
                  onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
                />
              </div>
              <button
                type="button"
                onClick={fetchDistance}
                disabled={distLoading || !form.pickupLocation || !form.dropLocation}
                title="Auto-detect road distance via OpenStreetMap (free)"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-40"
                style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
              >
                <Navigation className="w-3.5 h-3.5" />
                {distLoading ? 'Fetching...' : 'Auto KM'}
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Or click Auto KM to calculate road distance using OpenStreetMap (free)</p>
          </div>
        </div>

        {days > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-800/30">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs text-blue-300">
              <strong>{days} day{days > 1 ? 's' : ''}</strong> — {form.pickupDate} to {form.dropDate} · Minimum {days * 300} km
            </span>
          </div>
        )}

        {step1Done && step === 1 && (
          <button
            onClick={() => setStep(2)}
            className="btn-primary flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold"
          >
            Select Vehicle <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Step 2 — Vehicle Selection */}
      {(step >= 2 || selectedVehicle) && passengers > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">2</span>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>
              Select Vehicle
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>Showing vehicles for {passengers} passenger{passengers > 1 ? 's' : ''}</span>
            </h2>
          </div>

          {suggested.length === 0 && (
            <p className="text-sm text-red-400">No vehicles available for {passengers} passengers.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {suggested.map(v => {
              const isSelected = selectedVehicle?.name === v.name
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
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{v.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{v.seats} seats</span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{v.category}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>₹{v.ratePerKm}/km</span>
                    <span className="font-bold text-gold-400">{fmt(v.perDayRate)}<span className="text-xs font-normal text-gray-500">/day</span></span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Show all vehicles toggle */}
          <details className="mt-2">
            <summary className="text-xs text-gold-400 cursor-pointer hover:text-gold-300 flex items-center gap-1">
              <Car className="w-3.5 h-3.5" /> Show all {vehicles.length} vehicles
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              {vehicles.map(v => {
                const isSelected = selectedVehicle?.name === v.name
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
                    <span className="text-gold-400 font-semibold">{fmt(v.perDayRate)}/day</span>
                  </button>
                )
              })}
            </div>
          </details>
        </div>
      )}

      {/* Step 3 — Quotation Result */}
      {step === 3 && selectedVehicle && result && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 text-xs font-bold flex items-center justify-center">3</span>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>Quotation Summary</h2>
            </div>
            <button
              onClick={handlePrint}
              className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
          </div>

          {/* Trip summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Vehicle', value: selectedVehicle.name },
              { label: 'Days', value: `${result.days} day${result.days > 1 ? 's' : ''}` },
              { label: 'Total KM', value: `${result.totalKm} km` },
              { label: 'Passengers', value: form.passengers },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Price breakdown */}
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--glass-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <Row label={`Base rate: ${fmt(selectedVehicle.perDayRate)}/day × ${result.days} day${result.days > 1 ? 's' : ''} (incl. ${result.minKm} km)`} value={fmt(result.baseCost)} />
                {result.extraKm > 0 && (
                  <Row label={`Extra km: ${result.extraKm} km × ₹${selectedVehicle.ratePerKm}/km`} value={fmt(result.extraKmCost)} />
                )}
                <tr style={{ background: 'rgba(201,168,64,0.08)', borderTop: '1px solid var(--glass-border)' }}>
                  <td className="px-4 py-3 font-bold text-sm" style={{ color: 'var(--text-base)' }}>Total</td>
                  <td className="px-4 py-3 font-bold text-right text-gold-400 text-base">{fmt(result.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Notes */}
          <div className="text-xs space-y-1 px-1" style={{ color: 'var(--text-muted)' }}>
            <p>• Minimum {selectedVehicle.minKmPerDay} km/day applies. Toll, parking & state taxes extra.</p>
            {selectedVehicle.permitPerDay > 0 && <p>• Permit: {fmt(selectedVehicle.permitPerDay)}/day · Driver allowance: {fmt(selectedVehicle.driverAllowancePerDay)}/day (included in base rate).</p>}
            <p>• Rate valid for outstation trips only. GST applicable as per government norms.</p>
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



