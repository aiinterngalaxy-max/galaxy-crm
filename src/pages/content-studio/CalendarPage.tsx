import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAllContent, getShoots } from '@/lib/content-studio/queries'
import { Page } from '@/components/content-studio/ui'
import { CalendarBoard } from '@/components/content-studio/CalendarBoard'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { ContentRow, ShootRow } from '@/types/content-studio'

export function CalendarPage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [content, setContent] = useState<ContentRow[]>([])
  const [shoots, setShoots] = useState<ShootRow[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getAllContent(), getShoots()])
      .then(([c, s]) => {
        setContent(c)
        setShoots(s)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />
  if (!content.length && !shoots.length) return <FirstRun onSeeded={load} />

  const mParam = searchParams.get('m')
  const ym = mParam && /^\d{4}-\d{2}$/.test(mParam) ? mParam : new Date().toISOString().slice(0, 7)

  return (
    <Page>
      <CalendarBoard initialContent={content} shoots={shoots} ym={ym} onChanged={load} />
    </Page>
  )
}
