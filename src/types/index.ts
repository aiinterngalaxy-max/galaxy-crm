import { Timestamp } from 'firebase/firestore'

// ─── Shared ────────────────────────────────────────────────────────────────────

// An uploaded quote/document (PDF etc.) attached to a lead or partner.
export interface QuoteDoc {
  name: string
  url: string
  uploadedAt: number      // epoch ms (stored as a plain number so it works inside arrays)
  uploadedByName?: string
}

// ─── Role System ───────────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'management'
  | 'dept_head'
  | 'bd_exec'
  | 'project_manager'
  | 'marketing'
  | 'ai_team'
  | 'hr'
  | 'galaxy'
  | 'topz'
  | 'pending'

export type Department =
  | 'management'
  | 'business_development'
  | 'project_management'
  | 'marketing'
  | 'ai_department'
  | 'hr'

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role: UserRole
  department: Department
  isActive: boolean
  avatarUrl?: string
  createdAt: Timestamp
  lastLoginAt?: Timestamp
}

// ─── Lead System ───────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'floor_plan'
  | 'quote_sent'
  | 'won'
  | 'lost'

export type LeadSource =
  | 'referral'
  | 'partner'
  | 'google_ads'
  | 'linkedin'
  | 'meta_ads'
  | 'instagram'
  | 'facebook'
  | 'justdial'
  | 'indiamart'
  | 'cold_call'
  | 'other'

export type LostReason =
  | 'price'
  | 'timeline'
  | 'competitor'
  | 'not_interested'
  | 'unresponsive'
  | 'budget'
  | 'other'

export interface Lead {
  id: string
  leadCode: string
  status: LeadStatus
  source: LeadSource
  name: string
  phone: string
  email?: string
  address?: string
  whatsapp?: string
  projectType?: string
  estimatedBudget?: number
  propertySize?: string
  assignedTo: string
  assignedToName?: string
  aiScore: number
  aiScoreNote?: string
  lostReason?: LostReason
  lostNote?: string
  businessType?: 'b2b' | 'b2c'
  partnerId?: string
  partnerName?: string
  convertedToCustomerId?: string
  floorPlanUrl?: string
  quoteDocuments?: QuoteDoc[]
  tier?: 'T1' | 'T2' | 'T3' | 'T4' | 'T5'
  demoGiven?: boolean
  notes?: string
  nextFollowUp?: Timestamp
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ActivityType =
  | 'call'
  | 'meeting'
  | 'note'
  | 'status_change'
  | 'floor_plan_upload'
  | 'follow_up'
  | 'whatsapp'
  | 'email'

export type CallOutcome =
  | 'answered'
  | 'ringing'
  | 'voicemail'
  | 'no_answer'
  | 'callback_requested'
  | 'not_interested'
  | 'interested'

export interface LeadActivity {
  id: string
  leadId: string
  type: ActivityType
  description: string
  outcome?: CallOutcome
  duration?: number
  followUpDate?: Timestamp
  performedBy: string
  performedByName?: string
  createdAt: Timestamp
}

// ─── Customer ──────────────────────────────────────────────────────────────────

export type CustomerType = 'residential' | 'commercial'
export type CustomerTag = 'vip' | 'referral_source' | 'at_risk' | 'repeat'

export interface Customer {
  id: string
  leadId?: string
  name: string
  phone: string
  email?: string
  whatsapp?: string
  address: string
  type: CustomerType
  tags: CustomerTag[]
  totalProjectValue: number
  totalPaid: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── Products ──────────────────────────────────────────────────────────────────

export type ProductCategory =
  | 'lighting'
  | 'climate'
  | 'security'
  | 'audio_video'
  | 'networking'
  | 'curtains'
  | 'sensors'
  | 'custom'

export interface Product {
  id: string
  name: string
  category: ProductCategory
  description?: string
  specs?: string
  gsp: number
  price: number
  isActive: boolean
  createdBy: string
  updatedAt: Timestamp
}

// ─── Quotations ────────────────────────────────────────────────────────────────

export type QuotationStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'management_approved'
  | 'sent_to_customer'
  | 'customer_approved'
  | 'rejected'
  | 'revision_required'

export interface QuotationLineItem {
  id: string
  productId?: string
  productName: string
  productSpec?: string
  quantity: number
  unitPrice: number
  lineTotal: number
  notes?: string
}

export interface Quotation {
  id: string
  quotationCode: string
  customerId: string
  customerName?: string
  leadId?: string
  version: number
  parentQuotationId?: string
  status: QuotationStatus
  assignedPM: string
  assignedPMName?: string
  validUntil?: Timestamp
  paymentTerms?: string
  notes?: string
  subtotal: number
  taxRate: number
  taxAmount: number
  discount: number
  total: number
  lineItems: QuotationLineItem[]
  approvedBy?: string
  approvedByName?: string
  approvedAt?: Timestamp
  projectId?: string
  pdfUrl?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── Projects ──────────────────────────────────────────────────────────────────

export type ProjectStatus =
  | 'planning'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface Project {
  id: string
  projectCode: string
  title: string
  customerId: string
  customerName?: string
  quotationId: string
  quotationCode?: string
  leadId?: string
  assignedPM: string
  assignedPMName?: string
  status: ProjectStatus
  startDate?: Timestamp
  expectedEndDate?: Timestamp
  actualEndDate?: Timestamp
  projectValue?: number
  totalValue?: number
  totalPaid?: number
  collectedAmount?: number
  riskLevel: RiskLevel
  riskFlags?: string[]
  completionPercent: number
  // Denormalized workflow stage counts, kept in sync wherever stages are
  // written — lets list views show progress without reading the `workflow`
  // subcollection of every project.
  workflowTotal?: number
  workflowDone?: number
  // Denormalized sum of paymentAmount across completed stages, so aggregate
  // views (e.g. the CRM assistant) get per-project collected amounts without a
  // collectionGroup scan over every project's workflow stages.
  stagesPaidAmount?: number
  // Site info
  city?: string
  siteAddress?: string
  landmark?: string
  clientContact?: string
  accessCode?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'overdue'

export interface Milestone {
  id: string
  projectId: string
  title: string
  description?: string
  assignedWorkers: string[]
  assignedWorkerNames?: string[]
  expectedDate?: Timestamp
  completionDate?: Timestamp
  status: MilestoneStatus
  linkedPaymentPercent?: number
  orderIndex: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type TaskStatus = 'pending' | 'in_progress' | 'done'

export interface Task {
  id: string
  milestoneId: string
  projectId: string
  title: string
  description?: string
  assignedTo: string
  assignedToName?: string
  dueDate?: Timestamp
  completionDate?: Timestamp
  status: TaskStatus
  createdAt: Timestamp
}

// ─── Site Reports ──────────────────────────────────────────────────────────────

export interface SiteReportStructured {
  workDone: string
  issuesFound: string
  materialsNeeded: string
  nextSteps: string
}

export interface SitePhoto {
  url: string
  label: string
  uploadedAt: Timestamp
}

export interface SiteReport {
  id: string
  projectId: string
  milestoneId?: string
  date: string
  submittedBy: string
  submittedByName?: string
  audioUrl?: string
  transcription?: string
  structured: SiteReportStructured
  photos: SitePhoto[]
  createdAt: Timestamp
}

export type IssueType =
  | 'material_shortage'
  | 'design_conflict'
  | 'customer_unavailable'
  | 'wiring_issue'
  | 'other'

export type IssueStatus = 'open' | 'in_progress' | 'resolved'

export interface SiteIssue {
  id: string
  projectId: string
  reportedBy: string
  reportedByName?: string
  type: IssueType
  description: string
  status: IssueStatus
  resolvedBy?: string
  createdAt: Timestamp
  resolvedAt?: Timestamp
}

// ─── Inventory ─────────────────────────────────────────────────────────────────

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

export interface InventoryItem {
  id: string
  itemCode: string
  category: string
  itemName: string
  location: string
  productLine?: string
  color?: string
  material?: string
  openingStock: number
  importedQty: number
  issuedQty: number
  closingStock: number
  reorderLevel: number
  stockStatus: StockStatus
  createdBy?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface StockTransaction {
  id: string
  itemId: string
  itemCode: string
  itemName: string
  type: 'import' | 'issue'
  quantity: number
  note?: string
  projectRef?: string
  recordedBy: string
  recordedByName?: string
  createdAt: Timestamp
}

// ─── Invoices & Payments ───────────────────────────────────────────────────────

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'

export type PaymentMode = 'neft' | 'cheque' | 'cash' | 'upi' | 'rtgs'

export interface Invoice {
  id: string
  invoiceCode: string
  projectId: string
  customerId: string
  customerName?: string
  milestoneId?: string
  status: InvoiceStatus
  amount: number
  paidAmount: number
  balance: number
  dueDate?: Timestamp
  tallyReference?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Payment {
  id: string
  invoiceId: string
  amount: number
  date: Timestamp
  mode: PaymentMode
  reference?: string
  recordedBy: string
  recordedByName?: string
  createdAt: Timestamp
}

// ─── Daily Reports ─────────────────────────────────────────────────────────────

export type ReportStatus = 'not_submitted' | 'submitted' | 'late'

export interface DailyReportStats {
  callsLogged?: number
  leadsUpdated?: number
  followUpsCompleted?: number
  quotationsCreated?: number
  milestonesCompleted?: number
  leadsCreated?: number
  callsMade?: number
  quotationsSent?: number
  quotationsSentToCustomer?: number
  activeProjects?: number
  leadsProgressed?: number
  siteVisitsCompleted?: number
  photosUploaded?: number
  invoicesRaised?: number
  contentGenerated?: number
  contentStudioActivity?: number
}

export interface DailyReport {
  id: string
  date: string
  employeeId: string
  employeeName?: string
  department: Department
  preFilledSummary: string
  topWin?: string
  mainChallenge?: string
  tomorrowPlan?: string
  systemStats: DailyReportStats
  status: ReportStatus
  submittedAt?: Timestamp
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export type NotificationType =
  | 'follow_up_due'
  | 'milestone_overdue'
  | 'quotation_approval'
  | 'project_created'
  | 'payment_received'
  | 'invoice_overdue'
  | 'site_issue'
  | 'lead_assigned'
  | 'report_reminder'
  | 'digest_ready'
  | 'content_studio_idea'
  | 'content_studio_script'
  | 'content_studio_idea_approved'
  | 'content_studio_idea_rejected'
  | 'content_studio_script_changes'
  | 'content_studio_content_published'
  | 'general'

export interface AppNotification {
  id: string
  recipientId: string
  type: NotificationType
  title: string
  body: string
  relatedEntityType?: 'lead' | 'project' | 'invoice' | 'quotation' | 'customer' | 'content-studio-idea' | 'content-studio-script' | 'content-studio-content'
  relatedEntityId?: string
  isRead: boolean
  createdAt: Timestamp
  readAt?: Timestamp
}

// ─── AI Digest ─────────────────────────────────────────────────────────────────

export interface DigestSection {
  bd: string
  projects: string
  site: string
  revenue: string
  actionItems: string[]
  tomorrow: string
}

export interface AiDigest {
  id: string
  date: string
  generatedAt: Timestamp
  content: string
  sections: DigestSection
}

// ─── Partners (B2B) ────────────────────────────────────────────────────────────

export type PartnerType = 'architect' | 'interior_designer' | 'builder' | 'consultant' | 'dealer' | 'other'
export type PartnerStatus = 'active' | 'inactive'

export interface Partner {
  id: string
  name: string
  firmName?: string
  type: PartnerType
  phone: string
  email?: string
  whatsapp?: string
  city?: string
  gstNo: string
  notes?: string
  status: PartnerStatus
  totalLeads: number
  totalRevenue: number
  nextFollowUp?: Timestamp
  followUpNote?: string
  quoteDocuments?: QuoteDoc[]
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ─── HR Module ─────────────────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time' | 'internship' | 'contract'
export type ExperienceLevel = 'fresher' | 'junior' | 'mid' | 'senior'
export type HireRecommendation = 'strong_yes' | 'yes' | 'maybe' | 'no'

export interface JDCompensation {
  type: 'salary' | 'stipend'
  min?: number
  max?: number
  note?: string
}

export interface JobDescription {
  id: string
  title: string
  department: string
  employmentType: EmploymentType
  experienceLevel: ExperienceLevel
  prerequisites: string[]
  responsibilities: string[]
  compensation: JDCompensation
  rawJD: string
  createdBy: string
  createdByName?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ScoreBreakdown {
  skills: number
  experience: number
  education: number
}

export interface BreakdownReasoning {
  skills: string
  experience: string
  education: string
}

export interface Candidate {
  id: string
  name: string
  email?: string
  phone?: string
  jobDescriptionId: string
  jobTitle: string
  resumeText: string
  score: number
  breakdown: ScoreBreakdown
  breakdownReasoning?: BreakdownReasoning
  summary: string
  strengths: string[]
  gaps: string[]
  recommendation: HireRecommendation
  createdBy: string
  createdByName?: string
  createdAt: Timestamp
}

// ─── Utility Types ─────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string
  label: string
}

export interface PaginationState {
  page: number
  pageSize: number
  total: number
}
