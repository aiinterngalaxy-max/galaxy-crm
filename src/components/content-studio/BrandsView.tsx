import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, ProgressBar, StatusDot, Avatar, StageChip } from './ui'
import { PLATFORM_STYLE } from '@/lib/content-studio/stages'
import { pct } from '@/lib/content-studio/format'
import { BrandModal } from './BrandModal'
import { ChannelModal } from './ChannelModal'
import type { Brand, Channel, ContentRow, Idea } from '@/types/content-studio'

interface Props {
  brands: Brand[]
  content: ContentRow[]
  ideas: Idea[]
  channels: Channel[]
  month: string
  onChanged: () => void
}

type ChannelModalState = { mode: 'create'; brand: Brand } | { mode: 'edit'; brand: Brand; channel: Channel } | null

export function BrandsView({ brands, content, ideas, channels, month, onChanged }: Props) {
  const [modalBrand, setModalBrand] = useState<Brand | null | 'new'>(null)
  const [channelModal, setChannelModal] = useState<ChannelModalState>(null)

  const isOpen = modalBrand !== null
  const editTarget = modalBrand === 'new' ? null : (modalBrand as Brand | null)

  return (
    <>
      <PageHeader
        title="Brands & Channels"
        subtitle={`${brands.length} Galaxy-owned properties · monthly targets & live status`}
        right={
          <button onClick={() => setModalBrand('new')} className="btn-primary">
            + Add brand
          </button>
        }
      />

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        {brands.map((br) => {
          const items = content.filter((c) => c.brand_id === br.id)
          const inFlight = items.filter((c) => c.stage !== 'Published')
          const publishedThisMonth = items.filter((c) => c.stage === 'Published' && (c.publish_date || '').startsWith(month)).length
          const target = br.monthly_target || 0
          const targetPct = target ? (publishedThisMonth / target) * 100 : 0

          const bIdeas = ideas.filter((i) => i.brand_id === br.id && i.month === month)
          const pitched = bIdeas.filter((i) => i.pitched).length

          const brandChannels = channels.filter((c) => c.brand_id === br.id)
          const recent = inFlight.slice(0, 3)

          return (
            <div key={br.id} className="glass-card p-5 flex flex-col">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-gray-100">{br.name}</div>
                  <div className="text-xs text-gray-500">{br.category}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <StatusDot status={br.status} />
                  <button
                    onClick={() => setModalBrand(br)}
                    title="Edit brand"
                    className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12l-9 9L2 14l.38-2.62 9-9z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {brandChannels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => setChannelModal({ mode: 'edit', brand: br, channel: ch })}
                    title="Edit channel"
                    className={`badge ${PLATFORM_STYLE[ch.platform] || 'bg-gray-800 text-gray-300'} hover:opacity-80 cursor-pointer transition-opacity`}
                  >
                    {ch.platform} · {ch.handle || '—'}
                    {ch.follower_count > 0 && <span className="opacity-70"> · {ch.follower_count.toLocaleString('en-IN')}</span>}
                  </button>
                ))}
                <button
                  onClick={() => setChannelModal({ mode: 'create', brand: br })}
                  title="Add channel"
                  className="badge bg-gray-800 text-gray-500 hover:bg-gray-700 cursor-pointer transition-colors border border-dashed border-gray-700"
                >
                  + channel
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Box n={inFlight.length} l="In production" />
                <Box n={publishedThisMonth} l="Published" />
                <Box n={target} l="Target" />
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Monthly target</span>
                  <span className="font-semibold text-gray-100">{pct(targetPct)}</span>
                </div>
                <ProgressBar value={targetPct} />
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  Ideas pitched: <span className="font-semibold text-gray-100">{pitched}/{bIdeas.length || '—'}</span>
                </span>
                <span className="flex items-center gap-1.5 text-gray-500">
                  <Avatar name={br.lead} /> {br.lead}
                </span>
              </div>

              {recent.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-800 space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active work</div>
                  {recent.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-200 truncate">{c.title}</span>
                      <StageChip stage={c.stage} />
                    </div>
                  ))}
                </div>
              )}

              <Link to="/content-studio/pipeline" className="mt-4 text-sm font-semibold text-gold-400 hover:underline self-start">
                View pipeline →
              </Link>
            </div>
          )
        })}

        {brands.length === 0 && (
          <div className="glass-card p-10 col-span-full text-center text-gray-500">
            No brands yet. Click <strong className="text-gray-200">+ Add brand</strong> to get started.
          </div>
        )}
      </div>

      {isOpen && (
        <BrandModal
          brand={editTarget}
          onClose={() => setModalBrand(null)}
          onSaved={() => {
            setModalBrand(null)
            onChanged()
          }}
        />
      )}

      {channelModal && (
        <ChannelModal
          brandId={channelModal.brand.id}
          brandName={channelModal.brand.name}
          channel={channelModal.mode === 'edit' ? channelModal.channel : null}
          existingPlatforms={channels.filter((c) => c.brand_id === channelModal.brand.id).map((c) => c.platform)}
          onClose={() => setChannelModal(null)}
          onSaved={() => {
            setChannelModal(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function Box({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-lg bg-gray-900/60 py-2">
      <div className="text-xl font-bold text-gray-100">{n}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{l}</div>
    </div>
  )
}
