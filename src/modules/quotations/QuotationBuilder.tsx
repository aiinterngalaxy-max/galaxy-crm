import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Plus, UserPlus, X, Upload, FileImage, Trash2 } from 'lucide-react'
import { RoomCard } from './builder/RoomCard'
import { FloorPlanEditor, type FPZone } from './builder/FloorPlanEditor'
import { PricingSummary } from './builder/PricingSummary'
import { computePricing } from '../../lib/pricingEngine'
import { PRESETS, ACTIVE_PRESETS } from '../../data/presets'
import { formatCurrency } from '../../lib/utils'
import { db, collection, addDoc, getDocs, serverTimestamp, generateQuotationCode } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import type { Customer } from '../../types'

// ── Types ──────────────────────────────────────────────────────────────────────
interface QuoteRoomProduct { productId: string; qty: number }
interface QuoteRoom { id: string; name: string; type: string; products: QuoteRoomProduct[] }
interface CRMProduct { id: string; partCode?: string; name: string; category: string; gsp: number; isActive?: boolean; imageUrl?: string; image?: string }

interface QuoteState {
  customerId: string
  customerName: string
  leadId: string
  validDays: number
  paymentTerms: string
  notes: string
  bhkType: string
  sectionDiscounts: Record<string, number>
  floorPlan: { data: string; mimeType: string; fileName: string } | null
  floorPlanZones: FPZone[]
  rooms: QuoteRoom[]
}

const PAYMENT_TERMS_OPTIONS = [
  { value: '30% advance, 40% on Phase 1, 30% on completion', label: '30-40-30 Milestone' },
  { value: '50% advance, 50% on completion',                  label: '50-50 Advance' },
  { value: '100% advance',                                    label: '100% Advance' },
  { value: 'Custom terms',                                    label: 'Custom' },
]

const STEPS = [
  { id: 'client',    label: 'Client Details' },
  { id: 'floorplan', label: 'Floor Plan' },
  { id: 'rooms',     label: 'Rooms & Products' },
  { id: 'boq',       label: 'BOQ' },
  { id: 'summary',   label: 'Summary' },
]

const makeRoom = (template: { name: string; type: string; products: QuoteRoomProduct[] }): QuoteRoom => ({
  id: crypto.randomUUID(),
  name: template.name,
  type: template.type,
  products: template.products || [],
})

// ── Quick Add Customer ─────────────────────────────────────────────────────────
function QuickAddCustomer({ onCreated, onCancel }: { onCreated: (c: Customer) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name || !phone) { toast.error('Name and phone required'); return }
    setSaving(true)
    try {
      const ref = await addDoc(collection(db, 'customers'), {
        name, phone, email: email || null, address: address || '',
        type: 'residential', tags: [], totalProjectValue: 0, totalPaid: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      toast.success(`Customer "${name}" created`)
      onCreated({ id: ref.id, name, phone, email, address, type: 'residential', tags: [], totalProjectValue: 0, totalPaid: 0, createdAt: null as never, updatedAt: null as never })
    } catch { toast.error('Failed to create customer') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-gray-800/60 border border-indigo-800/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><UserPlus className="w-4 h-4" /> New Customer</p>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[['Full Name *', name, setName], ['Phone *', phone, setPhone], ['Email', email, setEmail], ['Address', address, setAddress]].map(([label, val, setter]) => (
          <div key={label as string}>
            <label className="form-label mb-1">{label as string}</label>
            <input className="form-input" value={val as string} onChange={e => (setter as any)(e.target.value)} placeholder="" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 text-sm rounded-xl border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors">Cancel</button>
        <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-60">
          {saving ? 'Creating…' : 'Create & Select'}
        </button>
      </div>
    </div>
  )
}

// ── Step: Client Details ───────────────────────────────────────────────────────
function ClientStep({ quote, onChange, customers, setCustomers }: {
  quote: QuoteState; onChange: (q: QuoteState) => void; customers: Customer[]; setCustomers: (c: Customer[]) => void
}) {
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const selectedCustomer = customers.find(c => c.id === quote.customerId)

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6">
      <div className="space-y-2">
        <div>
          <label className="form-label mb-1">Customer *</label>
          <div className="flex gap-2">
            <select className="form-input flex-1" value={quote.customerId}
              onChange={e => {
                const c = customers.find(x => x.id === e.target.value)
                onChange({ ...quote, customerId: e.target.value, customerName: c?.name || '' })
              }}>
              <option value="">Select customer…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
            </select>
            <button type="button" onClick={() => setShowQuickAdd(v => !v)}
              className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600/20 border border-indigo-700/50 text-indigo-400 hover:bg-indigo-600/30 transition-colors">
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
          {selectedCustomer && <p className="text-xs text-gray-500 mt-1">{selectedCustomer.phone} · {selectedCustomer.address}</p>}
        </div>
        {showQuickAdd && (
          <QuickAddCustomer
            onCreated={c => { setCustomers([c, ...customers]); onChange({ ...quote, customerId: c.id, customerName: c.name }); setShowQuickAdd(false) }}
            onCancel={() => setShowQuickAdd(false)}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label mb-1">Valid for (days)</label>
          <input type="number" className="form-input" value={quote.validDays}
            onChange={e => onChange({ ...quote, validDays: Number(e.target.value) })} />
        </div>
        <div>
          <label className="form-label mb-1">Payment Terms</label>
          <select className="form-input" value={quote.paymentTerms}
            onChange={e => onChange({ ...quote, paymentTerms: e.target.value })}>
            {PAYMENT_TERMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="form-label mb-1">Notes / Scope of Work</label>
        <textarea className="form-input min-h-[100px] resize-y" value={quote.notes}
          placeholder="Inclusions, exclusions, special requirements…"
          onChange={e => onChange({ ...quote, notes: e.target.value })} />
      </div>
    </div>
  )
}

// ── Step: Floor Plan ───────────────────────────────────────────────────────────
function FloorPlanStep({ quote, onChange, products }: { quote: QuoteState; onChange: (q: QuoteState) => void; products: CRMProduct[] }) {
  const handleFile = (file: File) => {
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp']
    if (!allowed.includes(file.type)) { toast.error('Please upload a JPG or PNG image.'); return }
    if (file.size > 15 * 1024 * 1024) { toast.error('File too large (max 15MB)'); return }
    const reader = new FileReader()
    reader.onload = e => onChange({ ...quote, floorPlan: { data: e.target!.result as string, mimeType: file.type, fileName: file.name }, floorPlanZones: [] })
    reader.readAsDataURL(file)
  }

  const handleZonesChange = (zones: FPZone[]) => {
    const zoneIds = new Set(zones.map(z => z.id))
    const presetRooms = (quote.rooms || []).filter(r => !zoneIds.has(r.id) && !(quote.floorPlanZones || []).some(z => z.id === r.id))
    const zoneRooms: QuoteRoom[] = zones.map(z => {
      const devMap: Record<string, number> = {}
      ;(z.devices || []).forEach(d => { devMap[d.productId] = (devMap[d.productId] || 0) + d.qty })
      return { id: z.id, name: z.name, type: 'Other', products: Object.entries(devMap).map(([productId, qty]) => ({ productId, qty })) }
    })
    onChange({ ...quote, floorPlanZones: zones, rooms: [...presetRooms, ...zoneRooms] })
  }

  if (!quote.floorPlan?.data) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('fp-file-input')?.click()}
          className="rounded-2xl p-16 text-center cursor-pointer border-2 border-dashed border-gray-800 hover:border-indigo-700/50 transition-colors"
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-indigo-900/20 border border-indigo-800/30">
            <Upload className="w-7 h-7 text-indigo-400" />
          </div>
          <p className="text-lg font-bold text-gray-200 mb-2">Upload Floor Plan</p>
          <p className="text-sm text-gray-500 mb-6">JPG or PNG · Max 15MB</p>
          <button type="button" className="px-8 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors">Browse File</button>
          <input id="fp-file-input" type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4 text-center">
          {[['1', 'Upload your floor plan image'], ['2', 'Draw zones around each room'], ['3', 'Drag products from sidebar into zones']].map(([step, text]) => (
            <div key={step} className="px-3 py-4 rounded-2xl bg-gray-900 border border-gray-800">
              <div className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-2 text-xs font-black bg-indigo-900/30 text-indigo-400 border border-indigo-800/30">{step}</div>
              <p className="text-xs text-gray-500">{text}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-gray-600 mt-4">Floor plan is optional — you can skip this step and add rooms manually.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
      <div className="flex items-center justify-between px-5 py-2.5 shrink-0 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-900/20 border border-indigo-800/30">
            <FileImage className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-200">{quote.floorPlan.fileName}</p>
            <p className="text-[10px] text-gray-500">
              {(quote.floorPlanZones || []).length} zone{(quote.floorPlanZones || []).length !== 1 ? 's' : ''} drawn
              {(quote.floorPlanZones || []).length > 0 && ' · synced with Rooms tab'}
            </p>
          </div>
        </div>
        <button onClick={() => onChange({ ...quote, floorPlan: null, floorPlanZones: [] })}
          className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <FloorPlanEditor
          floorPlanData={quote.floorPlan.data}
          zones={quote.floorPlanZones || []}
          onZonesChange={handleZonesChange}
          products={products}
        />
      </div>
    </div>
  )
}

// ── Step: Rooms & Products ─────────────────────────────────────────────────────
function RoomsStep({ quote, onChange, products }: { quote: QuoteState; onChange: (q: QuoteState) => void; products: CRMProduct[] }) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const rooms = quote.rooms || []

  const applyPreset = (key: string) => {
    const preset = PRESETS[key]
    if (!preset) return
    onChange({ ...quote, rooms: preset.rooms.map(makeRoom), bhkType: key, sectionDiscounts: preset.sectionDiscounts })
    setConfirmKey(null)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* Preset selector */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Select Property Type</p>
        <div className="grid grid-cols-3 gap-3">
          {ACTIVE_PRESETS.map(({ key, label, description }) => {
            const isActive = quote.bhkType === key
            return (
              <button key={key} onClick={() => rooms.length > 0 && quote.bhkType !== key ? setConfirmKey(key) : applyPreset(key)}
                className="relative p-4 rounded-2xl text-left transition-all border-2"
                style={isActive ? { background: 'rgba(79,70,229,0.1)', borderColor: '#4f46e5' } : { background: '#111827', borderColor: '#1f2937' }}>
                {isActive && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-indigo-500" />}
                <p className="text-base font-bold mb-1" style={{ color: isActive ? '#818CF8' : '#e5e7eb' }}>{label}</p>
                <p className="text-[10px] leading-relaxed text-gray-500">{description}</p>
                <p className="text-[10px] mt-2 font-semibold" style={{ color: isActive ? '#818CF8' : '#6b7280' }}>
                  {PRESETS[key]?.rooms.length} rooms
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {confirmKey && (
        <div className="rounded-2xl p-4 bg-gray-900 border border-yellow-800/30">
          <p className="text-sm font-semibold text-gray-200 mb-1">Replace existing rooms?</p>
          <p className="text-xs text-gray-500 mb-3">This will remove your {rooms.length} current rooms and load the {PRESETS[confirmKey]?.label} template.</p>
          <div className="flex gap-2">
            <button onClick={() => applyPreset(confirmKey)} className="px-4 py-1.5 text-xs rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">Replace</button>
            <button onClick={() => setConfirmKey(null)} className="px-4 py-1.5 text-xs rounded-xl bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {rooms.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Rooms · {rooms.length}</p>
            <button onClick={() => onChange({ ...quote, rooms: [...rooms, makeRoom({ name: 'New Room', type: 'other', products: [] })] })}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl text-indigo-400 border border-indigo-700/30 bg-indigo-900/20 hover:bg-indigo-900/30 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Room
            </button>
          </div>
          <div className="space-y-2">
            {rooms.map((room, idx) => (
              <RoomCard key={room.id} room={room} index={idx} products={products}
                onChange={updated => onChange({ ...quote, rooms: rooms.map(r => r.id === room.id ? updated : r) })}
                onDelete={() => onChange({ ...quote, rooms: rooms.filter(r => r.id !== room.id) })} />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed border-gray-800">
          <p className="text-sm font-medium text-gray-400 mb-1">Select a property type above to get started</p>
          <p className="text-xs text-gray-600">Or add rooms one by one using the button below</p>
          <button onClick={() => onChange({ ...quote, rooms: [makeRoom({ name: 'New Room', type: 'other', products: [] })] })}
            className="mt-4 flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl text-indigo-400 border border-indigo-700/30 bg-indigo-900/20 hover:bg-indigo-900/30 transition-colors mx-auto">
            <Plus className="w-3.5 h-3.5" /> Add First Room
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step: BOQ ──────────────────────────────────────────────────────────────────
function BOQStep({ quote, onChange, products, pricing }: {
  quote: QuoteState; onChange: (q: QuoteState) => void; products: CRMProduct[]
  pricing: ReturnType<typeof computePricing>
}) {
  const sectionDiscounts = quote.sectionDiscounts || {}

  if (pricing.lineItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-gray-400 font-medium mb-1">No products added yet</p>
          <p className="text-sm text-gray-600">Go back to Rooms and add products to your rooms.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <h3 className="text-base font-semibold text-gray-200">Bill of Quantities</h3>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* BOQ Table */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden border border-gray-800 bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800/80">
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">Sr.</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Part Code</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let srNo = 0
                  const rows: React.ReactNode[] = []
                  // Group items by category
                  const byCategory: Record<string, typeof pricing.lineItems> = {}
                  pricing.lineItems.forEach(item => { if (!byCategory[item.category]) byCategory[item.category] = []; byCategory[item.category].push(item) })
                  // Also show room breakdown
                  const CATEGORY_LABELS: Record<string, string> = { ELYSIA_SWITCHES: 'Elysia Switches', VITRUM_SWITCHES: 'Vitrum Switches', IR_CONTROLLERS: 'IR Controllers', SENSORS: 'Sensors', VDP: 'Video Door Phone', CURTAINS: 'Curtains', LOCKS: 'Smart Locks', LCD_PANELS: 'LCD Panels', NETWORKING: 'Networking', CONTROLLERS: 'Controllers' }

                  Object.entries(byCategory).forEach(([cat, items]) => {
                    const sec = pricing.sections.find(s => s.category === cat)
                    const discPct = sectionDiscounts[cat] ?? 0
                    rows.push(
                      <tr key={`cat-${cat}`} className="bg-gray-800/40">
                        <td colSpan={6} className="px-3 py-2 font-bold text-xs uppercase tracking-wider text-indigo-400">
                          {CATEGORY_LABELS[cat] || cat}
                          {discPct > 0 && <span className="ml-2 text-red-400 font-normal">({discPct}% discount applied)</span>}
                        </td>
                      </tr>
                    )
                    items.forEach(item => {
                      srNo++
                      const disc = discPct / 100
                      const discountedUnit = Math.round(item.unitPrice * (1 - disc))
                      const amount = discountedUnit * item.qty
                      rows.push(
                        <tr key={item.productId} className="border-b border-gray-800">
                          <td className="px-3 py-2.5 text-xs text-gray-600">{srNo}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-200">{item.name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-600 font-mono hidden md:table-cell">{item.partCode}</td>
                          <td className="px-3 py-2.5 text-center text-gray-400">{item.qty}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400">
                            {formatCurrency(item.unitPrice)}
                            {discPct > 0 && <span className="ml-1 text-[10px] text-red-400">−{discPct}%</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-yellow-400">{formatCurrency(amount)}</td>
                        </tr>
                      )
                    })
                    if (sec) {
                      rows.push(
                        <tr key={`sec-total-${cat}`} className="bg-indigo-900/10">
                          <td colSpan={5} className="px-3 py-1.5 text-right text-xs font-semibold text-gray-400">{CATEGORY_LABELS[cat] || cat} — Subtotal</td>
                          <td className="px-3 py-1.5 text-right text-xs font-bold text-yellow-400">{formatCurrency(sec.discountedItemTotal)}</td>
                        </tr>
                      )
                      if (sec.installCharge > 0) {
                        rows.push(
                          <tr key={`install-${cat}`} className="bg-indigo-900/5">
                            <td colSpan={5} className="px-3 py-1 text-right text-xs text-indigo-400">Installation ({Math.round(sec.installRate * 100)}%)</td>
                            <td className="px-3 py-1 text-right text-xs font-semibold text-indigo-400">+{formatCurrency(sec.installCharge)}</td>
                          </tr>
                        )
                      }
                    }
                  })
                  return rows
                })()}
              </tbody>
              <tfoot>
                {pricing.discountAmount > 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-sm text-red-400">Total Discount</td>
                    <td className="px-3 py-2 text-right text-sm text-red-400">−{formatCurrency(pricing.discountAmount)}</td>
                  </tr>
                )}
                {pricing.totalInstallation > 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-1.5 text-right text-sm text-indigo-400">Total Installation & Setup</td>
                    <td className="px-3 py-1.5 text-right text-sm font-semibold text-indigo-400">+{formatCurrency(pricing.totalInstallation)}</td>
                  </tr>
                )}
                <tr className="bg-gray-800/80">
                  <td colSpan={5} className="px-3 py-3 text-right font-bold text-gray-200">Grand Total (excl. GST)</td>
                  <td className="px-3 py-3 text-right font-bold text-lg text-yellow-400">{formatCurrency(pricing.grandSubtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Pricing summary with editable discounts */}
        <PricingSummary
          pricing={pricing}
          sectionDiscounts={sectionDiscounts}
          editable
          onDiscountChange={(cat, val) => onChange({ ...quote, sectionDiscounts: { ...sectionDiscounts, [cat]: val } })}
          onApplyAll={val => {
            const updated: Record<string, number> = {}
            pricing.sections.forEach(s => { updated[s.category] = val })
            onChange({ ...quote, sectionDiscounts: updated })
          }}
        />
      </div>
    </div>
  )
}

// ── Step: Summary ──────────────────────────────────────────────────────────────
function SummaryStep({ quote, pricing, saving, onSave, customers }: {
  quote: QuoteState; pricing: ReturnType<typeof computePricing>; saving: boolean; onSave: () => void; customers: Customer[]
}) {
  const customer = customers.find(c => c.id === quote.customerId)
  const checks = [
    { label: 'Customer selected', ok: !!quote.customerId },
    { label: 'At least 1 room added', ok: (quote.rooms || []).length > 0 },
    { label: 'At least 1 product', ok: pricing.lineItems.length > 0 },
  ]
  const canSave = checks.every(c => c.ok)

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <h3 className="text-base font-semibold text-gray-200">Summary & Save</h3>

      {/* Checklist */}
      <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
        {checks.map(c => (
          <div key={c.label} className={`flex items-center gap-2.5 text-sm ${c.ok ? 'text-green-400' : 'text-yellow-400'}`}>
            <Check className={`w-4 h-4 ${c.ok ? 'text-green-500' : 'text-yellow-500'}`} />
            {c.label}
            {!c.ok && <span className="text-xs text-yellow-600">(required)</span>}
          </div>
        ))}
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Customer', value: customer?.name || '—' },
          { label: 'Property Type', value: quote.bhkType || 'Custom' },
          { label: 'Rooms', value: `${(quote.rooms || []).length} room(s)` },
          { label: 'Floor Plan', value: quote.floorPlan?.fileName || 'Not uploaded' },
          { label: 'Products', value: `${pricing.lineItems.length} product type(s)` },
          { label: 'Valid for', value: `${quote.validDays} days` },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-start gap-3 p-3.5 rounded-xl bg-gray-800/50 border border-gray-800">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm font-semibold text-gray-200 truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Grand total */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-yellow-900/10 border border-yellow-800/30">
        <span className="text-base font-semibold text-gray-200">Grand Total (excl. GST)</span>
        <span className="text-2xl font-bold text-yellow-400">{formatCurrency(pricing.grandSubtotal)}</span>
      </div>

      {/* Pricing summary read-only */}
      <PricingSummary pricing={pricing} sectionDiscounts={quote.sectionDiscounts || {}} editable={false} />

      <div className="flex items-center gap-3 pt-2">
        <button onClick={onSave} disabled={!canSave || saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <Check className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save Quotation'}
        </button>
        {pricing.grandSubtotal >= 200000 && (
          <p className="text-xs text-yellow-400">⚠ Value ≥ ₹2L — will require management approval</p>
        )}
      </div>
      {!canSave && <p className="text-xs text-yellow-500">Complete the required fields before saving.</p>}
    </div>
  )
}

// ── Main QuotationBuilder ──────────────────────────────────────────────────────
export function QuotationBuilder() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<CRMProduct[]>([])
  const [saving, setSaving] = useState(false)

  const [quote, setQuote] = useState<QuoteState>({
    customerId:      searchParams.get('customerId') || '',
    customerName:    '',
    leadId:          searchParams.get('leadId') || '',
    validDays:       30,
    paymentTerms:    PAYMENT_TERMS_OPTIONS[0].value,
    notes:           '',
    bhkType:         '',
    sectionDiscounts: {},
    floorPlan:       null,
    floorPlanZones:  [],
    rooms:           [],
  })

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'products')),
    ]).then(([custSnap, prodSnap]) => {
      const loadedCustomers = custSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Customer)
      setCustomers(loadedCustomers)
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CRMProduct))
      if (searchParams.get('customerId')) {
        const c = loadedCustomers.find(x => x.id === searchParams.get('customerId'))
        if (c) setQuote(q => ({ ...q, customerName: c.name }))
      }
    }).catch(console.error)
  }, [])

  const pricing = useMemo(() => computePricing(quote.rooms, products, quote.sectionDiscounts), [quote.rooms, products, quote.sectionDiscounts])

  const handleSave = async () => {
    if (!quote.customerId || pricing.lineItems.length === 0) { toast.error('Complete required fields'); return }
    setSaving(true)
    try {
      const snap = await getDocs(collection(db, 'quotations'))
      const seq  = snap.size + 1
      const validUntil = new Date()
      validUntil.setDate(validUntil.getDate() + quote.validDays)

      const lineItems = pricing.lineItems.map((item, idx) => ({
        id:          `li_${idx + 1}`,
        productId:   item.productId,
        productName: item.name,
        productSpec: item.partCode,
        quantity:    item.qty,
        unitPrice:   item.unitPrice,
        lineTotal:   item.amount,
      }))

      const status = pricing.grandSubtotal >= 200000 ? 'pending_approval' : 'draft'

      const quotationRef = await addDoc(collection(db, 'quotations'), {
        quotationCode: generateQuotationCode(seq),
        customerId:    quote.customerId,
        customerName:  quote.customerName,
        leadId:        quote.leadId || null,
        version:       1,
        status,
        assignedPM:    user?.id,
        assignedPMName: user?.name,
        validUntil,
        paymentTerms:  quote.paymentTerms,
        notes:         quote.notes,
        bhkType:       quote.bhkType || null,
        rooms:         quote.rooms,
        floorPlanZones: quote.floorPlanZones,
        sectionDiscounts: quote.sectionDiscounts,
        subtotal:      pricing.productSubtotal,
        discountAmount: pricing.discountAmount,
        discountedSubtotal: pricing.discountedSubtotal,
        installationTotal: pricing.totalInstallation,
        total:         pricing.grandSubtotal,
        taxRate:       18,
        taxAmount:     0,
        discount:      pricing.discountAmount,
        lineItems,
        createdBy:     user?.id,
        createdAt:     serverTimestamp(),
        updatedAt:     serverTimestamp(),
      })

      if (quote.customerId) {
        const { doc: d, updateDoc: upd, arrayUnion } = await import('firebase/firestore')
        await upd(d(db, 'customers', quote.customerId), { quotationIds: arrayUnion(quotationRef.id), updatedAt: serverTimestamp() })
      }

      toast.success(status === 'pending_approval' ? 'Quotation sent for management approval (value > ₹2L)' : 'Quotation saved as draft')
      navigate('/quotations')
    } catch (err) {
      toast.error('Failed to save quotation')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const canGoNext = () => {
    if (step === 0) return !!quote.customerId
    return true
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-gray-900 border-b border-gray-800 shrink-0">
        <button onClick={() => navigate('/quotations')} className="p-2 rounded-xl text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-100">New Quotation Builder</h1>
          {quote.customerName && <p className="text-xs text-gray-500">{quote.customerName}</p>}
        </div>
        {pricing.lineItems.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-500">Grand Total</p>
            <p className="text-base font-bold text-yellow-400">{formatCurrency(pricing.grandSubtotal)}</p>
          </div>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 px-6 py-4 bg-gray-900 border-b border-gray-800 shrink-0 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-0">
            <button onClick={() => { if (i < step || (i === step + 1 && canGoNext())) setStep(i) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                i === step ? 'bg-indigo-600 text-white' : i < step ? 'text-indigo-400 hover:bg-indigo-900/20' : 'text-gray-600'
              }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${i < step ? 'bg-indigo-900/40 text-indigo-400' : i === step ? 'bg-white/20' : 'bg-gray-800 text-gray-600'}`}>
                {i < step ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-800 mx-1" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {step === 0 && <ClientStep quote={quote} onChange={setQuote} customers={customers} setCustomers={setCustomers} />}
        {step === 1 && <FloorPlanStep quote={quote} onChange={setQuote} products={products} />}
        {step === 2 && <RoomsStep quote={quote} onChange={setQuote} products={products} />}
        {step === 3 && <BOQStep quote={quote} onChange={setQuote} products={products} pricing={pricing} />}
        {step === 4 && <SummaryStep quote={quote} pricing={pricing} saving={saving} onSave={handleSave} customers={customers} />}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-t border-gray-800 shrink-0">
        <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Previous
        </button>

        <span className="text-xs text-gray-600">{step + 1} / {STEPS.length}</span>

        {step < STEPS.length - 1 ? (
          <button onClick={() => { if (canGoNext()) setStep(s => s + 1); else toast.error('Please select a customer first') }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors text-sm font-semibold">
            Next <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={handleSave} disabled={saving || !quote.customerId || pricing.lineItems.length === 0}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            <Check className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Quotation'}
          </button>
        )}
      </div>
    </div>
  )
}
