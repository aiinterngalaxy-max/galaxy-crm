import { useState, useEffect } from 'react'
import { db, doc, getDoc } from '../../lib/firebase'
import { setDoc } from 'firebase/firestore'
import { ROLE_LABELS } from '../../lib/utils'
import type { UserRole } from '../../types'
import { Button } from '../../components/ui/Button'
import { Shield } from 'lucide-react'
import toast from 'react-hot-toast'

const MODULES = [
  { id: 'dashboard',      label: 'Dashboard' },
  { id: 'leads',          label: 'Leads' },
  { id: 'b2b-campaign',   label: 'B2B Campaign' },
  { id: 'partners',       label: 'B2B Partners' },
  { id: 'customers',      label: 'Customers' },
  { id: 'quotations',     label: 'Quotations' },
  { id: 'projects',       label: 'Projects' },
  { id: 'daily-reports',  label: 'Daily Reports' },
  { id: 'content-studio', label: 'Content Studio' },
  { id: 'inventory',      label: 'Inventory' },
  { id: 'hr',             label: 'HR' },
  { id: 'notifications',  label: 'Notifications' },
  { id: 'settings',       label: 'Settings' },
  { id: 'recycle-bin',    label: 'Recycle Bin' },
]

// Roles that can be configured (super_admin always has everything)
const CONFIGURABLE_ROLES: UserRole[] = [
  'management', 'dept_head', 'bd_exec', 'project_manager',
  'marketing', 'ai_team', 'hr', 'topz',
]

export type RolePermissionsMap = Record<string, string[]>

export async function loadRolePermissions(): Promise<RolePermissionsMap | null> {
  const snap = await getDoc(doc(db, 'settings', 'rolePermissions'))
  return snap.exists() ? (snap.data() as RolePermissionsMap) : null
}

export function RolePermissionsTab() {
  const [perms, setPerms] = useState<RolePermissionsMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadRolePermissions().then(data => {
      if (data) {
        setPerms(data)
      } else {
        // seed from current hardcoded defaults
        const defaults: RolePermissionsMap = {
          management:      MODULES.map(m => m.id),
          dept_head:       ['dashboard','leads','b2b-campaign','partners','customers','quotations','projects','daily-reports','inventory','notifications'],
          bd_exec:         ['dashboard','leads','b2b-campaign','partners','customers','daily-reports','notifications'],
          project_manager: ['dashboard','customers','quotations','projects','daily-reports','inventory','notifications'],
          marketing:       ['dashboard','content-studio','daily-reports','notifications'],
          ai_team:         MODULES.map(m => m.id),
          hr:              ['dashboard','hr','daily-reports','notifications'],
          topz:            ['dashboard'],
        }
        setPerms(defaults)
      }
      setLoading(false)
    })
  }, [])

  function toggle(role: string, moduleId: string) {
    setPerms(prev => {
      const current = new Set(prev[role] ?? [])
      if (current.has(moduleId)) current.delete(moduleId)
      else current.add(moduleId)
      return { ...prev, [role]: Array.from(current) }
    })
  }

  function setAll(role: string, checked: boolean) {
    setPerms(prev => ({
      ...prev,
      [role]: checked ? MODULES.map(m => m.id) : [],
    }))
  }

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'rolePermissions'), perms)
      toast.success('Permissions saved — changes apply on next page load')
    } catch {
      toast.error('Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading permissions…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-gold-400" />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-base)' }}>Role Permissions</h2>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 ml-7">Tick which sidebar modules each role can access. Super Admin always has full access.</p>
        </div>
        <Button onClick={save} loading={saving} size="sm">Save changes</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <th className="text-left px-4 py-3 text-gray-400 font-medium w-40 sticky left-0 z-10" style={{ background: 'var(--sidebar-bg)' }}>
                Module
              </th>
              {CONFIGURABLE_ROLES.map(role => (
                <th key={role} className="px-3 py-3 text-center text-gray-300 font-medium min-w-[90px]">
                  <div>{ROLE_LABELS[role]}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <button
                      onClick={() => setAll(role, true)}
                      className="text-[10px] text-green-400 hover:text-green-300 transition-colors"
                    >all</button>
                    <span className="text-gray-700">·</span>
                    <button
                      onClick={() => setAll(role, false)}
                      className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                    >none</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((mod, i) => (
              <tr
                key={mod.id}
                className="border-b border-gray-800/60 transition-colors hover:bg-white/[0.02]"
                style={i % 2 === 0 ? { background: 'rgba(255,255,255,0.01)' } : {}}
              >
                <td className="px-4 py-2.5 text-gray-300 font-medium sticky left-0 z-10" style={{ background: 'var(--sidebar-bg)' }}>
                  {mod.label}
                  {mod.id === 'dashboard' && (
                    <span className="ml-1.5 text-[10px] text-gray-600">(always)</span>
                  )}
                </td>
                {CONFIGURABLE_ROLES.map(role => {
                  const checked = perms[role]?.includes(mod.id) ?? false
                  const isDashboard = mod.id === 'dashboard'
                  return (
                    <td key={role} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={isDashboard ? true : checked}
                        disabled={isDashboard}
                        onChange={() => !isDashboard && toggle(role, mod.id)}
                        className="w-4 h-4 rounded accent-yellow-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
