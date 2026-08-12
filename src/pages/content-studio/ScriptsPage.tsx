import { useCallback, useEffect, useRef, useState } from 'react'
import { getAllContent, getBrands, getIdeas, getScripts, maybeCreateScriptForContent } from '@/lib/content-studio/queries'
import { STAGE_INDEX } from '@/lib/content-studio/stages'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { IdeaScriptQueue } from '@/components/content-studio/IdeaScriptQueue'
import { IdeaScriptList } from '@/components/content-studio/IdeaScriptList'
import type { Brand, ContentRow, Idea, ScriptRow } from '@/types/content-studio'
import { getSuperAdmins, createNotificationIfNew } from '@/lib/notifyHelpers'

export function ScriptsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scripts, setScripts] = useState<ScriptRow[]>([])
  const [allContent, setAllContent] = useState<ContentRow[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const backfilling = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getScripts(), getAllContent(), getIdeas(), getBrands()])
      .then(([s, c, i, b]) => {
        setScripts(s)
        setAllContent(c)
        setIdeas(i)
        setBrands(b)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Catch up: any content piece already sitting at/past Script Writing
  // should have a linked script row. Covers cards that reached that stage
  // before the auto-link existed (seed data, direct DB inserts, etc).
  useEffect(() => {
    if (loading || backfilling.current) return
    const scriptWritingIdx = STAGE_INDEX['Script Writing'] ?? 2
    const publishedIdx = STAGE_INDEX['Published'] ?? 11
    const scriptedIds = new Set(scripts.map((s) => s.content_id))
    const missing = allContent.filter((c) => {
      const idx = STAGE_INDEX[c.stage] ?? 0
      return idx >= scriptWritingIdx && idx < publishedIdx && !scriptedIds.has(c.id)
    })
    if (missing.length === 0) return

    backfilling.current = true
    Promise.all(missing.map((c) => maybeCreateScriptForContent(c.id)))
      .then(load)
      .catch(console.error)
      .finally(() => { backfilling.current = false })
  }, [loading, scripts, allContent, load])

  // Catch up: make sure every script currently sitting in Submitted (awaiting
  // approval) has notified super admins at least once today — covers scripts
  // submitted before this notification existed, or if a notify call failed.
  useEffect(() => {
    if (scripts.length === 0) return
    const pendingReview = scripts.filter((s) => s.status === 'Submitted' && !s.approved)
    if (pendingReview.length === 0) return

    getSuperAdmins()
      .then((superAdmins) => Promise.all(
        pendingReview.flatMap((s) => superAdmins.map((admin) =>
          createNotificationIfNew({
            recipientId: admin.id,
            type: 'content_studio_script',
            title: 'Script Submitted for Review',
            body: `"${s.title}" (${s.brand_name}) script was submitted — needs your review and approval.`,
            relatedEntityType: 'content-studio-script',
            relatedEntityId: String(s.id),
          })
        ))
      ))
      .catch(console.error)
  }, [scripts])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

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
      <div data-tour="scripts-view" className="space-y-5">
        <IdeaScriptQueue ideas={ideas} brands={brands} onChanged={load} />
        <IdeaScriptList ideas={ideas} brands={brands} scripts={scripts} onChanged={load} />
      </div>
    </Page>
  )
}
