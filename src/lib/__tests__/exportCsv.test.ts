import { describe, it, expect } from 'vitest'
import { toCsv, datedFilename } from '../exportCsv'

describe('toCsv', () => {
  it('quotes every field so separators cannot shift columns', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('"a","b"\r\n"1","2"')
  })

  it('keeps a comma inside a value from splitting the row', () => {
    const csv = toCsv(['Name', 'Note'], [['Shah, Riya', 'called, no answer']])
    expect(csv).toContain('"Shah, Riya","called, no answer"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('doubles embedded quotes', () => {
    expect(toCsv(['Note'], [['he said "yes"']])).toContain('"he said ""yes"""')
  })

  it('survives a newline inside a value', () => {
    const csv = toCsv(['Note'], [['line one\nline two']])
    expect(csv).toContain('"line one\nline two"')
  })

  it('renders null and undefined as empty, not the words', () => {
    const csv = toCsv(['a', 'b', 'c'], [[null, undefined, 0]])
    expect(csv).toBe('"a","b","c"\r\n"","","0"')
    expect(csv).not.toContain('null')
    expect(csv).not.toContain('undefined')
  })

  it('handles no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('"a","b"')
  })
})

describe('datedFilename', () => {
  it('builds a zero-padded dated name', () => {
    expect(datedFilename('quotes')).toMatch(/^quotes-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('honours a custom extension', () => {
    expect(datedFilename('leads', 'txt')).toMatch(/\.txt$/)
  })
})
