import { useCallback, useEffect, useState } from 'react'
import { getAllContent } from '@/lib/content-studio/queries'
import { STAGE_INDEX } from '@/lib/content-studio/stages'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { EditingView } from '@/components/content-studio/EditingView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { ContentRow } from '@/types/content-studio'

export function EditingPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [allContent, setAllContent] = useState<ContentRow[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getAllContent()
      .then(setAllContent)
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

  const editingIdx = STAGE_INDEX['Editing']!
  const publishedIdx = STAGE_INDEX['Published']!

  const rows = allContent.filter((c) => {
    const i = STAGE_INDEX[c.stage] ?? -1
    return i >= editingIdx && i < publishedIdx
  })

  const editors = [...new Set(rows.map((r) => r.editor).filter(Boolean))].sort()

  const approved = rows.filter((r) => r.approved).length
  const overdue = rows.filter((r) => {
    if (!r.due_date) return false
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return new Date(r.due_date + 'T00:00:00') < t
  }).length

  return (
    <Page>
      <PageHeader title="Editing" subtitle={`${rows.length} in post-production · ${approved} approved · ${overdue} overdue`} />
      <EditingView rows={rows} editors={editors} onChanged={load} />
    </Page>
  )
}
