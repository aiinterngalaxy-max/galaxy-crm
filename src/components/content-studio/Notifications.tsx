import { Link } from 'react-router-dom'
import { daysUntil, fmtDate } from '@/lib/content-studio/format'
import type { ContentRow, ShootRow } from '@/types/content-studio'

type Stats = {
  overdue: ContentRow[]
  pendingApprovals: ContentRow[]
  upcomingShoots: ShootRow[]
}

export function Notifications({ stats }: { stats: Stats }) {
  const items: { tone: string; icon: string; text: string; meta: string; href: string }[] = []

  for (const c of stats.overdue.slice(0, 6)) {
    const d = daysUntil(c.due_date)
    items.push({
      tone: 'bad',
      icon: '⚠',
      text: `Overdue: ${c.title}`,
      meta: `${c.brand_name} · ${c.stage} · ${d !== null ? Math.abs(d) + 'd late' : ''}`,
      href: '/content-studio/pipeline',
    })
  }
  for (const c of stats.pendingApprovals.slice(0, 5)) {
    items.push({
      tone: 'warn',
      icon: '⧗',
      text: `Awaiting approval: ${c.title}`,
      meta: `${c.brand_name} · ${c.stage}`,
      href: '/content-studio/pipeline',
    })
  }
  for (const s of stats.upcomingShoots.slice(0, 5)) {
    const d = daysUntil(s.shoot_date)
    items.push({
      tone: 'ok',
      icon: '◎',
      text: `Shoot: ${s.title}`,
      meta: `${s.brand_name} · ${fmtDate(s.shoot_date)} · ${d === 0 ? 'today' : d + 'd'}`,
      href: '/content-studio/shoots',
    })
  }

  const toneCls: Record<string, string> = {
    bad: 'text-rose-400 bg-rose-900/30',
    warn: 'text-amber-400 bg-amber-900/30',
    ok: 'text-emerald-400 bg-emerald-900/30',
  }

  return (
    <div className="glass-card">
      <div className="p-5 border-b border-gray-800 flex items-center justify-between">
        <h2 className="font-bold text-gray-100">Notifications &amp; Alerts</h2>
        <span className="badge bg-gray-800 text-gray-300">{items.length}</span>
      </div>
      <div className="divide-y divide-gray-800 max-h-[420px] overflow-y-auto">
        {items.length === 0 && <div className="p-5 text-sm text-gray-500">All clear — nothing needs attention.</div>}
        {items.map((it, i) => (
          <Link key={i} to={it.href} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-800/40">
            <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-sm ${toneCls[it.tone]}`}>
              {it.icon}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-100 truncate">{it.text}</div>
              <div className="text-xs text-gray-500 truncate">{it.meta}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
