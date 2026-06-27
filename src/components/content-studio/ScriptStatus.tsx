import { useState } from 'react'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateScript } from '@/lib/content-studio/queries'
import { notifySuperAdminsOfScriptSubmitted, notifyTeamOfScriptChangesRequired } from '@/lib/notifyHelpers'
import { useViewer } from '@/lib/content-studio/viewer-context'

const OPTIONS = ['Pending', 'In Progress', 'Submitted', 'Changes Required'] as const

export function ScriptStatus({
  id,
  status,
  contentTitle,
  brandName,
  onChanged,
}: {
  id: number
  status: string
  contentTitle?: string
  brandName?: string
  onChanged: () => void
}) {
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner
  const [val, setVal] = useState(status)
  const [busy, setBusy] = useState(false)

  async function set(s: string) {
    if (s === val) return
    const prev = val
    setBusy(true)
    setVal(s)
    try {
      await updateScript(id, { status: s, approved: s === 'Approved' ? 1 : 0 })
      if (s === 'Submitted' && prev !== 'Submitted') {
        notifySuperAdminsOfScriptSubmitted({
          scriptId: id,
          contentTitle: contentTitle || `script #${id}`,
          brandName,
        }).catch(console.error)
      }
      if (s === 'Changes Required' && prev !== 'Changes Required') {
        notifyTeamOfScriptChangesRequired({
          scriptId: id,
          contentTitle: contentTitle || `script #${id}`,
          brandName,
        }).catch(console.error)
      }
      onChanged()
    } catch (err: any) {
      setVal(prev)
      toast.error(err?.message || 'Failed to update script status')
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

  if (val === 'Approved') {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 ${tone.Approved}`}>
        <Check className="w-3 h-3" /> Approved
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
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
      {canApprove && (
        <button
          disabled={busy}
          onClick={() => set('Approved')}
          title="Approve script — moves content to Shoot Planning"
          className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-500 transition-colors ${busy ? 'opacity-60' : ''}`}
        >
          <Check className="w-3 h-3" /> Approve
        </button>
      )}
    </div>
  )
}
