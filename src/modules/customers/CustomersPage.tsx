import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserSquare2, ChevronRight, Phone, MapPin, Trash2, CheckCircle2, Clock } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { db, collection, query, orderBy, onSnapshot, limit, where, getDocs } from '../../lib/firebase'
import { trashItem } from '../../lib/trash'
import { formatCurrency } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'
import type { Customer } from '../../types'

// Per-customer roll-up of workflow progress across all their projects, loaded lazily on hover.
interface CustomerProgress {
  projectCount: number
  totalStages: number
  doneStages: number
  done: string[]
  pending: string[]
}

const TAG_STYLES = {
  vip:             { color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  referral_source: { color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  at_risk:         { color: 'text-red-400',     bg: 'bg-red-900/30' },
  repeat:          { color: 'text-green-400',   bg: 'bg-green-900/30' },
}

export function CustomersPage() {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, CustomerProgress | 'loading'>>({})
  const requested = useRef<Set<string>>(new Set())

  // Lazily fetch a customer's projects and their workflow stages the first time
  // the row is hovered, then cache the result so we never re-fetch it.
  async function loadProgress(custId: string) {
    if (requested.current.has(custId)) return
    requested.current.add(custId)
    setProgress(prev => ({ ...prev, [custId]: 'loading' }))
    try {
      const projSnap = await getDocs(query(collection(db, 'projects'), where('customerId', '==', custId)))
      let totalStages = 0
      let doneStages = 0
      const done: string[] = []
      const pending: string[] = []
      await Promise.all(projSnap.docs.map(async pd => {
        const wSnap = await getDocs(collection(db, 'projects', pd.id, 'workflow'))
        wSnap.docs.forEach(w => {
          const s = w.data() as { title?: string; status?: string }
          const title = s.title || 'Untitled stage'
          totalStages++
          if (s.status === 'completed') { doneStages++; done.push(title) }
          else pending.push(title)
        })
      }))
      setProgress(prev => ({
        ...prev,
        [custId]: { projectCount: projSnap.size, totalStages, doneStages, done, pending },
      }))
    } catch (err) {
      console.error(err)
      requested.current.delete(custId) // allow a retry on the next hover
      setProgress(prev => {
        const next = { ...prev }
        delete next[custId]
        return next
      })
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDelete === id) {
      await trashItem('customers', id, user?.id ?? '', user?.name ?? 'Unknown')
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'customers'), orderBy('updatedAt', 'desc'), limit(100)),
      snap => {
        setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Customer))
        setLoading(false)
      },
      err => { console.error(err); setLoading(false) }
    )
    return unsub
  }, [])

  const filtered = customers.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    c.address.toLowerCase().includes(search.toLowerCase())
  )

  const totalValue = customers.reduce((s, c) => s + (c.totalProjectValue || 0), 0)
  const totalCollected = customers.reduce((s, c) => s + (c.totalPaid || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {customers.length} customers · Total value {formatCurrency(totalValue)} · Collected {formatCurrency(totalCollected)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div data-tour="stat-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Customers', value: customers.length },
          { label: 'Portfolio Value', value: formatCurrency(totalValue) },
          { label: 'Amount Collected', value: formatCurrency(totalCollected) },
          { label: 'Outstanding', value: formatCurrency(totalValue - totalCollected) },
        ].map(s => (
          <Card key={s.label} padding="sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xl font-bold text-gray-100 mt-1">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="max-w-sm">
        <Input
          placeholder="Search name, phone, address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading customers…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<UserSquare2 className="w-6 h-6" />}
            title="No customers yet"
            description="Customers are created when a lead's quotation is approved."
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map((customer, idx) => (
            <div
              key={customer.id}
              data-tour={idx === 0 ? 'customer-row' : undefined}
              onClick={() => navigate(`/customers/${customer.id}`)}
              onMouseEnter={() => loadProgress(customer.id)}
              className="group relative flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-indigo-900/50 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                {customer.name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-200">{customer.name}</p>
                  {customer.tags?.map(tag => (
                    <Badge key={tag} color={TAG_STYLES[tag]?.color} bg={TAG_STYLES[tag]?.bg} className="text-xs">
                      {tag.replace('_', ' ')}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</span>
                  {customer.address && (
                    <span className="flex items-center gap-1 truncate max-w-48">
                      <MapPin className="w-3 h-3 shrink-0" />{customer.address}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 hidden sm:block">
                <p className="text-sm font-semibold text-gray-200">{formatCurrency(customer.totalProjectValue)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {customer.totalPaid > 0
                    ? `${formatCurrency(customer.totalPaid)} paid`
                    : 'No payments yet'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isAdmin && (
                  confirmDelete === customer.id ? (
                    <button
                      onClick={e => handleDelete(customer.id, e)}
                      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                    >
                      Confirm?
                    </button>
                  ) : (
                    <button
                      onClick={e => handleDelete(customer.id, e)}
                      className="p-1 text-gray-700 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
                <ChevronRight className="w-4 h-4 text-gray-700" />
              </div>

              <ProgressPopover state={progress[customer.id]} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// Hover card summarising a customer's completed vs. pending workflow stages.
function ProgressPopover({ state }: { state: CustomerProgress | 'loading' | undefined }) {
  return (
    <div className="pointer-events-none absolute left-14 right-4 top-full z-30 -mt-1 hidden group-hover:block">
      <div className="rounded-lg border border-gray-700 bg-gray-950/95 p-3 shadow-xl backdrop-blur">
        {state === undefined || state === 'loading' ? (
          <p className="text-xs text-gray-500">Loading progress…</p>
        ) : state.projectCount === 0 ? (
          <p className="text-xs text-gray-500">No projects yet.</p>
        ) : state.totalStages === 0 ? (
          <p className="text-xs text-gray-500">
            {state.projectCount} project{state.projectCount > 1 ? 's' : ''} · no workflow stages yet.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-200">
                {state.doneStages}/{state.totalStages} stages complete
              </span>
              <span className="text-xs text-gray-500">
                {state.projectCount} project{state.projectCount > 1 ? 's' : ''}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.round((state.doneStages / state.totalStages) * 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-green-400">
                  <CheckCircle2 className="h-3 w-3" /> Completed ({state.done.length})
                </p>
                {state.done.length === 0 ? (
                  <p className="text-[11px] text-gray-600">None yet</p>
                ) : (
                  <ul className="space-y-0.5">
                    {state.done.slice(0, 5).map((t, i) => (
                      <li key={i} className="truncate text-[11px] text-gray-400">{t}</li>
                    ))}
                    {state.done.length > 5 && (
                      <li className="text-[11px] text-gray-600">+{state.done.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-yellow-400">
                  <Clock className="h-3 w-3" /> Pending ({state.pending.length})
                </p>
                {state.pending.length === 0 ? (
                  <p className="text-[11px] text-gray-600">All done 🎉</p>
                ) : (
                  <ul className="space-y-0.5">
                    {state.pending.slice(0, 5).map((t, i) => (
                      <li key={i} className="truncate text-[11px] text-gray-400">{t}</li>
                    ))}
                    {state.pending.length > 5 && (
                      <li className="text-[11px] text-gray-600">+{state.pending.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
