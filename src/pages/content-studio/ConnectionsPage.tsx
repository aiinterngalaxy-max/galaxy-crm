import { useCallback, useEffect, useState } from 'react'
import { getSyncStatus } from '@/lib/content-studio/queries'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { SyncButton } from '@/components/content-studio/SyncButton'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { SyncLogEntry, SyncStatusEntry } from '@/types/content-studio'

const SETUP: Record<string, { title: string; steps: string[]; vars: string[] }> = {
  youtube: {
    title: 'YouTube (easiest — public stats need only an API key)',
    vars: ['YT_API_KEY', 'YT_CHANNEL_ID', 'YT_BRAND_ID (optional, default 1)'],
    steps: [
      "Google Cloud Console → create a project → enable 'YouTube Data API v3'.",
      'Create an API key (Credentials → Create credentials → API key).',
      'Find your channel id (UC…) — YouTube → Settings → Advanced, or use your @handle.',
      'Set YT_API_KEY and YT_CHANNEL_ID in the server env, then press Sync.',
    ],
  },
  instagram: {
    title: 'Instagram (Meta Graph API)',
    vars: ['IG_ACCESS_TOKEN', 'IG_USER_ID', 'IG_BRAND_ID (optional)'],
    steps: [
      'Convert the IG account to Business/Creator and link it to a Facebook Page.',
      "developers.facebook.com → create an app → add 'Instagram Graph API'.",
      'Generate a long-lived access token with instagram_basic + instagram_manage_insights + pages_read_engagement.',
      'Get the IG business user id (via /me/accounts → instagram_business_account).',
      'Set IG_ACCESS_TOKEN and IG_USER_ID in the server env, then Sync.',
    ],
  },
  linkedin: {
    title: 'LinkedIn (Marketing API — needs app review)',
    vars: ['LI_ACCESS_TOKEN', 'LI_ORG_ID', 'LI_BRAND_ID (optional)'],
    steps: [
      "developer.linkedin.com → create an app, request the 'Community Management API' / Marketing products.",
      'Get approved for r_organization_social + rw_organization_admin (can take days).',
      'OAuth as a page admin to mint an access token; note the numeric organization id.',
      'Set LI_ACCESS_TOKEN and LI_ORG_ID in the server env, then Sync.',
    ],
  },
}

export function ConnectionsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<SyncStatusEntry[]>([])
  const [log, setLog] = useState<SyncLogEntry[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getSyncStatus()
      .then((j) => {
        setStatus(j.status)
        setLog(j.log)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <div className="glass-card p-5 text-sm text-rose-300">{error}</div>

  const anyConnected = status.some((s) => s.connected)

  return (
    <Page>
      <PageHeader title="Connections" subtitle="Link Galaxy's social accounts to pull real-time performance data" right={anyConnected ? <SyncButton onSynced={load} /> : undefined} />

      {!anyConnected && (
        <div className="glass-card p-5 mb-6 border-l-4 border-amber-500">
          <div className="font-semibold text-gray-100">No platforms connected yet — data is demo.</div>
          <div className="text-sm text-gray-400 mt-1">
            Add the API credentials below as environment variables on the marketing dashboard server, redeploy, then press{' '}
            <span className="font-semibold">Sync live data</span>. Each connected platform&apos;s recent posts and real metrics replace the demo numbers.
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {status.map((s) => {
          const setup = SETUP[s.key]
          return (
            <div key={s.key} className="glass-card p-5 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="font-bold text-gray-100">{s.label}</div>
                <span className={`badge ${s.connected ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                  {s.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{setup?.title}</div>

              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Env vars</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {setup?.vars.map((v) => (
                    <code key={v} className="badge bg-gray-800 text-gray-300">{v}</code>
                  ))}
                </div>
              </div>

              <ol className="mt-3 space-y-1.5 text-xs text-gray-400 list-decimal list-inside">
                {setup?.steps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ol>
            </div>
          )
        })}
      </div>

      <div className="glass-card mt-6">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-bold text-gray-100">Recent syncs</h2>
          {anyConnected && <SyncButton small onSynced={load} />}
        </div>
        <div className="divide-y divide-gray-800">
          {log.length === 0 && <div className="p-5 text-sm text-gray-500">No syncs yet.</div>}
          {log.map((l, i) => (
            <div key={i} className="px-5 py-2.5 flex items-center gap-3 text-sm">
              <span className={`badge ${l.ok ? 'bg-emerald-900/40 text-emerald-300' : 'bg-rose-900/40 text-rose-300'}`}>{l.ok ? 'ok' : 'fail'}</span>
              <span className="font-medium text-gray-100 w-24">{l.platform}</span>
              <span className="text-gray-500 flex-1 truncate">{l.detail}</span>
              <span className="text-xs text-gray-600">{l.ts}</span>
            </div>
          ))}
        </div>
      </div>
    </Page>
  )
}
