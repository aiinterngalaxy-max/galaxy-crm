import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  toDate,
  formatDate,
  formatDateTime,
  formatRelative,
  getMonthKey,
  getMonthLabel,
  getScoreBg,
  canManageLeads,
  canManageProjects,
  canApprove,
  generateInvoiceCode,
} from '../utils'
import type { UserRole } from '../../types'

// ─── toDate ───────────────────────────────────────────────────────────────────

describe('toDate', () => {
  it('returns null for null', () => {
    expect(toDate(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(toDate(undefined)).toBeNull()
  })

  it('returns null for invalid date string', () => {
    expect(toDate('not-a-date')).toBeNull()
  })

  it('returns null for invalid Date object', () => {
    expect(toDate(new Date('invalid'))).toBeNull()
  })

  it('converts a valid ISO string to Date', () => {
    const d = toDate('2026-07-03T10:00:00.000Z')
    expect(d).toBeInstanceOf(Date)
    expect(d!.getUTCFullYear()).toBe(2026)
  })

  it('returns the same Date object for a valid Date', () => {
    const input = new Date('2026-01-15')
    const result = toDate(input)
    expect(result).toBeInstanceOf(Date)
    expect(result!.getTime()).toBe(input.getTime())
  })

  it('converts a Firestore Timestamp', () => {
    const ts = Timestamp.fromDate(new Date('2026-03-20'))
    const result = toDate(ts)
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCFullYear()).toBe(2026)
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('returns — for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns — for undefined', () => {
    expect(formatDate(undefined)).toBe('—')
  })

  it('formats a valid date string', () => {
    const result = formatDate('2026-07-03')
    expect(result).toContain('2026')
    expect(result).toContain('Jul')
  })

  it('accepts a custom format', () => {
    const result = formatDate('2026-01-05', 'yyyy/MM/dd')
    expect(result).toBe('2026/01/05')
  })
})

// ─── formatDateTime ───────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('returns — for null', () => {
    expect(formatDateTime(null)).toBe('—')
  })

  it('includes year, month, and time in output', () => {
    const result = formatDateTime('2026-07-03T09:30:00')
    expect(result).toContain('2026')
    expect(result).toContain('Jul')
  })
})

// ─── formatRelative ───────────────────────────────────────────────────────────

describe('formatRelative', () => {
  it('returns — for null', () => {
    expect(formatRelative(null)).toBe('—')
  })

  it('returns "Today ..." for todays date', () => {
    const now = new Date()
    expect(formatRelative(now)).toMatch(/^Today/)
  })

  it('returns "Yesterday ..." for yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(formatRelative(yesterday)).toMatch(/^Yesterday/)
  })

  it('returns relative string for old dates', () => {
    const old = new Date('2024-01-01')
    const result = formatRelative(old)
    expect(result).toContain('ago')
  })
})

// ─── getMonthKey ──────────────────────────────────────────────────────────────

describe('getMonthKey', () => {
  it('returns "unknown" for null', () => {
    expect(getMonthKey(null)).toBe('unknown')
  })

  it('returns "unknown" for undefined', () => {
    expect(getMonthKey(undefined)).toBe('unknown')
  })

  it('returns YYYY-MM format for a valid date', () => {
    expect(getMonthKey('2026-07-03')).toBe('2026-07')
  })

  it('zero-pads single digit months', () => {
    expect(getMonthKey('2026-03-15')).toBe('2026-03')
  })

  it('works with a Firestore Timestamp', () => {
    const ts = Timestamp.fromDate(new Date('2026-11-20'))
    expect(getMonthKey(ts)).toBe('2026-11')
  })
})

// ─── getMonthLabel ────────────────────────────────────────────────────────────

describe('getMonthLabel', () => {
  it('returns — for null', () => {
    expect(getMonthLabel(null)).toBe('—')
  })

  it('contains the month name and year', () => {
    const result = getMonthLabel('2026-07-03')
    expect(result).toContain('2026')
    expect(result.toLowerCase()).toContain('july')
  })
})

// ─── getScoreBg ───────────────────────────────────────────────────────────────

describe('getScoreBg', () => {
  it('green bg for 75+', () => {
    expect(getScoreBg(75)).toBe('bg-green-900/30')
    expect(getScoreBg(100)).toBe('bg-green-900/30')
  })

  it('yellow bg for 50-74', () => {
    expect(getScoreBg(50)).toBe('bg-yellow-900/30')
    expect(getScoreBg(74)).toBe('bg-yellow-900/30')
  })

  it('orange bg for 25-49', () => {
    expect(getScoreBg(25)).toBe('bg-orange-900/30')
  })

  it('red bg for below 25', () => {
    expect(getScoreBg(0)).toBe('bg-red-900/30')
    expect(getScoreBg(24)).toBe('bg-red-900/30')
  })
})

// ─── canManageLeads / canManageProjects / canApprove ─────────────────────────

describe('canManageLeads', () => {
  const yes: UserRole[] = ['super_admin', 'management', 'dept_head', 'bd_exec']
  const no: UserRole[] = ['project_manager', 'marketing', 'ai_team', 'pending']

  yes.forEach(r => it(`${r} can manage leads`, () => expect(canManageLeads(r)).toBe(true)))
  no.forEach(r => it(`${r} cannot manage leads`, () => expect(canManageLeads(r)).toBe(false)))
})

describe('canManageProjects', () => {
  const yes: UserRole[] = ['super_admin', 'management', 'dept_head', 'project_manager']
  const no: UserRole[] = ['bd_exec', 'marketing', 'ai_team', 'pending']

  yes.forEach(r => it(`${r} can manage projects`, () => expect(canManageProjects(r)).toBe(true)))
  no.forEach(r => it(`${r} cannot manage projects`, () => expect(canManageProjects(r)).toBe(false)))
})

describe('canApprove', () => {
  it('super_admin can approve', () => expect(canApprove('super_admin')).toBe(true))
  it('management can approve', () => expect(canApprove('management')).toBe(true))
  it('dept_head cannot approve', () => expect(canApprove('dept_head')).toBe(false))
  it('bd_exec cannot approve', () => expect(canApprove('bd_exec')).toBe(false))
})

// ─── generateInvoiceCode ──────────────────────────────────────────────────────

describe('generateInvoiceCode', () => {
  it('starts with GHA-INV', () => {
    expect(generateInvoiceCode(1)).toMatch(/^GHA-INV-/)
  })

  it('contains the current year', () => {
    const year = new Date().getFullYear()
    expect(generateInvoiceCode(1)).toContain(String(year))
  })

  it('zero-pads sequence to 3 digits', () => {
    expect(generateInvoiceCode(1)).toMatch(/001$/)
    expect(generateInvoiceCode(42)).toMatch(/042$/)
  })

  it('handles 3-digit sequences without padding', () => {
    expect(generateInvoiceCode(100)).toMatch(/100$/)
  })
})
