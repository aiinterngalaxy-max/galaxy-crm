import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Filter, LayoutGrid, List, Phone, Calendar, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { LeadForm } from './LeadForm'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, where, orderBy, onSnapshot, deleteDocument } from '../../lib/firebase'
import {
  LEAD_STATUS_CONFIG, getScoreColor, formatRelative,
  formatCurrency, canManageLeads,
} from '../../lib/utils'
import type { Lead, LeadStatus } from '../../types'
import { cn } from '../../lib/utils'

const PIPELINE_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent']

type ViewMode = 'kanban' | 'list'

export function LeadsPage() {
  const navigate = useNavigate()
  const { user, role, isAdmin } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const canCreate = role ? canManageLeads(role) : false

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDelete === id) {
      await deleteDocument('leads', id)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  useEffect(() => {
    if (!user || !role) return

    const constraints = []
    constraints.push(orderBy('updatedAt', 'desc'))

    const q = query(collection(db, 'leads'), ...constraints)
    const unsub = onSnapshot(q, snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead))
      setLoading(false)
    }, err => {
      console.error(err)
      setLoading(false)
    })

    return unsub
  }, [user, role])

  const filtered = leads.filter(l => {
    const matchSearch = !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search) ||
      (l.email || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || l.status === filterStatus
    return matchSearch && matchStatus
  })

  const wonLost = leads.filter(l => ['won', 'lost'].includes(l.status))

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Lead Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {leads.filter(l => !['won', 'lost'].includes(l.status)).length} active ·{' '}
            {leads.filter(l => l.status === 'won').length} won ·{' '}
            {leads.filter(l => l.status === 'lost').length} lost
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>
            New Lead
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48 max-w-80">
          <Input
            placeholder="Search name, phone, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilterStatus('all')}
            className={cn('text-xs px-3 py-1.5 rounded-full border transition-colors', filterStatus === 'all' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-gray-200')}
          >
            All
          </button>
          {PIPELINE_STAGES.map(s => (
            <button key={s}
              onClick={() => setFilterStatus(s)}
              className={cn('text-xs px-3 py-1.5 rounded-full border transition-colors',
                filterStatus === s
                  ? `${LEAD_STATUS_CONFIG[s].bg} ${LEAD_STATUS_CONFIG[s].color} border-transparent`
                  : 'border-gray-700 text-gray-400 hover:text-gray-200'
              )}
            >
              {LEAD_STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('kanban')}
            className={cn('p-1.5 rounded', viewMode === 'kanban' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn('p-1.5 rounded', viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map(status => {
            const stageLeads = filtered.filter(l => l.status === status)
            const cfg = LEAD_STATUS_CONFIG[status]
            return (
              <div key={status} className="flex-shrink-0 w-72">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs bg-gray-800 text-gray-500 rounded-full px-2 py-0.5">{stageLeads.length}</span>
                  </div>
                </div>
                <div className="space-y-2 kanban-col">
                  {stageLeads.map(lead => (
                    <LeadKanbanCard key={lead.id} lead={lead} onClick={() => navigate(`/leads/${lead.id}`)} />
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="border-2 border-dashed border-gray-800 rounded-xl py-8 text-center text-xs text-gray-700">
                      No leads here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Name', 'Phone', 'Source', 'Status', 'Score', 'Demo', 'Assigned To', 'Last Updated', ''].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {loading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-600">Loading…</td></tr>
                )}
                {filtered.map(lead => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-200">{lead.name}</div>
                      {lead.address && <div className="text-xs text-gray-500 truncate max-w-36">{lead.address}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{lead.phone}</td>
                    <td className="px-4 py-3 text-gray-400 capitalize">{lead.source?.replace('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge color={LEAD_STATUS_CONFIG[lead.status]?.color} bg={LEAD_STATUS_CONFIG[lead.status]?.bg}>
                        {LEAD_STATUS_CONFIG[lead.status]?.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${getScoreColor(lead.aiScore)}`}>{lead.aiScore}</span>
                    </td>
                    <td className="px-4 py-3">
                      {lead.demoGiven
                        ? <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded">Yes</span>
                        : <span className="text-xs text-gray-600">No</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{lead.assignedToName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{formatRelative(lead.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button className="text-gray-600 hover:text-gray-300 p-1" title="Call">
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                        <button className="text-gray-600 hover:text-gray-300 p-1" title="Schedule">
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          confirmDelete === lead.id ? (
                            <button
                              onClick={e => handleDelete(lead.id, e)}
                              className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                            >
                              Confirm?
                            </button>
                          ) : (
                            <button
                              onClick={e => handleDelete(lead.id, e)}
                              className="p-1 text-gray-700 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        title="No leads found"
                        description={search ? 'Try a different search term.' : 'Add your first lead to get started.'}
                        action={canCreate ? { label: 'Add Lead', onClick: () => setShowForm(true), icon: <Plus className="w-4 h-4" /> } : undefined}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Won/Lost summary */}
      {wonLost.length > 0 && (
        <div className="flex gap-4">
          {(['won', 'lost'] as const).map(s => {
            const count = wonLost.filter(l => l.status === s).length
            const cfg = LEAD_STATUS_CONFIG[s]
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                  cfg.bg, cfg.color, 'border-transparent hover:opacity-80')}
              >
                {cfg.label}: {count}
              </button>
            )
          })}
        </div>
      )}

      {/* New Lead Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add New Lead"
        description="Enter the lead's details below."
        size="lg"
      >
        <LeadForm onSuccess={() => setShowForm(false)} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  )
}

function LeadKanbanCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <div onClick={onClick} className="pipeline-card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-100">{lead.name}</p>
          <p className="text-xs text-gray-500">{lead.phone}</p>
        </div>
        <span className={`text-xs font-bold shrink-0 ${getScoreColor(lead.aiScore)}`}>
          {lead.aiScore}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3">
        <span className="text-xs text-gray-600 capitalize bg-gray-800 px-2 py-0.5 rounded">
          {lead.source?.replace('_', ' ')}
        </span>
        {lead.estimatedBudget && (
          <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">
            {formatCurrency(lead.estimatedBudget)}
          </span>
        )}
        {lead.floorPlanUrl && (
          <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
            Floor plan ✓
          </span>
        )}
        {lead.demoGiven && (
          <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded">
            Demo ✓
          </span>
        )}
      </div>

      {lead.nextFollowUp && (
        <div className="flex items-center gap-1 mt-2 text-xs text-yellow-400">
          <Calendar className="w-3 h-3" />
          {formatRelative(lead.nextFollowUp)}
        </div>
      )}

      <div className="mt-2 text-xs text-gray-700">{formatRelative(lead.updatedAt)}</div>
    </div>
  )
}
