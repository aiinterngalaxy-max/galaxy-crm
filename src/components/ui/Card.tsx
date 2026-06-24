import React from 'react'
import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingClasses = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-6',
}

export function Card({ children, className, onClick, hover = false, padding = 'md' }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-gray-900 border border-gray-800 rounded-xl',
        paddingClasses[padding],
        hover && 'hover:border-gray-700 hover:bg-gray-850 transition-all duration-150',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  subValue?: string
  icon?: React.ReactNode
  iconBg?: string
  trend?: { value: string; up: boolean }
  onClick?: () => void
}

export function StatCard({ label, value, subValue, icon, iconBg, trend, onClick }: StatCardProps) {
  return (
    <Card hover={!!onClick} onClick={onClick} className="flex items-start gap-4">
      {icon && (
        <div className={cn('p-2.5 rounded-lg shrink-0', iconBg ?? 'bg-indigo-900/40')}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="mt-1 text-2xl font-bold text-gray-50">{value}</p>
        {subValue && <p className="text-xs text-gray-500 mt-0.5">{subValue}</p>}
        {trend && (
          <p className={cn('text-xs font-medium mt-1', trend.up ? 'text-green-400' : 'text-red-400')}>
            {trend.up ? '▲' : '▼'} {trend.value}
          </p>
        )}
      </div>
    </Card>
  )
}
