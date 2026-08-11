import { useState, useEffect } from 'react'
import { db } from '../../lib/firebase'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { restoreItem, permanentDelete, type TrashItem } from '../../lib/trash'
import { Trash2, RotateCcw, AlertTriangle, Inbox } from 'lucide-react'
import toast from 'react-hot-toast'

const COLLECTION_COLORS: Record<string, string> = {
  leads: 'bg-blue-900/30 text-blue-300 border-blue-800/40',
  customers: 'bg-purple-900/30 text-purple-300 border-purple-800/40',
  projects: 'bg-green-900/30 text-green-300 border-green-800/40',
  quotations: 'bg-yellow-900/30 text-yellow-300 border-yellow-800/40',
  partners: 'bg-orange-900/30 text-orange-300 border-orange-800/40',
  candidates: 'bg-pink-900/30 text-pink-300 border-pink-800/40',
  jobDescriptions: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/40',
  quoteDocuments: 'bg-amber-900/30 text-amber-300 border-amber-800/40',
  accountDocuments: 'bg-teal-900/30 text-teal-300 border-teal-800/40',
}

function timeAgo(ts: unknown): string {
  if (!ts || typeof (ts as { toDate?: unknown }).toDate !== 'function') return '—'
  const ms = Date.now() - (ts as { toDate: () => Date }).toDate().getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function RecycleBin() {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [emptying, setEmptying] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'deletedItems'), orderBy('deletedAt', 'desc'))
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as TrashItem)))
      setLoading(false)
    })
  }, [])

  const handleRestore = async (item: TrashItem) => {
    setBusy(item.id)
    try {
      await restoreItem(item.id)
      toast.success(`${item.displayName} restored`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(null)
    }
  }

  const handlePermanentDelete = async (id: string) => {
    setBusy(id)
    try {
      await permanentDelete(id)
      toast.success('Permanently deleted')
    } catch {
      toast.error('Delete failed')
    } finally {
      setBusy(null)
      setConfirmId(null)
    }
  }

  const handleEmpty = async () => {
    setEmptying(true)
    try {
      // Sequential, not Promise.all: each item may also delete a file on
      // Google Drive, and firing dozens of those requests at once risks
      // tripping Drive's rate limits mid-batch, leaving some files orphaned.
      let failed = 0
      for (const item of items) {
        try {
          await permanentDelete(item.id)
        } catch {
          failed++
        }
      }
      if (failed > 0) {
        toast.error(`Emptied bin, but ${failed} item${failed === 1 ? '' : 's'} failed to delete`)
      } else {
        toast.success('Recycle bin emptied')
      }
    } finally {
      setEmptying(false)
      setConfirmEmpty(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title text-2xl font-bold" style={{ color: 'var(--text-base)' }}>
            Recycle Bin
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Deleted items are kept here. Restore to bring them back, or permanently delete to remove forever.
          </p>
        </div>

        {!loading && items.length > 0 && (
          confirmEmpty ? (
            <div className="flex items-center gap-2 shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-400 font-medium">
                Permanently delete all {items.length} item{items.length === 1 ? '' : 's'}?
              </span>
              <button
                onClick={handleEmpty}
                disabled={emptying}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {emptying ? 'Emptying…' : 'Yes, empty bin'}
              </button>
              <button
                onClick={() => setConfirmEmpty(false)}
                disabled={emptying}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmEmpty(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Empty Recycle Bin
            </button>
          )
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-gold-400/30 border-t-gold-400 rounded-full animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="glass-card rounded-2xl p-16 flex flex-col items-center gap-4 text-center">
          <Inbox className="w-12 h-12 text-gray-600" />
          <p className="text-gray-400 font-medium">Recycle bin is empty</p>
          <p className="text-gray-600 text-sm">Deleted items will appear here</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => {
            const colorClass = COLLECTION_COLORS[item.originalCollection] ?? 'bg-gray-800/30 text-gray-300 border-gray-700/40'
            const isConfirming = confirmId === item.id
            const isBusy = busy === item.id

            return (
              <div
                key={item.id}
                className="glass-card rounded-xl px-4 py-3.5 flex items-center gap-4"
              >
                {/* Type badge */}
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg border capitalize ${colorClass}`}>
                  {item.originalCollection.replace(/([A-Z])/g, ' $1').trim()}
                </span>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-base)' }}>
                    {item.displayName}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Deleted by {item.deletedByName} · {timeAgo(item.deletedAt)}
                  </p>
                </div>

                {/* Actions */}
                {!isConfirming ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isBusy ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      onClick={() => setConfirmId(item.id)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete forever
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-xs text-red-400 font-medium">Are you sure?</span>
                    <button
                      onClick={() => handlePermanentDelete(item.id)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                    >
                      {isBusy ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
