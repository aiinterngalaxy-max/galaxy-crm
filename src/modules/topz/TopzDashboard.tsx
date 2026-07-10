import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Car, Bus, Users, Pencil, Check, X, RotateCcw, TrendingUp, IndianRupee, CalendarClock, AlertCircle } from 'lucide-react'
import { VEHICLES, getVehicles, setPriceOverride, getPriceOverrides, type VehicleType, type Vehicle } from './data/rateCard'
import { getBookings, getQuotations, type Booking, type SavedQuotation } from './data/storage'
import toast from 'react-hot-toast'

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (key: string) => { const [y, m] = key.split('-'); return new Date(+y, +m - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' }) }

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function TopzDashboard() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [quotes, setQuotes] = useState<SavedQuotation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getBookings(), getQuotations()]).then(([b, q]) => {
      setBookings(b); setQuotes(q); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const now = new Date()
  const thisMonthKey = monthKey(now.toISOString())

  // ── last 6 months bar chart data ─────────────────────────────────────────
  const last6: { key: string; label: string; revenue: number; collected: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bks = bookings.filter(b => monthKey(b.createdAt) === k)
    last6.push({ key: k, label: monthLabel(k), revenue: bks.reduce((s, b) => s + b.totalAmount, 0), collected: bks.reduce((s, b) => s + b.advancePaid, 0) })
  }
  const maxRevenue = Math.max(...last6.map(m => m.revenue), 1)

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const thisMonthBookings = bookings.filter(b => monthKey(b.createdAt) === thisMonthKey)
  const thisRevenue = thisMonthBookings.reduce((s, b) => s + b.totalAmount, 0)
  const thisCollected = thisMonthBookings.reduce((s, b) => s + b.advancePaid, 0)
  const thisPending = thisRevenue - thisCollected
  const collectionRate = thisRevenue > 0 ? Math.round((thisCollected / thisRevenue) * 100) : 0
  const avgBookingValue = bookings.length > 0 ? Math.round(bookings.reduce((s, b) => s + b.totalAmount, 0) / bookings.length) : 0
  const bestMonth = last6.reduce((best, m) => m.revenue > best.revenue ? m : best, last6[0])

  // ── Supplier leaderboard ──────────────────────────────────────────────────
  const supplierMap = new Map<string, { trips: number; revenue: number; pending: number }>()
  bookings.forEach(b => {
    const key = b.supplier?.trim() || '—'
    const prev = supplierMap.get(key) || { trips: 0, revenue: 0, pending: 0 }
    supplierMap.set(key, {
      trips: prev.trips + 1,
      revenue: prev.revenue + b.totalAmount,
      pending: prev.pending + Math.max(0, b.totalAmount - b.advancePaid),
    })
  })
  const allSuppliers = Array.from(supplierMap.entries()).map(([name, s]) => ({ name, ...s }))
  const thisMonthSuppliers = new Map<string, number>()
  thisMonthBookings.forEach(b => {
    const key = b.supplier?.trim() || '—'
    thisMonthSuppliers.set(key, (thisMonthSuppliers.get(key) || 0) + 1)
  })
  const topSuppliersThisMonth = [...thisMonthSuppliers.entries()]
    .map(([name, trips]) => ({ name, trips }))
    .sort((a, b) => b.trips - a.trips).slice(0, 5)
  const mostPendingSupplier = allSuppliers.filter(s => s.name !== '—').sort((a, b) => b.pending - a.pending)[0]

  // ── Alerts ────────────────────────────────────────────────────────────────
  const pendingBalance = bookings.filter(b => b.totalAmount - b.advancePaid > 0)
    .sort((a, b) => (b.totalAmount - b.advancePaid) - (a.totalAmount - a.advancePaid))
  const in7days = bookings.filter(b => {
    const pickup = new Date(b.pickupDate)
    const diff = (pickup.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 7
  }).sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime())
  const staleQuotes = quotes.filter(q => {
    if (q.status !== 'sent') return false
    const age = (now.getTime() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    return age >= 7
  })

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#f0c040', borderTopColor: 'transparent' }} />
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading dashboard…</span>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={() => navigate('/topz/quotation')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e', boxShadow: '0 4px 20px rgba(240,192,64,0.25)' }}>
          <FileText className="w-4 h-4" /> New Quotation
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'This Month Revenue', value: fmt(thisRevenue), sub: `${thisMonthBookings.length} bookings`, color: '#f0c040' },
          { label: 'Collected', value: fmt(thisCollected), sub: `${collectionRate}% collection rate`, color: '#34d399' },
          { label: 'Pending Dues', value: fmt(thisPending), sub: `across ${pendingBalance.length} bookings`, color: thisPending > 0 ? '#f87171' : '#34d399' },
          { label: 'Avg Booking Value', value: fmt(avgBookingValue), sub: `across all time`, color: '#60a5fa' },
        ].map(tile => (
          <div key={tile.label} className="glass-card rounded-2xl p-4 space-y-1">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{tile.label}</p>
            <p className="text-xl font-bold" style={{ color: tile.color }}>{tile.value}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Best month banner */}
      {bestMonth?.revenue > 0 && (
        <div className="glass-card rounded-2xl px-5 py-3 flex items-center gap-3"
          style={{ background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)' }}>
          <TrendingUp className="w-4 h-4 shrink-0" style={{ color: '#f0c040' }} />
          <p className="text-sm" style={{ color: 'var(--text-base)' }}>
            Best month in last 6: <span className="font-bold" style={{ color: '#f0c040' }}>{bestMonth.label}</span>
            {' '}— {fmt(bestMonth.revenue)}
          </p>
        </div>
      )}

      {/* Bar chart + supplier leaderboard */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Revenue bar chart */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Revenue — Last 6 Months</p>
          <div className="flex items-end gap-2 h-36">
            {last6.map(m => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                <p className="text-[9px] font-semibold" style={{ color: '#f0c040' }}>
                  {m.revenue > 0 ? fmt(m.revenue).replace('₹', '') : ''}
                </p>
                <div className="w-full rounded-t-lg relative" style={{ height: `${Math.max(4, (m.revenue / maxRevenue) * 100)}%`, background: m.key === thisMonthKey ? '#f0c040' : 'rgba(240,192,64,0.25)' }}>
                  {m.collected > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 rounded-t-lg" style={{ height: `${(m.collected / m.revenue) * 100}%`, background: 'rgba(52,211,153,0.5)' }} />
                  )}
                </div>
                <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{m.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'rgba(240,192,64,0.25)' }} />Revenue</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.5)' }} />Collected</span>
          </div>
        </div>

        {/* Supplier leaderboard this month */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Top Suppliers This Month</p>
          {topSuppliersThisMonth.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No bookings this month yet.</p>
          ) : topSuppliersThisMonth.map((s, i) => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="text-xs font-black w-5 text-center" style={{ color: '#f0c040' }}>#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-base)' }}>{s.name === '—' ? 'No Supplier' : s.name}</p>
                <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--glass-bg)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(s.trips / topSuppliersThisMonth[0].trips) * 100}%`, background: 'linear-gradient(90deg,#f0c040,#c8960a)' }} />
                </div>
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: '#f0c040' }}>{s.trips} trip{s.trips !== 1 ? 's' : ''}</span>
            </div>
          ))}
          {mostPendingSupplier && mostPendingSupplier.pending > 0 && (
            <div className="mt-2 pt-3 border-t text-xs" style={{ borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
              Most owed to: <span className="font-semibold" style={{ color: '#f87171' }}>{mostPendingSupplier.name}</span> — {fmt(mostPendingSupplier.pending)} pending
            </div>
          )}
        </div>
      </div>

      {/* Alerts row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

        {/* Pending balances */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4" style={{ color: '#f87171' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Pending Collections</p>
            {pendingBalance.length > 0 && <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>{pendingBalance.length}</span>}
          </div>
          {pendingBalance.length === 0 ? (
            <p className="text-xs" style={{ color: '#34d399' }}>All collected ✓</p>
          ) : pendingBalance.slice(0, 4).map(b => (
            <div key={b.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-base)' }}>{b.clientName}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.quoteNo}</p>
              </div>
              <span className="text-xs font-bold shrink-0" style={{ color: '#f87171' }}>{fmt(b.totalAmount - b.advancePaid)}</span>
            </div>
          ))}
          {pendingBalance.length > 4 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>+{pendingBalance.length - 4} more</p>}
        </div>

        {/* Upcoming trips */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Trips in Next 7 Days</p>
            {in7days.length > 0 && <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>{in7days.length}</span>}
          </div>
          {in7days.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No upcoming trips.</p>
          ) : in7days.slice(0, 4).map(b => (
            <div key={b.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-base)' }}>{b.clientName}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{b.pickupLocation} → {b.dropLocation || '—'}</p>
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: '#60a5fa' }}>{fmtDate(b.pickupDate)}</span>
            </div>
          ))}
          {in7days.length > 4 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>+{in7days.length - 4} more</p>}
        </div>

        {/* Stale quotes */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" style={{ color: '#fbbf24' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Quotes Awaiting 7d+</p>
            {staleQuotes.length > 0 && <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>{staleQuotes.length}</span>}
          </div>
          {staleQuotes.length === 0 ? (
            <p className="text-xs" style={{ color: '#34d399' }}>No stale quotes ✓</p>
          ) : staleQuotes.slice(0, 4).map(q => (
            <div key={q.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-base)' }}>{q.clientName}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{q.quoteNo}</p>
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: '#fbbf24' }}>{fmt(q.totalAmount)}</span>
            </div>
          ))}
          {staleQuotes.length > 4 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>+{staleQuotes.length - 4} more</p>}
        </div>
      </div>
    </div>
  )
}

// ── Rate Chart (moved from old dashboard) ─────────────────────────────────────
const CATEGORIES = [
  { type: 'car' as VehicleType,       label: 'Cars',       icon: <Car className="w-7 h-7" />,   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.30)' },
  { type: 'traveller' as VehicleType, label: 'Travellers', icon: <Users className="w-7 h-7" />, color: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)' },
  { type: 'bus' as VehicleType,       label: 'Bus',        icon: <Bus className="w-7 h-7" />,   color: '#f0c040', bg: 'rgba(240,192,64,0.10)',  border: 'rgba(240,192,64,0.30)' },
]

type EditField = 'perDayRate' | 'ratePerKm' | 'permitPerDay' | 'driverAllowancePerDay' | 'localRate'

export function TopzRateChart() {
  const navigate = useNavigate()
  const [activeType, setActiveType] = useState<VehicleType>('car')
  const [editMode, setEditMode] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>(getVehicles)
  const [editCell, setEditCell] = useState<{ name: string; field: EditField } | null>(null)
  const [editVal, setEditVal] = useState('')

  const filtered = vehicles.filter(v => v.type === activeType)
  const activeCat = CATEGORIES.find(c => c.type === activeType)!
  const hasOverrides = Object.keys(getPriceOverrides()).length > 0

  function startEdit(name: string, field: EditField, current: number) {
    setEditCell({ name, field })
    setEditVal(String(current))
  }

  function commitEdit() {
    if (!editCell) return
    const val = parseInt(editVal)
    if (isNaN(val) || val <= 0) { toast.error('Enter a valid amount'); return }
    setPriceOverride(editCell.name, editCell.field, val)
    setVehicles(getVehicles())
    setEditCell(null)
    toast.success('Price updated')
  }

  function cancelEdit() { setEditCell(null) }

  function resetAll() {
    localStorage.removeItem('topz-price-overrides')
    setVehicles(getVehicles())
    toast.success('All prices reset to defaults')
  }

  const PriceCell = useCallback(({ v, field }: { v: Vehicle; field: EditField }) => {
    const val = v[field]
    const isEditing = editCell?.name === v.name && editCell?.field === field
    const defaultVal = VEHICLES.find(d => d.name === v.name)?.[field] ?? val
    const isChanged = val !== defaultVal

    if (!editMode) return (
      <span style={{ color: field === 'perDayRate' ? '#f0c040' : 'var(--text-muted)', fontWeight: field === 'perDayRate' ? 700 : undefined }}>
        {val === 0 && field !== 'perDayRate' ? '—' : `₹${val}`}
        {isChanged && <span className="ml-1 text-xs text-green-400">*</span>}
      </span>
    )

    if (isEditing) return (
      <div className="flex items-center gap-1">
        <input autoFocus type="number" value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
          className="w-20 px-2 py-1 rounded-lg text-sm border outline-none"
          style={{ background: 'var(--input-bg)', borderColor: '#f0c040', color: 'var(--text-base)' }}
        />
        <button onClick={commitEdit} className="text-green-400 hover:text-green-300"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancelEdit} className="text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
      </div>
    )

    return (
      <button onClick={() => startEdit(v.name, field, val)}
        className="flex items-center gap-1 group hover:opacity-80 transition-opacity"
        style={{ color: field === 'perDayRate' ? '#f0c040' : 'var(--text-muted)', fontWeight: field === 'perDayRate' ? 700 : undefined }}>
        {val === 0 && field !== 'perDayRate' ? '—' : `₹${val}`}
        {isChanged && <span className="text-xs text-green-400">*</span>}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, editCell, editVal, vehicles])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-base)' }}>Rate Chart</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Vehicle pricing &middot; Edit rates below</p>
        </div>
        <button onClick={() => navigate('/topz/quotation')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e', boxShadow: '0 4px 20px rgba(240,192,64,0.3)' }}>
          <FileText className="w-4 h-4" /> New Quotation
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {CATEGORIES.map(cat => {
          const count = VEHICLES.filter(v => v.type === cat.type).length
          const isActive = activeType === cat.type
          return (
            <button key={cat.type} onClick={() => setActiveType(cat.type)}
              className="rounded-2xl p-5 text-left transition-all hover:scale-[1.02]"
              style={{ background: isActive ? cat.bg : 'var(--glass-bg)', border: `1.5px solid ${isActive ? cat.border : 'var(--glass-border)'}`, boxShadow: isActive ? `0 0 28px ${cat.bg}` : undefined }}>
              <div className="mb-3" style={{ color: cat.color }}>{cat.icon}</div>
              <p className="font-bold text-base" style={{ color: 'var(--text-base)' }}>{cat.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{count} vehicles</p>
            </button>
          )
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span style={{ color: activeCat.color }}>{activeCat.icon}</span>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{activeCat.label} Rate Card</h2>
            <span className="text-xs text-gray-500">300 km/day minimum</span>
            {hasOverrides && <span className="text-xs text-green-400">* = custom price</span>}
          </div>
          <div className="flex items-center gap-2">
            {hasOverrides && !editMode && (
              <button onClick={resetAll}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border text-red-400 border-red-900/40 hover:bg-red-900/10 transition-colors">
                <RotateCcw className="w-3 h-3" /> Reset to defaults
              </button>
            )}
            <button onClick={() => { setEditMode(e => !e); setEditCell(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
              style={editMode
                ? { background: 'rgba(240,192,64,0.15)', borderColor: 'rgba(240,192,64,0.5)', color: '#f0c040' }
                : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>
              <Pencil className="w-3 h-3" />
              {editMode ? 'Done Editing' : 'Edit Prices'}
            </button>
          </div>
        </div>

        {editMode && (
          <div className="mb-3 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2"
            style={{ background: 'rgba(240,192,64,0.08)', border: '1px solid rgba(240,192,64,0.2)', color: '#f0c040' }}>
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            Click any price cell to edit. Changes save immediately. Press Enter to confirm, Esc to cancel.
          </div>
        )}

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  {['Vehicle', 'Type', 'Seats', 'Rate/km', 'Permit/day', 'Driver Allow.', 'Per Day (300km)', 'Local (8h/80km)'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, i) => (
                  <tr key={v.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{v.name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: activeCat.bg, color: activeCat.color, border: `1px solid ${activeCat.border}` }}>{v.category}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{v.seats}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="ratePerKm" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="permitPerDay" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="driverAllowancePerDay" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="perDayRate" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="localRate" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
