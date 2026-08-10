import { useState } from 'react'
import { IdeaStudio } from './IdeaStudio'
import type { Brand, Idea } from '@/types/content-studio'

/**
 * Ideas that still need a script.
 *
 * An idea and its script were two separate errands before: you wrote the idea
 * in one place and had to remember it existed when you got to the other.
 * Anything without a hook, body or CTA shows up here on its own, and Add script
 * expands the writing panel under that row — the queue empties itself as
 * scripts get written.
 *
 * One row open at a time. Two half-written scripts on screen is a way to save
 * the wrong one.
 */
export function IdeaScriptQueue({
  ideas, brands, onChanged,
}: {
  ideas: Idea[]
  brands: Brand[]
  onChanged: () => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)

  const waiting = ideas.filter(i => !i.script_hook && !i.script_body && !i.script_cta && !i.rejected)
  const brandName = (id: number) => brands.find(b => b.id === id)?.name

  if (waiting.length === 0) {
    return (
      <div className="glass-card p-5">
        <h2 className="font-bold text-gray-100 mb-1">Ideas waiting for a script</h2>
        <p className="text-sm text-gray-500">
          Nothing waiting. New ideas appear here as soon as they are created.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-bold text-gray-100">Ideas waiting for a script</h2>
        <span className="text-xs text-gray-500">{waiting.length} waiting</span>
      </div>

      <div className="divide-y divide-gray-800">
        {waiting.map(idea => (
          <div key={idea.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-[9rem] flex-1">
                <div className="text-sm text-gray-200">{idea.title}</div>
                <div className="text-xs text-gray-500">
                  {brandName(idea.brand_id) ?? `Brand ${idea.brand_id}`}
                  {idea.platform ? ` · ${idea.platform}` : ''}
                  {idea.approved ? ' · approved' : ''}
                </div>
              </div>
              <button
                className="btn-secondary text-xs shrink-0 ml-auto"
                onClick={() => setOpenId(openId === idea.id ? null : idea.id)}
              >
                {openId === idea.id ? 'Collapse' : '+ Add script'}
              </button>
            </div>

            {openId === idea.id && (
              <IdeaStudio
                idea={idea}
                brandName={brandName(idea.brand_id)}
                autoGenerate
                onClose={() => setOpenId(null)}
                onSaved={onChanged}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
