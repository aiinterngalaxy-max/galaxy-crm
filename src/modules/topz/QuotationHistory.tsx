import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Trash2, CheckCircle, Send, RotateCcw, Plus } from 'lucide-react'
import { getQuotations, deleteQuotation, updateQuotationStatus, saveBooking, type SavedQuotation } from './data/storage'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  draft:     { label: 'Draft',     color: '#9ca3af', bg: 'rgba(156,163,175,0.1)' },
  sent:      { label: 'Sent',      color: '#60a5fa', bg: 'rgba(96,165,250,0.1)'  },
  converted: { label: 'Converted', color: '#34d399', bg: 'rgba(52,211,153,0.1)'  },
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export function QuotationHistory() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<SavedQuotation[]>(getQuotations)
  const [filter, setFilter] = useState<'all' | SavedQuotation['status']>('all')

  function refresh() { setQuotes(getQuotations()) }

  function handleDelete(id: string) {
    deleteQuotation(id); refresh()
    toast.success('Quote deleted')
  }

  function handleStatus(id: string, status: SavedQuotation['status']) {
    updateQuotationStatus(id, status); refresh()
    toast.success(`Marked as ${status}`)
  }

  function handleConvertToBooking(q: SavedQuotation) {
    saveBooking({
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
    handleStatus(q.id, 'converted')
    toast.success('Booking created from quote!')
  }

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Quotation History</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{quotes.length} quote{quotes.length !== 1 ? 's' : ''} saved</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/topz/quotation')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e' }}
          >
            <Plus className="w-4 h-4" /> New Quotation
          </button>
        <div className="flex items-center gap-2">
          {(['all', 'draft', 'sent', 'converted'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
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
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No quotes yet. Generate one from New Quotation.</p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  {['Quote #', 'Date', 'Client', 'Vehicle', 'Trip', 'Total', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((q, i) => {
                  const sc = STATUS_CONFIG[q.status]
                  return (
                    <tr key={q.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: '#f0c040' }}>{q.quoteNo}</td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(q.createdAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{q.clientName}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{q.clientPhone}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{q.vehicleName}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{q.tripType}</span>
                        {q.isRoundTrip && <span className="ml-1 text-xs" style={{ color: '#f0c040' }}>RT</span>}
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
                          <button onClick={() => handleDelete(q.id)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-900/20 text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
