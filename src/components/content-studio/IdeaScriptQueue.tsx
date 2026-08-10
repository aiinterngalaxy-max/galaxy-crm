import { useState } from 'react'
import { IdeaStudioModal } from './IdeaStudioModal'
import type { Brand, Idea } from '@/types/content-studio'

/**
 * Ideas that still need a script, listed on the Scripts page.
 *
 * An idea and its script were two separate errands before: you wrote the idea
 * in one place and then had to remember it existed when you got to the other.
 * Anything without a hook, body or CTA shows up here on its own, and pressing
 * Add script writes the first draft while the dialog opens — the queue empties
 * itself as scripts get written.
 */
export function IdeaScriptQueue({
  ideas, brands, onChanged,
}: {
  ideas: Idea[]
  brands: Brand[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState<Idea | null>(null)

  const waiting = ideas.filter(i => !i.script_hook && !i.script_body && !i.script_cta && !i.rejected)
  if (waiting.length === 0) return null

  const brandName = (id: number) => brands.find(b => b.id === id)?.name

  return (
    <div className="glass-card p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-bold text-gray-100">Ideas waiting for a script</h2>
        <span className="text-xs text-gray-500">{waiting.length} waiting</span>
      </div>

      <div className="divide-y divide-gray-800">
        {waiting.map(idea => (
          <div key={idea.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <div className="min-w-[9rem] flex-1">
              <div className="text-sm text-gray-200">{idea.title}</div>
              <div className="text-xs text-gray-500">
                {brandName(idea.brand_id) ?? `Brand ${idea.brand_id}`}
                {idea.platform ? ` · ${idea.platform}` : ''}
                {idea.approved ? ' · approved' : ''}
              </div>
            </div>
            <button className="btn-secondary text-xs shrink-0 ml-auto" onClick={() => setOpen(idea)}>
              + Add script
            </button>
          </div>
        ))}
      </div>

      {open && (
        <IdeaStudioModal
          idea={open}
          brandName={brandName(open.brand_id)}
          autoGenerate
          onClose={() => setOpen(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}
