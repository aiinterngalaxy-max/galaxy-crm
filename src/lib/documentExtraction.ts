/**
 * Turns an uploaded source document (PDF, Excel, CSV, Word, or an image) into
 * structured invoice data: buyer info and a line-item table.
 *
 * Two stages, kept separate so a failure in one doesn't look like the other:
 *   1. extractRawText  — get *something* readable out of the file, by format.
 *   2. extractStructuredInvoiceData — ask the AI to turn that text into JSON.
 *
 * Every parsing library here is dynamically imported. None of them are needed
 * by most pages in the app, so a static import would ship xlsx/mammoth/pdfjs/
 * tesseract to everyone rather than only the accountant who clicks Extract.
 */
import { callClaude } from './ai'
import type { ExtractedInvoiceData, ExtractedLineItem } from '../types'

export class ExtractionError extends Error {}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Stage 1: raw text, by format ──────────────────────────────────────────────

async function extractFromPdf(blob: Blob): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

  const buf = await blob.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise

  let text = ''
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    text += content.items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n'
  }

  // Near-empty text on a real page count means the PDF is scanned images, not
  // real text — fall back to OCR on each page rather than handing the AI 40
  // characters and calling it done.
  const charsPerPage = text.trim().length / Math.max(pdf.numPages, 1)
  if (charsPerPage > 20) return text

  const { default: Tesseract } = await import('tesseract.js')
  let ocrText = ''
  const maxOcrPages = Math.min(pdf.numPages, 15) // a runaway scan job is worse than an incomplete one
  for (let n = 1; n <= maxOcrPages; n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const { data } = await Tesseract.recognize(canvas, 'eng')
    ocrText += data.text + '\n'
    canvas.width = 0
    canvas.height = 0
  }
  return ocrText
}

async function extractFromExcel(blob: Blob): Promise<string> {
  const XLSX = await import('xlsx')
  const buf = await blob.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  return wb.SheetNames.map(name => {
    const sheet = wb.Sheets[name];
    return `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(sheet)}`
  }).join('\n\n')
}

async function extractFromCsv(blob: Blob): Promise<string> {
  return blob.text()
}

async function extractFromDocx(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth')
  const buf = await blob.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value
}

async function extractFromImage(blob: Blob): Promise<string> {
  const { default: Tesseract } = await import('tesseract.js')
  const { data } = await Tesseract.recognize(blob, 'eng')
  return data.text
}

export async function extractRawText(blob: Blob, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''

  if (mimeType.includes('pdf') || ext === 'pdf') return extractFromPdf(blob)
  if (mimeType.includes('sheet') || mimeType.includes('excel') || ['xlsx', 'xls'].includes(ext))
    return extractFromExcel(blob)
  if (mimeType === 'text/csv' || ext === 'csv') return extractFromCsv(blob)
  if (mimeType.includes('word') || ['doc', 'docx'].includes(ext)) return extractFromDocx(blob)
  if (mimeType.startsWith('image/')) return extractFromImage(blob)
  if (mimeType.startsWith('text/') || ext === 'txt') return blob.text()

  throw new ExtractionError(
    `"${fileName}" is a format this can't read automatically yet. Enter the details manually in Review below.`,
  )
}

// ─── Stage 2: raw text -> structured invoice data ──────────────────────────────

function cleanJsonReply(raw: string): string {
  return raw.replace(/```json|```/g, '').trim()
}

export async function extractStructuredInvoiceData(rawText: string): Promise<ExtractedInvoiceData> {
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new ExtractionError('No readable text came out of that file — enter the details manually below.')
  }

  // A very long source (e.g. a big spreadsheet) is truncated rather than sent
  // whole — the model has a context limit, and a truncated-but-answered call
  // is more useful than one that fails outright on an oversized prompt.
  const MAX_CHARS = 24000
  const source = trimmed.length > MAX_CHARS ? trimmed.slice(0, MAX_CHARS) + '\n[...truncated...]' : trimmed

  const prompt = `The text below was extracted from a customer's quotation, product list, or order document. Pull out the buyer's details and every line item so an invoice can be generated from them.

SOURCE TEXT:
${source}

Return this exact JSON and nothing else:
{"buyerName":"","buyerAddress":"","buyerGstin":"","buyerContact":"","items":[{"description":"","model":"","hsnCode":"","quantity":0,"unitPrice":0}],"notes":""}

Where:
- buyerName/buyerAddress/buyerGstin/buyerContact: the customer's own details, if present. Leave a field empty rather than guessing.
- items: one entry per distinct product or service line. description is required for every item.
- hsnCode: only if the source text states one explicitly. Never invent an HSN code — leave it "" if it is not present in the source.
- quantity/unitPrice: plain numbers, no currency symbols or commas. If a price is not stated, use 0 rather than guessing.
- notes: anything else worth carrying over (payment terms, delivery notes) that doesn't fit the fields above.`

  const raw = await callClaude(
    prompt,
    'You are an expert at reading business documents and extracting structured data. Never invent values that are not present in the source text — leave a field empty instead. Return ONLY a JSON object with no surrounding text or markdown.',
    3000,
  )

  let parsed: {
    buyerName?: string; buyerAddress?: string; buyerGstin?: string; buyerContact?: string
    items?: Array<{ description?: string; model?: string; hsnCode?: string; quantity?: number; unitPrice?: number }>
    notes?: string
  }
  try {
    parsed = JSON.parse(cleanJsonReply(raw))
  } catch {
    throw new ExtractionError('The AI reply was not valid data — please try again, or enter the details manually.')
  }

  const items: ExtractedLineItem[] = (parsed.items ?? [])
    .filter(it => it.description?.trim())
    .map(it => ({
      id: uid(),
      description: it.description!.trim(),
      model: it.model?.trim() || undefined,
      hsnCode: it.hsnCode?.trim() || undefined,
      quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1,
      unitPrice: typeof it.unitPrice === 'number' && it.unitPrice >= 0 ? it.unitPrice : 0,
    }))

  return {
    buyerName: parsed.buyerName?.trim() || undefined,
    buyerAddress: parsed.buyerAddress?.trim() || undefined,
    buyerGstin: parsed.buyerGstin?.trim() || undefined,
    buyerContact: parsed.buyerContact?.trim() || undefined,
    items,
    notes: parsed.notes?.trim() || undefined,
  }
}
