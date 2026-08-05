import { useState } from 'react'
import { FileText, Upload, Trash2, ExternalLink, Loader2 } from 'lucide-react'
import { Card } from './ui/Card'
import { db, doc, updateDoc, serverTimestamp } from '../lib/firebase'
import { formatDate } from '../lib/utils'
import { recalcLeadScore } from '../lib/leadScore'
import { uploadQuotePdf, MAX_QUOTE_BYTES, formatBytes, type QuoteUploadProgress } from '../lib/quoteUpload'
import type { QuoteDoc } from '../types'
import toast from 'react-hot-toast'

interface Props {
  /** Firestore collection the parent doc lives in. */
  collectionName: 'leads' | 'partners'
  docId: string
  documents: QuoteDoc[]
  canEdit: boolean
  /** Name stamped on uploads (current user). */
  uploadedByName?: string
  /**
   * Called after the document list changes so parents that keep the record in
   * local state (rather than a live snapshot) stay in sync.
   */
  onChange?: (docs: QuoteDoc[]) => void
  /** Optional heading override. */
  title?: string
}

// Upload, list, view and remove PDF quotes attached to a lead or partner.
// Files go to Firebase Storage; the metadata is saved as a `quoteDocuments`
// array on the parent doc — no subcollection, so it needs no extra rules.
export function QuoteDocuments({
  collectionName, docId, documents, canEdit, uploadedByName, onChange, title = 'Quote Documents',
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<QuoteUploadProgress | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const docs = documents ?? []

  async function persist(next: QuoteDoc[]) {
    await updateDoc(doc(db, collectionName, docId), {
      quoteDocuments: next,
      updatedAt: serverTimestamp(),
    })
    // Quote count feeds the lead score. Partners are not scored, so guard on the
    // collection this instance is attached to.
    if (collectionName === 'leads') {
      await recalcLeadScore(docId, { quoteDocuments: next })
    }
    onChange?.(next)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setUploading(true)
    setProgress({ phase: 'compressing', fraction: 0 })
    try {
      const newDoc = await uploadQuotePdf({
        file,
        collectionName,
        docId,
        uploadedByName,
        onProgress: setProgress,
      })
      await persist([...docs, newDoc])
      toast.success('Quote uploaded')
    } catch (err: unknown) {
      console.error('Quote upload error:', err)
      toast.error(err instanceof Error ? err.message : 'Upload failed — check your connection')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  async function handleRemove(target: QuoteDoc) {
    if (!window.confirm(`Remove "${target.name}"? The file link will be removed from this record.`)) return
    setRemoving(target.url)
    try {
      await persist(docs.filter(d => d.url !== target.url))
      toast.success('Quote removed')
    } catch (err) {
      console.error(err)
      toast.error('Failed to remove quote')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
        {canEdit && (
          <label className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 cursor-pointer transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading
              ? `${progress?.phase === 'compressing' ? 'Compressing' : 'Uploading'} ${Math.round((progress?.fraction ?? 0) * 100)}%`
              : 'Upload PDF'}
            <input type="file" accept="application/pdf,.pdf" className="sr-only"
              onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>
      {canEdit && !uploading && (
        <p className="text-[10px] text-gray-600 mb-2">
          PDF up to {formatBytes(MAX_QUOTE_BYTES)}. Large image-heavy quotes are compressed automatically.
        </p>
      )}

      {docs.length === 0 ? (
        <div className="text-center py-4">
          <FileText className="w-6 h-6 text-gray-700 mx-auto mb-2" />
          <p className="text-xs text-gray-600">No quotes uploaded yet</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.slice().sort((a, b) => b.uploadedAt - a.uploadedAt).map(d => (
            <li key={d.url} className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <a href={d.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300 truncate">
                  <span className="truncate">{d.name}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                <p className="text-[11px] text-gray-600">
                  {formatDate(new Date(d.uploadedAt))}{d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                </p>
              </div>
              {canEdit && (
                <button
                  onClick={() => handleRemove(d)}
                  disabled={removing === d.url}
                  className="p-1 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-40"
                  title="Remove"
                >
                  {removing === d.url ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
