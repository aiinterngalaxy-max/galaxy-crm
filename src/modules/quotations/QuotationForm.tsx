import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, addDoc, getDocs, serverTimestamp, generateQuotationCode
} from '../../lib/firebase'
import { formatCurrency } from '../../lib/utils'
import type { Customer, Product, QuotationLineItem } from '../../types'
import toast from 'react-hot-toast'

interface QuotationFormProps {
  onSuccess: () => void
  onCancel: () => void
  customerId?: string
}

const PAYMENT_TERMS = [
  { value: '30% advance, 40% on Phase 1, 30% on completion', label: '30-40-30 Milestone' },
  { value: '50% advance, 50% on completion', label: '50-50 Advance' },
  { value: '100% advance', label: '100% Advance' },
  { value: 'Custom terms', label: 'Custom' },
]

export function QuotationForm({ onSuccess, onCancel, customerId }: QuotationFormProps) {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(customerId || '')
  const [paymentTerms, setPaymentTerms] = useState(PAYMENT_TERMS[0].value)
  const [notes, setNotes] = useState('')
  const [validDays, setValidDays] = useState('30')
  const [taxRate, setTaxRate] = useState(18)
  const [discount, setDiscount] = useState(0)
  const [loading, setLoading] = useState(false)

  const [lineItems, setLineItems] = useState<Omit<QuotationLineItem, 'id'>[]>([
    { productName: '', productSpec: '', quantity: 1, unitPrice: 0, lineTotal: 0 }
  ])

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'products')),
    ]).then(([custSnap, prodSnap]) => {
      setCustomers(custSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Customer))
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Product))
    }).catch(console.error)
  }, [])

  const updateLineItem = (idx: number, field: string, value: string | number) => {
    setLineItems(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      if (field === 'quantity' || field === 'unitPrice') {
        updated[idx].lineTotal = (Number(updated[idx].quantity)) * (Number(updated[idx].unitPrice))
      }
      return updated
    })
  }

  const addLineItem = () => {
    setLineItems(prev => [...prev, { productName: '', productSpec: '', quantity: 1, unitPrice: 0, lineTotal: 0 }])
  }

  const removeLineItem = (idx: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  const fillFromProduct = (idx: number, productId: string) => {
    const product = products.find(p => p.id === productId)
    if (!product) return
    setLineItems(prev => {
      const updated = [...prev]
      updated[idx] = {
        ...updated[idx],
        productId,
        productName: product.name,
        productSpec: product.specs || '',
        unitPrice: product.standardPrice,
        lineTotal: product.standardPrice * updated[idx].quantity,
      }
      return updated
    })
  }

  const subtotal = lineItems.reduce((s, i) => s + (i.lineTotal || 0), 0)
  const taxAmount = (subtotal - discount) * (taxRate / 100)
  const total = subtotal - discount + taxAmount

  const handleSubmit = async () => {
    if (!selectedCustomerId) { toast.error('Select a customer'); return }
    if (!lineItems.some(l => l.productName && l.unitPrice > 0)) {
      toast.error('Add at least one line item')
      return
    }

    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'quotations'))
      const seq = snap.size + 1
      const customer = customers.find(c => c.id === selectedCustomerId)

      const validUntil = new Date()
      validUntil.setDate(validUntil.getDate() + Number(validDays))

      const lineItemsWithIds = lineItems
        .filter(l => l.productName)
        .map((l, idx) => ({ ...l, id: `li_${idx + 1}` }))

      await addDoc(collection(db, 'quotations'), {
        quotationCode: generateQuotationCode(seq),
        customerId: selectedCustomerId,
        customerName: customer?.name || '',
        version: 1,
        status: total >= 200000 ? 'pending_approval' : 'draft',
        assignedPM: user?.id,
        assignedPMName: user?.name,
        validUntil: validUntil,
        paymentTerms,
        notes,
        subtotal,
        taxRate,
        taxAmount,
        discount,
        total,
        lineItems: lineItemsWithIds,
        createdBy: user?.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      toast.success(
        total >= 200000
          ? 'Quotation created — sent for management approval (value > ₹2L)'
          : 'Quotation created as draft'
      )
      onSuccess()
    } catch (err) {
      toast.error('Failed to create quotation')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const customerOptions = customers.map(c => ({ value: c.id, label: c.name }))
  const productOptions = [
    { value: '', label: 'Select product or type manually' },
    ...products.filter(p => p.isActive).map(p => ({ value: p.id, label: `${p.name} — ₹${p.standardPrice.toLocaleString('en-IN')}` }))
  ]

  return (
    <div className="space-y-5">
      {/* Customer + Meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Customer *"
          options={customerOptions}
          placeholder="Select customer"
          value={selectedCustomerId}
          onChange={e => setSelectedCustomerId(e.target.value)}
        />
        <Input
          label="Valid for (days)"
          type="number"
          value={validDays}
          onChange={e => setValidDays(e.target.value)}
        />
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Line Items</h3>
          <Button size="sm" variant="secondary" onClick={addLineItem} icon={<Plus className="w-3.5 h-3.5" />}>
            Add Row
          </Button>
        </div>

        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
            <div className="col-span-4">Item</div>
            <div className="col-span-3">Spec / Description</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Unit Price</div>
            <div className="col-span-1 text-right">Total</div>
            <div className="col-span-1" />
          </div>

          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-gray-800/40 rounded-lg p-2">
              <div className="col-span-4">
                <select
                  className="form-input text-xs py-1.5 mb-1"
                  value={item.productId || ''}
                  onChange={e => fillFromProduct(idx, e.target.value)}
                >
                  {productOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  className="form-input text-xs py-1.5"
                  placeholder="Product name"
                  value={item.productName}
                  onChange={e => updateLineItem(idx, 'productName', e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <input
                  className="form-input text-xs py-1.5 h-full"
                  placeholder="Specs / notes"
                  value={item.productSpec || ''}
                  onChange={e => updateLineItem(idx, 'productSpec', e.target.value)}
                />
              </div>
              <div className="col-span-1">
                <input
                  type="number"
                  min={1}
                  className="form-input text-xs py-1.5 text-right"
                  value={item.quantity}
                  onChange={e => updateLineItem(idx, 'quantity', Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number"
                  className="form-input text-xs py-1.5 text-right"
                  placeholder="0"
                  value={item.unitPrice || ''}
                  onChange={e => updateLineItem(idx, 'unitPrice', Number(e.target.value))}
                />
              </div>
              <div className="col-span-1 text-right pt-2">
                <span className="text-xs font-medium text-gray-200">
                  {formatCurrency(item.lineTotal)}
                </span>
              </div>
              <div className="col-span-1 flex justify-center pt-1.5">
                {lineItems.length > 1 && (
                  <button onClick={() => removeLineItem(idx)} className="text-gray-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-64 space-y-2 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center text-gray-400">
            <span>Discount</span>
            <input
              type="number"
              className="form-input w-24 py-1 text-xs text-right"
              value={discount}
              onChange={e => setDiscount(Number(e.target.value))}
            />
          </div>
          <div className="flex justify-between items-center text-gray-400">
            <span>Tax ({taxRate}%)</span>
            <span>{formatCurrency(taxAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-base text-gray-100 border-t border-gray-700 pt-2">
            <span>Total</span>
            <span className="text-indigo-400">{formatCurrency(total)}</span>
          </div>
          {total >= 200000 && (
            <p className="text-xs text-yellow-400">⚠ Value ≥ ₹2L — Management approval required</p>
          )}
        </div>
      </div>

      {/* Payment Terms + Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Payment Terms"
          options={PAYMENT_TERMS}
          value={paymentTerms}
          onChange={e => setPaymentTerms(e.target.value)}
        />
      </div>
      <Textarea label="Notes / Scope" placeholder="Scope of work, inclusions, exclusions…" value={notes} onChange={e => setNotes(e.target.value)} />

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit} loading={loading}>Create Quotation</Button>
      </div>
    </div>
  )
}
