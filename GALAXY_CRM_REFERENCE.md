# Galaxy CRM — Complete Project Reference

> Hand this file to any AI tool to get full context on the project. It covers every layer: purpose, architecture, file map, data models, business logic, permissions, styling, and conventions.

---

## 1. What This Project Is

**Galaxy CRM** is a role-based sales and project management system built for **Galaxy Home Automation**, a Mumbai-based smart home solutions company. It manages the full lifecycle from first lead to project completion and payment.

**Core modules:**
| Module | Purpose |
|--------|---------|
| Leads | Kanban pipeline, AI scoring, activity log, follow-up reminders |
| Customers | CRM profiles, payment summaries, tagging |
| Quotations | Multi-step wizard builder, BOQ, approval workflow |
| Projects | Milestones, tasks, site reports, issue tracker |
| Site Ops | Worker view — milestones, visits, photo upload |
| Daily Reports | Per-employee structured reports with auto-populated stats |
| Content Studio | Marketing content generation (reels, captions, posts) |
| Notifications | Inbox with deduplication |
| Settings | User approval, role assignment, product catalog |
| Accounts | Invoice & payment management (coming soon) |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 + TypeScript (strict mode) |
| Build Tool | Vite 5 |
| Styling | Tailwind CSS 3 + custom CSS classes |
| Routing | React Router DOM v6 |
| Backend | Firebase (Auth, Firestore, Storage) — **no server** |
| Forms | React Hook Form + Zod validation |
| Charts | Recharts |
| Icons | Lucide React |
| Toasts | react-hot-toast |
| Dates | date-fns |
| Class merging | clsx + tailwind-merge |

**There is no REST API or backend server.** All persistence is Firestore. All real-time data is via `onSnapshot()` listeners. Auth is Google OAuth only via Firebase Auth.

**Environment variables (`.env`):**
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_ANTHROPIC_API_KEY   # optional, for future AI features
```

---

## 3. Directory Structure

```
galaxy crm/
├── src/
│   ├── App.tsx                         # Root: routing + auth guards
│   ├── main.tsx                        # React DOM entry point
│   ├── index.css                       # Tailwind directives + custom CSS classes
│   │
│   ├── types/
│   │   └── index.ts                    # ALL TypeScript interfaces & enums (single source of truth)
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx             # Auth state (firebaseUser, user, role, loading, isManagement, isAdmin)
│   │
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase init, auth helpers, Firestore CRUD helpers, code generators
│   │   ├── utils.ts                    # Date/currency formatting, status configs, permissions, calculateLeadScore
│   │   ├── pricingEngine.ts            # Quotation pricing: aggregation, section discounts, installation rates
│   │   ├── rulesEngine.ts              # Rule-based product suggestions per room (AC→IR controller, etc.)
│   │   ├── zoneRules.ts                # Zone templates (Living Room, Bedroom, Washroom, Kitchen, etc.)
│   │   └── notifyHelpers.ts            # Notification creation with deduplication
│   │
│   ├── data/
│   │   ├── presets.ts                  # Preset quotation templates: 2BHK, 3BHK, 4BHK
│   │   └── products.json               # Static product catalog fallback
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx              # App shell — renders Sidebar + Header + <Outlet>
│   │   │   ├── Sidebar.tsx             # Left nav, collapsible, role-filtered nav items, user profile, logout
│   │   │   └── Header.tsx              # Top bar — page title, date, search, notification bell, user greeting
│   │   └── ui/
│   │       ├── Button.tsx              # variants: primary|secondary|danger|success|ghost|warning; sizes: sm|md|lg
│   │       ├── Card.tsx                # Card + StatCard (KPI display with trend)
│   │       ├── Input.tsx               # Text input with label, error, hint, leftIcon, rightIcon
│   │       ├── Select.tsx              # Dropdown with label, error, hint, options
│   │       ├── Textarea.tsx            # Multi-line input with label, error, hint
│   │       ├── Modal.tsx               # Dialog: open, onClose, title, description, size, footer
│   │       ├── Badge.tsx               # Status labels: color, bg, dot, dotColor
│   │       ├── LoadingSpinner.tsx      # Spinner + PageLoader (full-page centered)
│   │       ├── EmptyState.tsx          # Empty state with icon, title, description, optional action
│   │       └── ComingSoon.tsx          # Placeholder for unbuilt modules
│   │
│   └── modules/
│       ├── auth/
│       │   ├── LoginPage.tsx           # Google sign-in, Firebase config check, setup instructions
│       │   └── PendingApprovalPage.tsx # Shown to new users until admin approves
│       │
│       ├── dashboard/
│       │   ├── DashboardRouter.tsx     # Renders the correct dashboard per role
│       │   ├── ManagementDashboard.tsx # KPIs: revenue, leads, projects, team stats, charts
│       │   ├── BDDashboard.tsx         # BD team: my leads, today's follow-ups, pipeline funnel
│       │   ├── PMDashboard.tsx         # PM: active projects, overdue milestones, site visits
│       │   ├── SiteWorkerDashboard.tsx # Worker: assigned milestones, today's tasks
│       │   └── GenericDashboard.tsx    # Fallback for other roles
│       │
│       ├── leads/
│       │   ├── LeadsPage.tsx           # Kanban board + list view, search/filter, create lead
│       │   ├── LeadDetail.tsx          # Full lead profile, activity log, status management, floor plan upload
│       │   ├── LeadForm.tsx            # Create/edit lead form (React Hook Form + Zod)
│       │   └── ActivityLog.tsx         # Timeline of calls, meetings, notes, status changes
│       │
│       ├── customers/
│       │   ├── CustomersPage.tsx       # List + search, summary stats (value/collected/outstanding), tags
│       │   └── CustomerDetail.tsx      # Profile, linked projects & quotations, payment history
│       │
│       ├── quotations/
│       │   ├── QuotationsPage.tsx      # List, status badges, approve/send/convert actions
│       │   ├── QuotationBuilder.tsx    # 5-step wizard (see Section 8 for full flow)
│       │   ├── QuotationForm.tsx       # Simple quotation form
│       │   ├── BOQPreview.tsx          # Bill of Quantities preview + export
│       │   └── builder/
│       │       ├── RoomCard.tsx        # Room product selection card
│       │       ├── FloorPlanEditor.tsx # Floor plan upload + zone editor
│       │       ├── PricingSummary.tsx  # Live pricing breakdown
│       │       └── AddProductModal.tsx # Product picker modal
│       │
│       ├── projects/
│       │   ├── ProjectsPage.tsx        # List, status filters, search (code/customer/PM/city), overdue indicator
│       │   └── ProjectDetail.tsx       # Full project: milestones, tasks, workflow, issues, photos, payments
│       │
│       ├── site-ops/
│       │   └── SiteOpsPage.tsx         # Worker view: assigned milestones, active projects, photo upload
│       │
│       ├── daily-reports/
│       │   └── DailyReportsPage.tsx    # Employee daily reports, auto-stats, dept filter
│       │
│       ├── accounts/
│       │   └── AccountsPage.tsx        # Coming soon placeholder
│       │
│       ├── content-studio/
│       │   └── ContentStudioPage.tsx   # AI content generation: type + platform + prompt → draft → approve → publish
│       │
│       ├── notifications/
│       │   └── NotificationsPage.tsx   # Notification inbox: mark read, delete, navigate to entity
│       │
│       └── settings/
│           ├── SettingsPage.tsx        # Tabs: Users, Products, System
│           └── ProductCatalogTab.tsx   # CRUD for product catalog
│
├── public/
│   └── galaxy-logo.png
│
├── firestore.rules                     # Server-side Firestore security rules
├── tailwind.config.js                  # Custom color palette (gold brand, galaxy dark, zinc neutral)
├── tsconfig.json                       # TypeScript config — ES2020, strict, path alias @/* → src/*
├── vite.config.ts                      # Vite config — React plugin, @/ alias
├── postcss.config.js                   # Tailwind + Autoprefixer
├── vercel.json                         # Vercel deployment config
├── package.json                        # Dependencies
├── .env                                # Firebase config (not in git)
└── .env.example                        # Template
```

---

## 4. Routing

All routes are defined in `src/App.tsx`. Two guards:
- **`RequireAuth`** — redirects to `/login` if unauthenticated; shows `PendingApprovalPage` if `role === 'pending'`
- **`RequireRole`** — redirects to `/` if role doesn't have access to the module

```
/login                        → LoginPage (public)
/                             → DashboardRouter (RequireAuth)
/leads                        → LeadsPage
/leads/:id                    → LeadDetail
/customers                    → CustomersPage
/customers/:id                → CustomerDetail
/quotations                   → QuotationsPage
/quotations/new               → QuotationBuilder (create mode)
/quotations/:id/edit          → QuotationBuilder (edit mode)
/quotations/:id/boq           → BOQPreview
/projects                     → ProjectsPage
/projects/:id                 → ProjectDetail
/site-ops                     → SiteOpsPage
/daily-reports                → DailyReportsPage
/accounts                     → AccountsPage
/content-studio               → ContentStudioPage
/notifications                → NotificationsPage (no role guard)
/settings                     → SettingsPage
*                             → redirect to /
```

---

## 5. Authentication & Authorization

### Auth Flow
1. User clicks "Sign in with Google" → Firebase Auth popup
2. `onAuthStateChanged` fires in `AuthContext`
3. **Returning user:** loads user doc from `users/{uid}`, updates `lastLoginAt`
4. **New user:** creates user doc with `role: 'pending'`, creates `accessRequests` doc → admin sees it in Settings
5. `role === 'pending'` → `PendingApprovalPage` shown (cannot access any module)
6. Admin assigns role + department in Settings → user can access modules

### `AuthContext` — `useAuth()` hook returns:
```typescript
{
  firebaseUser: FirebaseUser | null   // Firebase Auth object
  user: User | null                    // Custom user document from Firestore
  role: UserRole | null
  loading: boolean
  isManagement: boolean               // role === 'management' || 'super_admin'
  isAdmin: boolean                    // role === 'super_admin'
}
```

### Roles
```
super_admin    → full access, can approve users, delete anything
management     → full access, approvals
dept_head      → manages their department's users, most modules
bd_exec        → leads, customers, daily reports
project_manager→ customers, quotations, projects, site-ops, daily reports
site_worker    → projects (read), site-ops, daily reports
marketing      → content-studio, daily reports
ai_team        → full access (same as management)
accounts       → customers, accounts, invoices, daily reports
pending        → no module access
```

### Module Access Matrix
```typescript
// src/lib/utils.ts — canAccess(role, module)
leads:           dept_head, bd_exec, project_manager
customers:       dept_head, bd_exec, project_manager, accounts
quotations:      dept_head, project_manager
projects:        dept_head, project_manager, site_worker
site-ops:        dept_head, project_manager, site_worker
daily-reports:   dept_head, bd_exec, project_manager, site_worker, marketing, accounts
accounts:        dept_head, accounts
content-studio:  dept_head, marketing
notifications:   dept_head, bd_exec, project_manager, site_worker, marketing, accounts
settings:        dept_head
// super_admin, management, ai_team → all modules
```

### Permission Helpers (`src/lib/utils.ts`)
```typescript
canAccess(role, module): boolean        // module-level gate
canManageLeads(role): boolean           // super_admin, management, dept_head, bd_exec
canManageProjects(role): boolean        // super_admin, management, dept_head, project_manager
canApprove(role): boolean               // super_admin, management only
```

---

## 6. Firebase & Data Layer

### Firebase Helpers (`src/lib/firebase.ts`)
```typescript
// Auth
signInWithGoogle()                                           // OAuth popup
signOut()                                                    // Firebase sign out
isFirebaseConfigured: boolean                                // false if .env not set

// Firestore CRUD (all auto-add createdAt/updatedAt)
addDocument<T>(collection, data): Promise<string>            // returns new doc ID
updateDocument(collection, docId, data): Promise<void>       // merges + updatedAt
deleteDocument(collection, docId): Promise<void>
getDocument<T>(collection, docId): Promise<T | null>
getCollection<T>(collection, constraints[]): Promise<T[]>

// Storage
uploadFile(path, File): Promise<string>                      // returns download URL
uploadBase64(path, base64, mimeType): Promise<string>

// Code generators
generateLeadCode(seq)         → "GHA-L-2026-001"
generateQuotationCode(seq)    → "GHA-Q-2026-001"
generateProjectCode(seq)      → "GHA-P-2026-001"
generateInvoiceCode(seq)      → "GHA-INV-2026-001"
```

### Real-time Data Pattern
Every page uses `onSnapshot()` inside `useEffect` with cleanup:
```typescript
useEffect(() => {
  const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'))
  const unsub = onSnapshot(q, snap => {
    setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() } as Lead)))
  })
  return unsub  // cleanup on unmount
}, [])
```

### Firestore Collections

```
users/                          User profiles + roles
  {uid}/

leads/                          Lead records
  {leadId}/
    activities/                 Activity log (calls, meetings, notes, etc.)
    documents/                  Attached files

customers/                      Converted customers

quotations/                     Quotation records
  {quoteId}/
    lineItems/                  Individual line items

products/                       Product catalog (editable in Settings)

projects/                       Project records
  {projectId}/
    milestones/                 Project milestones (ordered by orderIndex)
    tasks/                      Tasks within milestones
    siteReports/                Daily site reports with photos
    issues/                     Site issues (material shortage, wiring, etc.)

invoices/                       Invoice records
  {invoiceId}/
    payments/                   Payment records per invoice

notifications/                  Per-user notification inbox

dailyReports/                   Employee daily submissions

contentStudio/                  Marketing content items

accessRequests/                 Pending user approval requests (admin inbox)

aiDigests/                      AI-generated management digests (write: Cloud Functions only)

auditLogs/                      Audit trail (write: Cloud Functions only; read: management only)
```

### Firestore Security Rules (key points from `firestore.rules`)
- `users`: own doc or management can read; only super_admin can create; own doc or management can update
- `leads`: management + dept_head + bd_exec + project_manager can read; bd roles create/update; management deletes
- `customers`: everyone except site_worker can read; project_manager + accounts can write
- `quotations`: most roles read; dept_head + project_manager write
- `products`: everyone reads; dept_head+ writes
- `projects`: everyone except marketing reads; project_manager+ writes; subcollections have own rules
- `dailyReports`: own reports + management/dept_head read; own reports write
- `notifications`: own notifications only (recipientId == uid)
- `aiDigests`: management reads; Cloud Functions write only

---

## 7. All TypeScript Types (`src/types/index.ts`)

### User System
```typescript
type UserRole = 'super_admin' | 'management' | 'dept_head' | 'bd_exec' |
                'project_manager' | 'site_worker' | 'marketing' | 'ai_team' |
                'accounts' | 'pending'

type Department = 'management' | 'business_development' | 'project_management' |
                  'site_operations' | 'marketing' | 'ai_department' | 'accounts'

interface User {
  id: string; name: string; email: string; phone?: string
  role: UserRole; department: Department; isActive: boolean
  avatarUrl?: string; createdAt: Timestamp; lastLoginAt?: Timestamp
}
```

### Leads
```typescript
type LeadStatus   = 'new' | 'contacted' | 'qualified' | 'floor_plan' | 'quote_sent' | 'won' | 'lost'
type LeadSource   = 'instagram' | 'referral' | 'website' | 'walk_in' | 'cold_call' | 'linkedin' | 'whatsapp' | 'other'
type LostReason   = 'price' | 'timeline' | 'competitor' | 'not_interested' | 'unresponsive' | 'budget' | 'other'
type ActivityType = 'call' | 'meeting' | 'note' | 'status_change' | 'floor_plan_upload' | 'follow_up' | 'whatsapp' | 'email'
type CallOutcome  = 'answered' | 'voicemail' | 'no_answer' | 'callback_requested' | 'not_interested' | 'interested'

interface Lead {
  id: string; leadCode: string; status: LeadStatus; source: LeadSource
  name: string; phone: string; email?: string; address?: string; whatsapp?: string
  projectType?: string; estimatedBudget?: number; propertySize?: string
  assignedTo: string; assignedToName?: string
  aiScore: number; aiScoreNote?: string
  lostReason?: LostReason; lostNote?: string
  convertedToCustomerId?: string; floorPlanUrl?: string; nextFollowUp?: Timestamp
  createdBy: string; createdAt: Timestamp; updatedAt: Timestamp
}

interface LeadActivity {
  id: string; leadId: string; type: ActivityType; description: string
  outcome?: CallOutcome; duration?: number; followUpDate?: Timestamp
  performedBy: string; performedByName?: string; createdAt: Timestamp
}
```

### Customers
```typescript
type CustomerType = 'residential' | 'commercial'
type CustomerTag  = 'vip' | 'referral_source' | 'at_risk' | 'repeat'

interface Customer {
  id: string; leadId?: string; name: string; phone: string
  email?: string; whatsapp?: string; address: string
  type: CustomerType; tags: CustomerTag[]
  totalProjectValue: number; totalPaid: number
  createdAt: Timestamp; updatedAt: Timestamp
}
```

### Products
```typescript
type ProductCategory = 'lighting' | 'climate' | 'security' | 'audio_video' |
                       'networking' | 'curtains' | 'sensors' | 'custom'

interface Product {
  id: string; name: string; category: ProductCategory
  description?: string; specs?: string
  gsp: number        // Gross Selling Price (base price used in pricing engine)
  price: number      // Display/list price
  isActive: boolean; createdBy: string; updatedAt: Timestamp
}
```

### Quotations
```typescript
type QuotationStatus = 'draft' | 'pending_approval' | 'approved' | 'management_approved' |
                       'sent_to_customer' | 'customer_approved' | 'rejected' | 'revision_required'

interface QuotationLineItem {
  id: string; productId?: string; productName: string; productSpec?: string
  quantity: number; unitPrice: number; lineTotal: number; notes?: string
}

interface Quotation {
  id: string; quotationCode: string; customerId: string; customerName?: string
  leadId?: string; version: number; parentQuotationId?: string
  status: QuotationStatus; assignedPM: string; assignedPMName?: string
  validUntil?: Timestamp; paymentTerms?: string; notes?: string
  subtotal: number; taxRate: number; taxAmount: number; discount: number; total: number
  lineItems: QuotationLineItem[]
  approvedBy?: string; approvedByName?: string; approvedAt?: Timestamp
  projectId?: string; pdfUrl?: string
  createdBy: string; createdAt: Timestamp; updatedAt: Timestamp
}
```

### Projects
```typescript
type ProjectStatus = 'planning' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
type RiskLevel     = 'low' | 'medium' | 'high'
type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'overdue'
type TaskStatus      = 'pending' | 'in_progress' | 'done'

interface Project {
  id: string; projectCode: string; title: string
  customerId: string; customerName?: string
  quotationId: string; quotationCode?: string; leadId?: string
  assignedPM: string; assignedPMName?: string; status: ProjectStatus
  startDate?: Timestamp; expectedEndDate?: Timestamp; actualEndDate?: Timestamp
  projectValue?: number; totalValue?: number; totalPaid?: number; collectedAmount?: number
  riskLevel: RiskLevel; riskFlags?: string[]; completionPercent: number
  city?: string; siteAddress?: string; landmark?: string; clientContact?: string; accessCode?: string
  createdBy: string; createdAt: Timestamp; updatedAt: Timestamp
}

interface Milestone {
  id: string; projectId: string; title: string; description?: string
  assignedWorkers: string[]; assignedWorkerNames?: string[]
  expectedDate?: Timestamp; completionDate?: Timestamp; status: MilestoneStatus
  linkedPaymentPercent?: number; orderIndex: number
  createdAt: Timestamp; updatedAt: Timestamp
}

interface Task {
  id: string; milestoneId: string; projectId: string
  title: string; description?: string
  assignedTo: string; assignedToName?: string
  dueDate?: Timestamp; completionDate?: Timestamp; status: TaskStatus; createdAt: Timestamp
}
```

### Site Reports & Issues
```typescript
interface SiteReportStructured { workDone: string; issuesFound: string; materialsNeeded: string; nextSteps: string }
interface SitePhoto { url: string; label: string; uploadedAt: Timestamp }

interface SiteReport {
  id: string; projectId: string; milestoneId?: string; date: string
  submittedBy: string; submittedByName?: string
  audioUrl?: string; transcription?: string
  structured: SiteReportStructured; photos: SitePhoto[]; createdAt: Timestamp
}

type IssueType   = 'material_shortage' | 'design_conflict' | 'customer_unavailable' | 'wiring_issue' | 'other'
type IssueStatus = 'open' | 'in_progress' | 'resolved'

interface SiteIssue {
  id: string; projectId: string; reportedBy: string; reportedByName?: string
  type: IssueType; description: string; status: IssueStatus
  resolvedBy?: string; createdAt: Timestamp; resolvedAt?: Timestamp
}
```

### Invoices & Payments
```typescript
type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue'
type PaymentMode   = 'neft' | 'cheque' | 'cash' | 'upi' | 'rtgs'

interface Invoice {
  id: string; invoiceCode: string; projectId: string; customerId: string; customerName?: string
  milestoneId?: string; status: InvoiceStatus
  amount: number; paidAmount: number; balance: number
  dueDate?: Timestamp; tallyReference?: string
  createdBy: string; createdAt: Timestamp; updatedAt: Timestamp
}

interface Payment {
  id: string; invoiceId: string; amount: number; date: Timestamp
  mode: PaymentMode; reference?: string
  recordedBy: string; recordedByName?: string; createdAt: Timestamp
}
```

### Daily Reports
```typescript
type ReportStatus = 'not_submitted' | 'submitted' | 'late'

interface DailyReportStats {
  callsLogged?: number; leadsUpdated?: number; followUpsCompleted?: number
  quotationsCreated?: number; milestonesCompleted?: number; leadsCreated?: number
  callsMade?: number; quotationsSent?: number; quotationsSentToCustomer?: number
  activeProjects?: number; leadsProgressed?: number
  siteVisitsCompleted?: number; photosUploaded?: number
  invoicesRaised?: number; contentGenerated?: number
}

interface DailyReport {
  id: string; date: string; employeeId: string; employeeName?: string
  department: Department; preFilledSummary: string
  topWin?: string; mainChallenge?: string; tomorrowPlan?: string
  systemStats: DailyReportStats; status: ReportStatus; submittedAt?: Timestamp
}
```

### Notifications
```typescript
type NotificationType = 'follow_up_due' | 'milestone_overdue' | 'quotation_approval' |
                        'project_created' | 'payment_received' | 'invoice_overdue' |
                        'site_issue' | 'lead_assigned' | 'report_reminder' | 'digest_ready' | 'general'

interface AppNotification {
  id: string; recipientId: string; type: NotificationType
  title: string; body: string
  relatedEntityType?: 'lead' | 'project' | 'invoice' | 'quotation' | 'customer'
  relatedEntityId?: string; isRead: boolean; createdAt: Timestamp; readAt?: Timestamp
}
```

### Content Studio
```typescript
type ContentType     = 'reel_script' | 'caption' | 'linkedin_post' | 'product_description' | 'ad_copy'
type ContentPlatform = 'instagram' | 'linkedin' | 'facebook' | 'youtube' | 'general'
type ContentStatus   = 'draft' | 'approved' | 'published'

interface ContentItem {
  id: string; createdBy: string; createdByName?: string
  type: ContentType; prompt: string; generatedContent: string; editedContent?: string
  platform: ContentPlatform; status: ContentStatus
  publishedAt?: Timestamp; createdAt: Timestamp
}
```

### AI Digest
```typescript
interface DigestSection {
  bd: string; projects: string; site: string; revenue: string
  actionItems: string[]; tomorrow: string
}
interface AiDigest { id: string; date: string; generatedAt: Timestamp; content: string; sections: DigestSection }
```

---

## 8. Business Logic

### Lead Lifecycle
```
new → contacted → qualified → floor_plan → quote_sent → won | lost
```
- AI score computed by `calculateLeadScore()` in `utils.ts`:
  - Base: 30
  - Referral source: +10; Website source: +5
  - Budget ≥ 5L: +20; Budget ≥ 2L: +10
  - Floor plan uploaded: +20
  - Max: 100
- Score colors: ≥75 green, ≥50 yellow, ≥25 orange, <25 red
- Lost leads require a `LostReason`
- Won leads auto-create a `Customer` when quotation is approved

### Quotation Builder — 5-Step Wizard
```
Step 1: Client Details   → select existing customer or quick-add
Step 2: Floor Plan       → upload image, define zones
Step 3: Rooms & Products → room cards, product picker, qty per room
Step 4: BOQ              → bill of quantities preview
Step 5: Summary          → review + submit
```
Preset templates in `src/data/presets.ts`: 2BHK, 3BHK, 4BHK (pre-filled rooms + default products).

### Quotation Status Workflow
```
draft → pending_approval → approved → management_approved → sent_to_customer → customer_approved
                        → rejected
                        → revision_required
```
Only `super_admin` or `management` can approve (`canApprove()`).

### Pricing Engine (`src/lib/pricingEngine.ts`)
```typescript
computePricing(rooms, products, sectionDiscounts): PricingResult
```
- `aggregateRoomProducts(rooms)` — sums qty per productId across all rooms
- Groups line items by category (section)
- Section order: ELYSIA_SWITCHES, VITRUM_SWITCHES, IR_CONTROLLERS, SENSORS, CONTROLLERS, LCD_PANELS, LOCKS, NETWORKING, VDP, CURTAINS
- Applies per-section `sectionDiscounts[category]` percent
- Installation rates:
  - LCD_PANELS: 0%
  - LOCKS: 10%
  - Everything else: 15%
- Returns: `{ lineItems, sections, productSubtotal, discountPercent, discountAmount, discountedSubtotal, totalInstallation, grandSubtotal }`

### Product Recommendation Rules (`src/lib/rulesEngine.ts`)
Rule-based (not ML). Per room:
- `room.hasAC` → suggest IR-003 (or IR-001) — AC IR Controller
- `room.hasTV` → suggest IR-002 — TV IR Blaster
- `room.hasFan` → suggest EL-008 — Fan Controller
- `room.curtainsCount > 0` → suggest CR-001 × count — Curtain Motor
- `room.type` includes bathroom/washroom/toilet → suggest SN-001 — Motion Sensor

`getSuggestionsForRoom(room, products)` returns `Suggestion[]` with `{ productId, qty, reasons[] }`.

### Zone Templates (`src/lib/zoneRules.ts`)
`ZONE_RULES[]` — predefined product sets for: Living Room, Bedroom, Master Bedroom, Kitchen, Washroom, Bathroom, Study, Dining, Balcony, etc.

### Notification System (`src/lib/notifyHelpers.ts`)
- `createNotificationIfNew(...)` — checks Firestore; won't create duplicate of same type+entity on same day
- `checkFollowUpNotifications(userId, leads)` — fires `follow_up_due` for overdue lead follow-ups
- `checkProjectOverdueNotifications(userId, projects)` — fires `milestone_overdue` for overdue projects

### Project Execution Flow
```
Create Project (from approved quotation)
  → Add Milestones (ordered, with expectedDate, linkedPaymentPercent)
    → Add Tasks per milestone (assigned to workers)
      → Workers submit SiteReports (photos + structured notes)
      → Workers log SiteIssues
    → Mark milestone complete
  → Track completionPercent
  → Record payments against invoices
→ Mark project completed
```

### Daily Reports
- System auto-populates `systemStats` by counting Firestore activity for the day
- Employees fill: `topWin`, `mainChallenge`, `tomorrowPlan`
- Status progresses: not_submitted → submitted | late (if submitted after deadline)
- Management/dept_head see all team; employees see own

---

## 9. Utility Functions (`src/lib/utils.ts`)

```typescript
// Class merging
cn(...inputs): string                           // clsx + tailwind-merge

// Date
toDate(Timestamp | Date | string | null): Date | null
formatDate(value, fmt?): string                 // default: 'dd MMM yyyy'
formatDateTime(value): string                   // 'dd MMM yyyy, hh:mm a'
formatRelative(value): string                   // 'Today 3:45 PM' | 'Yesterday...' | '3 days ago'

// Currency (Indian locale)
formatCurrency(amount): string                  // ₹1,00,000
formatCurrencyShort(amount): string             // ₹1.5L | ₹50K

// Status config objects (label + Tailwind color + bg classes)
LEAD_STATUS_CONFIG: Record<LeadStatus, {label, color, bg}>
QUOTATION_STATUS_CONFIG: Record<QuotationStatus, {label, color, bg}>
PROJECT_STATUS_CONFIG: Record<ProjectStatus, {label, color, bg}>
MILESTONE_STATUS_CONFIG: Record<MilestoneStatus, {label, color, dot}>
INVOICE_STATUS_CONFIG: Record<InvoiceStatus, {label, color, bg}>
RISK_CONFIG: Record<RiskLevel, {label, color, dot}>

// AI score colors
getScoreColor(score): string                    // text-green-400 / yellow / orange / red
getScoreBg(score): string                       // bg-green-900/30 etc.

// Role labels
ROLE_LABELS: Record<UserRole, string>

// Permissions
canAccess(role, module): boolean
canManageLeads(role): boolean
canManageProjects(role): boolean
canApprove(role): boolean

// Misc
getInitials(name): string                       // "John Doe" → "JD"
truncate(str, maxLen): string                   // clips with …
calculateLeadScore(lead): number                // 0–100 rule-based scoring
```

---

## 10. Styling & Theming

### Brand Identity
- **Primary color:** Gold — `#C9A840`
- **Background:** Near-black dark galaxy — `#09090b` (true neutral, no blue tint)
- **Effect:** Glass-morphism — `backdrop-blur` + semi-transparent backgrounds on all cards, sidebar, inputs, modals

### Tailwind Config (`tailwind.config.js`)
All `blue-*` and `indigo-*` utility classes are remapped to the gold palette so all default "primary blue" Tailwind patterns become gold automatically. Custom scales added:
- `gold-50` through `gold-950` — explicit gold scale
- `galaxy-500` through `galaxy-950` — dark space colors
- `gray-*` — overridden to zinc (true neutral, no blue tint)

### Custom CSS Classes (`src/index.css`)
```
.glass-card            frosted glass container (backdrop-blur + semi-transparent)
.glass-card-gold       gold-tinted glass variant
.glass-modal           modal backdrop glass
.sidebar-item          nav item base styles
.sidebar-item-active   highlighted active nav item (gold accent)
.sidebar-item-inactive default nav item
.stat-card             glass KPI display card
.form-label            form field label
.form-input            input base styles
.form-input:focus      gold focus ring
.btn                   button base
.btn-primary           gold gradient button
.btn-secondary         dark button
.btn-danger            red variant
.btn-success           green variant
.btn-ghost             transparent variant
.pipeline-card         kanban lead card
.section-header        section title styling
.page-title            page heading
.animate-fade-in       0.2s fade-in animation
.ring-gold             gold focus ring utility
.mobile-fab            floating action button (mobile)
```

### Scrollbar
Gold-colored, 6px width, throughout the app.

### Font
Inter (primary), system-ui fallback.

---

## 11. Component API Reference

### `<Button>`
```typescript
variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'warning'  // default: primary
size?: 'sm' | 'md' | 'lg'                                                          // default: md
loading?: boolean      // shows spinner, disables button
icon?: LucideIcon      // left icon
iconRight?: LucideIcon // right icon
disabled?: boolean
onClick?: () => void
```

### `<Card>` / `<StatCard>`
```typescript
// Card
children: ReactNode; className?: string; hover?: boolean; padding?: boolean; onClick?: () => void

// StatCard
label: string; value: string | number; subValue?: string
icon?: LucideIcon; iconBg?: string
trend?: { value: number; label?: string; isPositive: boolean }
onClick?: () => void
```

### `<Input>`
```typescript
label?: string; error?: string; hint?: string
leftIcon?: LucideIcon; rightIcon?: LucideIcon
// + all standard HTML input props
```

### `<Select>`
```typescript
label?: string; error?: string; hint?: string; placeholder?: string
options: { value: string; label: string }[]
// + standard select props
```

### `<Modal>`
```typescript
open: boolean; onClose: () => void; title?: string; description?: string
size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'    // default: md
children: ReactNode; footer?: ReactNode
```

### `<Badge>`
```typescript
children: ReactNode; color?: string; bg?: string; dot?: boolean; dotColor?: string
```

---

## 12. Key Conventions & Patterns

### Adding a New Page/Module
1. Create `src/modules/<name>/<Name>Page.tsx`
2. Add route in `src/App.tsx` wrapped in `<RequireRole module="<name>">`
3. Add module key to `canAccess()` in `src/lib/utils.ts`
4. Add nav item in `src/components/layout/Sidebar.tsx`
5. Add Firestore security rules in `firestore.rules`

### Adding a New Firestore Collection
1. Define TypeScript interface in `src/types/index.ts`
2. Add collection rules in `firestore.rules`
3. Use `addDocument()`, `updateDocument()`, `onSnapshot()` from `src/lib/firebase.ts`

### Adding a New Notification Type
1. Add value to `NotificationType` union in `src/types/index.ts`
2. Use `createNotificationIfNew()` from `src/lib/notifyHelpers.ts`
3. Handle the new type in `NotificationsPage.tsx` (icon/color)

### Status Config Pattern
All statuses have a config object in `utils.ts` (e.g., `LEAD_STATUS_CONFIG`) with `{ label, color, bg }` in Tailwind classes. Use these for consistent badge/label rendering.

### Form Validation Pattern
```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1) })
type FormData = z.infer<typeof schema>

const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(schema)
})
```

### Real-time Listener Pattern
```typescript
useEffect(() => {
  const unsub = onSnapshot(
    query(collection(db, 'collection'), where('field', '==', value)),
    snap => setData(snap.docs.map(d => ({ id: d.id, ...d.data() } as MyType)))
  )
  return unsub
}, [dependency])
```

---

## 13. What's Not Yet Built (Planned)

| Feature | Status | Notes |
|---------|--------|-------|
| Accounts / Invoicing | UI placeholder only | AccountsPage shows "Coming Soon" |
| AI-powered lead scoring | Rule-based currently | Anthropic API key in env, not wired |
| AI digest generation | Type exists (`AiDigest`) | Cloud Functions write-only, not implemented |
| AI content generation | Template-based currently | Anthropic API key available in env |
| PDF export for BOQ/Quotation | `pdfUrl` field exists | Generator not implemented |
| Push notifications | Not implemented | Only in-app Firestore notifications |
| Audio transcription for site reports | `audioUrl`/`transcription` fields exist | UI not built |
| Tally integration for invoices | `tallyReference` field exists | Not implemented |

---

## 14. Project Details

- **Company:** Galaxy Home Automation, Mumbai
- **Firebase Project ID:** `galaxy-crm-7d4dc`
- **Deployment:** Vercel (`vercel.json` present)
- **Dev command:** `npm run dev` (Vite dev server)
- **Build command:** `tsc && vite build`
- **Path alias:** `@/` maps to `src/` in both Vite and TypeScript config
