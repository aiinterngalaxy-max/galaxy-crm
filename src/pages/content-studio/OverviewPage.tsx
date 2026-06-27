import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAllContent, getBrands, getStats, getTeam } from '@/lib/content-studio/queries'
import { STAGE_STYLE } from '@/lib/content-studio/stages'
import { compact, pct } from '@/lib/content-studio/format'
import { Page, PageHeader, ProgressBar, PlatformChip } from '@/components/content-studio/ui'
import { Notifications } from '@/components/content-studio/Notifications'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ContentRow, Stats, TeamMember } from '@/types/content-studio'

export function OverviewPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [content, setContent] = useState<ContentRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getStats(), getTeam(), getAllContent(), getBrands()])
      .then(([s, t, c, b]) => {
        setStats(s)
        setTeam(t)
        setContent(c)
        setBrands(b)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />
  if (!stats || !brands.length) return <FirstRun onSeeded={load} />

  const maxStage = Math.max(1, ...stats.byStage.map((s) => s.count))
  const ideaPct = stats.ideasRequired ? (stats.ideasPitched / stats.ideasRequired) * 100 : 0

  const inFlight = content.filter((c) => c.stage !== 'Published')
  const workload = team
    .map((m) => {
      const load = inFlight.filter((c) => c.writer === m.name || c.editor === m.name || c.talent === m.name).length
      return { ...m, load, ratio: m.capacity ? load / m.capacity : 0 }
    })
    .sort((a, b) => b.ratio - a.ratio)

  const topPerf = [...stats.perf].sort((a, b) => b.views - a.views).slice(0, 5)
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <Page>
      <PageHeader
        title="Executive Dashboard"
        subtitle={`Galaxy Marketing Command Center · ${month}`}
        right={
          <Link to="/content-studio/reports" className="btn-primary">
            Monthly report →
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Active brands</div><div className="text-3xl font-bold text-gray-100 mt-1">{stats.activeBrands}</div><div className="text-xs text-gray-500 mt-1">{stats.totalBrands} total</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">In production</div><div className="text-3xl font-bold text-gold-400 mt-1">{stats.inProduction}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Published / mo</div><div className="text-3xl font-bold text-emerald-400 mt-1">{stats.publishedThisMonth}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Overdue tasks</div><div className={`text-3xl font-bold mt-1 ${stats.overdueCount ? 'text-rose-400' : 'text-gray-100'}`}>{stats.overdueCount}</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Upcoming shoots</div><div className="text-3xl font-bold text-gray-100 mt-1">{stats.upcomingShoots.length}</div><div className="text-xs text-gray-500 mt-1">next 14 days</div></div>
        <div className="stat-card"><div className="text-xs uppercase text-gray-500">Pending approvals</div><div className="text-3xl font-bold text-amber-400 mt-1">{stats.pendingApprovals.length}</div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-100">Production pipeline</h2>
              <Link to="/content-studio/pipeline" className="text-sm font-semibold text-gold-400 hover:underline">
                Open board →
              </Link>
            </div>
            <div className="space-y-2.5">
              {stats.byStage.map((s) => {
                const st = STAGE_STYLE[s.stage]
                return (
                  <div key={s.stage} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-xs font-medium text-gray-400">{s.stage}</div>
                    <div className="flex-1 h-6 rounded-md bg-gray-800 overflow-hidden">
                      <div className={`h-full ${st.dot} flex items-center justify-end pr-2`} style={{ width: `${(s.count / maxStage) * 100}%`, minWidth: s.count ? '1.5rem' : 0 }}>
                        {s.count > 0 && <span className="text-[11px] font-bold text-white">{s.count}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h2 className="font-bold text-gray-100 mb-3">Idea pipeline</h2>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-gray-100">{stats.ideasPitched}</div>
                  <div className="text-xs text-gray-500">of {stats.ideasRequired} ideas pitched</div>
                </div>
                <div className="text-2xl font-bold text-gold-400">{pct(ideaPct)}</div>
              </div>
              <ProgressBar value={ideaPct} className="mt-3" />
              <Link to="/content-studio/ideas" className="text-sm font-semibold text-gold-400 hover:underline mt-3 inline-block">
                Track ideas →
              </Link>
            </div>

            <div className="glass-card p-5">
              <h2 className="font-bold text-gray-100 mb-3">{month} performance</h2>
              <div className="grid grid-cols-2 gap-3">
                <Mini label="Views" value={compact(stats.totals.views)} />
                <Mini label="Reach" value={compact(stats.totals.reach)} />
                <Mini label="Engagement" value={compact(stats.totals.engagement)} />
                <Mini label="Followers +" value={compact(stats.totals.followers)} />
              </div>
              <Link to="/content-studio/performance" className="text-sm font-semibold text-gold-400 hover:underline mt-3 inline-block">
                Full performance →
              </Link>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h2 className="font-bold text-gray-100 mb-3">Monthly content target</h2>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-gray-100">{stats.publishedThisMonth}</div>
                  <div className="text-xs text-gray-500">of {stats.monthlyTargetTotal} required across all brands</div>
                </div>
                <div className="text-2xl font-bold text-gold-400">{pct(stats.monthlyCompletionPct)}</div>
              </div>
              <ProgressBar value={stats.monthlyCompletionPct} className="mt-3" />
            </div>

            <div className="glass-card p-5">
              <h2 className="font-bold text-gray-100 mb-3">Avg. turnaround</h2>
              <div className="text-3xl font-bold text-gray-100">{stats.avgTurnaround !== null ? `${stats.avgTurnaround}d` : '—'}</div>
              <div className="text-xs text-gray-500">idea start → publish, this month's published pieces</div>
              <Link to="/content-studio/insights" className="text-sm font-semibold text-gold-400 hover:underline mt-3 inline-block">
                See marketing insights →
              </Link>
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="font-bold text-gray-100 mb-4">Team workload</h2>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {workload.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <div className="text-sm font-semibold text-gray-100 truncate">{m.name}</div>
                    <div className="text-[11px] text-gray-500">{m.role}</div>
                  </div>
                  <ProgressBar value={m.ratio * 100} className="flex-1" />
                  <div className={`text-xs font-bold w-12 text-right ${m.ratio > 1 ? 'text-rose-400' : m.ratio > 0.85 ? 'text-amber-400' : 'text-gray-500'}`}>
                    {m.load}/{m.capacity}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Notifications stats={stats} />

          <div className="glass-card">
            <div className="p-5 border-b border-gray-800">
              <h2 className="font-bold text-gray-100">Top performing</h2>
            </div>
            <div className="divide-y divide-gray-800">
              {topPerf.length === 0 && <div className="p-5 text-sm text-gray-500">No published data yet.</div>}
              {topPerf.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="text-lg font-bold text-gold-500 w-5">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-100 truncate">{p.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <PlatformChip platform={p.platform} />
                      <span className="text-xs text-gray-500">{p.brand_name}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-gray-100">{compact(p.views)}</div>
                    <div className="text-[11px] text-gray-500">views</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-900/60 px-3 py-2">
      <div className="text-lg font-bold text-gray-100">{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  )
}
