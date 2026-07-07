import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { Timestamp } from 'firebase/firestore'
import type { LeadStatus, QuotationStatus, ProjectStatus, MilestoneStatus, InvoiceStatus, UserRole, RiskLevel } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date Formatting ───────────────────────────────────────────────────────────

export function toDate(value: Timestamp | Date | string | undefined | null): Date | null {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  const d = new Date(value as string)
  return isNaN(d.getTime()) ? null : d
}

export function formatDate(value: Timestamp | Date | string | undefined | null, fmt = 'dd MMM yyyy'): string {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, fmt)
}

export function formatDateTime(value: Timestamp | Date | string | undefined | null): string {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, 'dd MMM yyyy, hh:mm a')
}

export function formatRelative(value: Timestamp | Date | string | undefined | null): string {
  const d = toDate(value)
  if (!d) return '—'
  if (isToday(d)) return `Today ${format(d, 'hh:mm a')}`
  if (isYesterday(d)) return `Yesterday ${format(d, 'hh:mm a')}`
  return formatDistanceToNow(d, { addSuffix: true })
}

// ─── Currency ──────────────────────────────────────────────────────────────────

export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 10_00_000) return `₹${(amount / 10_00_000).toFixed(1)}L`
  if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`
  return `₹${amount}`
}

// ─── Status Labels & Colors ────────────────────────────────────────────────────

export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  new:         { label: 'New',           color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  contacted:   { label: 'Contacted',     color: 'text-cyan-400',   bg: 'bg-cyan-900/30' },
  qualified:   { label: 'Qualified',     color: 'text-indigo-400', bg: 'bg-indigo-900/30' },
  floor_plan:  { label: 'Floor Plan',    color: 'text-violet-400', bg: 'bg-violet-900/30' },
  quote_sent:  { label: 'Quote Sent',    color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  won:         { label: 'Confirm',        color: 'text-green-400',  bg: 'bg-green-900/30' },
  lost:        { label: 'Not Required',  color: 'text-red-400',    bg: 'bg-red-900/30' },
}

export const QUOTATION_STATUS_CONFIG: Record<QuotationStatus, { label: string; color: string; bg: string }> = {
  draft:               { label: 'Draft',              color: 'text-gray-400',   bg: 'bg-gray-800' },
  pending_approval:    { label: 'Pending Approval',   color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  approved:            { label: 'Approved',           color: 'text-green-400',  bg: 'bg-green-900/30' },
  management_approved: { label: 'Mgmt Approved',      color: 'text-green-400',  bg: 'bg-green-900/30' },
  sent_to_customer:    { label: 'Sent to Customer',   color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  customer_approved:   { label: 'Customer Approved',  color: 'text-emerald-400',bg: 'bg-emerald-900/30' },
  rejected:            { label: 'Rejected',           color: 'text-red-400',    bg: 'bg-red-900/30' },
  revision_required:   { label: 'Revision Required',  color: 'text-orange-400', bg: 'bg-orange-900/30' },
}

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bg: string }> = {
  planning:    { label: 'Planning',     color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  in_progress: { label: 'In Progress',  color: 'text-indigo-400', bg: 'bg-indigo-900/30' },
  on_hold:     { label: 'On Hold',      color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  completed:   { label: 'Completed',    color: 'text-green-400',  bg: 'bg-green-900/30' },
  cancelled:   { label: 'Cancelled',    color: 'text-red-400',    bg: 'bg-red-900/30' },
}

export const MILESTONE_STATUS_CONFIG: Record<MilestoneStatus, { label: string; color: string; dot: string }> = {
  pending:     { label: 'Pending',     color: 'text-gray-400',   dot: 'bg-gray-500' },
  in_progress: { label: 'In Progress', color: 'text-indigo-400', dot: 'bg-indigo-500' },
  completed:   { label: 'Completed',   color: 'text-green-400',  dot: 'bg-green-500' },
  overdue:     { label: 'Overdue',     color: 'text-red-400',    dot: 'bg-red-500' },
}

export const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:           { label: 'Draft',            color: 'text-gray-400',    bg: 'bg-gray-800' },
  sent:            { label: 'Sent',             color: 'text-blue-400',    bg: 'bg-blue-900/30' },
  partially_paid:  { label: 'Partially Paid',   color: 'text-yellow-400',  bg: 'bg-yellow-900/30' },
  paid:            { label: 'Paid',             color: 'text-green-400',   bg: 'bg-green-900/30' },
  overdue:         { label: 'Overdue',          color: 'text-red-400',     bg: 'bg-red-900/30' },
}

export const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; dot: string }> = {
  low:    { label: 'Low Risk',    color: 'text-green-400',  dot: 'bg-green-500' },
  medium: { label: 'Medium Risk', color: 'text-yellow-400', dot: 'bg-yellow-500' },
  high:   { label: 'High Risk',   color: 'text-red-400',    dot: 'bg-red-500' },
}

// ─── AI Score Color ────────────────────────────────────────────────────────────

export function getScoreColor(score: number): string {
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  if (score >= 25) return 'text-orange-400'
  return 'text-red-400'
}

export function getScoreBg(score: number): string {
  if (score >= 75) return 'bg-green-900/30'
  if (score >= 50) return 'bg-yellow-900/30'
  if (score >= 25) return 'bg-orange-900/30'
  return 'bg-red-900/30'
}

// ─── Role Labels ───────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:     'Super Admin',
  management:      'Management',
  dept_head:       'Department Head',
  bd_exec:         'BD Executive',
  project_manager: 'Project Manager',
  marketing:       'Marketing',
  ai_team:         'AI Team',
  pending:         'Pending Approval',
}

// ─── Permissions ───────────────────────────────────────────────────────────────

export function canAccess(role: UserRole, module: string): boolean {
  const fullAccess: UserRole[] = ['super_admin', 'management', 'ai_team']
  if (fullAccess.includes(role)) return true

  const moduleAccess: Record<string, UserRole[]> = {
    // BD only
    leads:           ['bd_exec', 'dept_head'],
    'b2b-campaign':  ['bd_exec', 'dept_head'],
    partners:        ['bd_exec', 'dept_head'],
    'follow-ups':    ['bd_exec', 'dept_head'],
    // PM only
    customers:       ['project_manager', 'dept_head', 'bd_exec'],
    quotations:      ['project_manager', 'dept_head'],
    projects:        ['project_manager', 'dept_head'],
    // Everyone
    'daily-reports': ['bd_exec', 'project_manager', 'marketing', 'dept_head'],
    notifications:   ['bd_exec', 'project_manager', 'marketing', 'dept_head'],
    // Role-specific
    'content-studio':['marketing'],
    inventory:       ['dept_head', 'project_manager'],
    settings:        [],  // super_admin & ai_team only (handled by fullAccess above)
  }

  return moduleAccess[module]?.includes(role) ?? false
}

export function canManageLeads(role: UserRole): boolean {
  return ['super_admin', 'management', 'dept_head', 'bd_exec'].includes(role)
}

export function canManageProjects(role: UserRole): boolean {
  return ['super_admin', 'management', 'dept_head', 'project_manager'].includes(role)
}

export function canApprove(role: UserRole): boolean {
  return ['super_admin', 'management'].includes(role)
}

// ─── Misc Helpers ──────────────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}

export function generateInvoiceCode(seq: number): string {
  return `GHA-INV-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`
}

export function getMonthKey(value: Timestamp | Date | string | undefined | null): string {
  const d = toDate(value)
  if (!d) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthLabel(value: Timestamp | Date | string | undefined | null): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

const SOURCE_SCORE: Record<string, number> = {
  referral:   25,
  partner:    20,
  google_ads: 15,
  linkedin:   12,
  meta_ads:   10,
  instagram:  10,
  facebook:   10,
  justdial:    7,
  indiamart:   7,
  cold_call:   3,
  other:       0,
}

export function calculateLeadScore(lead: Partial<{
  source: string
  estimatedBudget: number
  floorPlanUrl: string
  activities: unknown[]
}>): number {
  let score = 30 // base

  score += SOURCE_SCORE[lead.source ?? 'other'] ?? 0

  if (lead.estimatedBudget && lead.estimatedBudget >= 500000) score += 25
  else if (lead.estimatedBudget && lead.estimatedBudget >= 200000) score += 12
  else if (lead.estimatedBudget && lead.estimatedBudget >= 100000) score += 6

  if (lead.floorPlanUrl) score += 20

  return Math.min(100, score)
}
