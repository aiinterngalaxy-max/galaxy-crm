import { type ButtonHTMLAttributes, type ReactNode, type CSSProperties } from 'react'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from './LoadingSpinner'

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'warning'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

const variantClasses: Record<Variant, string> = {
  primary:   'text-gray-950 font-semibold border-transparent',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700 focus:ring-gray-600',
  danger:    'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500 border-transparent',
  success:   'bg-green-600 hover:bg-green-500 text-white focus:ring-green-500 border-transparent',
  ghost:     'hover:bg-gray-800 text-gray-400 hover:text-gray-100 border-transparent focus:ring-gray-600',
  warning:   'bg-yellow-600 hover:bg-yellow-500 text-white focus:ring-yellow-500 border-transparent',
}

const variantStyles: Partial<Record<Variant, CSSProperties>> = {
  primary: { background: 'linear-gradient(135deg, #D4AF37 0%, #A07820 100%)' },
}

const sizeClasses: Record<Size, string> = {
  sm:  'px-3 py-1.5 text-xs gap-1.5',
  md:  'px-4 py-2 text-sm gap-2',
  lg:  'px-5 py-2.5 text-base gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      style={variantStyles[variant]}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg border',
        'transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {loading ? (
        <LoadingSpinner size="sm" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
      {iconRight && !loading && <span className="shrink-0">{iconRight}</span>}
    </button>
  )
}
