import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, RefreshCw, Sparkles, Bot, Trash2 } from 'lucide-react'
import { db, collection, getDocs, query, orderBy, limit } from '../../lib/firebase'
import type { InventoryItem } from '../../types'
import toast from 'react-hot-toast'

interface Message {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const SUGGESTED = [
  'Which Elysia items are out of stock?',
  'How many 4T Grey do we have and in which rack?',
  'Show me the last 10 stock movements',
  'What Elysia stock is below its reorder level?',
  'What projects are currently in progress?',
  'Which invoices are overdue?',
]

const fmt = (n?: number) =>
  n != null ? `₹${n.toLocaleString('en-IN')}` : '₹0'

const tsDate = (ts: unknown): string => {
  if (!ts) return '-'
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function')
    return (ts as { toDate: () => Date }).toDate().toLocaleDateString('en-IN')
  return '-'
}

// Compact single-line formatters to minimize token usage
const fmtI = (n?: number) => n ? `₹${(n / 100000).toFixed(1)}L` : '₹0'
const fmtFull = (n?: number) => n ? `₹${n.toLocaleString('en-IN')}` : '₹0'

async function fetchCRMContext(): Promise<string> {
  // Fetch each collection independently and tolerate a permission-denied on any
  // one of them — a user who can't read (say) invoices or candidates should
  // still get a working assistant over the data they CAN see, rather than a
  // hard failure that breaks the whole chatbot.
  // Preserve each snapshot's real type (so downstream .docs typing still works)
  // while falling back to an empty stand-in if a collection read is denied.
  const safe = <T,>(p: Promise<T>): Promise<T> =>
    p.catch(() => ({ docs: [], size: 0 } as unknown as T))
  // Bound every fetch so cost stays flat as the CRM grows (the context is
  // truncated to ~5k tokens before it reaches the model anyway, so unbounded
  // reads were pure waste). Limits sit above current collection sizes, so
  // nothing is dropped today. Per-project collected amounts come from the
  // denormalized `stagesPaidAmount` field, replacing a collectionGroup scan
  // over every project's workflow stages (previously the single biggest read).
  const [projects, leads, customers, quotations, invoices, candidates, inventory, movements] =
    await Promise.all([
      safe(getDocs(query(collection(db, 'projects'), limit(200)))),
      safe(getDocs(query(collection(db, 'leads'), orderBy('createdAt', 'desc'), limit(250)))),
      safe(getDocs(query(collection(db, 'customers'), limit(200)))),
      safe(getDocs(query(collection(db, 'quotations'), limit(40)))),
      safe(getDocs(query(collection(db, 'invoices'), limit(40)))),
      safe(getDocs(query(collection(db, 'candidates'), limit(60)))),
      // Elysia rows are filtered in code rather than with where('productLine','==','elysia'):
      // items created before the field existed simply don't carry it, and Firestore
      // skips documents missing the field a query filters on — those rows would
      // vanish from the assistant's view entirely.
      safe(getDocs(query(collection(db, 'inventory'), limit(500)))),
      safe(getDocs(query(collection(db, 'stockTransactions'), orderBy('createdAt', 'desc'), limit(80)))),
    ])

  const L: string[] = []
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  L.push(`GALAXY CRM ${today}`)

  /**
   * Each section gets its own share of the context, instead of one shared cap
   * that the first sections eat. Before this, a long project or lead list could
   * push everything after it past the limit — the section would be silently
   * dropped and the assistant would answer "I don't have that data" about data
   * it had just fetched. A section that overflows says so, and says how many
   * rows it dropped, so a wrong answer is at least traceable.
   */
  const section = (title: string, lines: string[], budget: number) => {
    L.push(`\n${title}:`)
    let used = 0
    for (let i = 0; i < lines.length; i++) {
      if (used + lines[i].length > budget) {
        L.push(`[+${lines.length - i} more rows not shown]`)
        return
      }
      L.push(lines[i])
      used += lines[i].length + 1
    }
  }

  // Projects — paid amount from the denormalized per-project stage total
  section(`PROJECTS(${projects.size})`, projects.docs.map(d => {
    const p = d.data()
    const val = p.projectValue ?? p.totalValue ?? 0
    const paid = p.stagesPaidAmount ?? p.collectedAmount ?? p.totalPaid ?? 0
    return `${p.projectCode ?? d.id}|${p.title}|${p.customerName ?? ''}|${p.status}|${p.completionPercent ?? 0}%|pm:${p.assignedPMName ?? '-'}|val:${fmtI(val)}|paid:${fmtI(paid)}|bal:${fmtI(val - paid)}`
  }), 6000)

  // Leads — most-recent first, capped (see fetch limit above)
  section(`LEADS(${leads.size})`, leads.docs.map(d => {
    const l = d.data()
    return `${l.name}|${l.status}|${l.assignedToName ?? '-'}`
  }), 2500)

  // Customers — all, compact
  section(`CUSTOMERS(${customers.size})`, customers.docs.map(d => {
    const c = d.data()
    return `${c.name}|val:${fmtI(c.totalProjectValue)}|paid:${fmtI(c.totalPaid)}`
  }), 1500)

  // Quotations — max 20
  section(`QUOTATIONS(${quotations.size})`, quotations.docs.slice(0, 20).map(d => {
    const q = d.data()
    return `${q.quotationCode ?? d.id}|${q.customerName ?? '-'}|${q.status}|${fmtFull(q.total)}`
  }), 1000)

  // Invoices — max 20
  section(`INVOICES(${invoices.size})`, invoices.docs.slice(0, 20).map(d => {
    const inv = d.data()
    return `${inv.invoiceCode ?? d.id}|${inv.customerName ?? '-'}|${inv.status}|${fmtFull(inv.amount)}|bal:${fmtFull(inv.balance)}`
  }), 1000)

  // Payment data is embedded per-project above from workflow stages

  // Candidates
  section(`CANDIDATES(${candidates.size})`, candidates.docs.map(d => {
    const c = d.data()
    return `${c.name}|${c.jobTitle}|score:${c.score}|${c.recommendation}|skills:${c.breakdown?.skills}|exp:${c.breakdown?.experience}|edu:${c.breakdown?.education}`
  }), 1200)

  // ── Elysia stock ─────────────────────────────────────────────────────────────
  // Every total here is computed in code, not left to the model. A language model
  // asked to add up 200 rows produces a confident wrong number, and "how much
  // stock do we have" is exactly the question people will trust the answer to.
  const elysia = inventory.docs
    .map(d => d.data() as InventoryItem)
    .filter(i => (i.productLine ?? 'elysia') === 'elysia')

  const units = elysia.reduce((sum, i) => sum + (i.closingStock ?? 0), 0)
  const outOfStock = elysia.filter(i => (i.closingStock ?? 0) <= 0)
  const lowStock = elysia.filter(i => (i.closingStock ?? 0) > 0 && (i.closingStock ?? 0) <= (i.reorderLevel ?? 0))

  L.push(`\nELYSIA STOCK: ${elysia.length} items, ${units} units in hand, ${outOfStock.length} out of stock, ${lowStock.length} low`)
  L.push('Closing = Opening + Imported - Issued - Outward. Issued = used internally/on site, Outward = dispatched to a client.')

  // Per-module totals, so "how many 4T do we have" needs no addition by the model.
  const byModule = new Map<string, { items: number; units: number }>()
  elysia.forEach(i => {
    const key = i.category || 'OTHER'
    const cur = byModule.get(key) ?? { items: 0, units: 0 }
    byModule.set(key, { items: cur.items + 1, units: cur.units + (i.closingStock ?? 0) })
  })
  L.push(`BY MODULE: ${[...byModule.entries()].map(([k, v]) => `${k}:${v.units}u/${v.items}items`).join(' | ')}`)

  // Named lists, not just counts, so "what's out of stock" is answered outright.
  // Capped because these are single lines that the per-section budget can't trim.
  const named = (all: string[], cap = 60) =>
    all.length > cap ? `${all.slice(0, cap).join(', ')} [+${all.length - cap} more]` : all.join(', ')

  if (outOfStock.length) {
    L.push(`OUT OF STOCK(${outOfStock.length}): ${named(outOfStock.map(i => `${i.itemName}[${i.location ?? '?'}]`))}`)
  }
  if (lowStock.length) {
    L.push(`LOW STOCK(${lowStock.length}): ${named(lowStock.map(i => `${i.itemName}:${i.closingStock}(reorder@${i.reorderLevel})`))}`)
  }

  section(
    `ELYSIA ITEMS(${elysia.length}) code|name|colour|material|rack|client|opening|imported|issued|outward|CLOSING`,
    // Lowest stock first, so if the list ever overflows its budget the rows that
    // get dropped are the ones nobody needs to ask about.
    [...elysia]
      .sort((a, b) => (a.closingStock ?? 0) - (b.closingStock ?? 0))
      .map(i => [
        i.itemCode, i.itemName, i.color || '-', i.material || '-', i.location || '-',
        i.clientName || '-', i.openingStock ?? 0, i.importedQty ?? 0, i.issuedQty ?? 0,
        i.outwardQty ?? 0, i.closingStock ?? 0,
      ].join('|')),
    12000,
  )

  // Recent movements answer "who took what, when" — the questions the stock
  // figures alone can't. Bounded to the most recent, since this collection only grows.
  section(
    `RECENT STOCK MOVEMENTS(${movements.size}) date|in/out|item|qty|by|note`,
    movements.docs.map(d => {
      const t = d.data()
      return `${tsDate(t.createdAt)}|${t.type === 'issue' ? 'OUT' : 'IN'}|${t.itemName ?? t.itemCode}|${t.quantity}|${t.recordedByName ?? '-'}|${t.note ?? '-'}`
    }),
    4000,
  )

  return L.join('\n')
}

// Marker so we know which history entry carries the context payload
const CTX_PREFIX = '__CRM_CTX__:'

async function chatWithGroq(
  history: { role: string; content: string }[],
  context: string
): Promise<string> {
  const API_KEY = import.meta.env.VITE_GROQ_API_KEY as string
  if (!API_KEY) throw new Error('VITE_GROQ_API_KEY is not set')

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Minimal system prompt — context travels in the first user message, not here
  const sysPrompt = `You are Galaxy CRM Assistant for Galaxy Home Automation Pvt Ltd (India). Today: ${today}. Rules: Answer directly from the CRM data — never ask follow-up questions, never ask for clarification. Just show the matching records. Use ₹ and Indian units. If data is missing say so briefly.
Stock: the ELYSIA sections are live warehouse stock. CLOSING is the units in hand — quote it as-is and never recalculate it. Totals, out-of-stock and low-stock counts are already computed in the data: use those numbers rather than adding up rows yourself, and if a total you need is not given, say so instead of estimating. Issued means used internally or on site; Outward means dispatched to a client. Rack is where the item is kept. A row marked "[+N more rows not shown]" means the list was cut — say so rather than treating it as complete.`

  // Cap context at 40k chars ≈ 10k tokens. Each section is budgeted separately
  // above, so this is a backstop rather than the thing doing the trimming.
  const safeCtx = context.length > 40000 ? context.slice(0, 40000) + '\n[truncated]' : context

  // Build API messages:
  // - First user message gets context prepended (once, not on every call)
  // - Keep first message + last 5 to cap growing history
  let apiMessages = history.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      // Embed context in the very first question
      return { role: 'user', content: `CRM DATA:\n${safeCtx}\n---\n${m.content}` }
    }
    return m
  })

  // Trim: always keep message[0] (has context) + last 5 messages
  if (apiMessages.length > 6) {
    apiMessages = [apiMessages[0], ...apiMessages.slice(-5)]
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: sysPrompt }, ...apiMessages],
      max_tokens: 500,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Groq API error:', res.status, text)
    let msg = `Gemini error ${res.status}`
    try { msg = JSON.parse(text)?.error?.message ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data = await res.json()
  return (data.choices?.[0]?.message?.content as string) ?? ''
}

export function CRMChatbot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [context, setContext] = useState<string | null>(null)
  const [loadingCtx, setLoadingCtx] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const loadContext = useCallback(async () => {
    setLoadingCtx(true)
    try {
      const ctx = await fetchCRMContext()
      setContext(ctx)
    } catch {
      toast.error('Failed to load CRM data')
    } finally {
      setLoadingCtx(false)
    }
  }, [])

  useEffect(() => {
    if (open && !context) loadContext()
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const send = useCallback(async (text = input.trim()) => {
    if (!text || thinking || !context) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setThinking(true)

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const reply = await chatWithGroq(history, context)
      setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('CRM chatbot error:', msg)
      // Show error inline so user can read the full message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Error: ${msg}`,
        ts: Date.now(),
      }])
    } finally {
      setThinking(false)
    }
  }, [input, thinking, context, messages])

  const isEmpty = messages.length === 0 && !thinking

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Galaxy CRM Assistant"
        style={{
          position: 'fixed', bottom: 88, right: 24, zIndex: 9999,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #C9A840, #a07820)',
          border: '1px solid rgba(201,168,64,0.5)',
          boxShadow: '0 4px 24px rgba(201,168,64,0.40), 0 2px 8px rgba(0,0,0,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.10)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(201,168,64,0.55)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(201,168,64,0.40), 0 2px 8px rgba(0,0,0,0.30)' }}
      >
        {open
          ? <X className="w-5 h-5" style={{ color: '#0A0A0F' }} />
          : <MessageCircle className="w-5 h-5" style={{ color: '#0A0A0F' }} />
        }
      </button>

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed', bottom: 152, right: 24, zIndex: 9998,
            width: 400, height: 580,
            borderRadius: 20, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            background: 'var(--modal-bg)',
            border: '1px solid var(--modal-border)',
            borderTop: '1px solid var(--modal-border-top)',
            backdropFilter: 'blur(48px) saturate(180%)',
            WebkitBackdropFilter: 'blur(48px) saturate(180%)',
            boxShadow: 'var(--modal-shadow)',
            animation: 'chatSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '13px 16px',
            borderBottom: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--glass-bg)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, #C9A840, #a07820)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Sparkles style={{ width: 16, height: 16, color: '#0A0A0F' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: 'var(--text-base)', fontWeight: 700, fontSize: 13, lineHeight: 1 }}>
                Galaxy CRM Assistant
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>
                {loadingCtx
                  ? '⏳ Loading all CRM data…'
                  : context
                    ? '✓ Data synced · Ask me anything'
                    : 'Ready'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={loadContext}
                disabled={loadingCtx}
                title="Refresh CRM data"
                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, lineHeight: 0 }}
              >
                <RefreshCw style={{ width: 14, height: 14 }} className={loadingCtx ? 'animate-spin' : ''} />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  title="Clear chat"
                  style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, lineHeight: 0 }}
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              )}
            </div>
          </div>

          {/* Messages area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Empty state with suggestions */}
            {isEmpty && !loadingCtx && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 4 }}>
                  <Bot style={{ width: 36, height: 36, color: '#C9A840', opacity: 0.7 }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
                    Ask me about your projects, leads, payments, customers, or quotations.
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <p style={{ color: 'var(--text-hint)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Try asking</p>
                  {SUGGESTED.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      style={{
                        background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                        borderRadius: 8, padding: '7px 11px',
                        color: 'var(--text-muted)', fontSize: 11.5,
                        cursor: 'pointer', textAlign: 'left', lineHeight: 1.4,
                        transition: 'background 0.12s, color 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,168,64,0.08)'; e.currentTarget.style.color = '#C9A840' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass-bg)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {isEmpty && loadingCtx && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <div style={{ width: 36, height: 36, border: '3px solid rgba(201,168,64,0.2)', borderTopColor: '#C9A840', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Fetching all CRM data…</p>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                {m.role === 'assistant' && (
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #C9A840, #a07820)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Sparkles style={{ width: 13, height: 13, color: '#0A0A0F' }} />
                  </div>
                )}
                <div style={{
                  maxWidth: '82%',
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg, #C9A840, #a07820)'
                    : 'var(--glass-bg)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--glass-border)',
                  borderRadius: m.role === 'user'
                    ? '16px 16px 4px 16px'
                    : '4px 16px 16px 16px',
                  padding: '9px 12px',
                  color: m.role === 'user' ? '#0A0A0F' : 'var(--text-base)',
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {thinking && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #C9A840, #a07820)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles style={{ width: 13, height: 13, color: '#0A0A0F' }} />
                </div>
                <div style={{
                  background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                  borderRadius: '4px 16px 16px 16px',
                  padding: '12px 16px', display: 'flex', gap: 5, alignItems: 'center',
                }}>
                  {[0, 1, 2].map(j => (
                    <span
                      key={j}
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#C9A840', display: 'block',
                        animation: `chatBounce 1.2s ${j * 0.18}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--glass-border)',
            display: 'flex', gap: 8, alignItems: 'center',
            background: 'var(--glass-bg)',
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder={
                loadingCtx
                  ? 'Loading CRM data…'
                  : context
                    ? 'Ask about projects, payments, leads…'
                    : 'Ready to answer…'
              }
              disabled={loadingCtx || thinking}
              style={{
                flex: 1, background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                borderRadius: 10, padding: '8px 12px',
                color: 'var(--text-base)', fontSize: 12.5,
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = 'rgba(201,168,64,0.5)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--input-border)' }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || thinking || loadingCtx || !context}
              style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: input.trim() && !thinking && context
                  ? 'linear-gradient(135deg, #C9A840, #a07820)'
                  : 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: input.trim() && !thinking && context ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              <Send style={{
                width: 15, height: 15,
                color: input.trim() && !thinking && context ? '#0A0A0F' : 'var(--text-muted)',
              }} />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}
