import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, RefreshCw, Sparkles, Bot, Trash2 } from 'lucide-react'
import { db, collection, getDocs } from '../../lib/firebase'
import toast from 'react-hot-toast'

interface Message {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const SUGGESTED = [
  'What projects are currently in progress?',
  'Show me all unqualified leads',
  'Which invoices are overdue?',
  'How much revenue have we collected total?',
  'Who are our top customers by project value?',
  'List all leads assigned to each team member',
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
  const [projects, leads, customers, quotations, invoices, payments, dailyReports, candidates] =
    await Promise.all([
      getDocs(collection(db, 'projects')),
      getDocs(collection(db, 'leads')),
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'quotations')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'dailyReports')),
      getDocs(collection(db, 'candidates')),
    ])

  const L: string[] = []
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  L.push(`GALAXY CRM DATA ${today}`)

  // Projects — compact single line
  L.push(`\nPROJECTS(${projects.size}):`)
  projects.docs.forEach(d => {
    const p = d.data()
    const val = p.projectValue ?? p.totalValue ?? 0
    const paid = p.collectedAmount ?? p.totalPaid ?? 0
    const parts = [
      `[${p.projectCode ?? d.id}]`,
      p.title ?? 'Untitled',
      p.customerName ? `client:${p.customerName}` : '',
      `status:${p.status}`,
      `${p.completionPercent ?? 0}%`,
      p.assignedPMName ? `pm:${p.assignedPMName}` : '',
      p.city ? `city:${p.city}` : '',
      `val:${fmtI(val)}`,
      `paid:${fmtI(paid)}`,
      `bal:${fmtI(val - paid)}`,
      p.riskLevel !== 'low' ? `risk:${p.riskLevel}` : '',
    ].filter(Boolean)
    L.push(parts.join(' | '))
  })

  // Leads — compact single line
  L.push(`\nLEADS(${leads.size}):`)
  leads.docs.forEach(d => {
    const l = d.data()
    const parts = [
      `[${l.leadCode ?? d.id}]`,
      l.name,
      `status:${l.status}`,
      l.source ? `src:${l.source}` : '',
      l.estimatedBudget ? `budget:${fmtI(l.estimatedBudget)}` : '',
      l.assignedToName ? `assigned:${l.assignedToName}` : '',
      l.phone ? `ph:${l.phone}` : '',
      l.nextFollowUp ? `followup:${tsDate(l.nextFollowUp)}` : '',
    ].filter(Boolean)
    L.push(parts.join(' | '))
  })

  // Customers
  L.push(`\nCUSTOMERS(${customers.size}):`)
  customers.docs.forEach(d => {
    const c = d.data()
    const bal = (c.totalProjectValue ?? 0) - (c.totalPaid ?? 0)
    L.push(
      `${c.name} | ph:${c.phone ?? '-'} | val:${fmtI(c.totalProjectValue)} | paid:${fmtI(c.totalPaid)} | bal:${fmtI(bal)}`
    )
  })

  // Quotations
  L.push(`\nQUOTATIONS(${quotations.size}):`)
  quotations.docs.forEach(d => {
    const q = d.data()
    L.push(
      `[${q.quotationCode ?? d.id}] ${q.customerName ?? '-'} | status:${q.status} | total:${fmtFull(q.total)} | pm:${q.assignedPMName ?? '-'}`
    )
  })

  // Invoices
  L.push(`\nINVOICES(${invoices.size}):`)
  invoices.docs.forEach(d => {
    const inv = d.data()
    L.push(
      `[${inv.invoiceCode ?? d.id}] ${inv.customerName ?? '-'} | status:${inv.status} | amt:${fmtFull(inv.amount)} | paid:${fmtFull(inv.paidAmount)} | bal:${fmtFull(inv.balance)} | due:${tsDate(inv.dueDate)}`
    )
  })

  // Payments — newest 50
  const allPayments = payments.docs
    .map(d => d.data())
    .sort((a, b) => {
      const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0
      const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0
      return bt - at
    })
    .slice(0, 50)

  L.push(`\nPAYMENTS(last ${allPayments.length}):`)
  allPayments.forEach(p => {
    const parts = [
      fmtFull(p.amount),
      `via:${p.mode ?? '-'}`,
      `on:${tsDate(p.date ?? p.createdAt)}`,
      p.recordedByName ? `by:${p.recordedByName}` : '',
      p.reference ? `ref:${p.reference}` : '',
    ].filter(Boolean)
    L.push(parts.join(' | '))
  })

  // Daily Reports — last 14
  const recentReports = dailyReports.docs
    .map(d => d.data())
    .sort((a, b) => (b.date as string ?? '').localeCompare(a.date as string ?? ''))
    .slice(0, 14)

  L.push(`\nDAILY_REPORTS(last ${recentReports.length}):`)
  recentReports.forEach(r => {
    const summary = r.preFilledSummary ? r.preFilledSummary.substring(0, 80) : ''
    L.push(
      `${r.date} ${r.employeeName ?? '-'} | ${summary}${r.topWin ? ` | win:${r.topWin.substring(0, 60)}` : ''}`
    )
  })

  // Candidates (HR Resume Scoring)
  L.push(`\nHR_CANDIDATES(${candidates.size}):`)
  candidates.docs.forEach(d => {
    const c = d.data()
    L.push(
      `${c.name} | role:${c.jobTitle ?? '-'} | score:${c.score}/100 | recommendation:${c.recommendation}\n` +
      `  skills:${c.breakdown?.skills ?? '-'} exp:${c.breakdown?.experience ?? '-'} edu:${c.breakdown?.education ?? '-'}\n` +
      `  summary:${c.summary ? c.summary.substring(0, 120) : '-'}\n` +
      `  strengths:${(c.strengths ?? []).join('; ')} | gaps:${(c.gaps ?? []).join('; ')}`
    )
  })

  return L.join('\n')
}

async function chatWithGroq(
  history: { role: string; content: string }[],
  context: string
): Promise<string> {
  const API_KEY = import.meta.env.VITE_GROQ_API_KEY as string
  if (!API_KEY) throw new Error('VITE_GROQ_API_KEY is not set')

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Trim context before building the prompt (~80k chars ≈ 20k tokens, safe under Groq's limit)
  const safeContext = context.length > 80000
    ? context.slice(0, 80000) + '\n[...data truncated to fit context window...]'
    : context

  const sysPrompt =
    `You are Galaxy CRM Assistant — the AI brain of Galaxy Home Automation Pvt Ltd, a smart home automation company in India.

You have complete access to the company's live CRM data below. Use it to answer any question accurately and helpfully.

Rules:
- Always use Indian currency format with ₹ symbol
- Use "lakhs" / "crores" for large amounts where natural
- Today's date is: ${today}
- Be concise but thorough — include relevant numbers, names, dates
- If data doesn't exist for a query, say "I don't see that in the data"
- For lists use bullet points with a dash (-)
- Never make up data that isn't in the context below

You can answer questions like:
- Project status, completion %, payments collected, balance outstanding
- Lead pipeline, assigned reps, follow-up schedules
- Customer details, total values, payment history
- Invoice status, overdue amounts, due dates
- Quotation status and values
- Team activity from daily reports
- Payment history by date, mode, or person

--- LIVE CRM DATA ---
${safeContext}
--- END OF DATA ---`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: sysPrompt }, ...history],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Groq API error:', res.status, text)
    let msg = `Groq error ${res.status}`
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
