/**
 * Minimal RFC-4180 CSV reader — quoted fields, escaped quotes, CRLF or LF.
 *
 * Lives here rather than beside one importer because both the CRM's own
 * template import and the Google Sheet import read the same files, and a
 * second copy of quote handling is a second place for it to be subtly wrong.
 *
 * Rows where every field is empty are dropped: spreadsheet exports are full of
 * them and no caller has ever wanted one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some(v => v !== '')) rows.push(row)
  }
  return rows
}
