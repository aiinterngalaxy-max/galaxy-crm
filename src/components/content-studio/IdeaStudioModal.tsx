import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { updateIdea } from '@/lib/content-studio/queries'
import type { Idea, ReferenceMeta } from '@/types/content-studio'

/**
 * Reference → script → captions, on one screen.
 *
 * Everything the model writes lands in an ordinary text box. It drafts, the
 * team edits, and nothing is generated again unless someone asks — a
 * regenerate that quietly discarded a rewritten hook would be worse than no
 * button at all.
 *
 * Saving is explicit for the same reason. The dialog holds a working copy; the
 * idea row only changes when Save is pressed.
 */

async function creative<T>(action: string, payload: Record<string, string>): Promise<T> {
  const res = await fetch('/api/content-studio/creative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json as T
}

function parseMeta(raw?: string): ReferenceMeta | null {
  if (!raw) return null
  try { return JSON.parse(raw) as ReferenceMeta } catch { return null }
}

function parseCaptions(raw?: string): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function IdeaStudioModal({
  idea, brandName, autoGenerate, onClose, onSaved,
}: {
  idea: Idea
  brandName?: string
  /** Opened from the script queue: write a first draft without being asked. */
  autoGenerate?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [url, setUrl] = useState(idea.reference_url ?? '')
  const [meta, setMeta] = useState<ReferenceMeta | null>(parseMeta(idea.reference_meta))
  const [hook, setHook] = useState(idea.script_hook ?? '')
  const [body, setBody] = useState(idea.script_body ?? '')
  const [cta, setCta] = useState(idea.script_cta ?? '')
  const [examples, setExamples] = useState(idea.caption_examples ?? '')
  const [captions, setCaptions] = useState<string[]>(parseCaptions(idea.captions))

  const [analysing, setAnalysing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [captioning, setCaptioning] = useState(false)
  const [saving, setSaving] = useState(false)

  async function analyse() {
    if (!url.trim()) { toast.error('Paste a post link first'); return }
    setAnalysing(true)
    try {
      const r = await creative<ReferenceMeta>('analyse', { url: url.trim() })
      setMeta(r)
      toast.success('Reference read')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that link')
    } finally {
      setAnalysing(false)
    }
  }

  async function writeScript() {
    setWriting(true)
    try {
      const r = await creative<{ hook: string; body: string; cta: string }>('script', {
        title: idea.title,
        platform: idea.platform ?? '',
        analysis: meta?.analysis ?? '',
        caption: meta?.caption ?? '',
      })
      setHook(r.hook); setBody(r.body); setCta(r.cta)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not write the script')
    } finally {
      setWriting(false)
    }
  }

  async function writeCaptions() {
    setCaptioning(true)
    try {
      const r = await creative<{ captions: string[] }>('captions', {
        title: idea.title, examples, hook, cta,
      })
      setCaptions(r.captions)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not write captions')
    } finally {
      setCaptioning(false)
    }
  }

  /**
   * Only ever on the way in, and only when there is nothing to lose. A draft
   * that appeared over someone's edited hook would be a bug, not a feature.
   */
  useEffect(() => {
    if (!autoGenerate) return
    if (hook || body || cta) return
    writeScript()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    try {
      await updateIdea(idea.id, {
        reference_url: url.trim(),
        reference_meta: meta ? JSON.stringify(meta) : '',
        script_hook: hook,
        script_body: body,
        script_cta: cta,
        caption_examples: examples,
        captions: captions.length ? JSON.stringify(captions) : '',
      })
      toast.success('Saved')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const step = 'text-[11px] font-medium px-2 py-0.5 rounded-full bg-gold-500/15 text-gold-400'

  /**
   * Rendered into <body>, not where it is written. Every card in Content Studio
   * is a .glass-card with a backdrop-filter, and a filtered element becomes the
   * containing block for fixed-position descendants — so the dialog was being
   * centred inside whichever card opened it and clipped by its edges, with the
   * page showing through.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-2xl rounded-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-100">{idea.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {brandName ?? `Brand ${idea.brand_id}`}{idea.platform ? ` · ${idea.platform}` : ''} · {idea.month}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        {/* ── Reference ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={step}>Step 2</span>
            <span className="text-sm font-medium text-gray-200">Reference post</span>
          </div>
          <div className="flex gap-2">
            <input
              className="form-input flex-1"
              placeholder="https://instagram.com/reel/…"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
            <button className="btn-primary whitespace-nowrap" onClick={analyse} disabled={analysing}>
              {analysing ? 'Reading…' : 'Analyse'}
            </button>
          </div>

          {meta && (
            <div className="flex gap-3 pt-1">
              {meta.thumbnail
                ? <img src={meta.thumbnail} alt="" className="w-20 h-28 object-cover rounded-lg shrink-0 bg-gray-800" />
                : <div className="w-20 h-28 rounded-lg bg-gray-800 shrink-0" />}
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-gray-200">{meta.author || 'Unknown author'}</p>
                {meta.caption && <p className="text-xs text-gray-500 line-clamp-3">{meta.caption}</p>}
                {meta.analysis && <p className="text-xs text-gray-400 leading-relaxed">{meta.analysis}</p>}
              </div>
            </div>
          )}
        </section>

        {/* ── Script ────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={step}>Step 3</span>
              <span className="text-sm font-medium text-gray-200">Script — every box editable</span>
            </div>
            <button className="btn-secondary text-xs" onClick={writeScript} disabled={writing}>
              {writing ? 'Writing…' : hook || body || cta ? '⟳ Regenerate' : '⚡ Generate'}
            </button>
          </div>

          {[
            { label: 'Hook', value: hook, set: setHook, rows: 2, hint: '~3s' },
            { label: 'Body', value: body, set: setBody, rows: 3, hint: '~20s' },
            { label: 'CTA', value: cta, set: setCta, rows: 2, hint: '~5s' },
          ].map(f => (
            <div key={f.label}>
              <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                <span>{f.label}</span><span>{f.hint}</span>
              </div>
              <textarea
                className="form-input w-full"
                rows={f.rows}
                value={f.value}
                onChange={e => f.set(e.target.value)}
                placeholder={`${f.label}…`}
              />
            </div>
          ))}
        </section>

        {/* ── Captions ──────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={step}>Step 4</span>
            <span className="text-sm font-medium text-gray-200">Captions</span>
          </div>
          <div>
            <label className="form-label">Your example captions — one per line</label>
            <textarea
              className="form-input w-full"
              rows={3}
              value={examples}
              onChange={e => setExamples(e.target.value)}
              placeholder={'Your home, but smarter 🏠 #galaxyhomeautomation'}
            />
            <p className="text-[11px] text-gray-600 mt-1">
              These set the voice. The captions are written to match yours, not scraped from trends.
            </p>
          </div>
          <div className="flex justify-end">
            <button className="btn-secondary text-xs" onClick={writeCaptions} disabled={captioning}>
              {captioning ? 'Writing…' : 'Generate captions'}
            </button>
          </div>

          {captions.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-800 px-3 py-2">
              <p className="text-xs text-gray-300 flex-1 leading-relaxed">{c}</p>
              <button
                className="text-[11px] text-gray-500 hover:text-gold-400 shrink-0"
                onClick={() => { navigator.clipboard.writeText(c); toast.success('Copied') }}
              >
                Copy
              </button>
            </div>
          ))}
        </section>

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
          <button className="btn-primary flex-1" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
