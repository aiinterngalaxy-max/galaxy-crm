import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Car, Bus, Users } from 'lucide-react'
import { VEHICLES, type VehicleType } from './data/rateCard'

const CATEGORIES = [
  { type: 'car' as VehicleType,        label: 'Cars',       icon: <Car className="w-7 h-7" />,   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.30)'  },
  { type: 'traveller' as VehicleType,  label: 'Travellers', icon: <Users className="w-7 h-7" />, color: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
  { type: 'bus' as VehicleType,        label: 'Bus',        icon: <Bus className="w-7 h-7" />,   color: '#f0c040', bg: 'rgba(240,192,64,0.10)',  border: 'rgba(240,192,64,0.30)'  },
]

export function TopzDashboard() {
  const navigate = useNavigate()
  const [activeType, setActiveType] = useState<VehicleType>('car')

  const filtered = VEHICLES.filter(v => v.type === activeType)
  const activeCat = CATEGORIES.find(c => c.type === activeType)!

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-base)' }}>Topz Cab</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Outstation · Corporate · Luxury Travel Management</p>
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

      {/* Category cards */}
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

      {/* Rate table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: activeCat.color }}>{activeCat.icon}</span>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>{activeCat.label} Rate Card</h2>
          <span className="text-xs text-gray-500">· 300 km/day minimum</span>
        </div>
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
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>₹{v.ratePerKm}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{v.permitPerDay ? `₹${v.permitPerDay}` : '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>₹{v.driverAllowancePerDay}</td>
                    <td className="px-4 py-2.5 font-bold whitespace-nowrap" style={{ color: '#f0c040' }}>₹{v.perDayRate.toLocaleString('en-IN')}</td>
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
