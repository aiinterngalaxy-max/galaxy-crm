import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAllContent, getBrands } from '@/lib/content-studio/queries'
import { Page, PageHeader } from '@/components/content-studio/ui'
import { KanbanBoard } from '@/components/content-studio/KanbanBoard'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, ContentRow } from '@/types/content-studio'

export function PipelinePage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [content, setContent] = useState<ContentRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getAllContent(), getBrands()])
      .then(([c, b]) => {
        setContent(c)
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
  if (!brands.length) return <FirstRun onSeeded={load} />

  const editParam = searchParams.get('edit')
  const editId = editParam ? Number(editParam) : undefined

  return (
    <Page>
      <PageHeader title="Content Pipeline" subtitle="Drag any card across stages — Idea → … → Published. Changes save to the shared database." />
      <div data-tour="kanban-board"><KanbanBoard initial={content} brands={brands.map((b) => ({ id: b.id, name: b.name }))} editId={editId} onChanged={load} /></div>
    </Page>
  )
}
