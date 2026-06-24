import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { db, doc, getDoc, getDocs, collection } from '../../lib/firebase'
import { computePricing } from '../../lib/pricingEngine'
import { formatCurrency, formatDate } from '../../lib/utils'
import type { Quotation } from '../../types'

const CATEGORY_LABELS: Record<string, string> = {
  ELYSIA_SWITCHES: 'Elysia Switches', VITRUM_SWITCHES: 'Vitrum Switches',
  IR_CONTROLLERS: 'IR Controllers', SENSORS: 'Sensors', VDP: 'Video Door Phone',
  CURTAINS: 'Curtains', LOCKS: 'Smart Locks', LCD_PANELS: 'LCD Panels', NETWORKING: 'Networking', CONTROLLERS: 'Controllers',
}

interface CRMProduct { id: string; partCode?: string; name: string; category: string; gsp: number }

export function BOQPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [products, setProducts] = useState<CRMProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      getDoc(doc(db, 'quotations', id)),
      getDocs(collection(db, 'products')),
    ]).then(([quotSnap, prodSnap]) => {
      if (quotSnap.exists()) setQuotation({ id: quotSnap.id, ...quotSnap.data() } as Quotation)
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CRMProduct))
      setLoading(false)
    }).catch(console.error)
  }, [id])

  const rooms = useMemo(() => (quotation as any)?.rooms || [], [quotation])
  const sectionDiscounts = useMemo(() => (quotation as any)?.sectionDiscounts || {}, [quotation])
  const pricing = useMemo(() => computePricing(rooms, products, sectionDiscounts), [rooms, products, sectionDiscounts])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-500">Loading quotation…</p>
    </div>
  )
  if (!quotation) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-500">Quotation not found.</p>
    </div>
  )

  const handlePrint = () => window.print()

  return (
    <>
      {/* Screen controls (hidden on print) */}
      <div className="flex items-center gap-4 px-6 py-4 bg-gray-900 border-b border-gray-800 print:hidden">
        <button onClick={() => navigate('/quotations')} className="p-2 rounded-xl text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-100">{quotation.quotationCode} — BOQ Preview</h1>
          <p className="text-xs text-gray-500">{quotation.customerName}</p>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors">
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      {/* BOQ Document */}
      <div className="boq-document bg-white text-gray-900 max-w-4xl mx-auto my-6 print:my-0 print:max-w-none rounded-2xl print:rounded-none shadow-2xl print:shadow-none overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-8 py-6 border-b-4 border-gray-900" style={{ background: '#0f172a' }}>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <img src="/galaxy-logo.png" alt="Galaxy" className="h-8 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <div>
                <p className="text-lg font-black tracking-widest text-white">GALAXY HOME AUTOMATION</p>
                <p className="text-xs text-gray-400">Smart Living Solutions</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-white">{quotation.quotationCode}</p>
            <p className="text-xs text-gray-400 mt-1">Version {quotation.version}</p>
            <p className="text-xs text-gray-400">Valid till {formatDate(quotation.validUntil)}</p>
          </div>
        </div>

        {/* Client info */}
        <div className="px-8 py-5 bg-gray-50 border-b border-gray-200 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Prepared For</p>
            <p className="text-base font-bold text-gray-900">{quotation.customerName}</p>
            {(quotation as any).bhkType && <p className="text-sm text-gray-500">{(quotation as any).bhkType} Home Automation</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Prepared By</p>
            <p className="text-sm font-semibold text-gray-700">{quotation.assignedPMName || 'Galaxy Team'}</p>
            <p className="text-xs text-gray-500">Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            {quotation.paymentTerms && <p className="text-xs text-gray-500 mt-1">Terms: {quotation.paymentTerms}</p>}
          </div>
        </div>

        {/* BOQ Table */}
        {pricing.lineItems.length > 0 ? (
          <div className="px-8 py-6">
            <p className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Bill of Quantities</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ background: '#0f172a', color: 'white' }}>
                  <th className="px-3 py-3 text-left text-xs font-semibold w-10">Sr.</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold">Description</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold">Part Code</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold w-12">Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Unit Rate</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Discount</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let srNo = 0
                  const rows: React.ReactNode[] = []
                  const byCategory: Record<string, typeof pricing.lineItems> = {}
                  pricing.lineItems.forEach(item => { if (!byCategory[item.category]) byCategory[item.category] = []; byCategory[item.category].push(item) })

                  Object.entries(byCategory).forEach(([cat, items]) => {
                    const sec = pricing.sections.find(s => s.category === cat)
                    const discPct = sectionDiscounts[cat] ?? 0
                    rows.push(
                      <tr key={`cat-${cat}`} style={{ background: '#f8fafc' }}>
                        <td colSpan={7} className="px-3 py-2 font-bold text-xs uppercase tracking-wider" style={{ color: '#4f46e5' }}>
                          {CATEGORY_LABELS[cat] || cat}
                        </td>
                      </tr>
                    )
                    items.forEach(item => {
                      srNo++
                      const disc = discPct / 100
                      const discountedUnit = Math.round(item.unitPrice * (1 - disc))
                      const amount = discountedUnit * item.qty
                      rows.push(
                        <tr key={item.productId} className="border-b border-gray-100">
                          <td className="px-3 py-2.5 text-xs text-gray-400">{srNo}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{item.name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-400 font-mono">{item.partCode}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{item.qty}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">₹{item.unitPrice.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2.5 text-right text-red-600 text-xs">{discPct > 0 ? `${discPct}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-800">₹{amount.toLocaleString('en-IN')}</td>
                        </tr>
                      )
                    })
                    if (sec) {
                      rows.push(
                        <tr key={`sec-total-${cat}`} style={{ background: '#eef2ff' }}>
                          <td colSpan={6} className="px-3 py-1.5 text-right text-xs font-semibold text-gray-500">{CATEGORY_LABELS[cat] || cat} Subtotal</td>
                          <td className="px-3 py-1.5 text-right text-xs font-bold" style={{ color: '#4f46e5' }}>₹{sec.discountedItemTotal.toLocaleString('en-IN')}</td>
                        </tr>
                      )
                      if (sec.installCharge > 0) {
                        rows.push(
                          <tr key={`install-${cat}`} style={{ background: '#f0f9ff' }}>
                            <td colSpan={6} className="px-3 py-1 text-right text-xs text-gray-400">Installation & Setup ({Math.round(sec.installRate * 100)}%)</td>
                            <td className="px-3 py-1 text-right text-xs font-semibold text-blue-600">+₹{sec.installCharge.toLocaleString('en-IN')}</td>
                          </tr>
                        )
                      }
                    }
                  })
                  return rows
                })()}
              </tbody>
              <tfoot>
                {pricing.discountAmount > 0 && (
                  <tr style={{ background: '#fff5f5' }}>
                    <td colSpan={6} className="px-3 py-2 text-right font-semibold text-red-600">Total Discount</td>
                    <td className="px-3 py-2 text-right font-semibold text-red-600">−₹{pricing.discountAmount.toLocaleString('en-IN')}</td>
                  </tr>
                )}
                {pricing.totalInstallation > 0 && (
                  <tr style={{ background: '#f0f9ff' }}>
                    <td colSpan={6} className="px-3 py-2 text-right font-semibold text-blue-700">Total Installation & Setup</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700">+₹{pricing.totalInstallation.toLocaleString('en-IN')}</td>
                  </tr>
                )}
                <tr style={{ background: '#0f172a', color: 'white' }}>
                  <td colSpan={6} className="px-4 py-4 text-right font-bold text-base">GRAND TOTAL (Excl. GST)</td>
                  <td className="px-4 py-4 text-right font-black text-xl" style={{ color: '#fbbf24' }}>₹{pricing.grandSubtotal.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="px-8 py-12 text-center">
            <p className="text-gray-400">No products in this quotation.</p>
          </div>
        )}

        {/* Notes */}
        {quotation.notes && (
          <div className="px-8 py-5 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Notes & Scope</p>
            <p className="text-sm text-gray-600 whitespace-pre-line">{quotation.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <p className="text-xs text-gray-400">This quotation is valid for {(quotation as any).validDays || 30} days from date of issue.</p>
          <p className="text-xs text-gray-400">Galaxy Home Automation · galaxy.homeauto@gmail.com</p>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .boq-document { box-shadow: none !important; margin: 0 !important; }
          @page { margin: 10mm; size: A4; }
        }
      `}</style>
    </>
  )
}
