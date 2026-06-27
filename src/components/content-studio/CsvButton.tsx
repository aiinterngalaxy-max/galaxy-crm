export interface BrandCsvRow {
  brand: string
  lead: string
  target: number
  published: number
  inProduction: number
  ideasPitched: string // e.g. "5/10"
  targetHitPct: string // e.g. "33%"
}

export interface ContentCsvRow {
  title: string
  brand: string
  platform: string
  views: number
  engagement: number
}

function esc(v: string | number): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function row(...cells: (string | number)[]): string {
  return cells.map(esc).join(',')
}

export function CsvButton({
  brandRows,
  topContent,
  month,
}: {
  brandRows: BrandCsvRow[]
  topContent: ContentCsvRow[]
  month: string
}) {
  function download() {
    const lines: string[] = []

    lines.push(row(`Galaxy Marketing Command Center — ${month}`))
    lines.push('')

    lines.push(row('BRAND PRODUCTION REPORT'))
    lines.push(row('Brand', 'Lead', 'Target', 'Published', 'In Production', 'Ideas Pitched', 'Target Hit %'))
    for (const r of brandRows) {
      lines.push(row(r.brand, r.lead, r.target, r.published, r.inProduction, r.ideasPitched, r.targetHitPct))
    }
    lines.push('')

    lines.push(row('TOP PERFORMING CONTENT'))
    lines.push(row('Title', 'Brand', 'Platform', 'Views', 'Engagement'))
    for (const c of topContent) {
      lines.push(row(c.title, c.brand, c.platform, c.views, c.engagement))
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `galaxy-report-${new Date().toISOString().slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button className="btn-ghost no-print" onClick={download}>
      ⤓ Export CSV
    </button>
  )
}
