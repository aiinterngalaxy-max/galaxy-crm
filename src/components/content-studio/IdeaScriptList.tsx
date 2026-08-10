import { useState } from 'react'
import { IdeaStudio } from './IdeaStudio'
import type { Brand, Idea } from '@/types/content-studio'

/**
 * Ideas that already have a script written.
 *
 * IdeaScriptQueue's "waiting" list empties itself as scripts get written — by
 * design, so the queue only shows what still needs doing. But that meant a
 * written script had nowhere left to be seen from Script Management: it fell
 * out of the waiting list and there was no second list to land in, so opening
 * it again to re-read, edit or regenerate meant going back through Ideas or
 * the Pipeline board instead. This is that second list, and unlike the queue
 * it does not empty itself — everything with a script stays here.
 */
export function IdeaScriptList({
  ideas, brands, onChanged,
}: {
  ideas: Idea[]
  brands: Brand[]
  onChanged: () => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)

  const written = ideas.filter(i => (i.script_hook || i.script_body || i.script_cta || i.script_full_en || i.script_full_hi) && !i.rejected)
  const brandName = (id: number) => brands.find(b => b.id === id)?.name

  if (written.length === 0) return null

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-bold text-gray-100">Scripts written</h2>
        <span className="text-xs text-gray-500">{written.length}</span>
      </div>

      <div className="divide-y divide-gray-800">
        {written.map(idea => {
          const isExplainer = idea.script_format === 'explainer'
          const preview = isExplainer
            ? (idea.script_full_en || idea.script_full_hi || '').replace(/[#*_]/g, '').split('\n').find(l => l.trim()) ?? ''
            : idea.script_hook ?? ''
          return (
            <div key={idea.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-[9rem] flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="text-sm text-gray-200">{idea.title}</div>
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {isExplainer ? 'Explainer' : 'Reel'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {brandName(idea.brand_id) ?? `Brand ${idea.brand_id}`}
                    {idea.platform ? ` · ${idea.platform}` : ''}
                  </div>
                  {preview && <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">{preview}</p>}
                </div>
                <button
                  className="btn-secondary text-xs shrink-0 ml-auto"
                  onClick={() => setOpenId(openId === idea.id ? null : idea.id)}
                >
                  {openId === idea.id ? 'Collapse' : 'Open script'}
                </button>
              </div>

              {openId === idea.id && (
                <IdeaStudio
                  idea={idea}
                  brandName={brandName(idea.brand_id)}
                  onClose={() => setOpenId(null)}
                  onSaved={onChanged}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
