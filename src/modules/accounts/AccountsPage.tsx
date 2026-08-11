import { useNavigate } from 'react-router-dom'
import { FileUp, FileText, Truck } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { cn } from '../../lib/utils'

/**
 * The accounts department's landing page.
 *
 * "Accounts" here is the accounting team, not customer accounts — the two mean
 * opposite things in a CRM and the wrong one is an easy assumption to make.
 *
 * Each card is one job the accountant does. Only the first is built; the rest
 * are shown greyed rather than hidden so the team can see where the workflow is
 * going, and so nobody hunts for a menu that does not exist yet.
 */

interface Section {
  label: string
  description: string
  icon: React.ReactNode
  path?: string
  /** Shown instead of navigating, when the section is not built yet. */
  soon?: string
}

const SECTIONS: Section[] = [
  {
    label: 'Documents Upload',
    description: 'Upload a quotation, product list or order document and turn it into an invoice and packing list.',
    icon: <FileUp className="w-5 h-5" />,
    // No route yet. Pointing at one that does not exist would fall through the
    // router's catch-all and dump the user back on the dashboard with no
    // explanation — worse than a button that plainly is not ready.
    soon: 'Building next',
  },
  {
    label: 'Generated Documents',
    description: 'Invoices and packing lists already produced, with their source files and version history.',
    icon: <FileText className="w-5 h-5" />,
    soon: 'Next',
  },
  {
    label: 'Shipments',
    description: 'FedEx shipments, tracking numbers and shipping labels.',
    icon: <Truck className="w-5 h-5" />,
    soon: 'Needs FedEx credentials',
  },
]

export function AccountsPage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Accounts</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Document preparation and shipping for the accounts team
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map(s => {
          const enabled = !!s.path
          return (
            <button
              key={s.label}
              onClick={() => s.path && navigate(s.path)}
              disabled={!enabled}
              className={cn('text-left', !enabled && 'cursor-default')}
            >
              <Card
                className={cn(
                  'h-full transition-colors',
                  enabled
                    ? 'hover:border-gold-500/50'
                    : 'opacity-55',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      enabled ? 'bg-gold-500/15 text-gold-400' : 'bg-gray-800 text-gray-500',
                    )}
                  >
                    {s.icon}
                  </span>
                  {s.soon && (
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 border border-gray-800 rounded-full px-2 py-0.5">
                      {s.soon}
                    </span>
                  )}
                </div>

                <h2 className="text-sm font-semibold text-gray-100 mt-3">{s.label}</h2>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{s.description}</p>
              </Card>
            </button>
          )
        })}
      </div>
    </div>
  )
}
