import { useState } from 'react'
import { Plus, Trash2, X, Users } from 'lucide-react'
import { getLeads, saveLead, deleteLead, type Lead } from './data/storage'
import toast from 'react-hot-toast'

const STATUS_CONFIG: Record<Lead['status'], { label: string; color: string; bg: string }> = {
  new:       { label: 'New',       color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  contacted: { label: 'Contacted', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  quoted:    { label: 'Quoted',    color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  converted: { label: 'Converted', color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  lost:      { label: 'Lost',      color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
}

const uid = () => Math.random().toString(36).slice(2, 10)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

const EMPTY_FORM = { name: '', phone: '', email: '', requirement: '', notes: '' }

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>(getLeads)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  function refresh() { setLeads(getLeads()) }

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function handleAdd() {
    if (!form.name || !form.phone || !form.requirement) { toast.error('Name, phone, and requirement are required'); return }
    saveLead({ id: uid(), createdAt: new Date().toISOString(), status: 'new', ...form })
    setForm(EMPTY_FORM); setShowForm(false); refresh()
    toast.success('Lead added')
  }

  function handleStatus(id: string, status: Lead['status']) {
    const lead = leads.find(l => l.id === id)
    if (!lead) return
    saveLead({ ...lead, status }); refresh()
  }

  function handleDelete(id: string) {
    deleteLead(id); refresh()
    toast.success('Lead deleted')
  }

  const counts = Object.keys(STATUS_CONFIG).reduce((acc, k) => {
    acc[k] = leads.filter(l => l.status === k).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-base)' }}>Leads & Enquiries</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{leads.length} lead{leads.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e' }}
        >
          <Plus className="w-4 h-4" /> New Lead
        </button>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-5 gap-3">
        {(Object.entries(STATUS_CONFIG) as [Lead['status'], typeof STATUS_CONFIG[Lead['status']]][]).map(([status, cfg]) => (
          <div key={status} className="rounded-xl p-3 text-center" style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
            <p className="text-lg font-bold" style={{ color: cfg.color }}>{counts[status] ?? 0}</p>
            <p className="text-xs mt-0.5" style={{ color: cfg.color }}>{cfg.label}</p>
          </div>
        ))}
      </div>

      {/* Add Lead form */}
      {showForm && (
        <div className="glass-card rounded-2xl p-5 space-y-4 border" style={{ borderColor: 'rgba(240,192,64,0.3)' }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>New Lead</h2>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Name *" value={form.name} onChange={set('name')} placeholder="Client name" />
            <Field label="Phone *" value={form.phone} onChange={set('phone')} placeholder="+91 00000 00000" />
            <Field label="Email" value={form.email} onChange={set('email')} placeholder="Optional" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Requirement *</label>
            <textarea
              value={form.requirement} onChange={set('requirement')}
              placeholder="e.g. 2-day outstation trip for 20 people, Pune to Shirdi"
              rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none resize-none transition-colors"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
              onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Notes</label>
            <textarea
              value={form.notes} onChange={set('notes')}
              placeholder="Any additional details..."
              rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none resize-none transition-colors"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
              onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold">Save Lead</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="px-4 py-2 rounded-xl text-sm border transition-colors" style={{ borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Leads list */}
      {leads.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No leads yet. Add your first enquiry.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map(lead => {
            const sc = STATUS_CONFIG[lead.status]
            return (
              <div key={lead.id} className="glass-card rounded-xl p-4" style={{ border: '1px solid var(--glass-border)' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{lead.name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(lead.createdAt)}</span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{lead.phone}{lead.email ? ` · ${lead.email}` : ''}</p>
                    <p className="text-sm mt-2" style={{ color: 'var(--text-base)' }}>{lead.requirement}</p>
                    {lead.notes && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>{lead.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={lead.status}
                      onChange={e => handleStatus(lead.id, e.target.value as Lead['status'])}
                      className="text-xs rounded-lg px-2 py-1.5 border focus:outline-none transition-colors"
                      style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
                    >
                      {Object.entries(STATUS_CONFIG).map(([s, c]) => (
                        <option key={s} value={s}>{c.label}</option>
                      ))}
                    </select>
                    <button onClick={() => handleDelete(lead.id)} className="p-1.5 rounded-lg hover:bg-red-900/20 text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        value={value} onChange={onChange} placeholder={placeholder}
        className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none transition-colors"
        style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-base)' }}
        onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
        onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
      />
    </div>
  )
}
