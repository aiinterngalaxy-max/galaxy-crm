import { useCallback, useEffect, useState } from 'react'
import { getAllContent, getBrands, getChannels, getIdeas } from '@/lib/content-studio/queries'
import { Page } from '@/components/content-studio/ui'
import { FirstRun } from '@/components/content-studio/FirstRun'
import { BrandsView } from '@/components/content-studio/BrandsView'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Brand, Channel, ContentRow, Idea } from '@/types/content-studio'

export function BrandsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [content, setContent] = useState<ContentRow[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getBrands(), getAllContent(), getIdeas(), getChannels()])
      .then(([b, c, i, ch]) => {
        setBrands(b)
        setContent(c)
        setIdeas(i)
        setChannels(ch)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error) return <FirstRun error={error} onSeeded={load} />

  const month = new Date().toISOString().slice(0, 7)

  return (
    <Page>
      <div data-tour="brands-view"><BrandsView brands={brands} content={content} ideas={ideas} channels={channels} month={month} onChanged={load} /></div>
    </Page>
  )
}
