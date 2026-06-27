import jsPDF from 'jspdf'
import type { Brand, ContentRow, Idea, PerfRow, Stats } from '@/types/content-studio'
import { STAGES } from './stages'
import { compact, num } from './format'

const NAVY = '#0B1E3D'
const GOLD = '#C9A227'
const SLATE = '#64748B'
const LIGHT = '#F1F5F9'
const WHITE = '#FFFFFF'
const ROSE = '#E11D48'
const AMBER = '#D97706'
const GREEN = '#059669'

function pctStr(n: number) {
  return `${Math.round(n)}%`
}

export function generateReportPdf(data: {
  stats: Stats
  brands: Brand[]
  content: ContentRow[]
  ideas: Idea[]
  perf: PerfRow[]
}) {
  const { stats, brands, content, ideas, perf } = data
  const month = new Date().toISOString().slice(0, 7)
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const genDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const engagement = stats.totals.engagement
  const top = [...perf].sort((a, b) => b.views - a.views).slice(0, 10)

  const brandRows = brands.map((br) => {
    const items = content.filter((c) => c.brand_id === br.id)
    const published = items.filter((c) => c.stage === 'Published' && (c.publish_date || '').startsWith(month)).length
    const inProd = items.filter((c) => c.stage !== 'Published').length
    const bIdeas = ideas.filter((i) => i.brand_id === br.id && i.month === month)
    const pitched = bIdeas.filter((i) => i.pitched).length
    const hit = br.monthly_target ? (published / br.monthly_target) * 100 : 0
    return { br, published, inProd, pitched, total: bIdeas.length, hit }
  })

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const LEFT = 48
  const W = pageW - 96

  function ensureSpace(y: number, needed: number): number {
    if (y + needed > pageH - 60) {
      doc.addPage()
      return 48
    }
    return y
  }

  // Cover stripe
  doc.setFillColor(NAVY)
  doc.rect(0, 0, pageW, 90, 'F')
  doc.setFillColor(GOLD)
  doc.rect(0, 90, pageW, 6, 'F')

  doc.setTextColor(GOLD)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('GALAXY HOME AUTOMATION', LEFT, 36)

  doc.setTextColor(WHITE)
  doc.setFontSize(20)
  doc.text(`Marketing Report — ${monthName}`, LEFT, 56)

  doc.setTextColor(SLATE)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Generated ${genDate}`, LEFT, 78)

  // KPI row
  let y = 116
  const kpiW = (W - 18) / 4
  const kpis = [
    { n: String(stats.activeBrands), l: 'ACTIVE BRANDS' },
    { n: String(stats.publishedThisMonth), l: 'PUBLISHED THIS MONTH' },
    { n: String(stats.inProduction), l: 'IN PRODUCTION' },
    { n: compact(stats.totals.views), l: 'TOTAL VIEWS' },
  ]
  kpis.forEach(({ n, l }, i) => {
    const x = LEFT + i * (kpiW + 6)
    doc.setFillColor(LIGHT)
    doc.roundedRect(x, y, kpiW, 56, 4, 4, 'F')
    doc.setTextColor(NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(n, x + 10, y + 26)
    doc.setTextColor(SLATE)
    doc.setFontSize(7)
    doc.text(l, x + 10, y + 44)
  })

  function sectionHeader(title: string, yy: number) {
    doc.setFillColor(NAVY)
    doc.rect(LEFT, yy, W, 22, 'F')
    doc.setTextColor(WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(title.toUpperCase(), LEFT + 10, yy + 15)
    return yy + 22
  }

  function tableRow(
    cols: { text: string; width: number; align?: 'left' | 'right'; bold?: boolean; color?: string }[],
    yy: number,
    bg?: string
  ) {
    const rowH = 18
    if (bg) {
      doc.setFillColor(bg)
      doc.rect(LEFT, yy, W, rowH, 'F')
    }
    let x = LEFT
    for (const col of cols) {
      doc.setTextColor(col.color ?? NAVY)
      doc.setFont('helvetica', col.bold ? 'bold' : 'normal')
      doc.setFontSize(8)
      const textX = col.align === 'right' ? x + col.width - 4 : x + 4
      doc.text(col.text, textX, yy + 12, { align: col.align === 'right' ? 'right' : 'left' })
      x += col.width
    }
    return yy + rowH
  }

  y = y + 56 + 20
  y = sectionHeader('Brand Production Report', y)

  const bCols: { text: string; width: number; align?: 'left' | 'right'; color?: string }[] = [
    { text: 'Brand', width: 150, color: SLATE },
    { text: 'Lead', width: 100, color: SLATE },
    { text: 'Target', width: 50, align: 'right', color: SLATE },
    { text: 'Published', width: 65, align: 'right', color: SLATE },
    { text: 'In Prod.', width: 55, align: 'right', color: SLATE },
    { text: 'Ideas Pitched', width: 70, align: 'right', color: SLATE },
    { text: 'Target Hit', width: W - 490, align: 'right', color: SLATE },
  ]
  y = tableRow(bCols, y, '#E2E8F0')

  brandRows.forEach(({ br, published, inProd, pitched, total, hit }, i) => {
    const hitColor = hit >= 100 ? GREEN : hit >= 60 ? AMBER : ROSE
    y = ensureSpace(y, 18)
    y = tableRow(
      [
        { text: br.name, width: 150, bold: true },
        { text: br.lead || '—', width: 100, color: SLATE },
        { text: String(br.monthly_target), width: 50, align: 'right', color: SLATE },
        { text: String(published), width: 65, align: 'right', bold: true },
        { text: String(inProd), width: 55, align: 'right', color: SLATE },
        { text: `${pitched}/${total || '—'}`, width: 70, align: 'right', color: SLATE },
        { text: pctStr(hit), width: W - 490, align: 'right', bold: true, color: hitColor },
      ],
      y,
      i % 2 === 0 ? WHITE : LIGHT
    )
  })

  y += 20
  const halfW = (W - 12) / 2

  let pipeY = ensureSpace(y, 22)
  pipeY = sectionHeader('Pipeline Stage Breakdown', pipeY)
  STAGES.forEach((s, i) => {
    const count = stats.byStage.find((x) => x.stage === s)?.count || 0
    pipeY = ensureSpace(pipeY, 18)
    pipeY = tableRow(
      [
        { text: s, width: halfW - 40, color: SLATE },
        { text: String(count), width: 40, align: 'right', bold: true },
      ],
      pipeY,
      i % 2 === 0 ? WHITE : LIGHT
    )
  })

  const perfX = LEFT + halfW + 12
  let perfY = y
  doc.setFillColor(NAVY)
  doc.rect(perfX, perfY, halfW, 22, 'F')
  doc.setTextColor(WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('PERFORMANCE SUMMARY', perfX + 10, perfY + 15)
  perfY += 22

  const engRate = stats.totals.reach ? ((engagement / stats.totals.reach) * 100).toFixed(1) : '0'
  const perfKpis = [
    { l: 'Total views', v: compact(stats.totals.views) },
    { l: 'Total reach', v: compact(stats.totals.reach) },
    { l: 'Engagement', v: compact(engagement) },
    { l: 'Engagement rate', v: `${engRate}%` },
    { l: 'Follower growth', v: compact(stats.totals.followers) },
    { l: 'Pieces measured', v: String(perf.length) },
  ]
  perfKpis.forEach(({ l, v }, i) => {
    const bg = i % 2 === 0 ? WHITE : LIGHT
    doc.setFillColor(bg)
    doc.rect(perfX, perfY, halfW, 18, 'F')
    doc.setTextColor(SLATE)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(l, perfX + 4, perfY + 12)
    doc.setTextColor(NAVY)
    doc.setFont('helvetica', 'bold')
    doc.text(v, perfX + halfW - 4, perfY + 12, { align: 'right' })
    perfY += 18
  })

  y = Math.max(pipeY, perfY) + 20
  y = ensureSpace(y, 200)
  y = sectionHeader('Top Performing Content', y)

  const tCols: { text: string; width: number; align?: 'left' | 'right'; color?: string }[] = [
    { text: 'Content Title', width: W - 260, color: SLATE },
    { text: 'Brand', width: 100, color: SLATE },
    { text: 'Platform', width: 70, color: SLATE },
    { text: 'Views', width: 50, align: 'right', color: SLATE },
    { text: 'Engagement', width: 40, align: 'right', color: SLATE },
  ]
  y = tableRow(tCols, y, '#E2E8F0')

  top.forEach((p, i) => {
    y = ensureSpace(y, 18)
    const eng = p.likes + p.comments + p.shares + p.saves
    y = tableRow(
      [
        { text: p.title.slice(0, 55) + (p.title.length > 55 ? '…' : ''), width: W - 260, bold: true },
        { text: p.brand_name, width: 100, color: SLATE },
        { text: p.platform, width: 70, color: SLATE },
        { text: num(p.views), width: 50, align: 'right', bold: true },
        { text: num(eng), width: 40, align: 'right', color: SLATE },
      ],
      y,
      i % 2 === 0 ? WHITE : LIGHT
    )
  })

  const footY = pageH - 36
  doc.setFillColor(NAVY)
  doc.rect(0, footY, pageW, 36, 'F')
  doc.setTextColor(GOLD)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(
    `Galaxy Marketing Command Center  ·  ${monthName}  ·  Generated from live database`,
    pageW / 2,
    footY + 20,
    { align: 'center' }
  )

  doc.save(`galaxy-report-${month}.pdf`)
}
