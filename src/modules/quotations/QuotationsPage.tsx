import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FileText, ChevronRight } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { QuotationForm } from './QuotationForm'
import { db, collection, query, orderBy, onSnapshot } from '../../lib/firebase'
import { QUOTATION_STATUS_CONFIG, formatCurrency, formatDate } from '../../lib/utils'
import type { Quotation } from '../../types'
import { useAuth } from '../../contexts/AuthContext'

export function QuotationsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)

  const canCreate = ['super_admin', 'management', 'dept_head', 'project_manager'].includes(role || '')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'quotations'), orderBy('createdAt', 'desc')),
      snap => {
        setQuotations(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Quotation))
        setLoading(false)
      },
      err => { console.error(err); setLoading(false) }
    )
    return unsub
  }, [])

  const filtered = quotations.filter(q =>
    !search ||
    q.quotationCode.toLowerCase().includes(search.toLowerCase()) ||
    (q.customerName || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalSent = quotations.filter(q => q.status === 'sent_to_customer' || q.status === 'customer_approved')
  const totalApproved = quotations.filter(q => q.status === 'customer_approved')
  const pendingApproval = quotations.filter(q => q.status === 'pending_approval')

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Quotations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {quotations.length} total · {pendingApproval.length} pending approval · {totalApproved.length} approved
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>
            New Quotation
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Sent', value: totalSent.length },
          { label: 'Approved', value: totalApproved.length },
          { label: 'Pending Approval', value: pendingApproval.length },
          {
            label: 'Approved Value',
            value: formatCurrency(totalApproved.reduce((s, q) => s + q.total, 0))
          },
        ].map(s => (
          <Card key={s.label} padding="sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xl font-bold text-gray-100 mt-1">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="max-w-sm">
        <Input
          placeholder="Search by code or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<FileText className="w-6 h-6" />}
            title="No quotations yet"
            description="Create your first quotation from a customer lead."
            action={canCreate ? { label: 'New Quotation', onClick: () => setShowForm(true), icon: <Plus className="w-4 h-4" /> } : undefined}
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map(q => {
            const cfg = QUOTATION_STATUS_CONFIG[q.status]
            return (
              <div
                key={q.id}
                onClick={() => navigate(`/quotations/${q.id}`)}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
              >
                <div className="w-9 h-9 bg-yellow-900/30 rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-200">{q.quotationCode}</p>
                    <span className="text-xs text-gray-600">V{q.version}</span>
                  </div>
                  <p className="text-xs text-gray-500">{q.customerName || 'No customer'} · {q.assignedPMName || '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-100">{formatCurrency(q.total)}</p>
                  <p className="text-xs text-gray-500">Valid till {formatDate(q.validUntil)}</p>
                </div>
                <Badge color={cfg?.color} bg={cfg?.bg} className="shrink-0 hidden sm:flex">
                  {cfg?.label}
                </Badge>
                <ChevronRight className="w-4 h-4 text-gray-700 shrink-0" />
              </div>
            )
          })}
        </div>
      </Card>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Quotation"
        description="Build a quotation for a customer."
        size="2xl"
      >
        <QuotationForm onSuccess={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  )
}
