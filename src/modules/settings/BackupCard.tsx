import { useState } from 'react'
import { Download, Loader2, ShieldCheck } from 'lucide-react'
import { runBrowserBackup, downloadBlob, type BackupProgress } from '../../lib/browserBackup'
import toast from 'react-hot-toast'

/**
 * One-click backup of the whole database, using the signed-in user's own session.
 *
 * This exists because the command-line backup needs a credential the project
 * cannot easily provide — the CRM is Google-sign-in only, so there is no password
 * to hand a script. Clicking here needs nothing set up at all.
 */
export function BackupCard() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [last, setLast] = useState<string | null>(null)

  const handleBackup = async () => {
    setBusy(true)
    setProgress(null)
    try {
      const { blob, result } = await runBrowserBackup(setProgress)
      downloadBlob(blob, result.fileName)

      const skipped = Object.keys(result.skipped).length
      setLast(`${result.totalDocuments.toLocaleString()} documents · ${new Date().toLocaleString()}`)
      toast.success(
        `Backup downloaded — ${result.totalDocuments.toLocaleString()} documents` +
          (skipped ? ` (${skipped} collection(s) skipped)` : ''),
      )
      if (skipped) {
        console.warn('[backup] skipped collections:', result.skipped)
      }
    } catch (err) {
      console.error('Backup failed:', err)
      toast.error(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold" style={{ color: 'var(--text-base)' }}>Backup all data</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Downloads every lead, customer, quotation, project and invoice as a single
            JSON file. Deleted data cannot be recovered any other way on this plan, so
            take one before any big change — and keep a copy off this PC.
          </p>

          {last && (
            <p className="text-xs mt-2 text-green-400">Last backup: {last}</p>
          )}

          <button
            onClick={handleBackup}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gold-400 text-gray-900 hover:bg-gold-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ? `Backing up… ${pct}%` : 'Download backup'}
          </button>

          {busy && progress && (
            <p className="text-xs mt-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
              Reading {progress.current} — {progress.done}/{progress.total}
            </p>
          )}

          <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
            Read-only — this cannot change or delete anything. Topz Cab is a separate
            project and is not included.
          </p>
        </div>
      </div>
    </div>
  )
}
