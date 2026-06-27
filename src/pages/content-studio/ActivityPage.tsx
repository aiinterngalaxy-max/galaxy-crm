import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { getActivity } from '@/lib/content-studio/queries'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { ActivityEntry } from '@/types/content-studio'

const VALID_TYPES = new Set(['content', 'brand', 'idea', 'script', 'shoot'])

const TYPE_META: Record<string, { label: string; icon: string; href: (id: number) => string; dot: string }> = {
  content: { label: 'Content', icon: '▤', href: (id) => `/content-studio/pipeline?edit=${id}`, dot: 'bg-gray-600' },
  brand: { label: 'Brand', icon: '◉', href: () => `/content-studio/brands`, dot: 'bg-gold-500' },
  idea: { label: 'Idea', icon: '✦', href: () => `/content-studio/ideas`, dot: 'bg-purple-400' },
  script: { label: 'Script', icon: '✎', href: () => `/content-studio/scripts`, dot: 'bg-amber-400' },
  shoot: { label: 'Shoot', icon: '◎', href: () => `/content-studio/shoots`, dot: 'bg-rose-400' },
}

const ACTION_TONE: Record<string, string> = {
  created: 'text-emerald-400',
  deleted: 'text-rose-400',
  approved: 'text-emerald-400',
  rejected: 'text-rose-300',
  'stage-change': 'text-gray-200',
  'status-change': 'text-gray-200',
  pitched: 'text-amber-400',
}

function fmtTime(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts + (ts.includes('T') ? '' : 'Z')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

export function ActivityPage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState<ActivityEntry[]>([])

  const typeFilter = VALID_TYPES.has(searchParams.get('type') || '') ? (searchParams.get('type') as string) : ''

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getActivity(typeFilter || undefined)
      .then(setEntries)
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [typeFilter])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Page>
      <PageHeader title="Activity Log" subtitle="Recent changes across all content, brands, ideas, scripts, and shoots" />

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : error ? (
        <div className="glass-card p-5 text-sm text-rose-300">{error}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <Link to="/content-studio/activity" className={`badge text-xs font-semibold ${!typeFilter ? 'bg-gold-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              All
            </Link>
            {Object.entries(TYPE_META).map(([key, m]) => (
              <Link key={key} to={`/content-studio/activity?type=${key}`} className={`badge text-xs font-semibold ${typeFilter === key ? 'bg-gold-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {m.icon} {m.label}
              </Link>
            ))}
            {entries.length > 0 && <span className="ml-auto text-xs text-gray-600">{entries.length} entries</span>}
          </div>

          {entries.length === 0 ? (
            <div className="glass-card p-10 text-center">
              <p className="text-gray-500 text-sm">No activity recorded yet.</p>
              <p className="text-gray-600 text-xs mt-1">Changes to content, brands, ideas, scripts, and shoots will appear here.</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800 bg-gray-900/60">
                    <th className="px-5 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">Action</th>
                    <th className="px-3 py-2.5 font-semibold">Detail</th>
                    <th className="px-3 py-2.5 font-semibold">Actor</th>
                    <th className="px-5 py-2.5 font-semibold text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const meta = TYPE_META[e.entity_type] ?? { label: e.entity_type, icon: '·', href: () => '#', dot: 'bg-gray-700' }
                    const toneCls = ACTION_TONE[e.action] ?? 'text-gray-400'
                    return (
                      <tr key={e.id} className="border-b border-gray-800/60 hover:bg-gray-900/40">
                        <td className="px-5 py-2.5">
                          <Link to={meta.href(e.entity_id)} className="flex items-center gap-1.5 group">
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`} />
                            <span className="font-medium text-gray-100 group-hover:underline">{meta.icon} {meta.label}</span>
                            <span className="text-gray-600 text-xs">#{e.entity_id}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5"><span className={`font-semibold ${toneCls}`}>{e.action}</span></td>
                        <td className="px-3 py-2.5 text-gray-400 max-w-[260px] truncate" title={e.detail}>{e.detail}</td>
                        <td className="px-3 py-2.5"><span className="badge bg-gray-800 text-gray-300 text-xs">{e.actor || 'System'}</span></td>
                        <td className="px-5 py-2.5 text-right text-gray-600 text-xs whitespace-nowrap">{fmtTime(e.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Page>
  )
}
