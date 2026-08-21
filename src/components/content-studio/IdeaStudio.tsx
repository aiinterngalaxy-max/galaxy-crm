import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { updateIdea, getScriptByContentId, updateScript } from '@/lib/content-studio/queries'
import { useViewer } from '@/lib/content-studio/viewer-context'
import { notifySuperAdminsOfScriptSubmitted, notifyTeamOfScriptChangesRequired } from '@/lib/notifyHelpers'
import type { Idea, ReferenceMeta, ScriptRow } from '@/types/content-studio'

/**
 * Reference → script → captions, opened underneath the idea it belongs to.
 *
 * In the flow of the page rather than over it: a dialog here sat on top of the
 * very list you were working down, and every card in Content Studio carries a
 * backdrop-filter, which quietly makes it the containing block for anything
 * fixed inside it. Expanding in place has neither problem.
 *
 * Everything the model writes lands in an ordinary text box. It drafts, the
 * team edits, and nothing is written again unless someone asks — a regenerate
 * that discarded a rewritten hook would be worse than no button at all. Saving
 * is explicit for the same reason: this holds a working copy until Save.
 *
 * Analyse does two things at once: it reads the one link that was pasted, and
 * it has the model search the web for what else is trending in that niche
 * right now. Regenerate then picks whichever pattern — the pasted reference
 * or one of the trending ones — is the strongest fit, rather than being stuck
 * cloning a single post.
 *
 * Two script formats, not one. Reel (hook/body/cta) is for short-form; a
 * separate Explainer format writes the long structured, bilingual (English +
 * Hinglish) presenter script used for deep-dive product videos. They store to
 * different fields so switching formats never overwrites the other.
 *
 * The Script review block below Step 3 is the only thing in the app that can
 * move the underlying cmo_scripts row to Approved — and updateContent()
 * refuses to advance a card past Script Review until that row says Approved.
 * Without this control that gate had no key: nothing else in the UI ever
 * touches script status, so a card could reach Script Review and then simply
 * never leave.
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

/**
 * One handoff sheet, not four separate boxes to read from — this is what
 * gets pasted to whoever is shooting the reel, so it needs the funnel stage
 * and every part of the script in one place, in the order they'll say it.
 */
function buildScriptSheet(idea: Idea, hook: string, body: string, cta: string, caption?: string): string {
  const lines = [
    '🎬 REEL SCRIPT',
    '',
    `Funnel: ${idea.funnel_stage || '—'}`,
    '',
    'HOOK',
    hook || '(not written yet)',
    '',
    'BODY',
    body || '(not written yet)',
    '',
    'CTA',
    cta || '(not written yet)',
  ]
  if (caption) lines.push('', '📱 INSTAGRAM CAPTION', caption)
  return lines.join('\n')
}

/** The explainer script already carries its own title/structure — just append the caption, no extra wrapper needed. */
function appendCaption(text: string, caption?: string): string {
  if (!caption) return text
  return `${text}\n\n---\n\n📱 INSTAGRAM CAPTION\n${caption}`
}

function scriptFileName(title: string, ext: string): string {
  return `${(title || 'script').replace(/[^\w\- ]+/g, '').trim() || 'script'}.${ext}`
}

/**
 * jsPDF is only pulled in here on click (dynamic import), not at the top of
 * the file — this component ships in the same bundle as the whole Ideas
 * board, and jsPDF is a ~350KB dependency that most people opening that
 * board will never trigger. Loading it eagerly would grow every visitor's
 * initial download for a feature only some of them use.
 */
async function downloadScriptAsPdf(title: string, text: string) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(title || 'Script', margin, margin)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  let y = margin + 26
  for (const paragraph of text.split('\n')) {
    const lines: string[] = paragraph ? doc.splitTextToSize(paragraph, pageW - margin * 2) : ['']
    for (const line of lines) {
      if (y > pageH - margin) { doc.addPage(); y = margin }
      doc.text(line, margin, y)
      y += 15
    }
  }
  doc.save(scriptFileName(title, 'pdf'))
}

/**
 * No docx library involved — Word opens any HTML document saved with a
 * .doc extension and an application/msword MIME type, which is exactly
 * enough for a plain-text script and avoids adding a whole new dependency
 * (and its bundle weight) just for this one export.
 */
function downloadScriptAsWord(title: string, text: string) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:Calibri, sans-serif; font-size:11pt;"><h2>${title}</h2><p>${escaped}</p></body></html>`
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = scriptFileName(title, 'doc')
  a.click()
  URL.revokeObjectURL(url)
}

export function IdeaStudio({
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
  const [format, setFormat] = useState<'reel' | 'explainer'>(idea.script_format === 'explainer' ? 'explainer' : 'reel')
  const [hook, setHook] = useState(idea.script_hook ?? '')
  const [body, setBody] = useState(idea.script_body ?? '')
  const [cta, setCta] = useState(idea.script_cta ?? '')
  const [scriptEn, setScriptEn] = useState(idea.script_full_en ?? '')
  const [scriptHi, setScriptHi] = useState(idea.script_full_hi ?? '')
  const [lang, setLang] = useState<'en' | 'hi'>('hi')
  const [examples, setExamples] = useState(idea.caption_examples ?? '')
  const [captions, setCaptions] = useState<string[]>(parseCaptions(idea.captions))

  const [analysing, setAnalysing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const [captioning, setCaptioning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)
  const [script, setScript] = useState<ScriptRow | null>(null)
  const [scriptBusy, setScriptBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { viewer } = useViewer()
  const canApprove = !!viewer?.is_owner

  // The script row only exists once the idea is approved (content_id set) —
  // fetch it so there's something to review, rather than a dead-end blank.
  useEffect(() => {
    if (!idea.content_id) return
    getScriptByContentId(idea.content_id).then(setScript).catch(() => setScript(null))
  }, [idea.content_id])

  const hasScript = format === 'reel' ? !!(hook || body || cta) : !!(scriptEn || scriptHi)
  function scriptText(): string {
    return format === 'explainer' ? (lang === 'en' ? scriptEn : scriptHi) : buildScriptSheet(idea, hook, body, cta)
  }

  async function scriptAction(status: 'Submitted' | 'Approved' | 'Changes Required') {
    if (!script) return
    setScriptBusy(true)
    try {
      const updated = await updateScript(script.id, { status, approved: status === 'Approved' ? 1 : 0 })
      setScript(updated)
      if (status === 'Submitted') {
        notifySuperAdminsOfScriptSubmitted({ scriptId: script.id, contentTitle: idea.title, brandName }).catch(console.error)
        toast.success('Submitted for review')
      } else if (status === 'Approved') {
        toast.success('Script approved — moved to Editing')
      } else {
        notifyTeamOfScriptChangesRequired({ scriptId: script.id, contentTitle: idea.title, brandName }).catch(console.error)
        toast.success('Sent back for changes')
      }
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update script status')
    } finally {
      setScriptBusy(false)
    }
  }

  async function analyse() {
    if (!url.trim()) { toast.error('Paste a post link first'); return }
    setAnalysing(true)
    try {
      const r = await creative<ReferenceMeta>('analyse', { url: url.trim(), title: idea.title })
      setCoverFailed(false)
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
      if (format === 'explainer') {
        const r = await creative<{ script_full_en: string; script_full_hi: string }>('script', {
          format: 'explainer',
          title: idea.title,
          analysis: meta?.analysis ?? '',
          caption: meta?.caption ?? '',
          trends: meta?.trends ?? '',
        })
        setScriptEn(r.script_full_en); setScriptHi(r.script_full_hi)
      } else {
        const r = await creative<{ hook: string; body: string; cta: string }>('script', {
          title: idea.title,
          platform: idea.platform ?? '',
          analysis: meta?.analysis ?? '',
          caption: meta?.caption ?? '',
          author: meta?.author ?? '',
          trends: meta?.trends ?? '',
        })
        setHook(r.hook); setBody(r.body); setCta(r.cta)
      }
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
        title: idea.title,
        examples,
        hook: format === 'explainer' ? '' : hook,
        // The caption is for this video, so it needs the whole script and the
        // reference it was modelled on — not just the opening line. In explainer
        // mode there's no separate hook/cta, so an excerpt of the script stands in.
        scriptBody: format === 'explainer' ? scriptEn.slice(0, 800) : body,
        cta: format === 'explainer' ? '' : cta,
        analysis: meta?.analysis ?? '',
        trends: meta?.trends ?? '',
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
    if (hook || body || cta || scriptEn || scriptHi) return
    writeScript()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    try {
      await updateIdea(idea.id, {
        reference_url: url.trim(),
        reference_meta: meta ? JSON.stringify(meta) : '',
        script_format: format,
        script_hook: hook,
        script_body: body,
        script_cta: cta,
        script_full_en: scriptEn,
        script_full_hi: scriptHi,
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

  // Brings the panel into view when it opens, so pressing Add script on a row
  // near the fold does not leave the work off-screen.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  return (
    <div ref={ref} className="rounded-xl border border-gold-500/25 bg-gray-900/40 p-4 space-y-4 mt-2 mb-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{idea.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {brandName ?? `Brand ${idea.brand_id}`}{idea.platform ? ` · ${idea.platform}` : ''} · {idea.month}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">Collapse</button>
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
              placeholder="Reel or post link — https://instagram.com/p/… or /reel/…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); analyse() } }}
            />
            <button className="btn-primary whitespace-nowrap" onClick={analyse} disabled={analysing}>
              {analysing ? 'Reading & researching…' : 'Analyse'}
            </button>
          </div>

          {meta && (
            <div className="flex gap-3 pt-1">
              {meta.thumbnail && !coverFailed ? (
                /* Through our own server: Instagram's CDN checks the Referer and
                   serves nothing to a page it does not recognise, so a direct
                   src renders an empty box even when the URL is fine. */
                <img
                  src={`/api/content-studio/thumb?u=${encodeURIComponent(meta.thumbnail)}`}
                  alt="Reference post cover"
                  referrerPolicy="no-referrer"
                  className="w-24 h-32 object-cover rounded-lg shrink-0 bg-gray-800"
                  /* A broken-image icon says nothing about what went wrong.
                     Swap to the placeholder, which at least names the problem. */
                  onError={() => setCoverFailed(true)}
                />
              ) : (
                <div className="w-24 h-32 rounded-lg bg-gray-800 shrink-0 flex items-center justify-center p-2">
                  <span className="text-[10px] text-gray-600 text-center leading-tight">No cover available</span>
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-gray-200">{meta.author || 'Unknown author'}</p>
                {meta.caption && <p className="text-xs text-gray-500 line-clamp-3">{meta.caption}</p>}
                {meta.analysis && <p className="text-xs text-gray-400 leading-relaxed">{meta.analysis}</p>}
                {(!meta.thumbnail || coverFailed) && (
                  <p className="text-[11px] text-amber-400/80">
                    {coverFailed
                      ? 'The cover could not be loaded — the caption was still read.'
                      : 'Instagram returned no cover for this link — the caption was still read.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {meta?.trends && (
            <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-3">
              <p className="text-[11px] font-semibold text-gold-400 mb-1">Also trending in this niche right now</p>
              <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{meta.trends}</p>
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
            <div className="flex items-center gap-2">
              {hasScript && (
                <button
                  className="text-[11px] text-gray-500 hover:text-gold-400"
                  onClick={() => {
                    navigator.clipboard.writeText(scriptText())
                    toast.success('Copied')
                  }}
                >
                  📋 Copy script
                </button>
              )}
              <button className="btn-secondary text-xs" onClick={writeScript} disabled={writing}>
                {writing
                  ? format === 'explainer' ? 'Writing both languages…' : 'Writing…'
                  : (format === 'reel' ? (hook || body || cta) : (scriptEn || scriptHi)) ? '⟳ Regenerate' : '⚡ Generate'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${format === 'reel' ? 'bg-gold-500 border-gold-500 text-gray-950' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
              onClick={() => setFormat('reel')}
            >
              Reel — hook / body / cta
            </button>
            <button
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${format === 'explainer' ? 'bg-gold-500 border-gold-500 text-gray-950' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
              onClick={() => setFormat('explainer')}
            >
              Explainer — long, English + Hinglish
            </button>
          </div>

          {format === 'reel' ? (
            [
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
            ))
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <button
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${lang === 'en' ? 'bg-gray-700 border-gray-700 text-white' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                  onClick={() => setLang('en')}
                >
                  English
                </button>
                <button
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${lang === 'hi' ? 'bg-gray-700 border-gray-700 text-white' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                  onClick={() => setLang('hi')}
                >
                  Hinglish
                </button>
              </div>
              <textarea
                className="form-input w-full font-mono text-xs leading-relaxed"
                rows={22}
                value={lang === 'en' ? scriptEn : scriptHi}
                onChange={e => (lang === 'en' ? setScriptEn(e.target.value) : setScriptHi(e.target.value))}
                placeholder={writing ? 'Writing both languages…' : 'Generate to write the full presenter script…'}
              />
            </div>
          )}
        </section>

        {/* ── Script review ─────────────────────────────────────────────── */}
        {script && (
          <section className="rounded-xl border border-gray-800 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className={step}>Review</span>
              <span className="text-sm font-medium text-gray-200">Script review</span>
            </div>

            {script.status === 'Approved' ? (
              <p className="text-sm text-emerald-400 font-medium">✓ Approved — moved to Editing</p>
            ) : script.status === 'Submitted' ? (
              canApprove ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-amber-400 flex-1">Submitted — waiting on your review.</p>
                  <button className="btn-secondary text-xs" disabled={scriptBusy} onClick={() => scriptAction('Changes Required')}>
                    ✗ Request changes
                  </button>
                  <button className="btn-primary text-xs" disabled={scriptBusy} onClick={() => scriptAction('Approved')}>
                    ✓ Approve — moves to Editing
                  </button>
                </div>
              ) : (
                <p className="text-xs text-amber-400">⧗ Submitted — waiting for the Owner to review.</p>
              )
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500 flex-1">
                  {script.status === 'Changes Required'
                    ? 'Sent back for changes — resubmit once the rewrite is ready.'
                    : "Not submitted yet — the card won't move past Script Review until it is."}
                </p>
                <button
                  className="btn-primary text-xs"
                  disabled={scriptBusy || !(format === 'reel' ? (hook || body || cta) : (scriptEn || scriptHi))}
                  onClick={() => scriptAction('Submitted')}
                >
                  Submit for review
                </button>
              </div>
            )}
          </section>
        )}

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
              <button
                className="text-[11px] text-gray-500 hover:text-gold-400 shrink-0"
                title={format === 'explainer' ? `Copy the full ${lang === 'en' ? 'English' : 'Hinglish'} script with this caption` : 'Copy the full handoff sheet — funnel, hook, body, CTA and this caption'}
                onClick={() => {
                  const text = format === 'explainer' ? appendCaption(lang === 'en' ? scriptEn : scriptHi, c) : buildScriptSheet(idea, hook, body, cta, c)
                  navigator.clipboard.writeText(text)
                  toast.success('Copied full script')
                }}
              >
                📋 Copy full script
              </button>
            </div>
          ))}
        </section>

      <div className="flex justify-end gap-3">
        <button className="btn-secondary text-xs" onClick={onClose}>Collapse</button>
        {hasScript && (
          <>
            <button
              className="btn-secondary text-xs"
              disabled={pdfDownloading}
              onClick={async () => {
                setPdfDownloading(true)
                try {
                  await downloadScriptAsPdf(idea.title, scriptText())
                } catch {
                  toast.error('Could not generate the PDF')
                } finally {
                  setPdfDownloading(false)
                }
              }}
            >
              {pdfDownloading ? 'Preparing…' : '⬇ PDF'}
            </button>
            <button
              className="btn-secondary text-xs"
              onClick={() => downloadScriptAsWord(idea.title, scriptText())}
            >
              ⬇ Word
            </button>
          </>
        )}
        <button className="btn-primary text-xs" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save script'}
        </button>
      </div>
    </div>
  )
}
