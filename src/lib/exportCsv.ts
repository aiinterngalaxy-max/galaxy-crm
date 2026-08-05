/**
 * Minimal CSV export.
 *
 * Values are quoted and internal quotes doubled, per RFC 4180 — lead names and
 * notes routinely contain commas, quotes and newlines, any of which would
 * otherwise shift every following column.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    // Empty values are quoted too, so every field is uniformly quoted.
    const s = v === null || v === undefined ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  return [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n')
}

/**
 * Triggers a download of `content` as `filename`.
 * A UTF-8 BOM is prepended so Excel renders non-ASCII names correctly instead of
 * mojibake — without it "Arunachalam" is fine but accented or Devanagari text is not.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** `quotes-2026-08-05.csv` */
export function datedFilename(prefix: string, ext = 'csv'): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`
}
