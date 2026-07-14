import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export function ChooseAppPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0]

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg animate-fade-in space-y-4">
        <div className="rounded-2xl p-8 text-center" style={{
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(48px) saturate(200%)',
          WebkitBackdropFilter: 'blur(48px) saturate(200%)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderTopColor: 'rgba(255,255,255,0.20)',
          borderLeftColor: 'rgba(255,255,255,0.13)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.20)',
        }}>
          <p className="text-sm text-gray-400 mb-1">Welcome{firstName ? `, ${firstName}` : ''}</p>
          <h2 className="text-xl font-semibold text-gray-100 mb-8">Which would you like to open?</h2>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => navigate('/')}
              className="rounded-xl p-6 border transition-all hover:scale-[1.03]"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(201,168,64,0.3)' }}
            >
              <img src="/galaxy-logo.png" alt="Galaxy" className="w-14 h-14 mx-auto mb-3 object-contain" />
              <p className="font-bold" style={{ color: '#C9A840' }}>Galaxy CRM</p>
              <p className="text-xs text-gray-500 mt-1">Home Automation CRM</p>
            </button>

            <button
              onClick={() => navigate('/topz')}
              className="rounded-xl p-6 border transition-all hover:scale-[1.03]"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(240,192,64,0.3)' }}
            >
              <img src="/topz-logo.png" alt="Topz Cab" className="w-14 h-14 mx-auto mb-3 object-contain" />
              <p className="font-bold" style={{ color: '#f0c040' }}>Topz Cab</p>
              <p className="text-xs text-gray-500 mt-1">Travel Management</p>
            </button>
          </div>

          <p className="mt-6 text-xs text-gray-600">You can switch between them anytime from the sidebar.</p>
        </div>
      </div>
    </div>
  )
}
