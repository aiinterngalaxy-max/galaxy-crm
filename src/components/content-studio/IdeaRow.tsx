import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { fmtDate } from '@/lib/content-studio/format'
import { useViewer } from '@/lib/content-studio/viewer-context'
import type { Idea } from '@/types/content-studio'
import { deleteIdea as apiDeleteIdea, updateIdea } from '@/lib/content-studio/queries'
import { notifyTeamOfIdeaApproved, notifyTeamOfIdeaRejected } from '@/lib/notifyHelpers'

export function IdeaRow({ idea, brandName, onChanged }: { idea: Idea; brandName?: string; onChanged: () => void }) {
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner
  const [pitched, setPitched] = useState(!!idea.pitched)
  const [approved, setApproved] = useState(!!idea.approved)
  const [rejected, setRejected] = useState(!!idea.rejected)
  const [reviewNote, setReviewNote] = useState(idea.review_note ?? '')
  const [busy, setBusy] = useState(false)
  const noteRef = useRef<HTMLInputElement>(null)

  async function patch(body: Record<string, any>): Promise<boolean> {
    setBusy(true)
    try {
      await updateIdea(idea.id, body)
      onChanged()
      return true
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update idea')
      setPitched(!!idea.pitched)
      setApproved(!!idea.approved)
      setRejected(!!idea.rejected)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${idea.title}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await apiDeleteIdea(idea.id)
      onChanged()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete idea')
      setBusy(false)
    }
  }

  function saveNote(note: string) {
    if (note === (idea.review_note ?? '')) return
    patch({ review_note: note })
  }

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${busy ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5 flex-wrap">
        <Toggle
          on={pitched}
          label="Pitched"
          color="navy"
          onClick={() => {
            const v = !pitched
            setPitched(v)
            patch({ pitched: v ? 1 : 0 })
          }}
        />
        <Toggle
          on={approved}
          label="Approved"
          color="gold"
          disabled={!canApprove}
          disabledTitle="Only the Owner can approve or reject ideas"
          onClick={() => {
            if (!canApprove) return
            const v = !approved
            setApproved(v)
            if (v) setRejected(false)
            patch({ approved: v ? 1 : 0, rejected: 0 }).then((ok) => {
              if (ok && v) notifyTeamOfIdeaApproved({ ideaId: idea.id, title: idea.title, brandName }).catch(console.error)
            })
          }}
        />
        <Toggle
          on={rejected}
          label="Rejected"
          color="rose"
          disabled={!canApprove}
          disabledTitle="Only the Owner can approve or reject ideas"
          onClick={() => {
            if (!canApprove) return
            const v = !rejected
            setRejected(v)
            if (v) {
              setApproved(false)
              setTimeout(() => noteRef.current?.focus(), 50)
            }
            patch({ rejected: v ? 1 : 0, approved: 0 }).then((ok) => {
              if (ok && v) notifyTeamOfIdeaRejected({ ideaId: idea.id, title: idea.title, brandName, reviewNote }).catch(console.error)
            })
          }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className={`text-sm ${pitched ? 'text-gray-100 font-medium' : 'text-gray-300'} truncate`}>{idea.title}</div>

        {approved && <div className="text-xs text-emerald-400 font-medium mt-0.5">✓ Approved</div>}
        {rejected && (
          <div className="mt-1 space-y-1">
            <div className="text-xs text-rose-400 font-medium">✗ Rejected{reviewNote ? `: ${reviewNote}` : ''}</div>
            <input
              ref={noteRef}
              type="text"
              className="form-input text-xs py-1"
              placeholder="Add a rejection reason…"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              onBlur={(e) => saveNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              disabled={busy}
            />
          </div>
        )}
        {!approved && !rejected && pitched && <div className="text-xs text-amber-400 font-medium mt-0.5">⧗ Pending review</div>}
      </div>

      <div className="shrink-0 flex items-center gap-2 pt-0.5">
        <span className="text-xs text-gray-500">{idea.pitch_due ? `pitch by ${fmtDate(idea.pitch_due)}` : '—'}</span>
        <button
          onClick={handleDelete}
          disabled={busy}
          title="Delete idea"
          className="rounded p-1 text-gray-600 hover:bg-rose-900/30 hover:text-rose-400 disabled:opacity-50 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function Toggle({
  on,
  label,
  color,
  disabled,
  disabledTitle,
  onClick,
}: {
  on: boolean
  label: string
  color: 'navy' | 'gold' | 'rose'
  disabled?: boolean
  disabledTitle?: string
  onClick: () => void
}) {
  const active =
    color === 'gold'
      ? 'bg-gold-500 border-gold-500 text-gray-950'
      : color === 'rose'
      ? 'bg-rose-500 border-rose-500 text-white'
      : 'bg-gray-700 border-gray-700 text-white'

  if (disabled) {
    return (
      <span
        title={disabledTitle ?? 'Not permitted'}
        className="inline-flex items-center gap-1 rounded-md border border-gray-800 px-2 py-1 text-[11px] font-semibold text-gray-600 cursor-not-allowed select-none"
      >
        <span>○</span>
        {label}
      </span>
    )
  }

  return (
    <button
      onClick={onClick}
      title={label}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
        on ? active : 'border-gray-700 text-gray-500 hover:border-gray-600'
      }`}
    >
      <span>{on ? '✓' : '○'}</span>
      {label}
    </button>
  )
}
