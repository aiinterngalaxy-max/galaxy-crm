import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

export interface NotifItem {
  id: string
  tone: 'bad' | 'warn' | 'ok'
  icon: string
  text: string
  meta: string
  href: string
}

export interface NotifSection {
  title: string
  items: NotifItem[]
}

const TONE_CLS: Record<string, string> = {
  bad: 'text-rose-400 bg-rose-900/30',
  warn: 'text-amber-400 bg-amber-900/30',
  ok: 'text-emerald-400 bg-emerald-900/30',
}

const HEADER_DOT: Record<string, string> = {
  bad: 'bg-rose-500',
  warn: 'bg-amber-500',
  ok: 'bg-emerald-500',
}

export function NotificationBell({ sections }: { sections: NotifSection[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const total = sections.reduce((n, s) => n + s.items.length, 0)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filledSections = sections.filter((s) => s.items.length > 0)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors"
      >
        <span className="text-lg leading-none">🔔</span>
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white leading-none">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-xl border border-gray-800 bg-gray-900 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="font-bold text-gray-100 text-sm">Notifications</span>
            {total > 0 ? (
              <span className="badge bg-rose-900/40 text-rose-300">{total} item{total !== 1 ? 's' : ''}</span>
            ) : (
              <span className="badge bg-emerald-900/40 text-emerald-300">All clear</span>
            )}
          </div>

          <div className="max-h-[460px] overflow-y-auto">
            {total === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">Nothing needs attention right now 🎉</div>
            ) : (
              filledSections.map((section) => (
                <div key={section.title}>
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 border-b border-gray-800">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${HEADER_DOT[section.items[0]?.tone ?? 'warn']}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{section.title}</span>
                    <span className="ml-auto text-[11px] font-semibold text-gray-600">{section.items.length}</span>
                  </div>
                  {section.items.map((it) => (
                    <Link
                      key={it.id}
                      to={it.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-800/50 transition-colors border-b border-gray-800/60"
                    >
                      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${TONE_CLS[it.tone]}`}>
                        {it.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-100 truncate leading-tight">{it.text}</div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">{it.meta}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
