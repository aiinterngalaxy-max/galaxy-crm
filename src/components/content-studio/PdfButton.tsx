import { useState } from 'react'
import { getAllContent, getBrands, getIdeas, getStats, getPerformance } from '@/lib/content-studio/queries'
import { generateReportPdf } from '@/lib/content-studio/pdf'

export function PdfButton() {
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const [stats, brands, content, ideas, perf] = await Promise.all([
        getStats(),
        getBrands(),
        getAllContent(),
        getIdeas(),
        getPerformance(),
      ])
      generateReportPdf({ stats, brands, content, ideas, perf })
    } catch (e: any) {
      alert(e?.message || 'Failed to generate PDF')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn-ghost no-print" onClick={download} disabled={busy}>
      {busy ? 'Generating…' : '⤓ Export PDF'}
    </button>
  )
}
