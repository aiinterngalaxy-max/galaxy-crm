import { Clock } from 'lucide-react'

interface ComingSoonProps {
  title?: string
  description?: string
}

export function ComingSoon({ title = 'Coming Soon', description = "We're building this feature. Check back soon." }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/20 border border-indigo-800/30 flex items-center justify-center mb-5">
        <Clock className="w-7 h-7 text-indigo-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-200 mb-2">{title}</h2>
      <p className="text-sm text-gray-500 max-w-sm">{description}</p>
      <span className="mt-4 text-xs px-3 py-1.5 rounded-full bg-indigo-900/30 border border-indigo-800/40 text-indigo-400 font-medium">
        In Development
      </span>
    </div>
  )
}
