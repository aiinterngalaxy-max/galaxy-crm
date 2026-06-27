import { useCallback, useEffect, useState } from 'react'
import { getAllContent, getScripts } from '@/lib/content-studio/queries'
import { STAGE_INDEX } from '@/lib/content-studio/stages'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { ScriptsView } from '@/components/content-studio/ScriptsView'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { ContentRow, ScriptRow } from '@/types/content-studio'

export function ScriptsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scripts, setScripts] = useState<ScriptRow[]>([])
  const [allContent, setAllContent] = useState<ContentRow[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getScripts(), getAllContent()])
      .then(([s, c]) => {
        setScripts(s)
        setAllContent(c)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

  const scriptWritingIdx = STAGE_INDEX['Script Writing'] ?? 2
  const publishedIdx = STAGE_INDEX['Published'] ?? 11
  const scriptedIds = new Set(scripts.map((s) => s.content_id))
  const eligibleContent = allContent
    .filter((c) => {
      const idx = STAGE_INDEX[c.stage] ?? 0
      return idx >= scriptWritingIdx && idx < publishedIdx && !scriptedIds.has(c.id)
    })
    .map((c) => ({ id: c.id, title: c.title, brand_name: c.brand_name }))

  const pending = scripts.filter((s) => s.status !== 'Approved')
  const overdue = pending.filter((s) => {
    if (!s.deadline) return false
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return new Date(s.deadline + 'T00:00:00') < t
  }).length

  return (
    <Page>
      <PageHeader
        title="Script Management"
        subtitle={`${pending.length} in progress · ${overdue} overdue · ${scripts.filter((s) => s.status === 'Approved').length} approved`}
      />
      <ScriptsView scripts={scripts} content={eligibleContent} onChanged={load} />
    </Page>
  )
}
