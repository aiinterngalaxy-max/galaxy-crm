import { useCallback, useEffect, useState } from 'react'
import { getBrands, getInsights } from '@/lib/content-studio/queries'
import { Page, PageHeader, ProgressBar } from '@/components/content-studio/ui'
import { PLATFORM_STYLE } from '@/lib/content-studio/stages'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, Insights } from '@/types/content-studio'

export function InsightsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [insights, setInsights] = useState<Insights | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getInsights(), getBrands()])
      .then(([i, b]) => {
        setInsights(i)
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
  if (!brands.length || !insights) return <FirstRun onSeeded={load} />

  const { bestFormats, bestPlatforms, bestDays, bottlenecks, teamEfficiency } = insights
  const hasPerf = bestFormats.length > 0

  const maxFormatRate = Math.max(0.001, ...bestFormats.map((f) => f.avgEngRate))
  const maxPlatViews = Math.max(1, ...bestPlatforms.map((p) => p.avgViews))
  const maxDayViews = Math.max(1, ...bestDays.map((d) => d.avgViews))
  const maxBottleneckAge = Math.max(1, ...bottlenecks.map((b) => b.avgAge))

  return (
    <Page>
      <PageHeader title="Marketing Insights" subtitle="What's working, what's not, and where the team is getting stuck" />

      {!hasPerf ? (
        <div className="glass-card p-10 text-center">
          <div className="text-gray-600 text-4xl mb-2">✺</div>
          <div className="font-semibold text-gray-100">Not enough published data yet</div>
          <div className="text-sm text-gray-500 mt-1">Insights build up as content gets published and measured.</div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="glass-card p-5">
            <h2 className="font-bold text-gray-100 mb-1">Best performing formats</h2>
            <p className="text-xs text-gray-500 mb-4">Average engagement rate (likes+comments+shares+saves ÷ reach)</p>
            <div className="space-y-3">
              {bestFormats.map((f) => (
                <div key={f.format}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-100">{f.format}</span>
                    <span className="font-semibold text-emerald-400">{(f.avgEngRate * 100).toFixed(1)}%</span>
                  </div>
                  <ProgressBar value={(f.avgEngRate / maxFormatRate) * 100} />
                  <div className="text-[11px] text-gray-500 mt-0.5">{f.n} piece{f.n === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="font-bold text-gray-100 mb-1">Best performing platform</h2>
            <p className="text-xs text-gray-500 mb-4">Average views per published piece</p>
            <div className="space-y-3">
              {bestPlatforms.map((p) => (
                <div key={p.platform}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className={`badge ${PLATFORM_STYLE[p.platform] || 'bg-gray-800 text-gray-300'}`}>{p.platform}</span>
                    <span className="font-semibold text-gray-100">{p.avgViews.toLocaleString('en-IN')}</span>
                  </div>
                  <ProgressBar value={(p.avgViews / maxPlatViews) * 100} />
                  <div className="text-[11px] text-gray-500 mt-0.5">{p.n} piece{p.n === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="font-bold text-gray-100 mb-1">Best posting day</h2>
            <p className="text-xs text-gray-500 mb-4">Average views by day of week published</p>
            <div className="space-y-3">
              {bestDays.map((d) => (
                <div key={d.day}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-100">{d.day}</span>
                    <span className="font-semibold text-gray-100">{d.avgViews.toLocaleString('en-IN')}</span>
                  </div>
                  <ProgressBar value={(d.avgViews / maxDayViews) * 100} />
                </div>
              ))}
              {bestDays.length === 0 && <div className="text-sm text-gray-500">No publish-dated data yet.</div>}
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="font-bold text-gray-100 mb-1">Production bottlenecks</h2>
            <p className="text-xs text-gray-500 mb-4">Average days a piece has spent sitting in each stage right now</p>
            <div className="space-y-3">
              {bottlenecks.map((b) => (
                <div key={b.stage}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-100">{b.stage}</span>
                    <span className={`font-semibold ${b.avgAge > 7 ? 'text-rose-400' : b.avgAge > 3 ? 'text-amber-400' : 'text-gray-400'}`}>{b.avgAge}d avg</span>
                  </div>
                  <ProgressBar value={(b.avgAge / maxBottleneckAge) * 100} />
                  <div className="text-[11px] text-gray-500 mt-0.5">{b.count} item{b.count === 1 ? '' : 's'} currently here</div>
                </div>
              ))}
              {bottlenecks.length === 0 && <div className="text-sm text-gray-500">Nothing in production right now.</div>}
            </div>
          </div>

          <div className="glass-card p-5 lg:col-span-2">
            <h2 className="font-bold text-gray-100 mb-1">Team efficiency</h2>
            <p className="text-xs text-gray-500 mb-4">Average revision rounds per published piece (lower = cleaner first-pass work)</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {teamEfficiency.map((t) => (
                <div key={t.person} className="rounded-lg bg-gray-900/60 px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-100">{t.person}</div>
                    <div className="text-[11px] text-gray-500">{t.n} piece{t.n === 1 ? '' : 's'}</div>
                  </div>
                  <div className={`text-lg font-bold ${t.avgRevisions > 1.5 ? 'text-amber-400' : 'text-emerald-400'}`}>{t.avgRevisions.toFixed(1)}</div>
                </div>
              ))}
              {teamEfficiency.length === 0 && <div className="text-sm text-gray-500">No published content with assigned writers/editors yet.</div>}
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
