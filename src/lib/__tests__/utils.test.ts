import { describe, it, expect } from 'vitest'
import {
  calculateLeadScore,
  canAccess,
  formatCurrency,
  formatCurrencyShort,
  getScoreColor,
  getInitials,
  truncate,
} from '../utils'
import type { UserRole } from '../../types'

// ─── calculateLeadScore ────────────────────────────────────────────────────────

describe('calculateLeadScore', () => {
  it('returns base score of 30 for empty lead', () => {
    expect(calculateLeadScore({})).toBe(30)
  })

  it('adds source bonus — referral is highest (25)', () => {
    expect(calculateLeadScore({ source: 'referral' })).toBe(55)
  })

  it('adds source bonus — partner (20)', () => {
    expect(calculateLeadScore({ source: 'partner' })).toBe(50)
  })

  it('adds source bonus — cold_call is lowest (3)', () => {
    expect(calculateLeadScore({ source: 'cold_call' })).toBe(33)
  })

  it('unknown source adds 0', () => {
    expect(calculateLeadScore({ source: 'unknown_source' })).toBe(30)
  })

  it('adds 25 for budget >= 5L', () => {
    expect(calculateLeadScore({ estimatedBudget: 500000 })).toBe(55)
  })

  it('adds 12 for budget >= 2L', () => {
    expect(calculateLeadScore({ estimatedBudget: 200000 })).toBe(42)
  })

  it('adds 6 for budget >= 1L', () => {
    expect(calculateLeadScore({ estimatedBudget: 100000 })).toBe(36)
  })

  it('adds 0 for budget below 1L', () => {
    expect(calculateLeadScore({ estimatedBudget: 50000 })).toBe(30)
  })

  it('adds 20 for floor plan URL', () => {
    expect(calculateLeadScore({ floorPlanUrl: 'https://example.com/plan.jpg' })).toBe(50)
  })

  it('caps at 100 for a perfect lead', () => {
    const score = calculateLeadScore({
      source: 'referral',
      estimatedBudget: 1000000,
      floorPlanUrl: 'https://example.com/plan.jpg',
    })
    expect(score).toBe(100)
  })

  it('high-value referral with floor plan hits 100', () => {
    // base 30 + referral 25 + budget>=5L 25 + floorPlan 20 = 100
    expect(calculateLeadScore({ source: 'referral', estimatedBudget: 500000, floorPlanUrl: 'x' })).toBe(100)
  })
})

// ─── canAccess ────────────────────────────────────────────────────────────────

describe('canAccess', () => {
  const fullAccessRoles: UserRole[] = ['super_admin', 'management', 'ai_team']
  const modules = ['leads', 'partners', 'customers', 'quotations', 'projects',
    'daily-reports', 'notifications', 'content-studio', 'settings']

  fullAccessRoles.forEach(role => {
    it(`${role} can access every module`, () => {
      modules.forEach(mod => {
        expect(canAccess(role, mod)).toBe(true)
      })
    })
  })

  it('bd_exec can access leads and partners', () => {
    expect(canAccess('bd_exec', 'leads')).toBe(true)
    expect(canAccess('bd_exec', 'partners')).toBe(true)
  })

  it('bd_exec can access customers but not quotations', () => {
    expect(canAccess('bd_exec', 'customers')).toBe(true)
    expect(canAccess('bd_exec', 'quotations')).toBe(false)
  })

  it('project_manager can access customers, quotations, projects', () => {
    expect(canAccess('project_manager', 'customers')).toBe(true)
    expect(canAccess('project_manager', 'quotations')).toBe(true)
    expect(canAccess('project_manager', 'projects')).toBe(true)
  })

  it('project_manager cannot access leads', () => {
    expect(canAccess('project_manager', 'leads')).toBe(false)
  })

  it('marketing can only access content-studio (plus daily-reports and notifications)', () => {
    expect(canAccess('marketing', 'content-studio')).toBe(true)
    expect(canAccess('marketing', 'daily-reports')).toBe(true)
    expect(canAccess('marketing', 'notifications')).toBe(true)
    expect(canAccess('marketing', 'leads')).toBe(false)
    expect(canAccess('marketing', 'projects')).toBe(false)
  })

  it('settings is blocked for all non-fullAccess roles', () => {
    const restricted: UserRole[] = ['bd_exec', 'project_manager', 'marketing', 'dept_head']
    restricted.forEach(role => {
      expect(canAccess(role, 'settings')).toBe(false)
    })
  })

  it('bd_exec and dept_head can access follow-ups', () => {
    expect(canAccess('bd_exec', 'follow-ups')).toBe(true)
    expect(canAccess('dept_head', 'follow-ups')).toBe(true)
    expect(canAccess('marketing', 'follow-ups')).toBe(false)
    expect(canAccess('project_manager', 'follow-ups')).toBe(false)
  })

  it('super_admin and management can access inventory', () => {
    expect(canAccess('super_admin', 'inventory')).toBe(true)
    expect(canAccess('management', 'inventory')).toBe(true)
    expect(canAccess('bd_exec', 'inventory')).toBe(false)
  })

  it('returns false for unknown module', () => {
    expect(canAccess('bd_exec', 'nonexistent-module')).toBe(false)
  })

  it('pending role cannot access anything', () => {
    modules.forEach(mod => {
      expect(canAccess('pending', mod)).toBe(false)
    })
  })
})

// ─── formatCurrency ───────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('₹0')
  })

  it('formats null as ₹0', () => {
    expect(formatCurrency(null)).toBe('₹0')
  })

  it('formats undefined as ₹0', () => {
    expect(formatCurrency(undefined)).toBe('₹0')
  })

  it('formats a lakh amount', () => {
    const result = formatCurrency(100000)
    expect(result).toContain('₹')
    expect(result).toContain('1,00,000')
  })

  it('formats a large crore amount', () => {
    const result = formatCurrency(10000000)
    expect(result).toContain('₹')
    expect(result).toContain('1,00,00,000')
  })
})

describe('formatCurrencyShort', () => {
  it('shows K for thousands', () => {
    expect(formatCurrencyShort(50000)).toBe('₹50K')
  })

  it('shows L for lakhs', () => {
    expect(formatCurrencyShort(500000)).toBe('₹5.0L')
  })

  it('shows L for amounts >= 10L (divides by 10L)', () => {
    // 25 lakh = 2,500,000 → 2,500,000 / 1,000,000 = 2.5L
    expect(formatCurrencyShort(2500000)).toBe('₹2.5L')
  })

  it('shows raw for small values', () => {
    expect(formatCurrencyShort(500)).toBe('₹500')
  })
})

// ─── getScoreColor ────────────────────────────────────────────────────────────

describe('getScoreColor', () => {
  it('green for 75+', () => {
    expect(getScoreColor(75)).toBe('text-green-400')
    expect(getScoreColor(100)).toBe('text-green-400')
  })

  it('yellow for 50-74', () => {
    expect(getScoreColor(50)).toBe('text-yellow-400')
    expect(getScoreColor(74)).toBe('text-yellow-400')
  })

  it('orange for 25-49', () => {
    expect(getScoreColor(25)).toBe('text-orange-400')
    expect(getScoreColor(49)).toBe('text-orange-400')
  })

  it('red for below 25', () => {
    expect(getScoreColor(0)).toBe('text-red-400')
    expect(getScoreColor(24)).toBe('text-red-400')
  })
})

// ─── getInitials ──────────────────────────────────────────────────────────────

describe('getInitials', () => {
  it('returns two initials for full name', () => {
    expect(getInitials('Raj Sharma')).toBe('RS')
  })

  it('returns one initial for single name', () => {
    expect(getInitials('Raj')).toBe('R')
  })

  it('caps at two characters for long names', () => {
    expect(getInitials('Raj Kumar Sharma')).toBe('RK')
  })

  it('uppercases', () => {
    expect(getInitials('raj sharma')).toBe('RS')
  })
})

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
  })

  it('exact length is not truncated', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })
})
