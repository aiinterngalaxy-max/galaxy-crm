import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LayoutGrid, List, Phone, MessageSquare, Calendar, Trash2, Clock, Table2, Search, X } from 'lucide-react'
import { LeadsSpreadsheetView } from './LeadsSpreadsheetView'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { LeadForm } from './LeadForm'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, onSnapshot, limit } from '../../lib/firebase'
import { trashItem } from '../../lib/trash'
import {
  cn, LEAD_STATUS_CONFIG, getScoreColor, formatRelative, formatDate,
  formatCurrency, canManageLeads,
} from '../../lib/utils'
import type { Lead, LeadStatus } from '../../types'

const PIPELINE_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent']
const ALL_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified', 'floor_plan', 'quote_sent', 'won', 'lost']

type ViewMode = 'kanban' | 'list' | 'spreadsheet'

// ─── Lead Hover Tooltip ────────────────────────────────────────────────────────

function LeadTooltip({ lead, anchorRect }: { lead: Lead; anchorRect: DOMRect }) {
  const status = LEAD_STATUS_CONFIG[lead.status]
  const viewportH = window.innerHeight
  const tooltipH = 280
  const top = anchorRect.bottom + tooltipH > viewportH
    ? anchorRect.top - tooltipH - 8
    : anchorRect.bottom + 8

  const rows: [string, string | undefined | null][] = [
    ['Phone',        lead.phone],
    ['WhatsApp',     lead.whatsapp],
    ['Email',        lead.email],
    ['Business',     lead.businessType?.toUpperCase()],
    ['Partner',      lead.partnerName],
    ['Project Type', lead.projectType],
    ['Property',     lead.propertySize],
    ['Budget',       lead.estimatedBudget ? formatCurrency(lead.estimatedBudget) : null],
    ['Demo Given',   lead.demoGiven ? 'Yes' : 'No'],
    ['Score',        String(lead.aiScore ?? '—')],
    ['Notes',        lead.notes],
  ]

  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: anchorRect.left, top, minWidth: 280, maxWidth: 380 }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
          <p className="text-sm font-semibold text-white">{lead.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status?.color} ${status?.bg}`}>
              {status?.label}
            </span>
            {lead.assignedToName && (
              <span className="text-xs text-gray-400">→ {lead.assignedToName}</span>
            )}
          </div>
        </div>
        {/* Fields */}
        <div className="px-4 py-3 space-y-1.5">
          {rows.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="flex gap-2 text-xs">
              <span className="text-gray-500 w-24 shrink-0">{label}</span>
              <span className={`text-gray-200 ${label === 'Notes' ? 'line-clamp-3' : 'truncate'}`}>{value}</span>
            </div>
          ))}
          {lead.address && (
            <div className="flex gap-2 text-xs">
              <span className="text-gray-500 w-24 shrink-0">Address</span>
              <span className="text-gray-200 line-clamp-2">{lead.address}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function LeadsPage() {
  const navigate = useNavigate()
  const { user, role, isAdmin } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showForm, setShowForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStage, setFilterStage] = useState<LeadStatus | 'all'>('all')
  const [filterPlatform, setFilterPlatform] = useState<string>('all')
  const [filterEmployee, setFilterEmployee] = useState<string>('all')
  const [tooltip, setTooltip] = useState<{ lead: Lead; rect: DOMRect } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRowEnter = useCallback((lead: Lead, e: React.MouseEvent<HTMLTableRowElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    hoverTimer.current = setTimeout(() => setTooltip({ lead, rect }), 400)
  }, [])

  const handleRowLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setTooltip(null)
  }, [])
  const [filterDate, setFilterDate] = useState<string>('')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [sortScore, setSortScore] = useState<'none' | 'high' | 'low'>('none')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const canCreate = role ? canManageLeads(role) : false

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDelete === id) {
      await trashItem('leads', id, user?.id ?? '', user?.name ?? 'Unknown')
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  useEffect(() => {
    if (!user || !role) return

    const q = query(collection(db, 'leads'), orderBy('updatedAt', 'desc'), limit(500))
    const unsub = onSnapshot(q, snap => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Lead).filter(l => (l as any).businessType !== 'b2b'))
      setLoading(false)
    }, err => {
      console.error(err)
      setLoading(false)
    })

    return unsub
  }, [user, role])

  const platformOptions = useMemo(() => {
    const seen = new Set<string>()
    leads.forEach(l => { if (l.source) seen.add(l.source) })
    return Array.from(seen).sort()
  }, [leads])

  const employeeOptions = useMemo(() => {
    const seen = new Set<string>()
    leads.forEach(l => { if (l.assignedToName) seen.add(l.assignedToName) })
    return Array.from(seen).sort()
  }, [leads])

  // Month options derived from createdAt of all leads, sorted newest first
  const monthOptions = useMemo(() => {
    const seen = new Map<string, string>() // key: "2025-05", label: "May 2025"
    leads.forEach(l => {
      const ts = l.createdAt as any
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!seen.has(key)) {
        seen.set(key, d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }))
      }
    })
    return Array.from(seen.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [leads])

  const getLeadMonth = (lead: Lead): string => {
    const ts = lead.createdAt as any
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let list = leads.filter(l => {
      const matchStage = filterStage === 'all' || l.status === filterStage
      const matchPlatform = filterPlatform === 'all' || l.source === filterPlatform
      const matchEmployee = filterEmployee === 'all' || l.assignedToName === filterEmployee
      const matchDate = !filterDate || (() => {
        const ts = l.createdAt as any
        const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
        return d.toISOString().slice(0, 10) === filterDate
      })()
      const matchMonth = filterMonth === 'all' || getLeadMonth(l) === filterMonth
      const matchSearch = !q || [l.name, l.phone, l.email, l.whatsapp, l.address, l.assignedToName, l.source]
        .some(field => field?.toLowerCase().includes(q))
      return matchStage && matchPlatform && matchEmployee && matchDate && matchMonth && matchSearch
    })
    if (sortScore === 'high') list = [...list].sort((a, b) => b.aiScore - a.aiScore)
    else if (sortScore === 'low') list = [...list].sort((a, b) => a.aiScore - b.aiScore)
    return list
  }, [leads, searchQuery, filterStage, filterPlatform, filterEmployee, filterDate, filterMonth, sortScore])

  // Group filtered leads by month for list view (skip in kanban — not rendered)
  const groupedByMonth = useMemo(() => {
    if (viewMode === 'kanban') return []
    const map = new Map<string, { label: string; leads: Lead[] }>()
    filtered.forEach(l => {
      const key = getLeadMonth(l)
      if (!map.has(key)) {
        const ts = l.createdAt as any
        const d: Date = ts?.toDate ? ts.toDate() : new Date(ts)
        const label = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        map.set(key, { label, leads: [] })
      }
      map.get(key)!.leads.push(l)
    })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered, viewMode])

  const wonLost = leads.filter(l => ['won', 'lost'].includes(l.status))

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Lead Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {leads.filter(l => !['won', 'lost'].includes(l.status)).length} active ·{' '}
            {leads.filter(l => l.status === 'won').length} {LEAD_STATUS_CONFIG.won.label.toLowerCase()} ·{' '}
            {leads.filter(l => l.status === 'lost').length} {LEAD_STATUS_CONFIG.lost.label.toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" data-tour="follow-ups" icon={<Clock className="w-4 h-4" />} onClick={() => navigate('/follow-ups')}>
            Follow-ups
          </Button>
          {canCreate && (
            <Button data-tour="add-lead" onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>
              New Lead
            </Button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search leads…"
            className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg pl-9 pr-8 py-2 w-56 focus:outline-none focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Stage dropdown */}
        <select
          value={filterStage}
          onChange={e => setFilterStage(e.target.value as LeadStatus | 'all')}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="all">All Stages</option>
          {ALL_STAGES.map(s => (
            <option key={s} value={s}>{LEAD_STATUS_CONFIG[s].label}</option>
          ))}
        </select>

        {/* Platform dropdown */}
        <select
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="all">All Platforms</option>
          {platformOptions.map(p => (
            <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
          ))}
        </select>

        {/* Employee dropdown */}
        <select
          value={filterEmployee}
          onChange={e => setFilterEmployee(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="all">All Employees</option>
          {employeeOptions.map(emp => (
            <option key={emp} value={emp}>{emp}</option>
          ))}
        </select>

        {/* Month filter */}
        <select
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="all">All Months</option>
          {monthOptions.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Score sort */}
        <select
          value={sortScore}
          onChange={e => setSortScore(e.target.value as 'none' | 'high' | 'low')}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="none">Score: Default</option>
          <option value="high">Score: High → Low</option>
          <option value="low">Score: Low → High</option>
        </select>

        {/* Date added filter */}
        <div className="relative">
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
          />
          {filterDate && (
            <button
              onClick={() => setFilterDate('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              title="Clear date"
            >✕</button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('kanban')}
            className={cn('p-1.5 rounded', viewMode === 'kanban' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}
            title="Kanban view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn('p-1.5 rounded', viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('spreadsheet')}
            className={cn('p-1.5 rounded', viewMode === 'spreadsheet' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}
            title="Spreadsheet view"
          >
            <Table2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {(filterStage !== 'all' && PIPELINE_STAGES.includes(filterStage as LeadStatus)
            ? [filterStage as LeadStatus]
            : PIPELINE_STAGES
          ).map(status => {
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
        <div className="space-y-4">
          {loading && (
            <Card padding="none">
              <div className="px-4 py-8 text-center text-sm text-gray-600">Loading…</div>
            </Card>
          )}
          {!loading && filtered.length === 0 && (
            <EmptyState
              title="No leads found"
              description={searchQuery || filterStage !== 'all' || filterPlatform !== 'all' || filterEmployee !== 'all' || filterDate || filterMonth !== 'all' ? 'Try adjusting the filters.' : 'Add your first lead to get started.'}
              action={canCreate ? { label: 'Add Lead', onClick: () => setShowForm(true), icon: <Plus className="w-4 h-4" /> } : undefined}
            />
          )}
          {!loading && filtered.length > 0 && (
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Name', 'Phone', 'Source', 'Status', 'Score', 'Demo', 'Assigned To', 'Date Added', 'Last Updated', ''].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800" data-tour="lead-rows">
                    {filtered.map((lead, idx) => (
                      <tr
                        key={lead.id}
                        data-tour={idx === 0 ? 'lead-row' : undefined}
                        onClick={() => navigate(`/leads/${lead.id}`)}
                        className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                        onMouseEnter={e => handleRowEnter(lead, e)}
                        onMouseLeave={handleRowLeave}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-200">{lead.name}</div>
                          {lead.address && <div className="text-xs text-gray-500 truncate max-w-36">{lead.address}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          <span>{lead.phone}</span>
                          {lead.tier && <span className="ml-1.5 text-[10px] font-semibold text-gold-400">({lead.tier})</span>}
                        </td>
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
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(lead.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{formatRelative(lead.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                              className="text-gray-600 hover:text-gray-300 p-1" title={`Call ${lead.phone}`}>
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                            <a href={`https://wa.me/91${(lead.phone ?? '').replace(/\D/g, '')}`}
                              target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="text-gray-600 hover:text-green-400 p-1" title="WhatsApp">
                              <MessageSquare className="w-3.5 h-3.5" />
                            </a>
                            {isAdmin && (
                              confirmDelete === lead.id ? (
                                <button onClick={e => handleDelete(lead.id, e)}
                                  className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">
                                  Confirm?
                                </button>
                              ) : (
                                <button onClick={e => handleDelete(lead.id, e)}
                                  className="p-1 text-gray-700 hover:text-red-400 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Spreadsheet View */}
      {viewMode === 'spreadsheet' && (
        <LeadsSpreadsheetView
          leads={filtered}
          loading={loading}
          canEdit={canCreate}
        />
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
                onClick={() => setFilterStage(s)}
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

      {/* Hover Tooltip */}
      {tooltip && <LeadTooltip lead={tooltip.lead} anchorRect={tooltip.rect} />}
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
