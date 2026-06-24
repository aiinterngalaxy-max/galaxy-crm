import type { PricingResult } from '../../../lib/pricingEngine'
import { formatCurrency } from '../../../lib/utils'

const CATEGORY_LABELS: Record<string, string> = {
  ELYSIA_SWITCHES: 'Elysia Switches', VITRUM_SWITCHES: 'Vitrum Switches',
  IR_CONTROLLERS: 'IR Controllers', SENSORS: 'Sensors', VDP: 'Video Door Phone',
  CURTAINS: 'Curtains', LOCKS: 'Smart Locks', LCD_PANELS: 'LCD Panels',
  NETWORKING: 'Networking', CONTROLLERS: 'Controllers',
}

interface Props {
  pricing: PricingResult
  sectionDiscounts: Record<string, number>
  onDiscountChange?: (category: string, value: number) => void
  onApplyAll?: (value: number) => void
  editable?: boolean
}

export function PricingSummary({ pricing, sectionDiscounts, onDiscountChange, onApplyAll, editable = false }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Pricing Summary</h3>
        {editable && onApplyAll && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Apply all:</span>
            {[0, 25, 35].map(v => (
              <button key={v} onClick={() => onApplyAll(v)}
                className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:border-indigo-600 hover:text-indigo-400 transition-colors">
                {v}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {pricing.sections.map(sec => (
          <div key={sec.category} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">{CATEGORY_LABELS[sec.category] || sec.category}</span>
              <span className="text-xs text-gray-500">{formatCurrency(sec.itemTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Discount</span>
                {editable && onDiscountChange ? (
                  <input type="number" min={0} max={100} value={sectionDiscounts[sec.category] ?? 0}
                    onChange={e => onDiscountChange(sec.category, Number(e.target.value))}
                    className="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-xs text-gray-200 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                ) : (
                  <span className="text-red-400">{sec.discountPercent}%</span>
                )}
                <span className="text-gray-600">%</span>
              </div>
              {sec.discountAmount > 0 && <span className="text-red-400">−{formatCurrency(sec.discountAmount)}</span>}
            </div>
            {sec.installCharge > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Installation ({Math.round(sec.installRate * 100)}%)</span>
                <span className="text-indigo-400">+{formatCurrency(sec.installCharge)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs font-semibold border-t border-gray-800/50 pt-1">
              <span className="text-gray-400">Section Total</span>
              <span className="text-gray-200">{formatCurrency(sec.discountedItemTotal + sec.installCharge)}</span>
            </div>
          </div>
        ))}

        {pricing.sections.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-4">No products added yet.</p>
        )}

        {pricing.sections.length > 0 && (
          <div className="space-y-2 border-t border-gray-800 pt-3">
            <div className="flex justify-between text-sm text-gray-400">
              <span>Product Subtotal</span>
              <span>{formatCurrency(pricing.productSubtotal)}</span>
            </div>
            {pricing.discountAmount > 0 && (
              <div className="flex justify-between text-sm text-red-400">
                <span>Total Discount ({pricing.discountPercent}%)</span>
                <span>−{formatCurrency(pricing.discountAmount)}</span>
              </div>
            )}
            {pricing.totalInstallation > 0 && (
              <div className="flex justify-between text-sm text-indigo-400">
                <span>Installation & Setup</span>
                <span>+{formatCurrency(pricing.totalInstallation)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base text-gray-100 border-t border-gray-700 pt-2">
              <span>Grand Total</span>
              <span className="text-yellow-400">{formatCurrency(pricing.grandSubtotal)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
