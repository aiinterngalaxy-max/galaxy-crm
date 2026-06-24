import { useState } from 'react'
import { Zap, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { signInWithGoogle, isFirebaseConfigured } from '../../lib/firebase'
import { Button } from '../../components/ui/Button'
import toast from 'react-hot-toast'

export function LoginPage() {
  const [loading, setLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setLoading(true)
    try {
      await signInWithGoogle()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-md animate-fade-in space-y-4">
        {/* Setup Banner — shown when Firebase not yet configured */}
        {!isFirebaseConfigured && (
          <div className="bg-yellow-950/60 border border-yellow-800/60 rounded-2xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-300">Firebase not configured yet</p>
                <p className="text-xs text-yellow-700 mt-0.5">
                  The app is running but needs Firebase credentials to work. Follow the steps below.
                </p>
              </div>
            </div>
            <ol className="space-y-2 text-xs text-yellow-600">
              {[
                'Go to console.firebase.google.com and create a project called "Galaxy CRM"',
                'Enable Authentication → Google sign-in',
                'Enable Firestore Database (asia-south1 region)',
                'Copy the web app config keys',
                'Create a .env file in the project folder (copy from .env.example)',
                'Paste your Firebase keys into .env, then restart: npm run dev',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-yellow-900 text-yellow-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-4 pt-3 border-t border-yellow-900/50 flex items-center gap-2 text-xs text-yellow-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-yellow-600" />
              Full setup guide in <code className="text-yellow-500">SETUP.md</code> in this folder
            </div>
          </div>
        )}

        {/* Login Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-50">Galaxy OS</h1>
              <p className="text-xs text-gray-500">Home Automation CRM</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-gray-100 mb-1">Welcome back</h2>
          <p className="text-sm text-gray-400 mb-6">
            Sign in with your company Google account to continue.
          </p>

          <Button
            variant="secondary"
            className="w-full justify-center py-2.5"
            loading={loading}
            disabled={!isFirebaseConfigured}
            onClick={handleGoogleSignIn}
            icon={
              !loading && (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )
            }
          >
            {isFirebaseConfigured ? 'Sign in with Google' : 'Configure Firebase first'}
          </Button>

          {!isFirebaseConfigured && (
            <p className="mt-3 text-xs text-gray-700 text-center">
              Sign-in is disabled until Firebase credentials are added to .env
            </p>
          )}

          {isFirebaseConfigured && (
            <p className="mt-6 text-xs text-gray-600 text-center">
              Only authorised Galaxy Home Automation team members can access this system.
            </p>
          )}
        </div>

        {/* Footer */}
        <p className="mt-2 text-center text-xs text-gray-700">
          Galaxy Home Automation © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
