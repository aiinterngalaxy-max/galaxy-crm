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

async function fetchCRMContext(): Promise<string> {
  const [projects, leads, customers, quotations, invoices, payments, dailyReports] =
    await Promise.all([
      getDocs(collection(db, 'projects')),
      getDocs(collection(db, 'leads')),
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'quotations')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'dailyReports')),
    ])

  const lines: string[] = []
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  lines.push(`=== GALAXY HOME AUTOMATION — CRM DATA (${today}) ===\n`)

  // Projects
  lines.push(`── PROJECTS (${projects.size}) ──`)
  projects.docs.forEach(d => {
    const p = d.data()
    const val = p.projectValue ?? p.totalValue ?? 0
    const paid = p.collectedAmount ?? p.totalPaid ?? 0
    lines.push(
      `[${p.projectCode ?? d.id}] ${p.title ?? 'Untitled'} | Customer: ${p.customerName ?? '-'}\n` +
      `  Status: ${p.status} | ${p.completionPercent ?? 0}% complete | Risk: ${p.riskLevel ?? '-'}\n` +
      `  PM: ${p.assignedPMName ?? p.assignedPM ?? '-'} | City: ${p.city ?? '-'}\n` +
      `  Value: ${fmt(val)} | Collected: ${fmt(paid)} | Balance: ${fmt(val - paid)}\n` +
      `  Start: ${tsDate(p.startDate)} | Expected End: ${tsDate(p.expectedEndDate)}`
    )
  })
  lines.push('')

  // Leads
  lines.push(`── LEADS (${leads.size}) ──`)
  leads.docs.forEach(d => {
    const l = d.data()
    lines.push(
      `[${l.leadCode ?? d.id}] ${l.name} | Phone: ${l.phone ?? '-'} | Status: ${l.status}\n` +
      `  Source: ${l.source ?? '-'} | Budget: ${fmt(l.estimatedBudget)} | Assigned: ${l.assignedToName ?? l.assignedTo ?? '-'}\n` +
      `  Next Follow-up: ${tsDate(l.nextFollowUp)} | Notes: ${l.notes ? l.notes.substring(0, 100) : '-'}`
    )
  })
  lines.push('')

  // Customers
  lines.push(`── CUSTOMERS (${customers.size}) ──`)
  customers.docs.forEach(d => {
    const c = d.data()
    const bal = (c.totalProjectValue ?? 0) - (c.totalPaid ?? 0)
    lines.push(
      `${c.name} | Phone: ${c.phone ?? '-'} | Type: ${c.type ?? '-'}\n` +
      `  Total Project Value: ${fmt(c.totalProjectValue)} | Paid: ${fmt(c.totalPaid)} | Balance: ${fmt(bal)}`
    )
  })
  lines.push('')

  // Quotations
  lines.push(`── QUOTATIONS (${quotations.size}) ──`)
  quotations.docs.forEach(d => {
    const q = d.data()
    lines.push(
      `[${q.quotationCode ?? d.id}] ${q.customerName ?? '-'} | Status: ${q.status}\n` +
      `  Total: ${fmt(q.total)} | PM: ${q.assignedPMName ?? '-'} | Valid Until: ${tsDate(q.validUntil)}`
    )
  })
  lines.push('')

  // Invoices
  lines.push(`── INVOICES (${invoices.size}) ──`)
  invoices.docs.forEach(d => {
    const inv = d.data()
    lines.push(
      `[${inv.invoiceCode ?? d.id}] ${inv.customerName ?? '-'} | Status: ${inv.status}\n` +
      `  Amount: ${fmt(inv.amount)} | Paid: ${fmt(inv.paidAmount)} | Balance: ${fmt(inv.balance)} | Due: ${tsDate(inv.dueDate)}`
    )
  })
  lines.push('')

  // Payments — sorted newest first, all included
  const allPayments = payments.docs
    .map(d => d.data())
    .sort((a, b) => {
      const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0
      const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0
      return bt - at
    })

  lines.push(`── PAYMENTS (${allPayments.length}) ──`)
  allPayments.forEach(p => {
    const date = tsDate(p.date ?? p.createdAt)
    lines.push(
      `${fmt(p.amount)} via ${p.mode ?? '-'} on ${date} | By: ${p.recordedByName ?? '-'}${p.reference ? ` | Ref: ${p.reference}` : ''}`
    )
  })
  lines.push('')

  // Daily Reports — last 30
  const recentReports = dailyReports.docs
    .map(d => d.data())
    .sort((a, b) => (b.date as string ?? '').localeCompare(a.date as string ?? ''))
    .slice(0, 30)

  lines.push(`── DAILY REPORTS (last ${recentReports.length}) ──`)
  recentReports.forEach(r => {
    lines.push(
      `${r.date} | ${r.employeeName ?? '-'} (${r.department ?? '-'})\n` +
      `  Summary: ${r.preFilledSummary ? r.preFilledSummary.substring(0, 150) : '-'}\n` +
      `  Top Win: ${r.topWin ?? '-'} | Challenge: ${r.mainChallenge ?? '-'}`
    )
  })

  return lines.join('\n')
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

  const systemPrompt =
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
${context}
--- END OF DATA ---`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Groq error ${res.status}: ${text}`)
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
    } catch {
      toast.error('AI error — please try again')
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
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
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
            position: 'fixed', bottom: 88, right: 24, zIndex: 9998,
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
