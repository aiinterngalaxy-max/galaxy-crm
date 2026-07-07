import { useCallback, useEffect, useState } from 'react'
import { getAllContent, getBrands, getIdeas, getPerformance, getStats } from '@/lib/content-studio/queries'
import { Page, PageHeader, PlatformChip } from '@/components/content-studio/ui'
import { compact, num, pct, fmtDate } from '@/lib/content-studio/format'
import { STAGES } from '@/lib/content-studio/stages'
import { CsvButton } from '@/components/content-studio/CsvButton'
import { PdfButton } from '@/components/content-studio/PdfButton'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ContentRow, Idea, PerfRow, Stats } from '@/types/content-studio'

export function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [content, setContent] = useState<ContentRow[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [perf, setPerf] = useState<PerfRow[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getStats(), getBrands(), getAllContent(), getIdeas(), getPerformance()])
      .then(([s, b, c, i, p]) => {
        setStats(s)
        setBrands(b)
        setContent(c)
        setIdeas(i)
        setPerf(p)
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

  const month = new Date().toISOString().slice(0, 7)
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const engagement = stats.totals.engagement
  const top = [...perf].sort((a, b) => b.views - a.views).slice(0, 8)

  const brandRows = brands.map((br) => {
    const items = content.filter((c) => c.brand_id === br.id)
    const published = items.filter((c) => c.stage === 'Published' && (c.publish_date || '').startsWith(month)).length
    const inProduction = items.filter((c) => c.stage !== 'Published').length
    const bIdeas = ideas.filter((i) => i.brand_id === br.id && i.month === month)
    const pitched = bIdeas.filter((i) => i.pitched).length
    const hit = br.monthly_target ? (published / br.monthly_target) * 100 : 0
    return {
      br,
      published,
      inProduction,
      bIdeas,
      pitched,
      hit,
      csv: {
        brand: br.name,
        lead: br.lead,
        target: br.monthly_target,
        published,
        inProduction,
        ideasPitched: `${pitched}/${bIdeas.length || 0}`,
        targetHitPct: `${Math.round(hit)}%`,
      },
    }
  })

  const topContentCsv = top.map((p) => ({
    title: p.title,
    brand: p.brand_name,
    platform: p.platform,
    views: p.views,
    engagement: p.likes + p.comments + p.shares + p.saves,
  }))

  return (
    <Page>
      <PageHeader
        title="Reports"
        subtitle={`Monthly performance & production · ${monthName}`}
        right={
          <div className="flex items-center gap-2 no-print">
            <CsvButton brandRows={brandRows.map((r) => r.csv)} topContent={topContentCsv} month={monthName} />
            <PdfButton />
          </div>
        }
      />

      <div data-tour="report-header" className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-400 font-bold">Galaxy Home Automation</div>
            <h2 className="text-xl font-bold text-gray-100">Marketing Report — {monthName}</h2>
          </div>
          <div className="text-right text-xs text-gray-500">Generated {fmtDate(new Date().toISOString().slice(0, 10), true)}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <Kpi n={stats.activeBrands} l="Active brands" />
          <Kpi n={stats.publishedThisMonth} l="Published this month" />
          <Kpi n={stats.inProduction} l="In production" />
          <Kpi n={compact(stats.totals.views)} l="Total views" />
        </div>
      </div>

      <div data-tour="brand-table" className="glass-card overflow-hidden mb-6 page-break">
        <div className="p-5 border-b border-gray-800">
          <h2 className="font-bold text-gray-100">Brand production report</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="px-5 py-2.5 font-semibold">Brand</th>
                <th className="px-3 py-2.5 font-semibold">Lead</th>
                <th className="px-3 py-2.5 font-semibold text-right">Target</th>
                <th className="px-3 py-2.5 font-semibold text-right">Published</th>
                <th className="px-3 py-2.5 font-semibold text-right">In prod.</th>
                <th className="px-3 py-2.5 font-semibold text-right">Ideas pitched</th>
                <th className="px-5 py-2.5 font-semibold text-right">Target hit</th>
              </tr>
            </thead>
            <tbody>
              {brandRows.map(({ br, published, inProduction, bIdeas, pitched, hit }) => (
                <tr key={br.id} className="border-b border-gray-800/60">
                  <td className="px-5 py-2.5 font-medium text-gray-100">{br.name}</td>
                  <td className="px-3 py-2.5 text-gray-400">{br.lead}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{br.monthly_target}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-100">{published}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{inProduction}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{pitched}/{bIdeas.length || '—'}</td>
                  <td className={`px-5 py-2.5 text-right font-semibold ${hit >= 100 ? 'text-emerald-400' : hit >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>{pct(hit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="glass-card p-5">
          <h2 className="font-bold text-gray-100 mb-4">Production pipeline status</h2>
          <div className="space-y-2">
            {STAGES.map((s) => {
              const n = stats.byStage.find((x) => x.stage === s)?.count || 0
              return (
                <div key={s} className="flex items-center justify-between text-sm border-b border-gray-800/60 pb-1.5">
                  <span className="text-gray-400">{s}</span>
                  <span className="font-semibold text-gray-100">{n}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="glass-card p-5">
          <h2 className="font-bold text-gray-100 mb-4">Performance summary</h2>
          <div className="grid grid-cols-2 gap-3">
            <Kpi n={compact(stats.totals.views)} l="Views" />
            <Kpi n={compact(stats.totals.reach)} l="Reach" />
            <Kpi n={compact(engagement)} l="Engagement" />
            <Kpi n={compact(stats.totals.followers)} l="Follower growth" />
          </div>
          <div className="mt-4 text-xs text-gray-500">
            Engagement rate <span className="font-semibold text-emerald-400">{stats.totals.reach ? ((engagement / stats.totals.reach) * 100).toFixed(1) : '0'}%</span> · {perf.length} pieces measured
          </div>
        </div>
      </div>

      <div data-tour="top-content" className="glass-card overflow-hidden page-break">
        <div className="p-5 border-b border-gray-800">
          <h2 className="font-bold text-gray-100">Top performing content</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="px-5 py-2.5 font-semibold">Content</th>
                <th className="px-3 py-2.5 font-semibold">Brand</th>
                <th className="px-3 py-2.5 font-semibold">Platform</th>
                <th className="px-3 py-2.5 font-semibold text-right">Views</th>
                <th className="px-5 py-2.5 font-semibold text-right">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/60">
                  <td className="px-5 py-2.5 font-medium text-gray-100">{p.title}</td>
                  <td className="px-3 py-2.5 text-gray-400">{p.brand_name}</td>
                  <td className="px-3 py-2.5"><PlatformChip platform={p.platform} /></td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-100">{num(p.views)}</td>
                  <td className="px-5 py-2.5 text-right text-gray-400">{num(p.likes + p.comments + p.shares + p.saves)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-xs text-gray-600 mt-6">
        Galaxy Marketing Command Center · generated from the live shared database · {monthName}
      </p>
    </Page>
  )
}

function Kpi({ n, l }: { n: React.ReactNode; l: string }) {
  return (
    <div className="rounded-lg bg-gray-900/60 px-3 py-3">
      <div className="text-2xl font-bold text-gray-100">{n}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{l}</div>
    </div>
  )
}
