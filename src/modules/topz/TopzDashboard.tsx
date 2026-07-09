import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Car, Bus, Users, Pencil, Check, X, RotateCcw } from 'lucide-react'
import { VEHICLES, getVehicles, setPriceOverride, getPriceOverrides, type VehicleType, type Vehicle } from './data/rateCard'
import toast from 'react-hot-toast'

const CATEGORIES = [
  { type: 'car' as VehicleType,       label: 'Cars',       icon: <Car className="w-7 h-7" />,   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.30)' },
  { type: 'traveller' as VehicleType, label: 'Travellers', icon: <Users className="w-7 h-7" />, color: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)' },
  { type: 'bus' as VehicleType,       label: 'Bus',        icon: <Bus className="w-7 h-7" />,   color: '#f0c040', bg: 'rgba(240,192,64,0.10)',  border: 'rgba(240,192,64,0.30)' },
]

type EditField = 'perDayRate' | 'ratePerKm' | 'permitPerDay' | 'driverAllowancePerDay'

export function TopzDashboard() {
  const navigate = useNavigate()
  const [activeType, setActiveType] = useState<VehicleType>('car')
  const [editMode, setEditMode] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>(getVehicles)
  const [editCell, setEditCell] = useState<{ name: string; field: EditField } | null>(null)
  const [editVal, setEditVal] = useState('')

  const filtered = vehicles.filter(v => v.type === activeType)
  const activeCat = CATEGORIES.find(c => c.type === activeType)!
  const hasOverrides = Object.keys(getPriceOverrides()).length > 0

  function startEdit(name: string, field: EditField, current: number) {
    setEditCell({ name, field })
    setEditVal(String(current))
  }

  function commitEdit() {
    if (!editCell) return
    const val = parseInt(editVal)
    if (isNaN(val) || val <= 0) { toast.error('Enter a valid amount'); return }
    setPriceOverride(editCell.name, editCell.field, val)
    setVehicles(getVehicles())
    setEditCell(null)
    toast.success('Price updated')
  }

  function cancelEdit() { setEditCell(null) }

  function resetAll() {
    localStorage.removeItem('topz-price-overrides')
    setVehicles(getVehicles())
    toast.success('All prices reset to defaults')
  }

  const PriceCell = useCallback(({ v, field }: { v: Vehicle; field: EditField }) => {
    const val = v[field]
    const isEditing = editCell?.name === v.name && editCell?.field === field
    const defaultVal = VEHICLES.find(d => d.name === v.name)?.[field] ?? val
    const isChanged = val !== defaultVal

    if (!editMode) return (
      <span style={{ color: field === 'perDayRate' ? '#f0c040' : 'var(--text-muted)', fontWeight: field === 'perDayRate' ? 700 : undefined }}>
        {val === 0 && field !== 'perDayRate' ? '—' : `₹${val}`}
        {isChanged && <span className="ml-1 text-xs text-green-400">*</span>}
      </span>
    )

    if (isEditing) return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
          className="w-20 px-2 py-1 rounded-lg text-sm border outline-none"
          style={{ background: 'var(--input-bg)', borderColor: '#f0c040', color: 'var(--text-base)' }}
        />
        <button onClick={commitEdit} className="text-green-400 hover:text-green-300"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancelEdit} className="text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
      </div>
    )

    return (
      <button
        onClick={() => startEdit(v.name, field, val)}
        className="flex items-center gap-1 group hover:opacity-80 transition-opacity"
        style={{ color: field === 'perDayRate' ? '#f0c040' : 'var(--text-muted)', fontWeight: field === 'perDayRate' ? 700 : undefined }}
      >
        {val === 0 && field !== 'perDayRate' ? '—' : `₹${val}`}
        {isChanged && <span className="text-xs text-green-400">*</span>}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, editCell, editVal, vehicles])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-base)' }}>Topz Cab</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Outstation &middot; Corporate &middot; Luxury Travel Management</p>
        </div>
        <button
          onClick={() => navigate('/topz/quotation')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e', boxShadow: '0 4px 20px rgba(240,192,64,0.3)' }}
        >
          <FileText className="w-4 h-4" />
          New Quotation
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {CATEGORIES.map(cat => {
          const count = VEHICLES.filter(v => v.type === cat.type).length
          const isActive = activeType === cat.type
          return (
            <button
              key={cat.type}
              onClick={() => setActiveType(cat.type)}
              className="rounded-2xl p-5 text-left transition-all hover:scale-[1.02]"
              style={{
                background: isActive ? cat.bg : 'var(--glass-bg)',
                border: `1.5px solid ${isActive ? cat.border : 'var(--glass-border)'}`,
                boxShadow: isActive ? `0 0 28px ${cat.bg}` : undefined,
              }}
            >
              <div className="mb-3" style={{ color: cat.color }}>{cat.icon}</div>
              <p className="font-bold text-base" style={{ color: 'var(--text-base)' }}>{cat.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{count} vehicles</p>
            </button>
          )
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span style={{ color: activeCat.color }}>{activeCat.icon}</span>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{activeCat.label} Rate Card</h2>
            <span className="text-xs text-gray-500">300 km/day minimum</span>
            {hasOverrides && <span className="text-xs text-green-400">* = custom price</span>}
          </div>
          <div className="flex items-center gap-2">
            {hasOverrides && !editMode && (
              <button
                onClick={resetAll}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border text-red-400 border-red-900/40 hover:bg-red-900/10 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Reset to defaults
              </button>
            )}
            <button
              onClick={() => { setEditMode(e => !e); setEditCell(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
              style={editMode
                ? { background: 'rgba(240,192,64,0.15)', borderColor: 'rgba(240,192,64,0.5)', color: '#f0c040' }
                : { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--text-muted)' }
              }
            >
              <Pencil className="w-3 h-3" />
              {editMode ? 'Done Editing' : 'Edit Prices'}
            </button>
          </div>
        </div>

        {editMode && (
          <div className="mb-3 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2" style={{ background: 'rgba(240,192,64,0.08)', border: '1px solid rgba(240,192,64,0.2)', color: '#f0c040' }}>
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            Click any price cell to edit. Changes save immediately. Press Enter to confirm, Esc to cancel.
          </div>
        )}

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  {['Vehicle', 'Type', 'Seats', 'Rate/km', 'Permit/day', 'Driver Allow.', 'Per Day (300km)'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, i) => (
                  <tr key={v.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{v.name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: activeCat.bg, color: activeCat.color, border: `1px solid ${activeCat.border}` }}>{v.category}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{v.seats}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="ratePerKm" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="permitPerDay" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="driverAllowancePerDay" /></td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><PriceCell v={v} field="perDayRate" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
