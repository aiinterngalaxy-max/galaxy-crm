import { useState } from 'react'
import toast from 'react-hot-toast'
import { syncNow } from '@/lib/content-studio/queries'

export function SyncButton({
  label = 'Sync live data',
  small = false,
  onSynced,
}: {
  label?: string
  small?: boolean
  onSynced?: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function sync() {
    setBusy(true)
    const tid = toast.loading('Pulling from connected platforms…')
    try {
      const j = await syncNow()
      if (!j.ok) {
        toast.error(j.error || 'Sync failed', { id: tid })
      } else {
        const parts = (j.summary || []).map((s: any) => {
          if (!s.ok) return `${s.platform}: ${s.error || 'error'}`
          const base = `${s.platform}: ${s.posts} posts`
          return s.error ? `${base} ⚠ ${s.error}` : base
        })
        toast.success(parts.length ? parts.join(' · ') : 'Nothing to sync', { id: tid, duration: 5000 })
        onSynced?.()
      }
    } catch (e: any) {
      toast.error('Error: ' + (e?.message || e), { id: tid })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className={small ? 'btn-secondary text-xs px-2.5 py-1.5' : 'btn-primary'} onClick={sync} disabled={busy}>
      {busy ? 'Syncing…' : `⟳ ${label}`}
    </button>
  )
}
