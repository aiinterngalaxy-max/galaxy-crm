import { useCallback, useEffect, useState } from 'react'
import { getBrands, getIdeas } from '@/lib/content-studio/queries'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { pct, monthLabel } from '@/lib/content-studio/format'
import { IdeasView } from '@/components/content-studio/IdeasView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, Idea } from '@/types/content-studio'

export function IdeasPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getBrands(), getIdeas()])
      .then(([b, i]) => {
        setBrands(b)
        setIdeas(i)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />
  if (!brands.length) return <FirstRun onSeeded={load} />

  const month = new Date().toISOString().slice(0, 7)
  const totalReq = ideas.length
  const totalPitched = ideas.filter((i) => i.pitched).length
  const totalApproved = ideas.filter((i) => i.approved).length

  return (
    <Page>
      <PageHeader title="Idea Management" subtitle={`${monthLabel(month)} · ${totalPitched}/${totalReq} pitched · ${totalApproved} approved`} />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Stat n={totalReq} l="Ideas required" />
        <Stat n={totalPitched} l="Pitched" sub={pct(totalReq ? (totalPitched / totalReq) * 100 : 0)} />
        <Stat n={totalReq - totalPitched} l="Remaining to pitch" />
      </div>

      <IdeasView brands={brands} ideas={ideas} onChanged={load} />
    </Page>
  )
}

function Stat({ n, l, sub }: { n: number; l: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="text-xs uppercase tracking-wide text-gray-500">{l}</div>
      <div className="flex items-end gap-2">
        <div className="text-3xl font-bold text-gray-100">{n}</div>
        {sub && <div className="text-sm font-semibold text-gold-400 mb-1">{sub}</div>}
      </div>
    </div>
  )
}
