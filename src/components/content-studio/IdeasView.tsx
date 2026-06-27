import { useState } from 'react'
import { ProgressBar } from './ui'
import { pct } from '@/lib/content-studio/format'
import { IdeaRow } from './IdeaRow'
import { IdeaModal } from './IdeaModal'
import type { Brand, Idea } from '@/types/content-studio'

interface Props {
  brands: Brand[]
  ideas: Idea[]
  onChanged: () => void
}

export function IdeasView({ brands, ideas, onChanged }: Props) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Add idea
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {brands.map((br) => {
          const list = ideas.filter((i) => i.brand_id === br.id)
          if (!list.length) return null
          const pitched = list.filter((i) => i.pitched).length
          const p = list.length ? (pitched / list.length) * 100 : 0
          return (
            <div key={br.id} className="glass-card">
              <div className="p-5 border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-gray-100">{br.name}</div>
                  <span className="text-sm font-semibold text-gray-300">
                    {pitched}/{list.length} · {pct(p)}
                  </span>
                </div>
                <ProgressBar value={p} className="mt-2" />
              </div>
              <div className="divide-y divide-gray-800">
                {list.map((idea) => (
                  <IdeaRow key={idea.id} idea={idea} brandName={br.name} onChanged={onChanged} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <IdeaModal
          brands={brands}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}
