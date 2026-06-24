import { cn } from '../../lib/utils'

interface BadgeProps {
  children: React.ReactNode
  color?: string
  bg?: string
  className?: string
  dot?: boolean
  dotColor?: string
}

export function Badge({ children, color, bg, className, dot, dotColor }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        color ?? 'text-gray-300',
        bg ?? 'bg-gray-800',
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor ?? 'bg-gray-400')} />
      )}
      {children}
    </span>
  )
}
