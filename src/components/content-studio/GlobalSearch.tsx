import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { search } from '@/lib/content-studio/queries'
import type { SearchResult } from '@/types/content-studio'

const TYPE_STYLE: Record<string, string> = {
  Content: 'bg-sky-900/40 text-sky-300',
  Idea: 'bg-purple-900/40 text-purple-300',
  Script: 'bg-amber-900/40 text-amber-300',
  Shoot: 'bg-rose-900/40 text-rose-300',
  Brand: 'bg-emerald-900/40 text-emerald-300',
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else {
      setQuery('')
      setResults([])
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) {
      setResults([])
      return
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const j = await search(query)
        setResults(j.results ?? [])
        setActive(0)
      } finally {
        setLoading(false)
      }
    }, 200)
  }, [query])

  function go(href: string) {
    setOpen(false)
    navigate(`/content-studio${href.startsWith('/') ? href : `/${href}`}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && results[active]) go(results[active].href)
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r)
    return acc
  }, {})

  const flat = results

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-700 hover:text-gray-300 transition-colors"
        aria-label="Search"
      >
        <span>⌕</span>
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden sm:inline text-[10px] bg-gray-800 rounded px-1 py-0.5 font-mono">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl mx-4 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
              <span className="text-gray-500 text-lg">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search content, ideas, shoots, brands…"
                className="flex-1 text-sm bg-transparent outline-none text-gray-100 placeholder:text-gray-500"
              />
              {loading && <span className="text-xs text-gray-500 animate-pulse">searching…</span>}
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">
                ESC
              </button>
            </div>

            {results.length > 0 && (
              <div className="max-h-[60vh] overflow-y-auto py-2">
                {Object.entries(grouped).map(([type, items]) => (
                  <div key={type}>
                    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                      {type}
                    </div>
                    {items.map((r) => {
                      const idx = flat.indexOf(r)
                      const isActive = idx === active
                      return (
                        <button
                          key={`${r.type}-${r.id}`}
                          onClick={() => go(r.href)}
                          onMouseEnter={() => setActive(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                            isActive ? 'bg-gray-800/60' : ''
                          }`}
                        >
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_STYLE[r.type] || 'bg-gray-800 text-gray-300'}`}>
                            {r.type}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-100 truncate">{r.title}</div>
                            <div className="text-[11px] text-gray-500 truncate">{r.meta}</div>
                          </div>
                          {isActive && <span className="ml-auto shrink-0 text-gray-600 text-xs">↵</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {query.length >= 2 && !loading && results.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">No results for "{query}"</div>
            )}

            {query.length < 2 && (
              <div className="px-4 py-6 text-center text-xs text-gray-500">Type at least 2 characters to search</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
