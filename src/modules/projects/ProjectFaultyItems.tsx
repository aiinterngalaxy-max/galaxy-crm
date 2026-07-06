import { useState, useEffect } from 'react'
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import {
  db, collection, doc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from '../../lib/firebase'
import toast from 'react-hot-toast'

interface FaultyItem {
  id: string
  itemCode: string
  itemName: string
  qty: number
  reason: string
  reportedByName: string
  createdAt: any
}

interface Props {
  projectId: string
  canManage: boolean
  userName: string
}

export function ProjectFaultyItems({ projectId, canManage, userName }: Props) {
  const [items, setItems] = useState<FaultyItem[]>([])
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'projects', projectId, 'faultyItems'), orderBy('createdAt', 'desc')),
      snap => setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }) as FaultyItem))
    )
    return unsub
  }, [projectId])

  const handleDelete = async (itemId: string) => {
    if (!window.confirm('Remove this entry?')) return
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'faultyItems', itemId))
      toast.success('Removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  return (
    <Card padding="none">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> Non-Working Inventory
        </h3>
        {canManage && (
          <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowForm(true)}>
            Add Entry
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="p-6 text-xs text-gray-600 text-center">No non-working items logged.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Code', 'Item', 'Qty', 'Reason', 'Reported By', 'Date', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-300 whitespace-nowrap">{item.itemCode || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-200">{item.itemName}</td>
                  <td className="px-4 py-2.5 text-xs text-amber-400 font-semibold text-right">{item.qty}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px]">{item.reason}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{item.reportedByName}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                    {item.createdAt?.toDate?.().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {canManage && (
                      <button onClick={() => handleDelete(item.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <AddFaultyItemModal
          projectId={projectId}
          userName={userName}
          onClose={() => setShowForm(false)}
        />
      )}
    </Card>
  )
}

function AddFaultyItemModal({ projectId, userName, onClose }: {
  projectId: string
  userName: string
  onClose: () => void
}) {
  const [itemCode, setItemCode] = useState('')
  const [itemName, setItemName] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itemName.trim() || !qty || !reason.trim()) {
      toast.error('Fill in Item Name, Quantity and Reason')
      return
    }
    setSaving(true)
    try {
      await addDoc(collection(db, 'projects', projectId, 'faultyItems'), {
        itemCode: itemCode.trim().toUpperCase(),
        itemName: itemName.trim(),
        qty: Number(qty),
        reason: reason.trim(),
        reportedByName: userName,
        createdAt: serverTimestamp(),
      })
      toast.success('Entry logged')
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="glass-card w-full max-w-sm rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Log Non-Working Item
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="form-label">Item Code (optional)</label>
            <input className="form-input" placeholder="e.g. 2T-GREY-ALUMINIUM"
              value={itemCode} onChange={e => setItemCode(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Item Name *</label>
            <input autoFocus className="form-input" placeholder="e.g. 2 Touch Grey Switch"
              value={itemName} onChange={e => setItemName(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Quantity *</label>
            <input type="number" min="1" className="form-input" placeholder="0"
              value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Reason for not working *</label>
            <textarea className="form-input resize-none" rows={3}
              placeholder="e.g. Switch not responding, panel cracked, wiring issue..."
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Log Item</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
