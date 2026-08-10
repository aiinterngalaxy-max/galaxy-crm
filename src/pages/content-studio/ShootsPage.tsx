import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrands, getShoots, getAllContent, updateContent, backfillShootLinks } from '@/lib/content-studio/queries'
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
  const linking = useRef(false)

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

  // Catch up: shoots left unlinked before auto-linking-by-title existed (or
  // whose matching content didn't exist yet) get one more chance here, since
  // a shoot sitting unchanged at its current status has no click left that
  // would trigger the same match inside updateShoot.
  useEffect(() => {
    if (loading || linking.current) return
    if (!shoots.some((s) => !s.content_id)) return

    linking.current = true
    backfillShootLinks()
      .then((n) => { if (n > 0) load() })
      .catch(console.error)
      .finally(() => { linking.current = false })
  }, [loading, shoots, load])

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
      <div data-tour="shoots-view"><ShootsView shoots={shoots} brands={brands} content={allContent} onChanged={load} /></div>
    </Page>
  )
}
