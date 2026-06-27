import { useState } from 'react'
import { initDb } from '@/lib/content-studio/queries'

export function SeedButton({ label = 'Load Galaxy demo data', onSeeded }: { label?: string; onSeeded?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function seed() {
    setBusy(true)
    setMsg('')
    try {
      await initDb({ seed: true })
      setMsg('Loaded. Refreshing…')
      onSeeded?.()
    } catch (e: any) {
      setMsg('Error: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn-primary" onClick={seed} disabled={busy}>
        {busy ? 'Loading…' : label}
      </button>
      {msg && <span className="text-sm text-gray-500">{msg}</span>}
    </div>
  )
}
