import { describe, it, expect } from 'vitest'
import {
  normaliseKey, parseSheetDate, detectSheet, findHeader,
  parseStockMaster, parseImportLog, parseOutwards, unknownItems,
} from '../sheetImport'

/** Rows taken from the team's real exports, quirks and all. */
const STOCK = [
  ['Stock Summary', '', '', '08-08-2026', '', '', '', '', '', ''],
  ['Item Code', 'Category', 'Item Name', 'Closing Stock', 'Location', 'Opening Stock', 'Imported Qty', 'Issued Qty', 'Reorder Level', 'Stock Status'],
  ['1 T GREY', '1 T', '1 TOUCH GREY', '11', 'Rack 2', '2', '10', '1', '2', 'STOCK'],
  ['8 T', '8 T', '8 TOUCH GREY ', '15', 'Rack 2', '4', '11', '0', '3', 'STOCK'],
  ['8 T', '8 T', '8 TOUCH BLUE', '13', 'Rack 2', '2', '11', '0', '3', 'STOCK'],
  ['4T KNOB BLK Z', '4 T', '4 TOUCH + KNOB ZIG BLACK', '-3', 'Rack 2', '1', '0', '4', '0', 'Out of Stock'],
  ['6 T BLACK ', '6 T', '6 TOUCH BLACK ', '1', '', '1', '', '', '', ''],
  ['6 T BLACK ', '6 T', '6 Touch Black ', '1', '', '1', '0', '0', '', 'OK'],
  ['3 T BLACK ', '3 T', '', '1', '', '1', '', '', '', ''],
]

const IMPORT_LOG = [
  ['Inwards', '', '', '', '', '', '', '', ''],
  ['Date', 'Item Code', 'Recd By', 'Item Name', 'Category', 'Qty IN', 'Location ', 'Remarks', ''],
  ['25/07/26', '8 T', 'OFFICE', '8 TOUCH GREY ', '8 T', '5', 'DEMO BOARD', '', ''],
  ['', 'SKT + USB -C ', 'OFFICE', 'SINGLE SOCKET USB C ', 'SOCKET', '14', 'DEMO BOARD', '', ''],
  ['', '4T ', 'OFFICE', '', '', '16', 'DEMO BOARD', '', ''],
  ['29/07/26', 'Socket', 'office ', 'Socket', 'SOCKET', '10', 'DEMO BOARD', '', 'Rose gold '],
  ['', '3 T', '', '', '', '', '', '', ''],
]

const OUTWARDS = [
  ['   ', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Date', 'Customer', 'Item Code', 'Item Name', 'Category', 'Qty Issued', 'Unit', 'Site/Project', 'Carrier', 'Status', 'Chl/ Invoice no.', 'Purpose ', 'Remarks'],
  ['23/06/26', 'RAJ SHAH', '8 T', '8 TOUCH GREY ', '8 T', '2', '', '', 'Rapido', 'Issued', '', 'Demo', ''],
  ['16/07/26', 'SANJAY THANE ', '1 T GREY', '1 TOUCH GREY', '1 T', '1', '', '', 'Dheeraj', 'Issued', '', 'Demo', ''],
  ['', 'Name', '', '', '', '', '', '', 'Rapido', '', '', 'Demo', ''],
  ['06/-8/26', 'PRDHAN ', '4 T GREY', '4 TOUCH GREY', '4 T', '1', '', '', 'Rapido', 'Issued', '', 'Demo', ''],
  ['', '', '', '', '', '', '', '', 'Rapido', '', '', '', ''],
]

describe('normaliseKey', () => {
  it('makes one key out of every spelling of a name', () => {
    expect(normaliseKey('6 TOUCH BLACK ')).toBe(normaliseKey('6 Touch Black'))
    expect(normaliseKey('4 TOUCH + KNOB ZIG BLACK')).toBe('4 TOUCH KNOB ZIG BLACK')
  })
})

describe('parseSheetDate', () => {
  it('reads the hand-typed day-first formats', () => {
    expect(parseSheetDate('13/6/26')).toBe('2026-06-13')
    expect(parseSheetDate('19/06/26')).toBe('2026-06-19')
    expect(parseSheetDate('08/06/2026')).toBe('2026-06-08')
  })

  it('survives the stray dash in "06/-8/26"', () => {
    expect(parseSheetDate('06/-8/26')).toBe('2026-08-06')
  })

  it('takes a Sheets-converted ISO date at face value', () => {
    expect(parseSheetDate('2026-01-07')).toBe('2026-01-07')
  })

  it('returns empty rather than a wrong date', () => {
    expect(parseSheetDate('')).toBe('')
    expect(parseSheetDate('45/13/26')).toBe('')
    expect(parseSheetDate('sometime')).toBe('')
  })
})

describe('detectSheet / findHeader', () => {
  it('recognises each sheet under its title row', () => {
    expect(findHeader(STOCK)).toEqual({ index: 1, kind: 'stock' })
    expect(findHeader(IMPORT_LOG)).toEqual({ index: 1, kind: 'import' })
    expect(findHeader(OUTWARDS)).toEqual({ index: 1, kind: 'outward' })
  })

  it('says nothing rather than guessing at an unknown file', () => {
    expect(detectSheet(['Name', 'Phone', 'Email'])).toBeNull()
    expect(findHeader([['a', 'b'], ['c', 'd']])).toBeNull()
  })
})

describe('parseStockMaster', () => {
  const res = parseStockMaster(STOCK, 1)

  it('keeps products that share an item code apart', () => {
    // "8 T" is five different products in this sheet; the name is the identity.
    const eights = res.rows.filter(r => r.itemCode === '8 T')
    expect(eights.map(r => r.itemName.trim())).toEqual(['8 TOUCH GREY', '8 TOUCH BLUE'])
  })

  it('merges two spellings of one product instead of losing a row', () => {
    const black = res.rows.filter(r => r.key === normaliseKey('6 TOUCH BLACK'))
    expect(black).toHaveLength(1)
    expect(black[0].opening).toBe(2)
    expect(res.warnings.some(w => w.includes('appears twice'))).toBe(true)
  })

  it('skips a row with no item name and says so', () => {
    expect(res.rows.some(r => r.itemCode === '3 T BLACK')).toBe(false)
    expect(res.warnings.some(w => w.includes('no item name'))).toBe(true)
  })

  it('carries the quantities across', () => {
    const one = res.rows.find(r => r.key === normaliseKey('1 TOUCH GREY'))!
    expect(one).toMatchObject({ opening: 2, imported: 10, issued: 1, reorder: 2, location: 'Rack 2' })
    // Closing is not read from the sheet — it is opening + imported − issued.
    expect(one.opening + one.imported - one.issued).toBe(11)
  })

  it('flags an item that works out negative', () => {
    expect(res.warnings.some(w => w.includes('more issued than received'))).toBe(true)
  })
})

describe('parseImportLog', () => {
  const res = parseImportLog(IMPORT_LOG, 1)

  it('carries a blank date down from the row above', () => {
    expect(res.rows.map(r => r.date)).toEqual(['2026-07-25', '2026-07-25', '2026-07-29'])
  })

  it('reads quantity, receiver, location and remarks', () => {
    expect(res.rows[2]).toMatchObject({
      kind: 'received', itemName: 'Socket', qty: 10,
      party: 'office', location: 'DEMO BOARD', remarks: 'Rose gold',
    })
  })

  it('skips the code-only placeholder rows', () => {
    expect(res.rows).toHaveLength(3)
    expect(res.skipped).toBe(2)
    expect(res.warnings.some(w => w.includes('no item name'))).toBe(true)
  })
})

describe('parseOutwards', () => {
  const res = parseOutwards(OUTWARDS, 1)

  it('ignores the blank template filler rows', () => {
    expect(res.rows).toHaveLength(3)
    expect(res.rows.every(r => r.qty > 0)).toBe(true)
  })

  it('keeps customer, carrier, status and purpose', () => {
    expect(res.rows[0]).toMatchObject({
      kind: 'sent', date: '2026-06-23', itemName: '8 TOUCH GREY', qty: 2,
      party: 'RAJ SHAH', carrier: 'Rapido', status: 'Issued', purpose: 'Demo',
    })
  })

  it('recovers the mistyped date', () => {
    expect(res.rows[2].date).toBe('2026-08-06')
  })

  it('gives every row a fingerprint, so a second upload changes nothing', () => {
    const again = parseOutwards(OUTWARDS, 1)
    expect(again.rows.map(r => r.fingerprint)).toEqual(res.rows.map(r => r.fingerprint))
    expect(new Set(res.rows.map(r => r.fingerprint)).size).toBe(res.rows.length)
  })
})

describe('unknownItems', () => {
  it('names movements with no matching product', () => {
    const items = parseStockMaster(STOCK, 1).rows
    const moves = parseOutwards(OUTWARDS, 1).rows
    // 4 TOUCH GREY is dispatched but absent from this cut of Stock_Master.
    expect(unknownItems(moves, items)).toContain('4 TOUCH GREY')
    expect(unknownItems(moves, items)).not.toContain('1 TOUCH GREY')
  })
})
