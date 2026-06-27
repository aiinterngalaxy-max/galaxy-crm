import { useEffect, useRef, useState } from 'react'
import { PLATFORMS } from '@/lib/content-studio/stages'
import type { Channel } from '@/types/content-studio'
import { createChannel, updateChannel } from '@/lib/content-studio/queries'

interface Props {
  brandId: number
  brandName: string
  channel?: Channel | null
  existingPlatforms: string[]
  onClose: () => void
  onSaved: () => void
}

export function ChannelModal({ brandId, brandName, channel, existingPlatforms, onClose, onSaved }: Props) {
  const firstRef = useRef<HTMLSelectElement | HTMLInputElement>(null)

  const isEdit = Boolean(channel)

  const [form, setForm] = useState({
    platform: channel?.platform ?? '',
    handle: channel?.handle ?? '',
    follower_count: channel?.follower_count != null ? String(channel.follower_count) : '0',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({
      platform: channel?.platform ?? '',
      handle: channel?.handle ?? '',
      follower_count: channel?.follower_count != null ? String(channel.follower_count) : '0',
    })
    setError('')
  }, [channel])

  useEffect(() => {
    ;(firstRef.current as HTMLElement | null)?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!isEdit && !form.platform) {
      setError('Platform is required.')
      return
    }

    const follower_count = Number(form.follower_count)
    if (isNaN(follower_count) || follower_count < 0) {
      setError('Follower count must be 0 or a positive number.')
      return
    }

    setBusy(true)
    try {
      if (isEdit && channel) {
        await updateChannel(channel.id, { handle: form.handle.trim(), follower_count })
      } else {
        await createChannel({ brand_id: brandId, platform: form.platform, handle: form.handle.trim(), follower_count })
      }
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const availablePlatforms = isEdit ? PLATFORMS : PLATFORMS.filter((p) => !existingPlatforms.includes(p))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md glass-modal">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-100">{isEdit ? 'Edit channel' : 'Add channel'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{brandName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="form-label">Platform <span className="text-rose-400">*</span></label>
            {isEdit ? (
              <div className="form-input bg-gray-900 text-gray-400 cursor-not-allowed">{channel!.platform}</div>
            ) : (
              <select
                ref={firstRef as React.RefObject<HTMLSelectElement>}
                className="form-input"
                value={form.platform}
                onChange={set('platform')}
                disabled={busy}
                required
              >
                <option value="">Select platform…</option>
                {availablePlatforms.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
            {!isEdit && availablePlatforms.length === 0 && (
              <p className="text-xs text-amber-400 mt-1">This brand already has channels on all platforms.</p>
            )}
          </div>

          <div>
            <label className="form-label">Handle</label>
            <input
              ref={!isEdit ? undefined : (firstRef as React.RefObject<HTMLInputElement>)}
              className="form-input"
              placeholder="@handle or username"
              value={form.handle}
              onChange={set('handle')}
              disabled={busy}
            />
          </div>

          <div>
            <label className="form-label">Follower count</label>
            <input type="number" min={0} className="form-input" placeholder="0" value={form.follower_count} onChange={set('follower_count')} disabled={busy} />
          </div>

          {error && <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={busy || (!isEdit && availablePlatforms.length === 0)} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
