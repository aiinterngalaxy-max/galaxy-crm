import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Phone, Mail, MapPin, FolderKanban, FileText, Receipt, ChevronRight } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { db, doc, getDoc, collection, query, where, getDocs } from '../../lib/firebase'
import { formatCurrency, formatDate, PROJECT_STATUS_CONFIG, QUOTATION_STATUS_CONFIG, INVOICE_STATUS_CONFIG } from '../../lib/utils'
import type { Customer, Project, Quotation, Invoice } from '../../types'
import { PageLoader } from '../../components/ui/LoadingSpinner'

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const [custSnap, projSnap, quotSnap, invSnap] = await Promise.all([
          getDoc(doc(db, 'customers', id!)),
          getDocs(query(collection(db, 'projects'), where('customerId', '==', id))),
          getDocs(query(collection(db, 'quotations'), where('customerId', '==', id))),
          getDocs(query(collection(db, 'invoices'), where('customerId', '==', id))),
        ])
        if (custSnap.exists()) setCustomer({ id: custSnap.id, ...custSnap.data() } as Customer)
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Project))
        setQuotations(quotSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Quotation))
        setInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) return <PageLoader />
  if (!customer) return (
    <div className="text-center py-16 text-gray-500">Customer not found</div>
  )

  const outstanding = invoices.reduce((s, i) => s + (i.balance || 0), 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/customers')} className="text-gray-500 hover:text-gray-300">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">{customer.name}</h1>
          <p className="text-xs text-gray-500 capitalize">{customer.type} · Customer since {formatDate(customer.createdAt)}</p>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm"><p className="text-xs text-gray-500">Total Projects</p><p className="text-xl font-bold text-gray-100 mt-1">{projects.length}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Portfolio Value</p><p className="text-xl font-bold text-gray-100 mt-1">{formatCurrency(customer.totalProjectValue)}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Paid</p><p className="text-xl font-bold text-green-400 mt-1">{formatCurrency(customer.totalPaid)}</p></Card>
        <Card padding="sm"><p className="text-xs text-gray-500">Outstanding</p><p className="text-xl font-bold text-yellow-400 mt-1">{formatCurrency(outstanding)}</p></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Contact */}
        <div className="space-y-4">
          <Card>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contact Info</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-600" /><a href={`tel:${customer.phone}`} className="text-gray-200">{customer.phone}</a></div>
              {customer.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-600" /><span className="text-gray-300">{customer.email}</span></div>}
              <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-gray-600 mt-0.5" /><span className="text-gray-400">{customer.address}</span></div>
            </div>
          </Card>
        </div>

        {/* Projects */}
        <div className="lg:col-span-2 space-y-4">
          <Card padding="none">
            <div className="p-4 border-b border-gray-800 flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-gray-200">Projects</h3>
            </div>
            {projects.length === 0 ? (
              <p className="p-5 text-sm text-gray-600 text-center">No projects yet</p>
            ) : projects.map(p => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{p.title}</p>
                  <p className="text-xs text-gray-500">{p.projectCode} · {formatCurrency(p.projectValue)}</p>
                </div>
                <Badge color={PROJECT_STATUS_CONFIG[p.status]?.color} bg={PROJECT_STATUS_CONFIG[p.status]?.bg}>{PROJECT_STATUS_CONFIG[p.status]?.label}</Badge>
                <ChevronRight className="w-3.5 h-3.5 text-gray-700" />
              </div>
            ))}
          </Card>

          <Card padding="none">
            <div className="p-4 border-b border-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-yellow-400" />
              <h3 className="text-sm font-semibold text-gray-200">Quotations</h3>
            </div>
            {quotations.length === 0 ? (
              <p className="p-5 text-sm text-gray-600 text-center">No quotations yet</p>
            ) : quotations.map(q => (
              <div key={q.id} onClick={() => navigate(`/quotations/${q.id}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{q.quotationCode} <span className="text-gray-600 text-xs">V{q.version}</span></p>
                  <p className="text-xs text-gray-500">{formatCurrency(q.total)}</p>
                </div>
                <Badge color={QUOTATION_STATUS_CONFIG[q.status]?.color} bg={QUOTATION_STATUS_CONFIG[q.status]?.bg}>{QUOTATION_STATUS_CONFIG[q.status]?.label}</Badge>
              </div>
            ))}
          </Card>

          <Card padding="none">
            <div className="p-4 border-b border-gray-800 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-gray-200">Invoices</h3>
            </div>
            {invoices.length === 0 ? (
              <p className="p-5 text-sm text-gray-600 text-center">No invoices yet</p>
            ) : invoices.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{inv.invoiceCode}</p>
                  <p className="text-xs text-gray-500">{formatCurrency(inv.amount)} · Due {formatDate(inv.dueDate)}</p>
                </div>
                <div className="text-right">
                  <Badge color={INVOICE_STATUS_CONFIG[inv.status]?.color} bg={INVOICE_STATUS_CONFIG[inv.status]?.bg}>{INVOICE_STATUS_CONFIG[inv.status]?.label}</Badge>
                  <p className="text-xs text-gray-500 mt-1">Balance: {formatCurrency(inv.balance)}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}
