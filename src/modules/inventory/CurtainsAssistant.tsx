import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Send, Plus, Bot, User, MessageSquare, Check, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'
import {
  interpret, applyDraft, buildItem, todayKey, partyLabel,
  MOCK_ITEMS, MOCK_CUSTOMERS, MOCK_TXNS,
  type CurtainItem, type CurtainTxn, type BotReply, type Pending, type Draft,
} from '../../lib/curtainsAssistant'

/**
 * Curtains as a conversation.
 *
 * The team writes stock movements in a notebook, so this asks them to do the
 * same thing in a chat box and turns the sentence into an entry. Nothing is
 * saved until they press Confirm — the assistant reads back what it understood
 * first, because a misread quantity that writes itself into stock is worse than
 * no assistant at all.
 *
 * DEMO ONLY: the data lives in memory in `lib/curtainsAssistant.ts` and resets
 * on refresh. No Firestore read, no write, nothing shared between users.
 */

// ─── Messages ─────────────────────────────────────────────────────────────────

interface UserMsg { id: string; from: 'user'; text: string }
interface BotMsg { id: string; from: 'bot'; reply: BotReply; done?: boolean }
type ChatMsg = UserMsg | BotMsg

interface Conversation {
  id: string
  title: string
  messages: ChatMsg[]
  pending?: Pending
}

const EXAMPLES = [
  'Sent 20 Curtain Motors to Rahul',
  'Rahul returned 5 Curtain Motors',
  'Received 50 Curtain Motors',
  "Show today's transactions",
  'Show current stock',
  'Show low stock',
  'Search Curtain Track',
  'Add new customer',
]

let seq = 0
const nextId = () => `m${++seq}-${Date.now()}`

/** Bold only — enough for the assistant's replies, without pulling in a parser. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, li) => (
        <span key={li} className="block">
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={i} className="text-gray-100">{part.slice(2, -2)}</strong>
              : <span key={i}>{part}</span>,
          )}
        </span>
      ))}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CurtainsAssistant() {
  const { user } = useAuth()
  const userName = user?.name ?? 'You'

  // The "database": one copy shared by every conversation on the page.
  const [items, setItems] = useState<CurtainItem[]>(() => MOCK_ITEMS.map(i => ({ ...i })))
  const [customers, setCustomers] = useState<string[]>(() => [...MOCK_CUSTOMERS])
  const [txns, setTxns] = useState<CurtainTxn[]>(() => MOCK_TXNS.map(t => ({ ...t })))

  const [conversations, setConversations] = useState<Conversation[]>([
    { id: 'c0', title: 'New chat', messages: [] },
  ])
  const [activeId, setActiveId] = useState('c0')
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = conversations.find(c => c.id === activeId) ?? conversations[0]

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages.length])
  useEffect(() => { inputRef.current?.focus() }, [activeId])

  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations(prev => prev.map(c => (c.id === id ? fn(c) : c)))
  }, [])

  const today = todayKey()
  const summary = useMemo(() => {
    const mine = txns.filter(t => t.date === today)
    const sum = (k: CurtainTxn['kind']) => mine.filter(t => t.kind === k).reduce((s, t) => s + t.qty, 0)
    return {
      sent: sum('sent'),
      returned: sum('returned'),
      received: sum('received'),
      stock: items.reduce((s, i) => s + i.stock, 0),
      low: items.filter(i => i.stock <= i.reorderLevel).length,
    }
  }, [txns, items, today])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return
    setInput('')

    const convo = conversations.find(c => c.id === activeId)
    if (!convo) return

    // Every reply is built from the data as it stands right now — the assistant
    // never answers from a number it mentioned earlier in the conversation.
    const result = interpret(text, { items, customers, txns, pending: convo.pending })

    if (result.addCustomer) setCustomers(prev => [...prev, result.addCustomer!])
    if (result.addItem) setItems(prev => [...prev, buildItem(result.addItem!.name, result.addItem!.stock, prev)])

    patch(activeId, c => ({
      ...c,
      title: c.messages.length === 0 ? text.slice(0, 38) : c.title,
      pending: result.pending,
      messages: [
        ...c.messages,
        { id: nextId(), from: 'user', text },
        ...result.replies.map(reply => ({ id: nextId(), from: 'bot' as const, reply })),
      ],
    }))
  }, [activeId, conversations, items, customers, txns, patch])

  const confirm = useCallback((msgId: string, draft: Draft) => {
    const result = applyDraft({ items, customers, txns }, draft, userName)

    if (result.ok) {
      setItems(result.items)
      setTxns(result.txns)
      setCustomers(result.customers)
    }

    patch(activeId, c => ({
      ...c,
      pending: undefined,
      messages: [
        ...c.messages.map(m => (m.id === msgId ? { ...m, done: true } : m)),
        { id: nextId(), from: 'bot', reply: { kind: 'text', text: result.message } },
      ],
    }))
  }, [items, customers, txns, userName, activeId, patch])

  const cancel = useCallback((msgId: string) => {
    patch(activeId, c => ({
      ...c,
      pending: undefined,
      messages: [
        ...c.messages.map(m => (m.id === msgId ? { ...m, done: true } : m)),
        { id: nextId(), from: 'bot', reply: { kind: 'text', text: 'Cancelled — nothing was saved.' } },
      ],
    }))
  }, [activeId, patch])

  const newChat = () => {
    const id = `c${Date.now()}`
    setConversations(prev => [{ id, title: 'New chat', messages: [] }, ...prev])
    setActiveId(id)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <div className="px-1 pb-3">
        <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
          <Bot className="w-5 h-5 text-gold-400" /> Curtains Inventory Assistant
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Type what happened — the assistant records it.</p>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* ── Conversation history ─────────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-56 shrink-0 glass-card rounded-2xl p-3">
          <button
            onClick={newChat}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-gray-800 text-xs font-medium text-gray-300 hover:border-gold-500/50 hover:text-gold-400 transition-colors"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 mt-4 mb-2 px-1">Conversations</p>
          <div className="flex-1 overflow-y-auto space-y-1">
            {conversations.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={cn(
                  'flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left text-xs truncate transition-colors',
                  c.id === activeId ? 'bg-gold-500/10 text-gold-400' : 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-300',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{c.title}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 px-1 pt-2 border-t border-gray-800">
            Chats are kept until you refresh.
          </p>
        </aside>

        {/* ── Chat ─────────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2 bg-amber-500/5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <p className="text-[11px] text-amber-300/90">
              Demo — sample data only, not connected to the inventory database. Everything resets on refresh.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {active.messages.length === 0 && (
              <div className="max-w-xl">
                <p className="text-base font-semibold text-gray-100">Hello!</p>
                <p className="text-sm text-gray-400 mt-0.5">How can I help you today?</p>
                <p className="text-[11px] uppercase tracking-wider text-gray-600 mt-5 mb-2">Examples — tap one</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map(e => (
                    <button
                      key={e}
                      onClick={() => send(e)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-800 text-gray-400 hover:border-gold-500/50 hover:text-gold-400 transition-colors"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {active.messages.map(m => m.from === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="flex items-start gap-2 max-w-[80%]">
                  <p className="text-sm text-gray-100 bg-gold-500/15 border border-gold-500/25 rounded-2xl rounded-tr-sm px-3.5 py-2">
                    {m.text}
                  </p>
                  <span className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                  </span>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-2 max-w-[92%]">
                <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg, #C9A840, #a07820)' }}>
                  <Bot className="w-3.5 h-3.5" style={{ color: '#0A0A0F' }} />
                </span>
                <div className="min-w-0 flex-1">
                  <BotBubble
                    msg={m}
                    items={items}
                    onConfirm={draft => confirm(m.id, draft)}
                    onCancel={() => cancel(m.id)}
                  />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* ── Input ──────────────────────────────────────────────────────── */}
          <form
            onSubmit={e => { e.preventDefault(); send(input) }}
            className="p-3 border-t border-gray-800 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              className="form-input flex-1"
              placeholder="Type your message…"
              value={input}
              onChange={e => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #C9A840, #a07820)' }}
            >
              <Send className="w-4 h-4" style={{ color: '#0A0A0F' }} />
            </button>
          </form>
        </main>

        {/* ── Quick summary ────────────────────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col w-60 shrink-0 glass-card rounded-2xl p-4 gap-3 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-gray-600">Quick Summary</p>

          <Stat label="Today's Sent" value={summary.sent} tone="text-red-400" />
          <Stat label="Today's Returned" value={summary.returned} tone="text-green-400" />
          <Stat label="Today's Received" value={summary.received} tone="text-blue-400" />
          <Stat label="Current Stock" value={summary.stock} tone="text-gray-100" suffix="units" />
          <Stat label="Low Stock" value={summary.low} tone={summary.low ? 'text-yellow-400' : 'text-gray-100'} suffix="items" />

          <div className="border-t border-gray-800 pt-3 mt-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Needs attention</p>
            {items.filter(i => i.stock <= i.reorderLevel).length === 0 ? (
              <p className="text-xs text-gray-600">Everything is above its reorder level.</p>
            ) : items.filter(i => i.stock <= i.reorderLevel).map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs text-gray-400 truncate">{i.name}</span>
                <span className={cn('text-xs font-bold tabular-nums', i.stock <= 0 ? 'text-red-400' : 'text-yellow-400')}>
                  {i.stock}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, suffix }: { label: string; value: number; tone: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 px-3 py-2.5">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums', tone)}>
        {value}{suffix && <span className="text-[10px] font-normal text-gray-600 ml-1">{suffix}</span>}
      </p>
    </div>
  )
}

// ─── Bot bubble ───────────────────────────────────────────────────────────────

function BotBubble({
  msg, items, onConfirm, onCancel,
}: {
  msg: BotMsg
  items: CurtainItem[]
  onConfirm: (draft: Draft) => void
  onCancel: () => void
}) {
  const { reply } = msg

  if (reply.kind === 'text') {
    return (
      <p className="text-sm text-gray-300 bg-gray-800/40 border border-gray-800 rounded-2xl rounded-tl-sm px-3.5 py-2 whitespace-pre-wrap">
        <RichText text={reply.text} />
      </p>
    )
  }

  if (reply.kind === 'table') {
    return (
      <div className="bg-gray-800/40 border border-gray-800 rounded-2xl rounded-tl-sm overflow-hidden">
        <p className="text-xs font-semibold text-gray-200 px-3.5 pt-2.5">{reply.title}</p>
        {reply.rows.length === 0 ? (
          <p className="text-xs text-gray-500 px-3.5 py-3">{reply.empty}</p>
        ) : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-gray-800">
                  {reply.columns.map(c => (
                    <th key={c} className="text-left font-medium text-gray-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70">
                {reply.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={cn(
                        'px-3 py-1.5 whitespace-nowrap',
                        j === 0 ? 'text-gray-400' : 'text-gray-300',
                        cell === 'Low stock' && 'text-yellow-400',
                        cell === 'Out of stock' && 'text-red-400',
                        cell === 'In stock' && 'text-green-400',
                      )}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // Confirmation — the one place stock actually changes.
  const item = items.find(i => i.id === reply.draft.itemId)
  const after = item
    ? (reply.draft.kind === 'sent' ? item.stock - reply.draft.qty : item.stock + reply.draft.qty)
    : 0

  return (
    <div className="bg-gray-800/40 border border-gold-500/30 rounded-2xl rounded-tl-sm px-3.5 py-3 space-y-2.5 max-w-sm">
      <p className="text-sm text-gray-300">{reply.text}</p>

      <dl className="text-xs space-y-1">
        <Row k={partyLabel(reply.draft.kind)} v={reply.draft.customer} />
        <Row k="Item" v={item?.name ?? '—'} />
        <Row k="Quantity" v={String(reply.draft.qty)} />
        <Row k="Transaction" v={reply.draft.kind === 'sent' ? 'Sent' : reply.draft.kind === 'returned' ? 'Returned' : 'Received'} />
        {item && (
          <Row
            k="Stock after"
            v={`${item.stock} → ${after}`}
            tone={reply.draft.kind === 'sent' ? 'text-red-400' : 'text-green-400'}
          />
        )}
      </dl>

      {msg.done ? (
        <p className="text-[11px] text-gray-600 pt-1">Handled.</p>
      ) : (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm(reply.draft)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: 'linear-gradient(135deg, #C9A840, #a07820)', color: '#0A0A0F' }}
          >
            <Check className="w-3.5 h-3.5" /> Confirm
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v?: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{k}</dt>
      <dd className={cn('font-medium text-right', tone ?? 'text-gray-200')}>{v || '—'}</dd>
    </div>
  )
}
