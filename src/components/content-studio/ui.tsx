import type { ReactNode } from 'react'
import { STAGE_STYLE, PLATFORM_STYLE, stageProgress } from '@/lib/content-studio/stages'

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2 no-print">{right}</div>}
    </div>
  )
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="max-w-[1500px] mx-auto space-y-5">{children}</div>
}

export function Stat({
  label,
  value,
  sub,
  tone = 'gold',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'gold' | 'rose' | 'emerald' | 'amber' | 'navy'
}) {
  const toneCls =
    tone === 'rose'
      ? 'text-rose-400'
      : tone === 'emerald'
      ? 'text-emerald-400'
      : tone === 'amber'
      ? 'text-amber-400'
      : tone === 'gold'
      ? 'text-gold-500'
      : 'text-gray-100'
  return (
    <div className="stat-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tracking-tight ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

export function StageChip({ stage }: { stage: string }) {
  const s = STAGE_STYLE[stage] || STAGE_STYLE['Idea']
  return (
    <span className={`badge ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {stage}
    </span>
  )
}

export function PlatformChip({ platform }: { platform: string }) {
  return <span className={`badge ${PLATFORM_STYLE[platform] || 'bg-gray-800 text-gray-300'}`}>{platform}</span>
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 rounded-full bg-gray-800 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: 'linear-gradient(90deg, #A07820 0%, #C9A840 100%)',
        }}
      />
    </div>
  )
}

export function StageProgress({ stage }: { stage: string }) {
  const p = stageProgress(stage)
  return (
    <div className="flex items-center gap-2">
      <ProgressBar value={p} className="w-full" />
      <span className="text-xs font-semibold text-gray-500 w-9 text-right">{p}%</span>
    </div>
  )
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-emerald-500',
    Onboarding: 'bg-sky-500',
    Paused: 'bg-amber-500',
    Retired: 'bg-rose-500',
    Planned: 'bg-gray-500',
    Scheduled: 'bg-sky-500',
    Completed: 'bg-emerald-500',
    Cancelled: 'bg-rose-500',
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
      <span className={`h-2 w-2 rounded-full ${map[status] || 'bg-gray-500'}`} />
      {status}
    </span>
  )
}

export function Avatar({ name }: { name: string }) {
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span
      title={name}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-[10px] font-bold text-gold-400"
    >
      {initials || '?'}
    </span>
  )
}

export function DueChip({ tone, text }: { tone: 'ok' | 'warn' | 'bad' | 'mute'; text: string }) {
  const cls =
    tone === 'bad'
      ? 'bg-rose-900/40 text-rose-300'
      : tone === 'warn'
      ? 'bg-amber-900/40 text-amber-300'
      : tone === 'ok'
      ? 'bg-emerald-900/40 text-emerald-300'
      : 'bg-gray-800 text-gray-400'
  return <span className={`badge ${cls}`}>{text}</span>
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="glass-card p-10 text-center">
      <div className="text-gray-600 text-4xl mb-2">∅</div>
      <div className="font-semibold text-gray-100">{title}</div>
      {hint && <div className="text-sm text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}
