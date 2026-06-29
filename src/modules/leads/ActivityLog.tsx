import { Phone, MessageSquare, Users, FileText, Clock, Mail, AlertCircle, Trash2 } from 'lucide-react'
import { formatDateTime } from '../../lib/utils'
import type { LeadActivity, ActivityType } from '../../types'
import { cn } from '../../lib/utils'

const TYPE_CONFIG: Record<ActivityType, { icon: React.ReactNode; color: string; label: string }> = {
  call:               { icon: <Phone className="w-3.5 h-3.5" />,        color: 'text-green-400 bg-green-900/30',   label: 'Call' },
  meeting:            { icon: <Users className="w-3.5 h-3.5" />,        color: 'text-blue-400 bg-blue-900/30',    label: 'Meeting' },
  note:               { icon: <FileText className="w-3.5 h-3.5" />,     color: 'text-gray-400 bg-gray-800',       label: 'Note' },
  status_change:      { icon: <AlertCircle className="w-3.5 h-3.5" />,  color: 'text-indigo-400 bg-indigo-900/30',label: 'Status' },
  floor_plan_upload:  { icon: <FileText className="w-3.5 h-3.5" />,     color: 'text-violet-400 bg-violet-900/30',label: 'Document' },
  follow_up:          { icon: <Clock className="w-3.5 h-3.5" />,        color: 'text-yellow-400 bg-yellow-900/30',label: 'Follow-up' },
  whatsapp:           { icon: <MessageSquare className="w-3.5 h-3.5" />,color: 'text-emerald-400 bg-emerald-900/30',label: 'WhatsApp' },
  email:              { icon: <Mail className="w-3.5 h-3.5" />,          color: 'text-sky-400 bg-sky-900/30',      label: 'Email' },
}

interface ActivityLogProps {
  activities: LeadActivity[]
  onDelete?: (activityId: string) => void
}

export function ActivityLog({ activities, onDelete }: ActivityLogProps) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="w-8 h-8 text-gray-800 mb-3" />
        <p className="text-sm text-gray-600">No activities yet</p>
        <p className="text-xs text-gray-700 mt-1">Log a call, meeting, or note above</p>
      </div>
    )
  }

  return (
    <div className="relative p-5">
      {/* Timeline line */}
      <div className="absolute left-9 top-8 bottom-8 w-px bg-gray-800" />

      <div className="space-y-5">
        {activities.map((act, i) => {
          const cfg = TYPE_CONFIG[act.type] ?? TYPE_CONFIG.note
          return (
            <div key={act.id} className="flex gap-4 relative">
              {/* Icon */}
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ring-2 ring-gray-900', cfg.color)}>
                {cfg.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-gray-300">{cfg.label}</span>
                    {act.outcome && (
                      <span className="ml-2 text-xs text-gray-500">· {act.outcome.replace('_', ' ')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-600 whitespace-nowrap">
                      {formatDateTime(act.createdAt)}
                    </span>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(act.id)}
                        className="p-1 text-gray-700 hover:text-red-400 transition-colors"
                        title="Delete activity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-300 mt-0.5">{act.description}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-600">{act.performedByName}</span>
                  {act.followUpDate && (
                    <span className="text-xs text-yellow-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Follow-up: {formatDateTime(act.followUpDate)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
