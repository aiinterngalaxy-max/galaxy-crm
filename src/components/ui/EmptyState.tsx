import React from 'react'
import { Button } from './Button'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center mb-4 text-gray-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-gray-300">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-gray-500 max-w-xs">{description}</p>}
      {action && (
        <div className="mt-5">
          <Button onClick={action.onClick} icon={action.icon}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}
