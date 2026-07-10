import { useState, useEffect, useCallback } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { getBookings, type Booking } from './data/storage'
import toast from 'react-hot-toast'

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (key: string) => { const [y, m] = key.split('-'); return new Date(+y, +m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }

interface SupplierMonth {
  month: string
  monthLabel: string
  clients: Booking[]
  total: number
}

interface SupplierSummary {
  name: string
  months: SupplierMonth[]
  totalClients: number
  totalRevenue: number
}

export function Suppliers() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>('all')

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setBookings(await getBookings()) }
    catch { toast.error('Failed to load bookings') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // All months present in bookings
  const allMonths = [...new Set(bookings.map(b => monthKey(b.createdAt)))].sort().reverse()

  const filtered = selectedMonth === 'all' ? bookings : bookings.filter(b => monthKey(b.createdAt) === selectedMonth)

  // Group by supplier
  const supplierMap = new Map<string, Booking[]>()
  for (const b of filtered) {
    const key = b.supplier?.trim() || '—'
    if (!supplierMap.has(key)) supplierMap.set(key, [])
    supplierMap.get(key)!.push(b)
  }

  const suppliers: SupplierSummary[] = Array.from(supplierMap.entries()).map(([name, bks]) => {
    const monthMap = new Map<string, Booking[]>()
    for (const b of bks) {
      const k = monthKey(b.createdAt)
      if (!monthMap.has(k)) monthMap.set(k, [])
      monthMap.get(k)!.push(b)
    }
    const months: SupplierMonth[] = Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mk, clients]) => ({ month: mk, monthLabel: monthLabel(mk), clients, total: clients.reduce((s, b) => s + b.totalAmount, 0) }))
    return { name, months, totalClients: bks.length, totalRevenue: bks.reduce((s, b) => s + b.totalAmount, 0) }
  }).sort((a, b) => b.totalClients - a.totalClients)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Suppliers</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-base)' }}
          >
            <option value="all">All Time</option>
            {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-12 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#f0c040' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No supplier data yet. Convert quotations to bookings with a supplier name.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {suppliers.map(s => (
            <div key={s.name} className="glass-card rounded-2xl overflow-hidden">
              {/* Header row */}
              <button
                onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black shrink-0"
                    style={{ background: 'rgba(240,192,64,0.12)', border: '1px solid rgba(240,192,64,0.25)', color: '#f0c040' }}>
                    {s.name === '—' ? '?' : s.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{s.name === '—' ? 'No Supplier' : s.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.totalClients} client{s.totalClients !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Revenue</p>
                    <p className="font-bold text-sm" style={{ color: '#f0c040' }}>{fmt(s.totalRevenue)}</p>
                  </div>
                  <span className="text-gray-500 text-sm">{expanded === s.name ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded month breakdown */}
              {expanded === s.name && (
                <div className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
                  {s.months.map(m => (
                    <div key={m.month} className="border-b last:border-0" style={{ borderColor: 'var(--glass-border)' }}>
                      <div className="flex items-center justify-between px-5 py-2.5"
                        style={{ background: 'rgba(240,192,64,0.04)' }}>
                        <p className="text-xs font-semibold" style={{ color: '#f0c040' }}>{m.monthLabel}</p>
                        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span>{m.clients.length} booking{m.clients.length !== 1 ? 's' : ''}</span>
                          <span className="font-semibold" style={{ color: '#f0c040' }}>{fmt(m.total)}</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {m.clients.map(b => (
                              <tr key={b.id} className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
                                <td className="px-5 py-2.5 font-medium" style={{ color: 'var(--text-base)' }}>{b.clientName}</td>
                                <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{b.clientPhone}</td>
                                <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{b.vehicleName}</td>
                                <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                                  {b.pickupLocation}{b.dropLocation ? ` → ${b.dropLocation}` : ''}
                                </td>
                                <td className="px-4 py-2.5 font-semibold text-right" style={{ color: '#f0c040' }}>{fmt(b.totalAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
