import { useNavigate } from 'react-router-dom'
import { FileText, Car } from 'lucide-react'
import { VEHICLES } from './data/rateCard'

export function TopzDashboard() {
  const navigate = useNavigate()

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-base)' }}>Topz Cab</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Outstation · Corporate · Luxury Travel Management</p>
      </div>

      {/* Quick action */}
      <button
        onClick={() => navigate('/topz/quotation')}
        className="w-full sm:w-auto flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-base transition-all hover:scale-105"
        style={{ background: 'linear-gradient(135deg,#f0c040,#c8960a)', color: '#1a1a2e', boxShadow: '0 4px 24px rgba(240,192,64,0.35)' }}
      >
        <FileText className="w-5 h-5" />
        Generate New Quotation
      </button>

      {/* Rate card preview */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Car className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-base)' }}>Rate Card — Outstation</h2>
          <span className="text-xs text-gray-500">(300 km/day min)</span>
        </div>
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--glass-border)' }}>
                  {['Vehicle', 'Seats', 'Rate/km', 'Permit/day', 'Driver Allow.', 'Per Day (300km)'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VEHICLES.map((v, i) => (
                  <tr key={v.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: '1px solid var(--glass-border)' }}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-base)' }}>{v.name}</td>
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
