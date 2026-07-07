import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, Plus, Trash2, X, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, doc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from '../../lib/firebase'
import toast from 'react-hot-toast'
import { cn } from '../../lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ProductLine = 'elysia' | 'vitrum' | 'curtains' | 'general'

interface NonWorkingItem {
  id: string
  productLine: ProductLine
  itemCode: string
  itemName: string
  category: string
  qty: number
  reason: string
  reportedByName: string
  createdAt: any
  // Elysia extras
  material?: string
  color?: string
  // Vitrum extras
  connectivity?: string
  // Curtains extras
  // General extras
}

// ─── Elysia builders ───────────────────────────────────────────────────────────

const ELYSIA_SWITCH_MODULES = ['1T', '2T', '3T', '4T', 'D/T Knob', 'Music Knob', '4T LCD', '6T', '8T', 'Multifunctional Switch', 'Multifunctional Type-C']
const ELYSIA_SOCKET_MODULES = ['Single Socket USB C', 'Single Socket 5Pin', 'Single Socket 3Pin', 'Double Socket USB C', 'Double Socket 5Pin', 'Apple Wire Socket']
const ELYSIA_MATERIALS = ['Aluminium', 'Skin', 'PC']
const ELYSIA_COLORS = ['Grey', 'Black', 'White', 'Blue', 'Red', 'Gold', 'Silver', 'Brown', 'Orange']

function buildElysiaItemName(product: 'switch' | 'socket', module: string, color: string): string {
  const c = color.trim()
  if (product === 'socket') return `${module.toUpperCase()} ${c}`.trim()
  if (module === '4T LCD') return `4 TOUCH LCD ${c}`.trim()
  if (/^\d+T$/.test(module)) return `${module.replace(/\D/g, '')} TOUCH ${c}`.trim()
  return `${module.toUpperCase()} ${c}`.trim()
}

function buildElysiaItemCode(module: string, color: string, material: string): string {
  return [module.trim().toUpperCase(), color.trim().toUpperCase(), material.trim().toUpperCase()].filter(Boolean).join('-')
}

// ─── Vitrum builders ───────────────────────────────────────────────────────────

const VITRUM_MODULES = ['1M', '2M', '3M', '4M', '6M', '7M', '8M', '10M', 'CITRUM', 'OTHER']
const VITRUM_FINISHES = ['Black / Black', 'Black / Gold', 'Black / Silver', 'White / Gold', 'White / Silver', 'Silver / White']
const VITRUM_CONNECTIVITY = ['WiFi', 'Zigbee']

function buildVitrumItemName(module: string, color: string, connectivity: string): string {
  const m = module.match(/^(\d+)M$/)
  const touchLabel = m ? `${m[1]} TOUCH` : module
  return [touchLabel, color, connectivity.toUpperCase()].filter(Boolean).join(' + ')
}

function buildVitrumItemCode(module: string, color: string, connectivity: string): string {
  const finishAbbrev = color ? color.split('/').map(c => c.trim()[0]?.toUpperCase() ?? '').join('/') : ''
  const connAbbrev = connectivity === 'Zigbee' ? 'ZIG' : 'WI'
  return [module, finishAbbrev, connAbbrev].filter(Boolean).join('-')
}

// ─── Curtain categories ────────────────────────────────────────────────────────

const CURTAIN_CATEGORIES = ['Motor', 'Remote', 'Carriers', 'Belt', 'Runners', 'Bracket', 'Kaan', 'Track', 'Hook', 'OTHER']
const GENERAL_CATEGORIES = ['SENSORS', 'HUB', 'CAMERA', 'NETWORKING', 'BACKBOX', 'SOCKET', 'OTHER']

const LINE_LABELS: Record<ProductLine, string> = {
  elysia: 'Elysia',
  vitrum: 'Vitrum',
  curtains: 'Curtains',
  general: 'General',
}

const LINE_COLORS: Record<ProductLine, string> = {
  elysia: 'text-indigo-400',
  vitrum: 'text-purple-400',
  curtains: 'text-amber-400',
  general: 'text-green-400',
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function NonWorkingPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<NonWorkingItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterLine, setFilterLine] = useState<ProductLine | 'all'>('all')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'nonWorkingInventory'), orderBy('createdAt', 'desc')),
      snap => setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as NonWorkingItem))
    )
    return unsub
  }, [])

  const filtered = useMemo(() => items.filter(item => {
    if (filterLine !== 'all' && item.productLine !== filterLine) return false
    if (search) {
      const q = search.toLowerCase()
      return item.itemName.toLowerCase().includes(q) || item.itemCode.toLowerCase().includes(q) || item.reason.toLowerCase().includes(q)
    }
    return true
  }), [items, filterLine, search])

  const handleDelete = async (itemId: string) => {
    if (!window.confirm('Remove this entry?')) return
    try {
      await deleteDoc(doc(db, 'nonWorkingInventory', itemId))
      toast.success('Removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  const canManage = !!user

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" /> Non-Working Inventory
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Track faulty or non-functional items across all product lines</p>
        </div>
        {canManage && (
          <Button data-tour="add-btn" variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>
            Log Item
          </Button>
        )}
      </div>

      {/* Filters */}
      <div data-tour="filters"><Card>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              className="form-input pl-8 text-sm w-full"
              placeholder="Search item name, code or reason…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'elysia', 'vitrum', 'curtains', 'general'] as const).map(line => (
              <button
                key={line}
                onClick={() => setFilterLine(line)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  filterLine === line
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                )}
              >
                {line === 'all' ? 'All' : LINE_LABELS[line]}
                <span className="ml-1.5 text-[10px] opacity-60">
                  {line === 'all' ? items.length : items.filter(i => i.productLine === line).length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card></div>

      {/* Table */}
      <div data-tour="items-table"><Card padding="none">
        {filtered.length === 0 ? (
          <p className="p-8 text-xs text-gray-600 text-center">
            {items.length === 0 ? 'No non-working items logged yet.' : 'No items match your filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Line', 'Code', 'Item', 'Category', 'Qty', 'Reason', 'Reported By', 'Date', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map(item => (
                  <tr key={item.id} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-semibold', LINE_COLORS[item.productLine])}>
                        {LINE_LABELS[item.productLine]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400 whitespace-nowrap">{item.itemCode || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{item.itemName}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{item.category}</td>
                    <td className="px-4 py-3 text-xs text-amber-400 font-semibold text-right">{item.qty}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[220px]">
                      <span className="line-clamp-2">{item.reason}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{item.reportedByName}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {item.createdAt?.toDate?.().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && (
                        <button onClick={() => handleDelete(item.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card></div>

      {showForm && user && (
        <AddNonWorkingModal
          userName={user.name}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ─── Add Modal ─────────────────────────────────────────────────────────────────

function AddNonWorkingModal({ userName, onClose }: { userName: string; onClose: () => void }) {
  const [step, setStep] = useState<'line' | 'form'>('line')
  const [productLine, setProductLine] = useState<ProductLine>('elysia')
  const [saving, setSaving] = useState(false)

  // Shared
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')

  // Elysia
  const [elysiaProduct, setElysiaProduct] = useState<'switch' | 'socket'>('switch')
  const [elysiaModule, setElysiaModule] = useState(ELYSIA_SWITCH_MODULES[0])
  const [elysiaMaterial, setElysiaMaterial] = useState('Aluminium')
  const [elysiaColor, setElysiaColor] = useState('Grey')

  // Vitrum
  const [vitrumModule, setVitrumModule] = useState(VITRUM_MODULES[0])
  const [vitrumColor, setVitrumColor] = useState(VITRUM_FINISHES[0])
  const [vitrumConnectivity, setVitrumConnectivity] = useState('WiFi')

  // Curtains / General
  const [itemCode, setItemCode] = useState('')
  const [itemName, setItemName] = useState('')
  const [category, setCategory] = useState(CURTAIN_CATEGORIES[0])

  const handleLineSelect = (line: ProductLine) => {
    setProductLine(line)
    setCategory(line === 'curtains' ? CURTAIN_CATEGORIES[0] : GENERAL_CATEGORIES[0])
    setStep('form')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!qty || Number(qty) <= 0) { toast.error('Enter a quantity'); return }
    if (!reason.trim()) { toast.error('Enter reason for not working'); return }

    let finalCode = ''
    let finalName = ''
    let finalCategory = ''

    if (productLine === 'elysia') {
      if (!elysiaColor) { toast.error('Select a color'); return }
      finalCode = buildElysiaItemCode(elysiaModule, elysiaColor, elysiaMaterial)
      finalName = buildElysiaItemName(elysiaProduct, elysiaModule, elysiaColor)
      finalCategory = elysiaProduct === 'socket' ? 'SOCKET' : elysiaModule
    } else if (productLine === 'vitrum') {
      if (!vitrumColor) { toast.error('Select a finish'); return }
      finalCode = buildVitrumItemCode(vitrumModule, vitrumColor, vitrumConnectivity)
      finalName = buildVitrumItemName(vitrumModule, vitrumColor, vitrumConnectivity)
      finalCategory = vitrumModule
    } else {
      if (!itemName.trim()) { toast.error('Enter item name'); return }
      finalCode = itemCode.trim().toUpperCase()
      finalName = itemName.trim()
      finalCategory = category
    }

    setSaving(true)
    try {
      await addDoc(collection(db, 'nonWorkingInventory'), {
        productLine,
        itemCode: finalCode,
        itemName: finalName,
        category: finalCategory,
        qty: Number(qty),
        reason: reason.trim(),
        reportedByName: userName,
        ...(productLine === 'elysia' ? { material: elysiaMaterial, color: elysiaColor } : {}),
        ...(productLine === 'vitrum' ? { color: vitrumColor, connectivity: vitrumConnectivity } : {}),
        createdAt: serverTimestamp(),
      })
      toast.success('Item logged')
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="glass-card w-full max-w-md rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            {step === 'line' ? 'Select Product Line' : `Log Non-Working — ${LINE_LABELS[productLine]}`}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        {/* Step 1 — pick product line */}
        {step === 'line' && (
          <div className="grid grid-cols-2 gap-3">
            {(['elysia', 'vitrum', 'curtains', 'general'] as ProductLine[]).map(line => (
              <button
                key={line}
                onClick={() => handleLineSelect(line)}
                className="rounded-xl border border-gray-700 bg-gray-800/50 hover:border-indigo-500 hover:bg-indigo-900/20 p-4 text-left transition-colors space-y-1"
              >
                <p className={cn('text-sm font-semibold', LINE_COLORS[line])}>{LINE_LABELS[line]}</p>
                <p className="text-[11px] text-gray-500">
                  {line === 'elysia' && 'Switches & Sockets'}
                  {line === 'vitrum' && 'Vitrum panels'}
                  {line === 'curtains' && 'Curtain motors & parts'}
                  {line === 'general' && 'Sensors, hubs, cameras…'}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — item form */}
        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <button type="button" onClick={() => setStep('line')} className="text-xs text-gray-500 hover:text-gray-300">
              ← Change product line
            </button>

            {/* Elysia fields */}
            {productLine === 'elysia' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {(['switch', 'socket'] as const).map(p => (
                    <button key={p} type="button"
                      onClick={() => {
                        setElysiaProduct(p)
                        setElysiaModule(p === 'switch' ? ELYSIA_SWITCH_MODULES[0] : ELYSIA_SOCKET_MODULES[0])
                      }}
                      className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                        elysiaProduct === p ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'
                      )}>
                      {p === 'switch' ? 'Switch' : 'Socket'}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="form-label">Module</label>
                  <select className="form-input" value={elysiaModule}
                    onChange={e => setElysiaModule(e.target.value)}>
                    {(elysiaProduct === 'switch' ? ELYSIA_SWITCH_MODULES : ELYSIA_SOCKET_MODULES).map(m => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Material</label>
                    <select className="form-input" value={elysiaMaterial} onChange={e => setElysiaMaterial(e.target.value)}>
                      {ELYSIA_MATERIALS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Color</label>
                    <select className="form-input" value={elysiaColor} onChange={e => setElysiaColor(e.target.value)}>
                      {ELYSIA_COLORS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Vitrum fields */}
            {productLine === 'vitrum' && (
              <div className="space-y-3">
                <div>
                  <label className="form-label">Module</label>
                  <select className="form-input" value={vitrumModule} onChange={e => setVitrumModule(e.target.value)}>
                    {VITRUM_MODULES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Finish / Color</label>
                    <select className="form-input" value={vitrumColor} onChange={e => setVitrumColor(e.target.value)}>
                      {VITRUM_FINISHES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Connectivity</label>
                    <select className="form-input" value={vitrumConnectivity} onChange={e => setVitrumConnectivity(e.target.value)}>
                      {VITRUM_CONNECTIVITY.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Curtains / General fields */}
            {(productLine === 'curtains' || productLine === 'general') && (
              <div className="space-y-3">
                <div>
                  <label className="form-label">Category</label>
                  <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                    {(productLine === 'curtains' ? CURTAIN_CATEGORIES : GENERAL_CATEGORIES).map(c => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Item Code (optional)</label>
                  <input className="form-input" placeholder="e.g. MOTOR-5W"
                    value={itemCode} onChange={e => setItemCode(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Item Name *</label>
                  <input autoFocus className="form-input" placeholder="e.g. 5 Wire Curtain Motor"
                    value={itemName} onChange={e => setItemName(e.target.value)} />
                </div>
              </div>
            )}

            {/* Shared fields */}
            <div>
              <label className="form-label">Quantity *</label>
              <input type="number" min="1" className="form-input" placeholder="0"
                value={qty} onChange={e => setQty(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Reason for not working *</label>
              <textarea className="form-input resize-none" rows={3}
                placeholder="e.g. Panel cracked, switch unresponsive, motor stuck…"
                value={reason} onChange={e => setReason(e.target.value)} />
            </div>

            {/* Preview */}
            {(productLine === 'elysia' || productLine === 'vitrum') && (
              <div className="rounded-lg bg-gray-800/50 px-3 py-2 text-xs text-gray-400">
                <span className="text-gray-600">Item: </span>
                <span className="text-gray-200">
                  {productLine === 'elysia'
                    ? buildElysiaItemName(elysiaProduct, elysiaModule, elysiaColor) || '—'
                    : buildVitrumItemName(vitrumModule, vitrumColor, vitrumConnectivity) || '—'}
                </span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>Log Item</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
