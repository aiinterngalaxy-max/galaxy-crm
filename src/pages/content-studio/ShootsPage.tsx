import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrands, getShoots, getAllContent, updateContent } from '@/lib/content-studio/queries'
import { STAGE_INDEX } from '@/lib/content-studio/stages'
import { daysUntil } from '@/lib/content-studio/format'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { ShootsView } from '@/components/content-studio/ShootsView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ContentRow, ShootRow } from '@/types/content-studio'

export function ShootsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shoots, setShoots] = useState<ShootRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [allContent, setAllContent] = useState<ContentRow[]>([])
  const backfilling = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getShoots(), getBrands(), getAllContent()])
      .then(([s, b, c]) => {
        setShoots(s)
        setBrands(b)
        setAllContent(c)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Catch up: shoots already marked Completed before this auto-advance
  // existed left their content stuck before Editing. Push those forward now.
  useEffect(() => {
    if (loading || backfilling.current) return
    const contentById = new Map(allContent.map((c) => [c.id, c]))
    const stuck = shoots.filter((s) => {
      if (s.status !== 'Completed' || !s.content_id) return false
      const content = contentById.get(s.content_id)
      return !!content && STAGE_INDEX[content.stage] < STAGE_INDEX['Editing']
    })
    if (stuck.length === 0) return

    backfilling.current = true
    Promise.all(stuck.map((s) => updateContent(s.content_id!, { stage: 'Editing' })))
      .then(load)
      .catch(console.error)
      .finally(() => { backfilling.current = false })
  }, [loading, shoots, allContent, load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

  const upcoming = shoots.filter((s) => s.status !== 'Cancelled' && s.status !== 'Completed')
  const next14 = upcoming.filter((s) => {
    const d = daysUntil(s.shoot_date)
    return d !== null && d >= 0 && d <= 14
  }).length
  const done = shoots.filter((s) => s.status === 'Completed').length

  return (
    <Page>
      <PageHeader title="Shoot Management" subtitle={`${upcoming.length} upcoming · ${next14} in next 14 days · ${done} completed`} />
      <div data-tour="shoots-view"><ShootsView shoots={shoots} brands={brands} onChanged={load} /></div>
    </Page>
  )
}
