import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserSquare2, ChevronRight, Phone, MapPin } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { db, collection, query, orderBy, onSnapshot } from '../../lib/firebase'
import { formatCurrency, formatDate } from '../../lib/utils'
import type { Customer } from '../../types'

const TAG_STYLES = {
  vip:             { color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  referral_source: { color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  at_risk:         { color: 'text-red-400',     bg: 'bg-red-900/30' },
  repeat:          { color: 'text-green-400',   bg: 'bg-green-900/30' },
}

export function CustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'customers'), orderBy('updatedAt', 'desc')),
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          {filtered.map(customer => (
            <div
              key={customer.id}
              onClick={() => navigate(`/customers/${customer.id}`)}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
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

              <ChevronRight className="w-4 h-4 text-gray-700 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
