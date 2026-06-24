import { Clock, Zap, LogOut } from 'lucide-react'
import { signOut } from '../../lib/firebase'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'

export function PendingApprovalPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl text-center">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-lg font-bold text-gray-50">Galaxy OS</h1>
              <p className="text-xs text-gray-500">Home Automation CRM</p>
            </div>
          </div>

          {/* Pending icon */}
          <div className="w-16 h-16 bg-yellow-900/30 border border-yellow-800/50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Clock className="w-8 h-8 text-yellow-400" />
          </div>

          <h2 className="text-xl font-semibold text-gray-100 mb-2">Access Pending Approval</h2>
          <p className="text-sm text-gray-400 mb-1">
            Hi <span className="text-gray-200 font-medium">{user?.name}</span>, your account has been created.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            The admin has been notified and will assign your role shortly. You'll be able to access the system once approved.
          </p>

          <div className="bg-gray-800/60 rounded-xl p-4 mb-6 text-left space-y-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Your account</p>
            <p className="text-sm text-gray-300">{user?.name}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-xs text-yellow-400">Waiting for admin approval</span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-center"
            icon={<LogOut className="w-4 h-4" />}
            onClick={() => signOut()}
          >
            Sign out
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-gray-700">
          Galaxy Home Automation © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
