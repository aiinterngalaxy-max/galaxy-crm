/**
 * Builds the Invoice and Packing List PDFs for the Accounts document pipeline.
 *
 * jsPDF + jspdf-autotable rather than the HTML+window.print() pattern Topz
 * quotations use: the app needs the actual PDF *bytes* afterward, to upload
 * the generated document to Drive and keep a real, restorable file — a print
 * dialog only produces something the browser saves, with no bytes JS can get
 * hold of.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CompanyProfile, ExtractedInvoiceData } from '../types'

const PAGE_MARGIN = 14

function fmtCurrency(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function drawLetterhead(doc: jsPDF, title: string, profile: CompanyProfile, invoiceNumber: string, date: string) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(profile.name || 'Company name not set', PAGE_MARGIN, 20)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const addressLines = doc.splitTextToSize(profile.address || 'Address not set', 100)
  doc.text(addressLines, PAGE_MARGIN, 27)
  let y = 27 + addressLines.length * 4.2
  if (profile.gstin) { doc.text(`GSTIN: ${profile.gstin}`, PAGE_MARGIN, y); y += 4.5 }
  if (profile.phone) { doc.text(`Phone: ${profile.phone}`, PAGE_MARGIN, y); y += 4.5 }
  if (profile.email) { doc.text(`Email: ${profile.email}`, PAGE_MARGIN, y); y += 4.5 }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, 196, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`No: ${invoiceNumber}`, 196, 27, { align: 'right' })
  doc.text(`Date: ${date}`, 196, 32, { align: 'right' })

  return Math.max(y, 40)
}

function drawBuyerBlock(doc: jsPDF, startY: number, data: ExtractedInvoiceData): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Bill To', PAGE_MARGIN, startY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let y = startY + 5
  doc.text(data.buyerName || 'Buyer name not provided', PAGE_MARGIN, y)
  y += 4.5
  if (data.buyerAddress) {
    const lines = doc.splitTextToSize(data.buyerAddress, 100)
    doc.text(lines, PAGE_MARGIN, y)
    y += lines.length * 4.2
  }
  if (data.buyerGstin) { doc.text(`GSTIN: ${data.buyerGstin}`, PAGE_MARGIN, y); y += 4.5 }
  if (data.buyerContact) { doc.text(`Contact: ${data.buyerContact}`, PAGE_MARGIN, y); y += 4.5 }

  return y + 4
}

export function buildInvoicePdf(profile: CompanyProfile, data: ExtractedInvoiceData, invoiceNumber: string): Blob {
  const doc = new jsPDF()
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const afterLetterhead = drawLetterhead(doc, 'TAX INVOICE', profile, invoiceNumber, date)
  const afterBuyer = drawBuyerBlock(doc, afterLetterhead + 6, data)

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.description + (it.model ? `\n${it.model}` : ''),
    it.hsnCode || '—',
    String(it.quantity),
    fmtCurrency(it.unitPrice),
    fmtCurrency(it.quantity * it.unitPrice),
  ])

  autoTable(doc, {
    startY: afterBuyer,
    head: [['#', 'Description', 'HSN Code', 'Qty', 'Unit Price', 'Amount']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [31, 41, 55], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
  })

  const total = data.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
  // @ts-expect-error lastAutoTable is attached by the plugin at runtime, not in its type defs
  const afterTable = (doc.lastAutoTable?.finalY ?? afterBuyer + 20) + 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Total: ${fmtCurrency(total)}`, 196, afterTable, { align: 'right' })

  if (data.notes) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Notes:', PAGE_MARGIN, afterTable + 10)
    const noteLines = doc.splitTextToSize(data.notes, 180)
    doc.text(noteLines, PAGE_MARGIN, afterTable + 15)
  }

  return doc.output('blob')
}

/**
 * Weight and package count are physical facts about the shipment that no
 * source document text can supply — the columns exist to be filled in by
 * whoever actually packs the boxes, not extracted or guessed.
 */
export function buildPackingListPdf(profile: CompanyProfile, data: ExtractedInvoiceData, invoiceNumber: string): Blob {
  const doc = new jsPDF()
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const afterLetterhead = drawLetterhead(doc, 'PACKING LIST', profile, invoiceNumber, date)
  const afterBuyer = drawBuyerBlock(doc, afterLetterhead + 6, data)

  const rows = data.items.map((it, i) => [
    String(i + 1),
    it.description + (it.model ? `\n${it.model}` : ''),
    String(it.quantity),
    '', // Net Weight — filled in by hand
    '', // Gross Weight — filled in by hand
  ])

  autoTable(doc, {
    startY: afterBuyer,
    head: [['#', 'Description', 'Qty', 'Net Wt. (kg)', 'Gross Wt. (kg)']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [31, 41, 55], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 30, halign: 'center' },
      4: { cellWidth: 30, halign: 'center' },
    },
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
  })

  // @ts-expect-error lastAutoTable is attached by the plugin at runtime
  const afterTable = (doc.lastAutoTable?.finalY ?? afterBuyer + 20) + 8
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('Weights to be filled in at the time of packing.', PAGE_MARGIN, afterTable)

  return doc.output('blob')
}
