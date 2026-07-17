import { useState, useEffect } from 'react'
import { Settings, Users, Package, Shield, Zap, Clock, CheckCircle2, XCircle, Palette } from 'lucide-react'
import { useTheme, type AppTheme } from '../../contexts/ThemeContext'
import { ProductCatalogTab } from './ProductCatalogTab'
import { RolePermissionsTab } from './RolePermissionsTab'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, getDocs, updateDoc, doc, serverTimestamp, query, where
} from '../../lib/firebase'
import { ROLE_LABELS } from '../../lib/utils'
import type { User, UserRole, Department } from '../../types'
import toast from 'react-hot-toast'

interface AccessRequest {
  id: string
  userId: string
  userName: string
  userEmail: string
  userAvatar: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: unknown
}

const ROLE_OPTIONS = Object.entries(ROLE_LABELS)
  .filter(([v]) => v !== 'pending')
  .map(([v, l]) => ({ value: v, label: l }))

const DEPT_OPTIONS: { value: Department; label: string }[] = [
  { value: 'management', label: 'Management' },
  { value: 'business_development', label: 'Business Development' },
  { value: 'project_management', label: 'Project Management' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'ai_department', label: 'AI Department' },
]

type Tab = 'users' | 'products' | 'permissions' | 'system'

const THEMES: { id: AppTheme; label: string; desc: string; preview: { bg: string; card: string; border: string; orb1?: string; orb2?: string; text: string; textMuted: string } }[] = [
  {
    id: 'dark-classic',
    label: 'Dark Classic',
    desc: 'Minimal dark glass, no distractions',
    preview: { bg: '#09090b', card: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', textMuted: '#6b7280' },
  },
  {
    id: 'dark-cosmos',
    label: 'Dark Cosmos',
    desc: 'Dark glass with gold & purple orbs',
    preview: { bg: '#08080d', card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', orb1: 'rgba(201,168,64,0.35)', orb2: 'rgba(110,80,220,0.28)', text: '#f1f5f9', textMuted: '#94a3b8' },
  },
  {
    id: 'light-glass',
    label: 'Light Glass',
    desc: 'Frosted white glass, iOS style',
    preview: { bg: '#dde1eb', card: 'rgba(255,255,255,0.55)', border: 'rgba(255,255,255,0.80)', orb1: 'rgba(210,210,235,0.80)', orb2: 'rgba(195,200,230,0.65)', text: '#0f172a', textMuted: '#475569' },
  },
  {
    id: 'funky-chaos',
    label: '🎪 Funky Chaos',
    desc: 'Maximum chaos. Zero chill.',
    preview: { bg: '#0a0015', card: 'rgba(255,0,200,0.10)', border: 'rgba(0,255,200,0.50)', orb1: 'rgba(255,0,200,0.55)', orb2: 'rgba(0,255,180,0.45)', text: '#f0e0ff', textMuted: '#c084fc' },
  },
]

function ThemePicker() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-3 mb-5">
        <Palette className="w-5 h-5 text-gold-400" />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Appearance</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {THEMES.map(t => {
          const active = theme === t.id
          const isFunky = t.id === 'funky-chaos'
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="text-left rounded-xl overflow-hidden transition-all"
              style={{
                border: active ? (isFunky ? '2px solid #ff00cc' : '2px solid #C9A840') : '2px solid transparent',
                outline: active ? (isFunky ? '1px solid rgba(255,0,200,0.4)' : '1px solid rgba(201,168,64,0.3)') : '1px solid rgba(255,255,255,0.08)',
                boxShadow: active ? (isFunky ? '0 0 20px rgba(255,0,200,0.35), 0 0 40px rgba(0,255,200,0.15)' : '0 0 16px rgba(201,168,64,0.20)') : 'none',
                animation: isFunky && active ? 'funky-border-spin 3s linear infinite' : undefined,
              }}
            >
              {/* Mini preview */}
              <div className="relative overflow-hidden" style={{ background: t.preview.bg, height: 90 }}>
                {t.preview.orb1 && (
                  <>
                    <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${t.preview.orb1} 0%, transparent 70%)`, filter: 'blur(16px)' }} />
                    <div style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: 70, height: 70, borderRadius: '50%', background: `radial-gradient(circle, ${t.preview.orb2} 0%, transparent 70%)`, filter: 'blur(14px)' }} />
                  </>
                )}
                {isFunky && (
                  <>
                    <div style={{ position: 'absolute', top: '30%', left: '40%', width: 50, height: 50, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,220,0,0.50) 0%, transparent 70%)', filter: 'blur(12px)' }} />
                    <div style={{ position: 'absolute', top: '5%', right: '5%', width: 30, height: 30, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,150,255,0.55) 0%, transparent 70%)', filter: 'blur(8px)' }} />
                  </>
                )}
                <div style={{ position: 'absolute', top: 12, left: 10, right: 10, height: 28, borderRadius: 8, background: t.preview.card, border: `1px solid ${t.preview.border}`, backdropFilter: 'blur(8px)' }} />
                <div style={{ position: 'absolute', top: 22, left: 18, width: 40, height: 6, borderRadius: 3, background: isFunky ? '#ff00cc' : t.preview.textMuted, opacity: 0.7 }} />
                <div style={{ position: 'absolute', top: 48, left: 10, right: 10, height: 20, borderRadius: 6, background: t.preview.card, border: `1px solid ${t.preview.border}`, backdropFilter: 'blur(8px)' }} />
                <div style={{ position: 'absolute', top: 55, left: 18, width: 60, height: 5, borderRadius: 3, background: isFunky ? '#00ffcc' : t.preview.textMuted, opacity: 0.5 }} />
              </div>
              {/* Label */}
              <div className="px-3 py-2.5" style={{ background: 'var(--glass-bg)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold" style={{ color: isFunky ? '#ff00cc' : 'var(--text-base)' }}>{t.label}</p>
                  {active && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: isFunky ? '#00ffcc' : '#C9A840' }} />}
                </div>
                <p className="text-xs mt-0.5" style={{ color: isFunky ? '#c084fc' : 'var(--text-muted)' }}>{t.desc}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { user: currentUser, isAdmin, isManagement, role } = useAuth()
  const isDeptHead = role === 'dept_head'
  const canManageUsers = isManagement || isDeptHead
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [approveRoles, setApproveRoles] = useState<Record<string, UserRole>>({})
  const [approveDepts, setApproveDepts] = useState<Record<string, Department>>({})
  const [approving, setApproving] = useState<string | null>(null)

  useEffect(() => {
    if (!canManageUsers) return
    Promise.all([
      getDocs(collection(db, 'users')).then(snap =>
        snap.docs.map(d => ({ id: d.id, ...d.data() }) as User)
      ),
      isManagement
        ? getDocs(query(collection(db, 'accessRequests'), where('status', '==', 'pending'))).then(snap =>
            snap.docs.map(d => ({ id: d.id, ...d.data() }) as AccessRequest)
          )
        : Promise.resolve([] as AccessRequest[]),
    ])
      .then(([u, r]) => {
        // Dept heads only see users in their own department
        const filtered = isDeptHead
          ? u.filter(x => x.department === currentUser?.department)
          : u
        setUsers(filtered)
        setRequests(r)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [canManageUsers])

  const approveRequest = async (req: AccessRequest) => {
    const role = approveRoles[req.id] ?? 'bd_exec'
    const dept = approveDepts[req.id] ?? 'business_development'
    setApproving(req.id)
    try {
      await updateDoc(doc(db, 'users', req.userId), {
        role,
        department: dept,
        isActive: true,
        updatedAt: serverTimestamp(),
      })
      await updateDoc(doc(db, 'accessRequests', req.id), {
        status: 'approved',
        approvedBy: currentUser?.id,
        approvedAt: serverTimestamp(),
      })
      setRequests(prev => prev.filter(r => r.id !== req.id))
      setUsers(prev => prev.map(u => u.id === req.userId ? { ...u, role, department: dept, isActive: true } : u))
      toast.success(`${req.userName} approved as ${ROLE_LABELS[role]}`)
    } catch {
      toast.error('Approval failed')
    } finally {
      setApproving(null)
    }
  }

  const rejectRequest = async (req: AccessRequest) => {
    setApproving(req.id)
    try {
      await updateDoc(doc(db, 'users', req.userId), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
      await updateDoc(doc(db, 'accessRequests', req.id), {
        status: 'rejected',
        rejectedBy: currentUser?.id,
        rejectedAt: serverTimestamp(),
      })
      setRequests(prev => prev.filter(r => r.id !== req.id))
      toast.success(`${req.userName}'s request rejected`)
    } catch {
      toast.error('Rejection failed')
    } finally {
      setApproving(null)
    }
  }

  const updateUserRole = async (userId: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
      toast.success('Role updated')
    } catch {
      toast.error('Update failed')
    }
  }

  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      await updateDoc(doc(db, 'users', userId), { isActive: !isActive, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: !isActive } : u))
      toast.success(isActive ? 'User deactivated' : 'User activated')
    } catch {
      toast.error('Update failed')
    }
  }

  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all')

  const activeUsers = users.filter(u => {
    if (u.role === 'pending') return false
    if (filterRole === 'all') return true
    return u.role === filterRole
  })

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: 'Team Members', icon: <Users className="w-4 h-4" /> },
    { id: 'products', label: 'Product Catalog', icon: <Package className="w-4 h-4" /> },
    { id: 'permissions', label: 'Permissions', icon: <Shield className="w-4 h-4" /> },
    { id: 'system', label: 'System', icon: <Zap className="w-4 h-4" /> },
  ]

  return (
    <div className={`space-y-5 ${tab === 'products' ? '' : 'max-w-4xl'}`}>
      <div>
        <h1 className="page-title flex items-center gap-2"><Settings className="w-6 h-6" /> Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage team, roles, and system configuration</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.icon}{t.label}
            {t.id === 'users' && requests.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-yellow-500 text-gray-950 text-xs font-bold flex items-center justify-center">
                {requests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="space-y-4">

          {/* Pending Access Requests */}
          {requests.length > 0 && (
            <Card className="border-yellow-800/40 bg-yellow-900/5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-yellow-300">Pending Access Requests</h2>
                <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full">{requests.length}</span>
              </div>
              <div className="space-y-3">
                {requests.map(req => (
                  <div key={req.id} className="bg-gray-800/60 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      {req.userAvatar ? (
                        <img src={req.userAvatar} className="w-9 h-9 rounded-full shrink-0" alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-indigo-900/50 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                          {req.userName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-200">{req.userName}</p>
                        <p className="text-xs text-gray-500">{req.userEmail}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-yellow-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                        Awaiting approval
                      </span>
                    </div>

                    {/* Role + Dept assignment */}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="form-label mb-1">Assign Role</label>
                        <select
                          className="form-input text-sm py-1.5 w-full"
                          value={approveRoles[req.id] ?? 'bd_exec'}
                          onChange={e => setApproveRoles(prev => ({ ...prev, [req.id]: e.target.value as UserRole }))}
                        >
                          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="form-label mb-1">Department</label>
                        <select
                          className="form-input text-sm py-1.5 w-full"
                          value={approveDepts[req.id] ?? 'business_development'}
                          onChange={e => setApproveDepts(prev => ({ ...prev, [req.id]: e.target.value as Department }))}
                        >
                          {DEPT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {isManagement && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          variant="success"
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          loading={approving === req.id}
                          onClick={() => approveRequest(req)}
                        >
                          Approve & Grant Access
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<XCircle className="w-3.5 h-3.5" />}
                          loading={approving === req.id}
                          onClick={() => rejectRequest(req)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {isDeptHead && (
                      <p className="text-xs text-gray-600 mt-3">Contact a super admin to approve this request.</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Active Team Members */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-400">
                {activeUsers.length}
                {filterRole !== 'all' && ` of ${users.filter(u => u.role !== 'pending').length}`}
                {' '}team members
                {filterRole !== 'all' && <span className="text-indigo-400"> · {ROLE_LABELS[filterRole as UserRole]}</span>}
              </p>
              {filterRole !== 'all' && (
                <button onClick={() => setFilterRole('all')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Clear filter
                </button>
              )}
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterRole('all')}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filterRole === 'all' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                >
                  All
                </button>
                {(Object.entries(ROLE_LABELS) as [UserRole, string][])
                  .filter(([v]) => v !== 'pending')
                  .map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setFilterRole(value)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filterRole === value ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
          </div>
          <Card padding="none">
            {loading && <div className="p-8 text-center text-sm text-gray-600">Loading…</div>}
            {!loading && activeUsers.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-600">No team members yet</div>
            )}
            <div className="divide-y divide-gray-800">
              {activeUsers.map(u => (
                <div key={u.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-9 h-9 rounded-full bg-indigo-900/50 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">{u.name}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                  {isManagement ? (
                    <select
                      value={u.role}
                      onChange={e => updateUserRole(u.id, e.target.value as UserRole)}
                      className="form-input text-xs py-1.5 w-40 shrink-0"
                      disabled={u.id === currentUser?.id}
                    >
                      {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <Badge color="text-indigo-400" bg="bg-indigo-900/30">{ROLE_LABELS[u.role]}</Badge>
                  )}
                  <Badge
                    color={u.isActive ? 'text-green-400' : 'text-gray-500'}
                    bg={u.isActive ? 'bg-green-900/30' : 'bg-gray-800'}
                    dot
                    dotColor={u.isActive ? 'bg-green-500' : 'bg-gray-600'}
                  >
                    {u.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {isManagement && u.id !== currentUser?.id && (
                    <button
                      onClick={() => toggleUserStatus(u.id, u.isActive)}
                      className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
                    >
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Products Tab */}
      {tab === 'products' && <ProductCatalogTab />}

      {/* Permissions Tab */}
      {tab === 'permissions' && <RolePermissionsTab />}

      {/* System Tab */}
      {tab === 'system' && (
        <div className="space-y-4">
          <ThemePicker />
          {isAdmin && <ProjectStatsMaintenance />}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-5 h-5 text-yellow-400" />
              <h3 className="text-sm font-semibold text-gray-200">AI Configuration</h3>
            </div>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-center justify-between py-2 border-b border-gray-800">
                <span>Claude API (Daily Digest, Lead Scoring)</span>
                <Badge color="text-yellow-400" bg="bg-yellow-900/30">Not configured</Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-800">
                <span>Voice Report Transcription</span>
                <Badge color="text-yellow-400" bg="bg-yellow-900/30">Not configured</Badge>
              </div>
              <p className="text-xs text-gray-600 pt-2">
                Add <code className="text-indigo-400">VITE_ANTHROPIC_API_KEY</code> to your <code>.env</code> file to enable AI features.
              </p>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-green-400" />
              <h3 className="text-sm font-semibold text-gray-200">Security</h3>
            </div>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex items-center justify-between py-2 border-b border-gray-800">
                <span>Authentication</span>
                <Badge color="text-green-400" bg="bg-green-900/30">Google SSO</Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-800">
                <span>Database Rules</span>
                <Badge color="text-green-400" bg="bg-green-900/30">RBAC Active</Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <span>Audit Logs</span>
                <Badge color="text-green-400" bg="bg-green-900/30">Enabled</Badge>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// One-time (re-runnable) backfill: recompute each project's denormalized
// workflowTotal/workflowDone/stagesPaidAmount from its actual workflow stages,
// so list views and the CRM assistant are exact immediately instead of healing
// project-by-project as each is opened. Reads every project's workflow
// subcollection once — fine as a manual maintenance action, unlike the
// per-page-load scans this denormalization removed.
function ProjectStatsMaintenance() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ scanned: number; updated: number } | null>(null)

  async function recompute() {
    setRunning(true)
    setResult(null)
    setProgress(null)
    try {
      const projSnap = await getDocs(collection(db, 'projects'))
      const total = projSnap.size
      let updated = 0
      for (let i = 0; i < projSnap.docs.length; i++) {
        const p = projSnap.docs[i]
        const wf = await getDocs(collection(db, 'projects', p.id, 'workflow'))
        const wfTotal = wf.size
        const wfDone = wf.docs.filter(d => d.data().status === 'completed').length
        const paid = wf.docs.reduce((sum, d) => {
          const s = d.data()
          return s.status === 'completed' ? sum + (s.paymentAmount || 0) : sum
        }, 0)
        const cur = p.data()
        if (cur.workflowTotal !== wfTotal || cur.workflowDone !== wfDone || cur.stagesPaidAmount !== paid) {
          await updateDoc(doc(db, 'projects', p.id), {
            workflowTotal: wfTotal,
            workflowDone: wfDone,
            stagesPaidAmount: paid,
          })
          updated++
        }
        setProgress({ done: i + 1, total })
      }
      setResult({ scanned: total, updated })
      toast.success(`Recomputed ${total} projects — ${updated} updated`)
    } catch (e) {
      console.error(e)
      toast.error('Recompute failed — see console')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-3 mb-2">
        <Zap className="w-5 h-5 text-indigo-400" />
        <h3 className="text-sm font-semibold text-gray-200">Maintenance</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Recompute every project's stage counts and collected amount from its workflow stages.
        Run once after a denormalization change, or any time the figures look off.
      </p>
      <Button onClick={recompute} loading={running} size="sm">
        Recompute project stats
      </Button>
      {running && progress && (
        <p className="text-xs text-gray-500 mt-3">Processing {progress.done}/{progress.total}…</p>
      )}
      {result && (
        <p className="text-xs text-green-400 mt-3 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> Done — scanned {result.scanned}, updated {result.updated}.
        </p>
      )}
    </Card>
  )
}
