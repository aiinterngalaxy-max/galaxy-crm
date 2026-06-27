import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, Plus, Search, CheckCircle2, Clock, AlertTriangle, IndianRupee, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { StatCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs, deleteDocument, limit,
} from '../../lib/firebase'
import { formatCurrency, formatDate } from '../../lib/utils'
import type { Invoice, InvoiceStatus, Project } from '../../types'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',          color: 'text-gray-400',   bg: 'bg-gray-800' },
  sent:           { label: 'Sent',           color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  partially_paid: { label: 'Part Paid',      color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  paid:           { label: 'Paid',           color: 'text-green-400',  bg: 'bg-green-900/30' },
  overdue:        { label: 'Overdue',        color: 'text-red-400',    bg: 'bg-red-900/30' },
}

const schema = z.object({
  projectId:    z.string().min(1, 'Select a project'),
  amount:       z.coerce.number().min(1, 'Enter amount'),
  dueDate:      z.string().min(1, 'Select due date'),
  tallyReference: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export function AccountsPage() {
  const navigate = useNavigate()
  const { isAdmin, isManagement, user } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | 'all'>('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const canWrite = isManagement

  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const selectedProjectId = watch('projectId')
  const selectedProject = projects.find(p => p.id === selectedProjectId)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'invoices'), orderBy('createdAt', 'desc'), limit(100)),
      snap => {
        setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice))
        setLoading(false)
      },
      err => { console.error(err); setLoading(false) }
    )
    return unsub
  }, [])

  useEffect(() => {
    getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(100)))
      .then(snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Project)))
      .catch(console.error)
  }, [])

  const nextInvoiceCode = async () => {
    const snap = await getDocs(collection(db, 'invoices'))
    return `INV-${String(snap.size + 1).padStart(4, '0')}`
  }

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    try {
      const project = projects.find(p => p.id === data.projectId)
      const code = await nextInvoiceCode()
      await addDoc(collection(db, 'invoices'), {
        invoiceCode: code,
        projectId: data.projectId,
        customerId: project?.customerId || '',
        customerName: project?.customerName || '',
        status: 'draft' as InvoiceStatus,
        amount: data.amount,
        paidAmount: 0,
        balance: data.amount,
        dueDate: data.dueDate,
        tallyReference: data.tallyReference || null,
        createdBy: user?.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success(`Invoice ${code} created`)
      reset()
      setShowForm(false)
    } catch {
      toast.error('Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  const markSent = async (inv: Invoice) => {
    try {
      await updateDoc(doc(db, 'invoices', inv.id), { status: 'sent', updatedAt: serverTimestamp() })
      toast.success('Marked as sent')
    } catch {
      toast.error('Failed to update')
    }
  }

  const recordPayment = async (inv: Invoice) => {
    const input = window.prompt(`Record payment for ${inv.invoiceCode}\nBalance: ${formatCurrency(inv.balance)}\n\nEnter amount received:`)
    if (!input) return
    const amount = parseFloat(input)
    if (isNaN(amount) || amount <= 0) { toast.error('Invalid amount'); return }
    const newPaid = inv.paidAmount + amount
    const newBalance = inv.amount - newPaid
    const newStatus: InvoiceStatus = newBalance <= 0 ? 'paid' : 'partially_paid'
    try {
      await updateDoc(doc(db, 'invoices', inv.id), {
        paidAmount: newPaid,
        balance: Math.max(0, newBalance),
        status: newStatus,
        updatedAt: serverTimestamp(),
      })
      toast.success(`₹${amount.toLocaleString('en-IN')} recorded`)
    } catch {
      toast.error('Failed to record payment')
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete === id) {
      await deleteDocument('invoices', id)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  const filtered = invoices.filter(inv => {
    const matchStatus = filterStatus === 'all' || inv.status === filterStatus
    const q = search.toLowerCase()
    const matchSearch = !q ||
      inv.invoiceCode.toLowerCase().includes(q) ||
      (inv.customerName || '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  const totalInvoiced    = invoices.reduce((s, i) => s + i.amount, 0)
  const totalCollected   = invoices.reduce((s, i) => s + i.paidAmount, 0)
  const totalOutstanding = invoices.reduce((s, i) => s + i.balance, 0)
  const overdueCount     = invoices.filter(i => i.status === 'overdue').length

  const projectOptions = projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.customerName}` }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Accounts & Invoicing</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {invoices.length} invoices · {overdueCount > 0 ? `${overdueCount} overdue` : 'No overdue'}
          </p>
        </div>
        {canWrite && (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>
            New Invoice
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Invoiced"    value={formatCurrency(totalInvoiced)}    icon={<Receipt className="w-5 h-5 text-blue-400" />}    iconBg="bg-blue-900/30" />
        <StatCard label="Collected"         value={formatCurrency(totalCollected)}   icon={<CheckCircle2 className="w-5 h-5 text-green-400" />} iconBg="bg-green-900/30" />
        <StatCard label="Outstanding"       value={formatCurrency(totalOutstanding)} icon={<IndianRupee className="w-5 h-5 text-yellow-400" />} iconBg="bg-yellow-900/30" />
        <StatCard label="Overdue Invoices"  value={overdueCount}                     icon={<AlertTriangle className="w-5 h-5 text-red-400" />}  iconBg="bg-red-900/30" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search invoice code or customer…"
            leftIcon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as InvoiceStatus | 'all')}
            options={[
              { value: 'all', label: 'All Statuses' },
              ...Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label })),
            ]}
          />
        </div>
      </div>

      {/* Invoice list */}
      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading invoices…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title="No invoices yet"
            description="Create invoices from approved project milestones."
            action={canWrite ? { label: 'New Invoice', onClick: () => setShowForm(true) } : undefined}
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map(inv => {
            const cfg = STATUS_CONFIG[inv.status]
            const pct = inv.amount > 0 ? Math.round((inv.paidAmount / inv.amount) * 100) : 0
            return (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-gray-800/30 transition-colors"
              >
                {/* Icon */}
                <div className="w-9 h-9 bg-blue-900/20 rounded-lg flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4 text-blue-400" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-200">{inv.invoiceCode}</p>
                    <Badge color={cfg.color} bg={cfg.bg}>{cfg.label}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {inv.customerName || '—'}
                    {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}` : ''}
                  </p>
                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden max-w-32">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-600">{pct}% paid</span>
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-100">{formatCurrency(inv.amount)}</p>
                  {inv.balance > 0 && (
                    <p className="text-xs text-red-400">{formatCurrency(inv.balance)} due</p>
                  )}
                </div>

                {/* Actions */}
                {canWrite && (
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {inv.status === 'draft' && (
                      <Button size="sm" variant="secondary" onClick={() => markSent(inv)}>Mark Sent</Button>
                    )}
                    {['sent', 'partially_paid', 'overdue'].includes(inv.status) && (
                      <Button size="sm" variant="success" icon={<IndianRupee className="w-3.5 h-3.5" />} onClick={() => recordPayment(inv)}>
                        Record Payment
                      </Button>
                    )}
                    {isAdmin && (
                      confirmDelete === inv.id ? (
                        <button onClick={e => handleDelete(inv.id, e)} className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">
                          Confirm?
                        </button>
                      ) : (
                        <button onClick={e => handleDelete(inv.id, e)} className="p-1 text-gray-700 hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Create Invoice modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); reset() }}
        title="New Invoice"
        description="Create an invoice linked to a project"
        size="sm"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Select
            label="Project *"
            options={[{ value: '', label: 'Select project…' }, ...projectOptions]}
            error={errors.projectId?.message}
            {...register('projectId')}
          />
          {selectedProject && (
            <div className="text-xs text-gray-500 -mt-2 px-1">
              Customer: {selectedProject.customerName} · Value: {formatCurrency(selectedProject.totalValue)}
            </div>
          )}
          <Input
            label="Invoice Amount (₹) *"
            type="number"
            placeholder="500000"
            error={errors.amount?.message}
            {...register('amount')}
          />
          <Input
            label="Due Date *"
            type="date"
            error={errors.dueDate?.message}
            {...register('dueDate')}
          />
          <Input
            label="Tally Reference"
            placeholder="Optional accounting reference"
            {...register('tallyReference')}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); reset() }}>Cancel</Button>
            <Button type="submit" loading={saving}>Create Invoice</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
