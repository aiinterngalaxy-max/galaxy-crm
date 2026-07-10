import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Trash2, CheckCircle, Send, RotateCcw, Plus, Loader2, Download } from 'lucide-react'
import { getQuotations, deleteQuotation, updateQuotationStatus, saveBooking, type SavedQuotation } from './data/storage'
import { getVehicles } from './data/rateCard'
import { printQuotation } from './printQuotation'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  draft:     { label: 'Draft',     color: '#9ca3af', bg: 'rgba(156,163,175,0.1)' },
  sent:      { label: 'Sent',      color: '#60a5fa', bg: 'rgba(96,165,250,0.1)'  },
  converted: { label: 'Converted', color: '#34d399', bg: 'rgba(52,211,153,0.1)'  },
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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

export function QuotationHistory() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<SavedQuotation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | SavedQuotation['status']>('all')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setQuotes(await getQuotations())
    } catch {
      toast.error('Failed to load quotations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  function handlePrint(q: SavedQuotation) {
    const vehicle = getVehicles().find(v => v.name === q.vehicleName)
    if (!vehicle) { toast.error('Vehicle data not found'); return }
    printQuotation({
      form: {
        clientName: q.clientName,
        clientPhone: q.clientPhone,
        clientEmail: q.clientEmail,
        pickupDate: q.pickupDate,
        pickupTime: '',
        pickupLocation: q.pickupLocation,
        dropDate: q.dropDate,
        dropLocation: q.dropLocation,
        passengers: q.passengers,
        estimatedKm: q.estimatedKm,
        tripType: q.tripType,
        isRoundTrip: q.isRoundTrip,
      },
      vehicle,
      result: null,
      localResult: null,
      days: q.days,
      quoteNo: q.quoteNo,
      overrideTotalAmount: q.totalAmount,
    })
  }

  async function handleDelete(id: string) {
    try {
      await deleteQuotation(id); refresh()
      toast.success('Quote deleted')
    } catch { toast.error('Failed to delete') }
  }

  async function handleStatus(id: string, status: SavedQuotation['status']) {
    try {
      await updateQuotationStatus(id, status); refresh()
      toast.success(`Marked as ${status}`)
    } catch { toast.error('Failed to update') }
  }

  async function handleConvertToBooking(q: SavedQuotation) {
    try {
      await saveBooking({
        id: Math.random().toString(36).slice(2, 10),
        createdAt: new Date().toISOString(),
        quoteNo: q.quoteNo,
        clientName: q.clientName,
        clientPhone: q.clientPhone,
        vehicleName: q.vehicleName,
        pickupDate: q.pickupDate,
        dropDate: q.dropDate,
        pickupLocation: q.pickupLocation,
        dropLocation: q.dropLocation,
        totalAmount: q.totalAmount,
        advancePaid: 0,
        status: 'confirmed',
        notes: '',
        tripType: q.tripType,
      })
      await updateQuotationStatus(q.id, 'converted')
      refresh()
      toast.success('Booking created!')
    } catch { toast.error('Failed to convert') }
  }

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)
  const groups = groupByMonth(filtered)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Quotations</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{quotes.length} quote{quotes.length !== 1 ? 's' : ''} saved</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate('/topz/quotation')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e' }}
          >
            <Plus className="w-4 h-4" /> New Quotation
          </button>
          {(['all', 'draft', 'sent', 'converted'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize"
              style={filter === f
                ? { background: 'rgba(240,192,64,0.15)', borderColor: 'rgba(240,192,64,0.4)', color: '#f0c040' }
                : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }
              }
            >
              {f === 'all' ? `All (${quotes.length})` : f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-12 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#f0c040' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading quotations...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No quotes yet. Click New Quotation to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => {
            const monthTotal = group.items.reduce((s, q) => s + q.totalAmount, 0)
            const converted = group.items.filter(q => q.status === 'converted').length
            return (
              <div key={group.key}>
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-3">
                    <h2 className="font-bold text-sm" style={{ color: 'var(--text-base)' }}>{group.label}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                      {group.items.length} quote{group.items.length !== 1 ? 's' : ''}
                    </span>
                    {converted > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: '#34d399' }}>
                        {converted} converted
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold" style={{ color: '#f0c040' }}>{fmt(monthTotal)}</div>
                </div>

                <div className="glass-card rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                          {['Quote #', 'Date', 'Client', 'Vehicle', 'Trip', 'Total', 'Status', ''].map(h => (
                            <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((q, i) => {
                          const sc = STATUS_CONFIG[q.status]
                          return (
                            <tr key={q.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                              <td className="px-4 py-3 font-mono text-xs" style={{ color: '#f0c040' }}>{q.quoteNo}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(q.createdAt)}</td>
                              <td className="px-4 py-3">
                                <p className="font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{q.clientName}</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{q.clientPhone}</p>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-base)' }}>{q.vehicleName}</td>
                              <td className="px-4 py-3">
                                <span className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{q.tripType}</span>
                                {q.isRoundTrip && <span className="ml-1 text-xs font-semibold" style={{ color: '#f0c040' }}>RT</span>}
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{q.pickupLocation}{q.dropLocation ? ` → ${q.dropLocation}` : ''}</p>
                              </td>
                              <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: '#f0c040' }}>{fmt(q.totalAmount)}</td>
                              <td className="px-4 py-3">
                                <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  {q.status === 'draft' && (
                                    <button onClick={() => handleStatus(q.id, 'sent')} title="Mark as sent" className="p-1.5 rounded-lg hover:bg-blue-900/20 text-blue-400 transition-colors">
                                      <Send className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {q.status !== 'converted' && (
                                    <button onClick={() => handleConvertToBooking(q)} title="Convert to booking" className="p-1.5 rounded-lg hover:bg-green-900/20 text-green-400 transition-colors">
                                      <CheckCircle className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {q.status === 'converted' && (
                                    <button onClick={() => handleStatus(q.id, 'draft')} title="Revert to draft" className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 transition-colors">
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button onClick={() => handlePrint(q)} title="Download PDF" className="p-1.5 rounded-lg hover:bg-yellow-900/20 transition-colors" style={{ color: '#f0c040' }}>
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDelete(q.id)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-900/20 text-red-500 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(240,192,64,0.05)', borderTop: '1px solid var(--glass-border)' }}>
                          <td colSpan={5} className="px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{group.label} total</td>
                          <td className="px-4 py-2 font-bold text-sm" style={{ color: '#f0c040' }}>{fmt(monthTotal)}</td>
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
