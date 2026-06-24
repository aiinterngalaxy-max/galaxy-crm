import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FileText, FolderPlus, CheckCircle2, LayoutTemplate, Eye } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { QuotationForm } from './QuotationForm'
import { db, collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from '../../lib/firebase'
import { QUOTATION_STATUS_CONFIG, formatCurrency, formatDate } from '../../lib/utils'
import { generateProjectCode } from '../../lib/firebase'
import type { Quotation } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export function QuotationsPage() {
  const navigate = useNavigate()
  const { role, user, isManagement } = useAuth()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [creatingProject, setCreatingProject] = useState<string | null>(null)

  const canCreate = ['super_admin', 'management', 'dept_head', 'bd_exec', 'project_manager'].includes(role || '')
  const canApprove = isManagement

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

  const approveQuotation = async (q: Quotation, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await updateDoc(doc(db, 'quotations', q.id), {
        status: 'approved',
        approvedBy: user?.id,
        approvedByName: user?.name,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast.success('Quotation approved')
    } catch {
      toast.error('Approval failed')
    }
  }

  const createProjectFromQuotation = async (q: Quotation, e: React.MouseEvent) => {
    e.stopPropagation()
    if (q.projectId) {
      navigate(`/projects/${q.projectId}`)
      return
    }
    setCreatingProject(q.id)
    try {
      const snap = await getDocs(collection(db, 'projects'))
      const seq = snap.size + 1

      const projectRef = await addDoc(collection(db, 'projects'), {
        projectCode: generateProjectCode(seq),
        title: `${q.customerName} — Home Automation`,
        customerId: q.customerId,
        customerName: q.customerName,
        quotationId: q.id,
        quotationCode: q.quotationCode,
        totalValue: q.total,
        status: 'planning',
        riskLevel: 'low',
        completionPercent: 0,
        milestones: [],
        assignedPM: q.assignedPM,
        assignedPMName: q.assignedPMName,
        collectedAmount: 0,
        createdBy: user?.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Link project back to quotation and customer
      await updateDoc(doc(db, 'quotations', q.id), {
        projectId: projectRef.id,
        updatedAt: serverTimestamp(),
      })

      if (q.customerId) {
        const { arrayUnion } = await import('firebase/firestore')
        await updateDoc(doc(db, 'customers', q.customerId), {
          projectIds: arrayUnion(projectRef.id),
          updatedAt: serverTimestamp(),
        })
      }

      toast.success('Project created from quotation!')
      navigate(`/projects/${projectRef.id}`)
    } catch (err) {
      toast.error('Failed to create project')
      console.error(err)
    } finally {
      setCreatingProject(null)
    }
  }

  const filtered = quotations.filter(q =>
    !search ||
    q.quotationCode.toLowerCase().includes(search.toLowerCase()) ||
    (q.customerName || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalSent = quotations.filter(q => q.status === 'sent_to_customer' || q.status === 'customer_approved')
  const totalApproved = quotations.filter(q => q.status === 'approved' || q.status === 'customer_approved')
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
          <Button onClick={() => navigate('/quotations/new')} icon={<Plus className="w-4 h-4" />}>
            New Quotation
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: quotations.length },
          { label: 'Approved', value: totalApproved.length },
          { label: 'Pending Approval', value: pendingApproval.length, highlight: pendingApproval.length > 0 },
          { label: 'Approved Value', value: formatCurrency(totalApproved.reduce((s, q) => s + q.total, 0)) },
        ].map(s => (
          <Card key={s.label} padding="sm" className={s.highlight ? 'border-yellow-800/50' : ''}>
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${s.highlight ? 'text-yellow-400' : 'text-gray-100'}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="max-w-sm">
        <Input placeholder="Search by code or customer…" value={search}
          onChange={e => setSearch(e.target.value)} leftIcon={<Search className="w-4 h-4" />} />
      </div>

      <Card padding="none">
        {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={<FileText className="w-6 h-6" />}
            title="No quotations yet"
            description="Create your first quotation from a customer."
            action={canCreate ? { label: 'New Quotation', onClick: () => setShowForm(true), icon: <Plus className="w-4 h-4" /> } : undefined}
          />
        )}
        <div className="divide-y divide-gray-800">
          {filtered.map(q => {
            const cfg = QUOTATION_STATUS_CONFIG[q.status]
            const isApproved = q.status === 'approved' || q.status === 'customer_approved'
            const isPending = q.status === 'pending_approval'
            const hasProject = !!q.projectId
            return (
              <div
                key={q.id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
                onClick={() => {}}
              >
                <div className="w-9 h-9 bg-yellow-900/30 rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-200">{q.quotationCode}</p>
                    <span className="text-xs text-gray-600">V{q.version}</span>
                    {hasProject && (
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/projects/${q.projectId}`) }}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        → Project ↗
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {q.customerName || 'No customer'} · {q.assignedPMName || '—'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-100">{formatCurrency(q.total)}</p>
                  <p className="text-xs text-gray-500">Valid till {formatDate(q.validUntil)}</p>
                </div>
                <Badge color={cfg?.color} bg={cfg?.bg} className="shrink-0 hidden sm:flex">
                  {cfg?.label}
                </Badge>

                {/* Action buttons */}
                <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  {isPending && canApprove && (
                    <Button size="sm" variant="success"
                      icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      onClick={e => approveQuotation(q, e)}>
                      Approve
                    </Button>
                  )}
                  {isApproved && !hasProject && (
                    <Button size="sm" variant="secondary"
                      icon={<FolderPlus className="w-3.5 h-3.5" />}
                      loading={creatingProject === q.id}
                      onClick={e => createProjectFromQuotation(q, e)}>
                      Create Project
                    </Button>
                  )}
                  {isApproved && hasProject && (
                    <Button size="sm" variant="ghost"
                      onClick={e => { e.stopPropagation(); navigate(`/projects/${q.projectId}`) }}>
                      View Project
                    </Button>
                  )}
                  <Button size="sm" variant="ghost"
                    icon={<Eye className="w-3.5 h-3.5" />}
                    onClick={e => { e.stopPropagation(); navigate(`/quotations/${q.id}/boq`) }}>
                    BOQ
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Modal open={showForm} onClose={() => setShowForm(false)}
        title="New Quotation" description="Build a quotation for a customer." size="2xl">
        <QuotationForm onSuccess={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  )
}
