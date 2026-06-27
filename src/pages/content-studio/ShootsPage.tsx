import { useCallback, useEffect, useState } from 'react'
import { getBrands, getShoots } from '@/lib/content-studio/queries'
import { daysUntil } from '@/lib/content-studio/format'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { ShootsView } from '@/components/content-studio/ShootsView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ShootRow } from '@/types/content-studio'

export function ShootsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shoots, setShoots] = useState<ShootRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getShoots(), getBrands()])
      .then(([s, b]) => {
        setShoots(s)
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

  const upcoming = shoots.filter((s) => s.status !== 'Cancelled' && s.status !== 'Completed')
  const next14 = upcoming.filter((s) => {
    const d = daysUntil(s.shoot_date)
    return d !== null && d >= 0 && d <= 14
  }).length
  const done = shoots.filter((s) => s.status === 'Completed').length

  return (
    <Page>
      <PageHeader title="Shoot Management" subtitle={`${upcoming.length} upcoming · ${next14} in next 14 days · ${done} completed`} />
      <ShootsView shoots={shoots} brands={brands} onChanged={load} />
    </Page>
  )
}
