import { useState } from 'react'
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
  const [msg, setMsg] = useState('')

  async function sync() {
    setBusy(true)
    setMsg('Pulling from connected platforms…')
    try {
      const j = await syncNow()
      if (!j.ok) {
        setMsg(j.error || 'sync failed')
      } else {
        const parts = (j.summary || []).map((s: any) => {
          if (!s.ok) return `${s.platform}: ${s.error || 'error'}`
          const base = `${s.platform}: ${s.posts} posts`
          return s.error ? `${base} ⚠ ${s.error}` : base
        })
        setMsg(parts.length ? 'Synced — ' + parts.join(' · ') : 'Nothing to sync')
        onSynced?.()
      }
    } catch (e: any) {
      setMsg('Error: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className={small ? 'btn-secondary text-xs px-2.5 py-1.5' : 'btn-primary'} onClick={sync} disabled={busy}>
        {busy ? 'Syncing…' : `⟳ ${label}`}
      </button>
      {msg && <span className="text-xs text-gray-500 max-w-md">{msg}</span>}
    </div>
  )
}
