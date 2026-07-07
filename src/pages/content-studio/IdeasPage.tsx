import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrands, getIdeas, getAllContent, updateContent } from '@/lib/content-studio/queries'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { pct, monthLabel } from '@/lib/content-studio/format'
import { IdeasView } from '@/components/content-studio/IdeasView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ContentRow, Idea } from '@/types/content-studio'

export function IdeasPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [allContent, setAllContent] = useState<ContentRow[]>([])
  const backfilling = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getBrands(), getIdeas(), getAllContent()])
      .then(([b, i, c]) => {
        setBrands(b)
        setIdeas(i)
        setAllContent(c)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Catch up: ideas approved before content auto-advanced to Script Writing
  // left their linked content stuck at the "Idea" stage. Push those forward
  // now so they show up on the Pipeline and Scripts page correctly.
  useEffect(() => {
    if (loading || backfilling.current) return
    const contentById = new Map(allContent.map((c) => [c.id, c]))
    const stuck = ideas.filter((i) => i.approved && i.content_id && contentById.get(i.content_id)?.stage === 'Idea')
    if (stuck.length === 0) return

    backfilling.current = true
    Promise.all(stuck.map((i) => updateContent(i.content_id!, { stage: 'Script Writing' })))
      .then(load)
      .catch(console.error)
      .finally(() => { backfilling.current = false })
  }, [loading, ideas, allContent, load])

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

      <div data-tour="stat-cards" className="grid grid-cols-3 gap-4 mb-6">
        <Stat n={totalReq} l="Ideas required" />
        <Stat n={totalPitched} l="Pitched" sub={pct(totalReq ? (totalPitched / totalReq) * 100 : 0)} />
        <Stat n={totalReq - totalPitched} l="Remaining to pitch" />
      </div>

      <div data-tour="ideas-view"><IdeasView brands={brands} ideas={ideas} onChanged={load} /></div>
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
