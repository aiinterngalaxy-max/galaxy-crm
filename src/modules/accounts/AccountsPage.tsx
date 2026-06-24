import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, Plus, Search, ChevronRight, TrendingDown } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  getDocs, Timestamp
} from '../../lib/firebase'
import { INVOICE_STATUS_CONFIG, formatCurrency, formatDate } from '../../lib/utils'
import type { Invoice, Payment, Customer, Project, PaymentMode } from '../../types'
import toast from 'react-hot-toast'

export function AccountsPage() {
  const { user, role } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // Payment form
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState<PaymentMode>('neft')
  const [payRef, setPayRef] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  const [paySubmitting, setPaySubmitting] = useState(false)

  const canWrite = ['super_admin', 'management', 'accounts'].includes(role || '')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'invoices'), orderBy('createdAt', 'desc')),
      snap => {
        setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice))
        setLoading(false)
      }
    )
    Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'projects')),
    ]).then(([c, p]) => {
      setCustomers(c.docs.map(d => ({ id: d.id, ...d.data() }) as Customer))
      setProjects(p.docs.map(d => ({ id: d.id, ...d.data() }) as Project))
    })
    return unsub
  }, [])

  const filtered = invoices.filter(inv =>
    !search ||
    inv.invoiceCode.toLowerCase().includes(search.toLowerCase()) ||
    (inv.customerName || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalOutstanding = invoices.reduce((s, i) => s + (i.balance || 0), 0)
  const totalCollected = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
  const overdue = invoices.filter(i => i.status === 'overdue')

  const recordPayment = async () => {
    if (!showPaymentModal || !payAmount) return
    setPaySubmitting(true)
    try {
      const invoice = invoices.find(i => i.id === showPaymentModal)
      if (!invoice) return

      const amount = Number(payAmount)
      const newPaid = (invoice.paidAmount || 0) + amount
      const newBalance = invoice.amount - newPaid
      const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid'

      await addDoc(collection(db, 'invoices', showPaymentModal, 'payments'), {
        invoiceId: showPaymentModal,
        amount,
        date: Timestamp.fromDate(new Date(payDate)),
        mode: payMode,
        reference: payRef || null,
        recordedBy: user?.id,
        recordedByName: user?.name,
        createdAt: serverTimestamp(),
      })

      const { updateDocument } = await import('../../lib/firebase')
      await updateDocument('invoices', showPaymentModal, {
        paidAmount: newPaid,
        balance: newBalance,
        status: newStatus,
      })

      setInvoices(prev => prev.map(i =>
        i.id === showPaymentModal
          ? { ...i, paidAmount: newPaid, balance: newBalance, status: newStatus }
          : i
      ))

      toast.success(`Payment of ${formatCurrency(amount)} recorded`)
      setShowPaymentModal(null)
      setPayAmount(''); setPayRef(''); setPayMode('neft')
    } catch {
      toast.error('Failed to record payment')
    } finally {
      setPaySubmitting(false)
    }
  }

  const PAYMENT_MODE_OPTIONS = [
    { value: 'neft', label: 'NEFT / RTGS' },
    { value: 'upi', label: 'UPI' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'cash', label: 'Cash' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {invoices.length} invoices · {overdue.length} overdue
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm"><p className="text-xs text-gray-500">Total Invoiced</p><p className="text-xl font-bold text-gray-100 mt-1">{formatCurrency(invoices.reduce((s, i) => s + i.amount, 0))}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Collected</p><p className="text-xl font-bold text-green-400 mt-1">{formatCurrency(totalCollected)}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Outstanding</p><p className="text-xl font-bold text-yellow-400 mt-1">{formatCurrency(totalOutstanding)}</p></Card>
        <Card padding="sm">
          <p className="text-xs text-gray-500 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-red-400" /> Overdue</p>
          <p className="text-xl font-bold text-red-400 mt-1">{overdue.length}</p>
        </Card>
      </div>

      <div className="max-w-sm">
        <Input
          placeholder="Search by invoice or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title="No invoices yet"
            description="Invoices are created when project milestones are reached."
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map(invoice => {
            const cfg = INVOICE_STATUS_CONFIG[invoice.status]
            const paidPct = invoice.amount > 0 ? Math.round((invoice.paidAmount / invoice.amount) * 100) : 0
            return (
              <div key={invoice.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 bg-violet-900/30 rounded-lg flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-200">{invoice.invoiceCode}</p>
                  <p className="text-xs text-gray-500">{invoice.customerName} · Due {formatDate(invoice.dueDate)}</p>
                  {/* Payment progress */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full max-w-32">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${paidPct}%` }} />
                    </div>
                    <span className="text-xs text-gray-600">{paidPct}% paid</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-100">{formatCurrency(invoice.amount)}</p>
                  <p className="text-xs text-green-400">{formatCurrency(invoice.paidAmount)} paid</p>
                  {invoice.balance > 0 && (
                    <p className="text-xs text-yellow-400">{formatCurrency(invoice.balance)} due</p>
                  )}
                </div>
                <Badge color={cfg?.color} bg={cfg?.bg} className="shrink-0 hidden sm:flex">{cfg?.label}</Badge>
                {canWrite && invoice.status !== 'paid' && (
                  <Button size="sm" variant="secondary" onClick={() => setShowPaymentModal(invoice.id)}>
                    Record Payment
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Record Payment Modal */}
      <Modal
        open={!!showPaymentModal}
        onClose={() => setShowPaymentModal(null)}
        title="Record Payment"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPaymentModal(null)}>Cancel</Button>
            <Button onClick={recordPayment} loading={paySubmitting} variant="success">Record</Button>
          </>
        }
      >
        <div className="space-y-4">
          {showPaymentModal && (() => {
            const inv = invoices.find(i => i.id === showPaymentModal)
            return inv ? (
              <div className="bg-gray-800/50 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-200">{inv.invoiceCode}</p>
                <p className="text-gray-500 mt-0.5">Outstanding: <span className="text-yellow-400 font-semibold">{formatCurrency(inv.balance)}</span></p>
              </div>
            ) : null
          })()}
          <Input label="Amount (₹) *" type="number" placeholder="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
          <Select label="Payment Mode" options={PAYMENT_MODE_OPTIONS} value={payMode} onChange={e => setPayMode(e.target.value as PaymentMode)} />
          <Input label="Reference / Transaction ID" placeholder="Optional" value={payRef} onChange={e => setPayRef(e.target.value)} />
          <Input label="Date" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}
