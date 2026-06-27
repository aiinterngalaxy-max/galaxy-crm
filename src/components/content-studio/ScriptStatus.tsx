import { useState } from 'react'
import { updateScript } from '@/lib/content-studio/queries'

const OPTIONS = ['Pending', 'In Progress', 'Submitted', 'Changes Required', 'Approved'] as const

export function ScriptStatus({ id, status, onChanged }: { id: number; status: string; onChanged: () => void }) {
  const [val, setVal] = useState(status)
  const [busy, setBusy] = useState(false)

  async function set(s: string) {
    if (s === val) return
    setBusy(true)
    setVal(s)
    try {
      await updateScript(id, { status: s, approved: s === 'Approved' ? 1 : 0 })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const tone: Record<string, string> = {
    Pending: 'bg-gray-800 text-gray-300',
    'In Progress': 'bg-sky-600 text-white',
    Submitted: 'bg-amber-600 text-white',
    'Changes Required': 'bg-rose-600 text-white',
    Approved: 'bg-emerald-600 text-white',
  }

  return (
    <select
      disabled={busy}
      value={val}
      onChange={(e) => set(e.target.value)}
      className={`text-[11px] font-semibold rounded-md border-0 px-2 py-1 cursor-pointer ${tone[val] || 'bg-gray-800 text-gray-300'} ${busy ? 'opacity-60' : ''}`}
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}
