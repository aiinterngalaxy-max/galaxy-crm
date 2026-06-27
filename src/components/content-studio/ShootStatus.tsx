import { useState } from 'react'
import toast from 'react-hot-toast'
import { updateShoot } from '@/lib/content-studio/queries'

const OPTIONS = ['Planned', 'Scheduled', 'Completed', 'Cancelled'] as const

export function ShootStatus({ id, status, onChanged }: { id: number; status: string; onChanged: () => void }) {
  const [val, setVal] = useState(status)
  const [busy, setBusy] = useState(false)

  async function set(s: string) {
    if (s === val) return
    const prev = val
    setBusy(true)
    setVal(s)
    try {
      await updateShoot(id, { status: s })
      onChanged()
    } catch (err: any) {
      setVal(prev)
      toast.error(err?.message || 'Failed to update shoot status')
    } finally {
      setBusy(false)
    }
  }

  const tone: Record<string, string> = {
    Planned: 'bg-gray-800 text-gray-300',
    Scheduled: 'bg-sky-600 text-white',
    Completed: 'bg-emerald-600 text-white',
    Cancelled: 'bg-rose-600 text-white',
  }

  return (
    <div className={`inline-flex rounded-lg border border-gray-800 overflow-hidden ${busy ? 'opacity-60' : ''}`}>
      {OPTIONS.map((o) => (
        <button
          key={o}
          onClick={() => set(o)}
          className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${val === o ? tone[o] : 'bg-gray-900 text-gray-500 hover:bg-gray-800'}`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
