import { useState } from 'react'
import { Plus, Trash2, X, CalendarCheck } from 'lucide-react'
import { getBookings, saveBooking, deleteBooking, type Booking } from './data/storage'
import toast from 'react-hot-toast'

const STATUS_CONFIG: Record<Booking['status'], { label: string; color: string; bg: string }> = {
  confirmed:   { label: 'Confirmed',   color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  in_progress: { label: 'In Progress', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  completed:   { label: 'Completed',   color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  cancelled:   { label: 'Cancelled',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
}

const uid = () => Math.random().toString(36).slice(2, 10)
const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (key: string) => { const [y, m] = key.split('-'); return new Date(+y, +m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }

function groupByMonth<T extends { createdAt: string }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const map = new Map<string, T[]>()
  for (const item of sorted) {
    const k = monthKey(item.createdAt)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, label: monthLabel(key), items }))
}

const EMPTY_FORM = {
  clientName: '', clientPhone: '', vehicleName: '', pickupDate: '',
  dropDate: '', pickupLocation: '', dropLocation: '', totalAmount: '',
  advancePaid: '', notes: '', tripType: 'outstation' as Booking['tripType'],
}

export function Bookings() {
  const [bookings, setBookings] = useState<Booking[]>(getBookings)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filter, setFilter] = useState<'all' | Booking['status']>('all')

  function refresh() { setBookings(getBookings()) }
  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function handleAdd() {
    if (!form.clientName || !form.clientPhone || !form.vehicleName || !form.pickupDate) {
      toast.error('Client, vehicle, and pickup date are required'); return
    }
    saveBooking({
      id: uid(), createdAt: new Date().toISOString(), quoteNo: '',
      clientName: form.clientName, clientPhone: form.clientPhone,
      vehicleName: form.vehicleName, pickupDate: form.pickupDate,
      dropDate: form.dropDate, pickupLocation: form.pickupLocation,
      dropLocation: form.dropLocation, totalAmount: parseInt(form.totalAmount) || 0,
      advancePaid: parseInt(form.advancePaid) || 0, status: 'confirmed',
      notes: form.notes, tripType: form.tripType,
    })
    setForm(EMPTY_FORM); setShowForm(false); refresh()
    toast.success('Booking confirmed!')
  }

  function handleStatus(id: string, status: Booking['status']) {
    const b = bookings.find(x => x.id === id)
    if (!b) return
    saveBooking({ ...b, status }); refresh()
  }

  function handleDelete(id: string) {
    deleteBooking(id); refresh()
    toast.success('Booking deleted')
  }

  const filtered = filter === 'all' ? bookings : bookings.filter(b => b.status === filter)
  const groups = groupByMonth(filtered)
  const counts = Object.keys(STATUS_CONFIG).reduce((a, k) => ({ ...a, [k]: bookings.filter(b => b.status === k).length }), {} as Record<string, number>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Bookings</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{bookings.length} booking{bookings.length !== 1 ? 's' : ''} total</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e' }}
        >
          <Plus className="w-4 h-4" /> New Booking
        </button>
      </div>

      {/* Status summary — clickable filters */}
      <div className="grid grid-cols-4 gap-3">
        {(Object.entries(STATUS_CONFIG) as [Booking['status'], typeof STATUS_CONFIG[Booking['status']]][]).map(([status, cfg]) => (
          <button
            key={status}
            onClick={() => setFilter(filter === status ? 'all' : status)}
            className="rounded-xl p-3 text-center transition-all hover:scale-[1.02]"
            style={{ background: cfg.bg, border: `1.5px solid ${filter === status ? cfg.color : cfg.color + '30'}` }}
          >
            <p className="text-lg font-bold" style={{ color: cfg.color }}>{counts[status] ?? 0}</p>
            <p className="text-xs mt-0.5" style={{ color: cfg.color }}>{cfg.label}</p>
          </button>
        ))}
      </div>

      {/* Add Booking form */}
      {showForm && (
        <div className="glass-card rounded-2xl p-5 space-y-4 border" style={{ borderColor: 'rgba(240,192,64,0.3)' }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>New Booking</h2>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Client Name *" value={form.clientName} onChange={set('clientName')} placeholder="Full name" />
            <Field label="Phone *" value={form.clientPhone} onChange={set('clientPhone')} placeholder="+91 00000 00000" />
            <Field label="Vehicle *" value={form.vehicleName} onChange={set('vehicleName')} placeholder="e.g. Innova Crysta" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Pickup Date *" type="date" value={form.pickupDate} onChange={set('pickupDate')} />
            <Field label="Drop Date" type="date" value={form.dropDate} onChange={set('dropDate')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Pickup Location" value={form.pickupLocation} onChange={set('pickupLocation')} placeholder="City / address" />
            <Field label="Drop Location" value={form.dropLocation} onChange={set('dropLocation')} placeholder="City / address" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Total Amount (₹)" type="number" value={form.totalAmount} onChange={set('totalAmount')} placeholder="0" />
            <Field label="Advance Paid (₹)" type="number" value={form.advancePaid} onChange={set('advancePaid')} placeholder="0" />
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Trip Type</label>
              <select
                value={form.tripType} onChange={set('tripType')}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
              >
                <option value="outstation">Outstation</option>
                <option value="local">Local (8hr/80km)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Notes</label>
            <textarea
              value={form.notes} onChange={set('notes')} placeholder="Any special requirements..." rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold">Confirm Booking</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="px-4 py-2 rounded-xl text-sm border" style={{ borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Grouped by month */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <CalendarCheck className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {filter === 'all' ? 'No bookings yet. Convert a quotation or add manually.' : `No ${filter.replace('_', ' ')} bookings.`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => {
            const monthRevenue = group.items.reduce((s, b) => s + b.totalAmount, 0)
            const monthAdvance = group.items.reduce((s, b) => s + b.advancePaid, 0)
            const monthDue = monthRevenue - monthAdvance
            const completed = group.items.filter(b => b.status === 'completed').length

            return (
              <div key={group.key}>
                {/* Month header */}
                <div className="flex items-center justify-between mb-3 px-1 flex-wrap gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="font-bold text-sm" style={{ color: 'var(--text-base)' }}>{group.label}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                      {group.items.length} booking{group.items.length !== 1 ? 's' : ''}
                    </span>
                    {completed > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: '#34d399' }}>
                        {completed} completed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Revenue</p>
                      <p className="text-sm font-bold" style={{ color: '#f0c040' }}>{fmt(monthRevenue)}</p>
                    </div>
                    {monthDue > 0 && (
                      <div className="text-right">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Due</p>
                        <p className="text-sm font-bold text-red-400">{fmt(monthDue)}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Table */}
                <div className="glass-card rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                          {['Client', 'Vehicle', 'Trip Date', 'Route', 'Amount', 'Advance', 'Status', ''].map(h => (
                            <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((b, i) => {
                          const sc = STATUS_CONFIG[b.status]
                          const balance = b.totalAmount - b.advancePaid
                          return (
                            <tr key={b.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                              <td className="px-4 py-3">
                                <p className="font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{b.clientName}</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.clientPhone}</p>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-base)' }}>{b.vehicleName}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>
                                {fmtDate(b.pickupDate)}{b.dropDate && b.dropDate !== b.pickupDate ? ` – ${fmtDate(b.dropDate)}` : ''}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                                  {b.pickupLocation}{b.dropLocation ? ` → ${b.dropLocation}` : ''}
                                </p>
                                <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{b.tripType}</p>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <p className="font-semibold text-sm" style={{ color: '#f0c040' }}>{fmt(b.totalAmount)}</p>
                                {balance > 0 && <p className="text-xs text-red-400">Due: {fmt(balance)}</p>}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(b.advancePaid)}</td>
                              <td className="px-4 py-3">
                                <select
                                  value={b.status}
                                  onChange={e => handleStatus(b.id, e.target.value as Booking['status'])}
                                  className="text-xs rounded-lg px-2 py-1.5 border focus:outline-none font-semibold"
                                  style={{ background: sc.bg, borderColor: sc.color + '50', color: sc.color }}
                                >
                                  {Object.entries(STATUS_CONFIG).map(([s, c]) => (
                                    <option key={s} value={s}>{c.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => handleDelete(b.id)} className="p-1.5 rounded-lg hover:bg-red-900/20 text-red-500 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {/* Month subtotal */}
                      <tfoot>
                        <tr style={{ background: 'rgba(240,192,64,0.05)', borderTop: '1px solid var(--glass-border)' }}>
                          <td colSpan={4} className="px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                            {group.label} total
                          </td>
                          <td className="px-4 py-2 font-bold text-sm" style={{ color: '#f0c040' }}>{fmt(monthRevenue)}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(monthAdvance)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none transition-colors"
        style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
        onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
        onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
      />
    </div>
  )
}
