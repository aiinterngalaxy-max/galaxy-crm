import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBrands, getPerformance, getSyncStatus } from '@/lib/content-studio/queries'
import { Page, PageHeader, PlatformChip, ProgressBar } from '@/components/content-studio/ui'
import { compact, num } from '@/lib/content-studio/format'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { SyncButton } from '@/components/content-studio/SyncButton'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, PerfRow, SyncStatusEntry } from '@/types/content-studio'

export function PerformancePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [perf, setPerf] = useState<PerfRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [connected, setConnected] = useState<string[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getPerformance(), getBrands(), getSyncStatus().catch(() => null)])
      .then(([p, b, sync]) => {
        setPerf(p)
        setBrands(b)
        const status: SyncStatusEntry[] = sync?.status ?? []
        setConnected(status.filter((s) => s.connected).map((s) => s.label))
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

  const syncedCount = perf.filter((p: any) => p.source === 'sync').length
  const isLive = syncedCount > 0 || connected.length > 0

  if (!brands.length) {
    return (
      <Page>
        <PageHeader title="Performance" subtitle="Post-publish results" />
        <FirstRun onSeeded={load} />
      </Page>
    )
  }
  if (!perf.length) {
    return (
      <Page>
        <PageHeader title="Performance" subtitle="Post-publish results" />
        <div className="glass-card p-10 text-center">
          <h2 className="text-lg font-semibold text-gray-100 mb-2">No performance data yet</h2>
          <p className="text-gray-500 text-sm">Performance metrics will appear here once content has been published and measured.</p>
        </div>
      </Page>
    )
  }

  const t = perf.reduce(
    (a, p) => ({
      views: a.views + p.views,
      reach: a.reach + p.reach,
      likes: a.likes + p.likes,
      comments: a.comments + p.comments,
      shares: a.shares + p.shares,
      saves: a.saves + p.saves,
      watch: a.watch + p.watch_time_sec,
      followers: a.followers + p.follower_growth,
    }),
    { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, watch: 0, followers: 0 }
  )
  const engagement = t.likes + t.comments + t.shares + t.saves
  const engRate = t.reach ? (engagement / t.reach) * 100 : 0

  const platforms = Object.entries(
    perf.reduce<Record<string, { views: number; eng: number; n: number }>>((a, p) => {
      const k = p.platform || 'Other'
      a[k] = a[k] || { views: 0, eng: 0, n: 0 }
      a[k].views += p.views
      a[k].eng += p.likes + p.comments + p.shares + p.saves
      a[k].n += 1
      return a
    }, {})
  ).sort((a, b) => b[1].views - a[1].views)
  const maxPlatViews = Math.max(1, ...platforms.map(([, v]) => v.views))

  const top = [...perf].sort((a, b) => b.views - a.views)

  return (
    <Page>
      <PageHeader title="Performance Dashboard" subtitle={`${perf.length} published pieces measured`} right={connected.length ? <SyncButton onSynced={load} /> : undefined} />

      <div className={`glass-card p-5 mb-6 border-l-4 ${isLive ? 'border-emerald-500' : 'border-amber-500'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-gray-100">
              {isLive ? <>Live data — {syncedCount} posts pulled from {connected.join(', ') || 'connected platforms'}</> : <>Showing demo data (synthetic placeholder numbers)</>}
            </div>
            <div className="text-sm text-gray-400 mt-0.5">
              {isLive ? 'These metrics come straight from the platform APIs. Press Sync live data to refresh.' : 'No social account is connected yet, so these figures are illustrative — not real.'}
            </div>
          </div>
          {!connected.length && (
            <Link to="/content-studio/connections" className="btn-primary">
              Connect accounts →
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Views</div><div className="text-3xl font-bold text-gray-100 mt-1">{compact(t.views)}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Reach</div><div className="text-3xl font-bold text-gray-100 mt-1">{compact(t.reach)}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Engagement</div><div className="text-3xl font-bold text-gold-400 mt-1">{compact(engagement)}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Eng. rate</div><div className="text-3xl font-bold text-emerald-400 mt-1">{engRate.toFixed(1)}%</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Watch time</div><div className="text-3xl font-bold text-gray-100 mt-1">{compact(Math.round(t.watch / 60))}m</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Followers +</div><div className="text-3xl font-bold text-emerald-400 mt-1">{compact(t.followers)}</div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="glass-card p-5">
          <h2 className="font-bold text-gray-100 mb-4">Views by platform</h2>
          <div className="space-y-3">
            {platforms.map(([p, v]) => (
              <div key={p}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <PlatformChip platform={p} />
                  <span className="font-semibold text-gray-100">{compact(v.views)}</span>
                </div>
                <ProgressBar value={(v.views / maxPlatViews) * 100} />
                <div className="text-[11px] text-gray-500 mt-0.5">{v.n} pieces · {compact(v.eng)} engagement</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-5">
          <h2 className="font-bold text-gray-100 mb-4">Engagement breakdown</h2>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Likes" value={t.likes} />
            <Metric label="Comments" value={t.comments} />
            <Metric label="Shares" value={t.shares} />
            <Metric label="Saves" value={t.saves} />
          </div>
        </div>

        <div className="glass-card p-5">
          <h2 className="font-bold text-gray-100 mb-4">Highlights</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span className="text-gray-500">Best piece</span><span className="font-semibold text-gray-100 truncate ml-2">{top[0]?.title}</span></li>
            <li className="flex justify-between"><span className="text-gray-500">Top views</span><span className="font-semibold text-gray-100">{compact(top[0]?.views || 0)}</span></li>
            <li className="flex justify-between"><span className="text-gray-500">Avg views / piece</span><span className="font-semibold text-gray-100">{compact(Math.round(t.views / perf.length))}</span></li>
            <li className="flex justify-between"><span className="text-gray-500">Leading platform</span><span className="font-semibold text-gray-100">{platforms[0]?.[0]}</span></li>
          </ul>
        </div>
      </div>

      <div className="glass-card mt-6 overflow-hidden">
        <div className="p-5 border-b border-gray-800">
          <h2 className="font-bold text-gray-100">Top performing content</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="px-5 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">Content</th>
                <th className="px-3 py-2.5 font-semibold">Platform</th>
                <th className="px-3 py-2.5 font-semibold text-right">Views</th>
                <th className="px-3 py-2.5 font-semibold text-right">Reach</th>
                <th className="px-3 py-2.5 font-semibold text-right">Likes</th>
                <th className="px-3 py-2.5 font-semibold text-right">Comments</th>
                <th className="px-3 py-2.5 font-semibold text-right">Shares</th>
                <th className="px-3 py-2.5 font-semibold text-right">Saves</th>
                <th className="px-5 py-2.5 font-semibold text-right">Eng. rate</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => {
                const eng = p.likes + p.comments + p.shares + p.saves
                const er = p.reach ? (eng / p.reach) * 100 : 0
                return (
                  <tr key={p.id} className="border-b border-gray-800/60 hover:bg-gray-900/40">
                    <td className="px-5 py-2.5 text-gray-500 font-semibold">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-100">{p.title}</div>
                      <div className="text-[11px] text-gray-500">{p.brand_name}</div>
                    </td>
                    <td className="px-3 py-2.5"><PlatformChip platform={p.platform} /></td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-100">{num(p.views)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{num(p.reach)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{num(p.likes)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{num(p.comments)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{num(p.shares)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{num(p.saves)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-emerald-400">{er.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-900/60 px-3 py-3 text-center">
      <div className="text-xl font-bold text-gray-100">{compact(value)}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  )
}
