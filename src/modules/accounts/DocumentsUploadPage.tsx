import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, UploadCloud, FileText, FileSpreadsheet, FileImage, File as FileIcon,
  Loader2, ExternalLink, Trash2, AlertTriangle,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { cn, formatDate } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'
import { db, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from '../../lib/firebase'
import { uploadToDrive, GoogleDriveError } from '../../lib/googleDrive'
import { getDriveAccessToken } from '../../lib/googleDriveAuth'
import { compressForUpload } from '../../lib/uploadCompression'
import { trashItem } from '../../lib/trash'
import toast from 'react-hot-toast'
import type { AccountDocument } from '../../types'

// Not a hard technical ceiling — Drive itself accepts files far larger — but
// asking someone to wait through a multi-GB upload on a phone connection with
// no resume-on-drop is a bad experience, so this is a soft guardrail with a
// clear way past it, not a wall.
const SOFT_SIZE_WARNING_BYTES = 200 * 1024 * 1024 // 200MB

const ACCEPTED_EXTENSIONS =
  '.pdf,.xls,.xlsx,.csv,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic,.txt,.zip'

function iconFor(mimeType: string) {
  if (mimeType.includes('pdf')) return <FileText className="w-4 h-4 text-red-400" />
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return <FileSpreadsheet className="w-4 h-4 text-green-400" />
  if (mimeType.startsWith('image/')) return <FileImage className="w-4 h-4 text-blue-400" />
  return <FileIcon className="w-4 h-4 text-gray-400" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const STATUS_LABEL: Record<AccountDocument['status'], { label: string; color: string; bg: string }> = {
  uploaded:  { label: 'Uploaded',  color: 'text-gray-400',   bg: 'bg-gray-800' },
  extracted: { label: 'Extracted', color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  generated: { label: 'Generated', color: 'text-violet-400', bg: 'bg-violet-900/30' },
  saved:     { label: 'Saved',     color: 'text-green-400',  bg: 'bg-green-900/30' },
}

interface UploadTask {
  id: string
  fileName: string
  fraction: number
  phase: 'compressing' | 'uploading'
  error?: string
}

export function DocumentsUploadPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [docs, setDocs] = useState<AccountDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [dragging, setDragging] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = query(collection(db, 'accountDocuments'), orderBy('uploadedAt', 'desc'))
    return onSnapshot(q, snap => {
      setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as AccountDocument))
      setLoading(false)
    })
  }, [])

  const uploadOne = useCallback(async (file: File, autoOpen: boolean) => {
    const taskId = `${file.name}-${Date.now()}-${Math.random()}`
    setTasks(prev => [...prev, { id: taskId, fileName: file.name, fraction: 0, phase: 'compressing' }])

    try {
      // Grab Drive access before doing any other work. Browsers only allow a
      // popup to open if it's triggered right on the heels of a user gesture
      // (the click/drop that got us here) — any real async work first
      // (compression can run for seconds on a large image or PDF) burns
      // through that window, and the popup opens too late to count as
      // gesture-triggered, so it gets silently killed before the user can
      // see or approve it.
      await getDriveAccessToken()

      // Compression is best-effort and never throws — a failure or an
      // unsuitable file type (Excel/CSV/Word) just returns the original
      // untouched, so this never blocks the upload it's meant to shrink.
      const { blob: uploadBlob, wasCompressed, savedBytes } = await compressForUpload(file, fraction => {
        setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, phase: 'compressing', fraction } : t)))
      })

      // A compressed image becomes a JPEG blob — if the original wasn't
      // already .jpg/.jpeg, keep the stored file's extension matching what
      // its bytes actually are, or apps opening it later will see a mismatch.
      const uploadFileName = wasCompressed && uploadBlob.type === 'image/jpeg' && !/\.jpe?g$/i.test(file.name)
        ? file.name.replace(/\.[^.]+$/, '') + '.jpg'
        : file.name

      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, phase: 'uploading', fraction: 0 } : t)))

      const { driveFileId, driveViewUrl } = await uploadToDrive(
        new File([uploadBlob], uploadFileName, { type: uploadBlob.type || file.type }),
        fraction => setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, phase: 'uploading', fraction } : t))),
      )

      const docRef = await addDoc(collection(db, 'accountDocuments'), {
        fileName: uploadFileName,
        mimeType: uploadBlob.type || file.type || 'application/octet-stream',
        size: uploadBlob.size,
        driveFileId,
        driveViewUrl,
        status: 'uploaded',
        uploadedBy: user?.id ?? '',
        uploadedByName: user?.name ?? '',
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      setTasks(prev => prev.filter(t => t.id !== taskId))
      toast.success(
        wasCompressed
          ? `${uploadFileName} uploaded — compressed, saved ${formatFileSize(savedBytes)}`
          : `${file.name} uploaded`,
      )

      // Uploading exactly one file is almost always "here's an invoice, deal
      // with it" — so go straight to reading it rather than making them find
      // it again in the list below. Dropping several at once is more likely a
      // batch to work through at their own pace, so those are left in the list.
      if (autoOpen) navigate(`/accounts/documents/${docRef.id}`)
    } catch (err) {
      const message = err instanceof GoogleDriveError ? err.message : 'Upload failed — please try again'
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, error: message } : t)))
      toast.error(`${file.name}: ${message}`)
    }
  }, [user, navigate])

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    const autoOpen = files.length === 1
    files.forEach(file => {
      if (file.size > SOFT_SIZE_WARNING_BYTES) {
        toast(`${file.name} is ${formatFileSize(file.size)} — this may take a while.`, { icon: '⏳' })
      }
      uploadOne(file, autoOpen)
    })
  }, [uploadOne])

  const dismissFailedTask = (taskId: string) => setTasks(prev => prev.filter(t => t.id !== taskId))

  const handleDelete = async (d: AccountDocument) => {
    try {
      await trashItem('accountDocuments', d.id, user?.id ?? '', user?.name ?? '')
      toast.success(`${d.fileName} moved to Recycle Bin`)
    } catch {
      toast.error('Failed to delete — please try again')
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/accounts')} className="text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">Documents Upload</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload a quotation, product list or order document. Stored in Google Drive — no size limit.
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <Card padding="none">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            handleFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-2 py-12 px-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
            dragging ? 'border-gold-400 bg-gold-400/5' : 'border-gray-800 hover:border-gray-700',
          )}
        >
          <UploadCloud className={cn('w-8 h-8', dragging ? 'text-gold-400' : 'text-gray-600')} />
          <p className="text-sm text-gray-300 font-medium">Drop files here, or click to browse</p>
          <p className="text-xs text-gray-600">PDF, Excel, CSV, Word, images, and more — any size</p>
          <p className="text-xs text-gray-700">Images and large PDFs are compressed automatically before upload</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
        </div>
      </Card>

      {/* Active / failed uploads */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map(t => (
            <Card key={t.id} padding="sm">
              <div className="flex items-center gap-3">
                {t.error ? (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-gold-400 animate-spin shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">
                    {t.fileName}
                    {!t.error && <span className="text-gray-600 font-normal"> · {t.phase === 'compressing' ? 'compressing' : 'uploading'}</span>}
                  </p>
                  {t.error ? (
                    <p className="text-xs text-red-400 mt-0.5">{t.error}</p>
                  ) : (
                    <div className="w-full h-1.5 bg-gray-800 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-gold-400 transition-all"
                        style={{ width: `${Math.round(t.fraction * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {!t.error && (
                  <span className="text-xs text-gray-500 shrink-0 tabular-nums">{Math.round(t.fraction * 100)}%</span>
                )}
                {t.error && (
                  <button onClick={() => dismissFailedTask(t.id)} className="text-xs text-gray-500 hover:text-gray-300 shrink-0">
                    Dismiss
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Uploaded documents list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Uploaded Documents</h2>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-600 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && docs.length === 0 && (
          <Card>
            <p className="text-sm text-gray-500 text-center py-6">No documents uploaded yet.</p>
          </Card>
        )}

        {!loading && docs.length > 0 && (
          <div className="space-y-2">
            {docs.map(d => {
              const st = STATUS_LABEL[d.status] ?? STATUS_LABEL.uploaded
              const confirming = confirmDeleteId === d.id
              return (
                <Card key={d.id} padding="sm">
                  <div className="flex items-center gap-3">
                    {iconFor(d.mimeType)}
                    <button
                      onClick={() => navigate(`/accounts/documents/${d.id}`)}
                      className="flex-1 min-w-0 text-left"
                      title="Review, extract and generate documents"
                    >
                      <p className="text-sm text-gray-200 truncate hover:text-gold-400 transition-colors">{d.fileName}</p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {formatFileSize(d.size)} · {formatDate(d.uploadedAt)}
                        {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                        {d.invoiceNumber ? ` · ${d.invoiceNumber}` : ''}
                      </p>
                    </button>
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded shrink-0', st.color, st.bg)}>
                      {st.label}
                    </span>
                    <a
                      href={d.driveViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google Drive"
                      className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {confirming ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleDelete(d)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(d.id)}
                        title="Move to Recycle Bin"
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {docs.length > 0 && (
        <p className="text-xs text-gray-600">Click a document to extract its details and generate an invoice and packing list.</p>
      )}
    </div>
  )
}
