# Galaxy CRM — Full Architecture Document

> **Purpose:** Complete technical reference for the Galaxy CRM system. Any developer or AI agent reading this should be able to understand, maintain, and extend the codebase from scratch.

---

## 1. PROJECT OVERVIEW

**Galaxy CRM** is a home automation sales and project management system built for Galaxy Home Automation. It manages the full business lifecycle: lead capture → quotation → project execution → customer management, along with inventory, daily reports, and a content studio for social media production.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.3.1, TypeScript 5.2, Vite 5.3 |
| Styling | Tailwind CSS 3.4, custom CSS variables |
| Forms | React Hook Form + Zod validation |
| Routing | React Router v6 (lazy-loaded routes) |
| Database (primary) | Firebase Firestore |
| Auth | Firebase Auth (Google OAuth) |
| Storage | Firebase Storage |
| Database (content studio) | Turso / libSQL (SQLite-compatible) |
| Icons | Lucide React |
| Charts | Recharts |
| Notifications | React Hot Toast |
| Error Tracking | Sentry (production only) |
| Tests | Vitest 4.1.9 |

---

## 2. DIRECTORY STRUCTURE

```
galaxy-crm/
├── src/
│   ├── main.tsx                        # Entry point, Sentry init
│   ├── App.tsx                         # Router, auth guards, lazy route imports
│   ├── index.css                       # Tailwind + global CSS variables
│   ├── vite-env.d.ts                   # Vite env type declarations
│   │
│   ├── types/
│   │   ├── index.ts                    # ALL core domain interfaces & types
│   │   └── content-studio/index.ts     # Content Studio types (Turso schema)
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx             # Global user + role state (onAuthStateChanged)
│   │
│   ├── hooks/
│   │   └── useFollowUpNotifier.ts      # Browser notification hook for follow-ups
│   │
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase init, auth helpers, CRUD wrappers
│   │   ├── utils.ts                    # Date/currency formatting, RBAC, status configs
│   │   ├── counters.ts                 # Atomic code generation (lead/quote/project codes)
│   │   ├── notifyHelpers.ts            # In-app notification creation helpers
│   │   ├── pricingEngine.ts            # Quotation pricing calculations
│   │   ├── rulesEngine.ts              # Business rules (future use)
│   │   ├── zoneRules.ts                # Floor plan zone rules (future use)
│   │   ├── content-studio/
│   │   │   ├── db.ts                   # Turso client wrapper
│   │   │   ├── schema.ts               # SQLite table definitions & auto-migrations
│   │   │   ├── queries.ts              # All Content Studio SQL queries
│   │   │   ├── format.ts               # Data formatting utilities
│   │   │   ├── stages.ts               # Pipeline stage definitions
│   │   │   ├── seed.ts                 # Test data seeder
│   │   │   ├── pdf.ts                  # PDF export logic
│   │   │   ├── viewer-context.tsx      # Content viewer global state
│   │   │   └── integrations/
│   │   │       ├── types.ts            # Shared integration types
│   │   │       ├── facebook.ts         # Facebook Graph API v21.0
│   │   │       ├── instagram.ts        # Instagram Graph API v21.0
│   │   │       ├── youtube.ts          # YouTube Data API v3
│   │   │       ├── linkedin.ts         # LinkedIn Marketing API
│   │   │       └── index.ts            # syncAll(), providers(), lastSync()
│   │   └── __tests__/
│   │       ├── pricingEngine.test.ts
│   │       └── utils.test.ts
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx              # App shell: sidebar + header + <Outlet>
│   │   │   ├── Header.tsx              # Page title, search, NotificationPanel
│   │   │   ├── Sidebar.tsx             # Role-filtered nav, user card, sign out
│   │   │   └── NotificationPanel.tsx   # Bell dropdown: overdue/today follow-ups + app notifs
│   │   ├── ui/
│   │   │   ├── Button.tsx              # primary / secondary / destructive variants
│   │   │   ├── Input.tsx               # Text field with label + error
│   │   │   ├── Select.tsx              # Dropdown with label + error
│   │   │   ├── Textarea.tsx            # Multi-line text field
│   │   │   ├── Card.tsx                # Container with border + padding
│   │   │   ├── Badge.tsx               # Inline status indicator
│   │   │   ├── Modal.tsx               # Overlay dialog (header/body/footer)
│   │   │   ├── LoadingSpinner.tsx      # Spinner + PageLoader
│   │   │   ├── EmptyState.tsx          # "No data" placeholder
│   │   │   └── ComingSoon.tsx          # Feature not yet built placeholder
│   │   ├── content-studio/             # 20+ Content Studio components
│   │   │   ├── ContentStudioLayout.tsx
│   │   │   ├── BrandsView, IdeasView, ScriptsView, ShootsView, EditingView
│   │   │   ├── CalendarBoard, KanbanBoard
│   │   │   ├── GlobalSearch, NotificationBell
│   │   │   ├── Modals: Brand, Channel, Content, Idea, Script, Shoot
│   │   │   └── Export: CsvButton, PdfButton, PrintButton, SeedButton, SyncButton
│   │   └── ErrorBoundary.tsx
│   │
│   ├── modules/                        # Feature modules (one per business domain)
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx           # Google Sign-In
│   │   │   └── PendingApprovalPage.tsx # Waiting for admin approval screen
│   │   ├── leads/
│   │   │   ├── LeadsPage.tsx           # Kanban/List view, filters, search
│   │   │   ├── LeadDetail.tsx          # Lead profile, activity log, status updates
│   │   │   ├── LeadForm.tsx            # Create lead (B2C/B2B, auto AI score)
│   │   │   ├── ActivityLog.tsx         # Timeline component for lead activities
│   │   │   └── FollowUpsPage.tsx       # Overdue/today/upcoming follow-ups
│   │   ├── customers/
│   │   │   ├── CustomersPage.tsx
│   │   │   └── CustomerDetail.tsx
│   │   ├── quotations/
│   │   │   ├── QuotationsPage.tsx
│   │   │   ├── QuotationBuilder.tsx    # 5-step wizard
│   │   │   ├── QuotationForm.tsx       # Legacy form view
│   │   │   ├── BOQPreview.tsx
│   │   │   └── builder/
│   │   │       ├── RoomCard.tsx
│   │   │       ├── FloorPlanEditor.tsx
│   │   │       ├── AddProductModal.tsx
│   │   │       └── PricingSummary.tsx
│   │   ├── projects/
│   │   │   ├── ProjectsPage.tsx        # List with real workflow progress bar
│   │   │   └── ProjectDetail.tsx       # Timeline, milestones, tasks, site reports
│   │   ├── partners/
│   │   │   ├── PartnersPage.tsx
│   │   │   └── PartnerDetail.tsx
│   │   ├── inventory/
│   │   │   └── InventoryPage.tsx       # Elysia + Vitrum product lines, stock tracking
│   │   ├── daily-reports/
│   │   │   └── DailyReportsPage.tsx
│   │   ├── notifications/
│   │   │   └── NotificationsPage.tsx   # Notification inbox with mark-read / delete
│   │   ├── settings/
│   │   │   ├── SettingsPage.tsx        # User mgmt, access requests, product catalog
│   │   │   └── ProductCatalogTab.tsx
│   │   └── dashboard/
│   │       ├── DashboardRouter.tsx     # Routes to role-specific dashboard
│   │       ├── ManagementDashboard.tsx
│   │       ├── BDDashboard.tsx
│   │       ├── PMDashboard.tsx
│   │       ├── AIDashboard.tsx
│   │       └── GenericDashboard.tsx
│   │
│   ├── pages/
│   │   └── content-studio/
│   │       ├── OverviewPage, BrandsPage, PipelinePage, IdeasPage
│   │       ├── ScriptsPage, EditingPage, CalendarPage, ShootsPage
│   │       ├── PerformancePage, InsightsPage, ReportsPage
│   │       ├── ConnectionsPage, ActivityPage
│   │
│   └── data/
│       └── presets.ts                  # Pre-built room configs (2/3/4 BHK)
│
├── ARCHITECTURE.md                     # This file
├── .env                                # Local env vars (not committed)
├── package.json
├── tsconfig.json                       # @ alias → src/
└── vite.config.ts                      # React plugin + Vitest config
```

---

## 3. ENVIRONMENT VARIABLES

```env
# Firebase (required)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Turso — Content Studio database (required for Content Studio)
VITE_TURSO_DATABASE_URL=libsql://...
VITE_TURSO_AUTH_TOKEN=

# Social media integrations (optional — Content Studio sync)
VITE_YT_API_KEY=
VITE_YT_CHANNEL_ID=
VITE_YT_BRAND_ID=
VITE_IG_ACCESS_TOKEN=          # Long-lived Instagram token (from /me/accounts)
VITE_IG_USER_ID=               # Instagram Business User ID
VITE_IG_BRAND_ID=
VITE_FB_ACCESS_TOKEN=          # Facebook Page Access Token (never-expiring)
VITE_FB_PAGE_ID=               # Numeric Facebook Page ID
VITE_FB_BRAND_ID=
VITE_LI_ACCESS_TOKEN=
VITE_LI_ORG_ID=
VITE_LI_BRAND_ID=

# Error tracking (optional — auto-disabled if empty)
VITE_SENTRY_DSN=
```

### Facebook Token Setup (important)
1. Go to developers.facebook.com → Graph API Explorer
2. Select Galaxy CMO app → generate User Token with `pages_show_list`, `pages_read_engagement`, `read_insights`
3. Exchange for long-lived token: `GET /oauth/access_token?grant_type=fb_exchange_token&...`
4. Call `/me/accounts` → get the Page Access Token (never expires)
5. Set `VITE_FB_ACCESS_TOKEN` = Page token, `VITE_FB_PAGE_ID` = numeric page ID
6. **Note:** `pages_read_user_content` requires the Facebook app to be in Published/Live mode

---

## 4. FIREBASE COLLECTIONS

### `users`
```typescript
interface User {
  id: string              // Firebase Auth UID (also the Firestore doc ID)
  name: string
  email: string
  phone?: string
  role: UserRole          // super_admin | management | dept_head | bd_exec | project_manager | marketing | ai_team | pending
  department: Department  // management | business_development | project_management | marketing | ai_department
  isActive: boolean
  avatarUrl?: string
  createdAt: Timestamp
  lastLoginAt?: Timestamp
}
```

### `accessRequests`
```typescript
{
  userId, userName, userEmail, userAvatar
  status: 'pending' | 'approved' | 'rejected'
  createdAt, approvedBy?, approvedAt?
}
```

### `leads`
```typescript
interface Lead {
  id: string
  leadCode: string              // GHA-L-2026-001 (auto-generated, atomic)
  status: LeadStatus            // new | contacted | qualified | floor_plan | quote_sent | won | lost | not_required
  source: LeadSource            // referral | partner | google_ads | linkedin | instagram | facebook | justdial | indiamart | cold_call | other
  name: string
  phone: string                 // 10-digit normalized
  email?: string
  whatsapp?: string
  address?: string
  projectType?: string
  estimatedBudget?: number
  propertySize?: string
  businessType: 'b2b' | 'b2c'
  partnerId?: string
  partnerName?: string
  assignedTo: string            // User ID
  assignedToName?: string
  aiScore: number               // 0–100 auto-calculated
  aiScoreNote?: string
  notes?: string                // Free-text notes (added 2026-07-01)
  demoGiven?: boolean
  nextFollowUp?: Timestamp      // Used by notification system
  floorPlanUrl?: string
  lostReason?: LostReason       // price | timeline | competitor | not_interested | unresponsive | budget | other
  lostNote?: string
  convertedToCustomerId?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `leads/{leadId}/activities` (subcollection)
```typescript
interface LeadActivity {
  id: string
  leadId: string
  type: 'call' | 'meeting' | 'note' | 'status_change' | 'floor_plan_upload' | 'follow_up' | 'whatsapp' | 'email'
  description: string
  outcome?: 'answered' | 'ringing' | 'voicemail' | 'no_answer' | 'callback_requested' | 'not_interested' | 'interested'
  duration?: number             // minutes
  followUpDate?: Timestamp
  performedBy: string
  performedByName?: string
  createdAt: Timestamp
}
```

### `customers`
```typescript
interface Customer {
  id: string
  leadId?: string
  name: string
  phone: string
  email?: string
  whatsapp?: string
  address: string
  type: 'residential' | 'commercial'
  tags: Array<'vip' | 'referral_source' | 'at_risk' | 'repeat'>
  totalProjectValue: number
  totalPaid: number
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `quotations`
```typescript
interface Quotation {
  id: string
  quotationCode: string         // GHA-Q-2026-001
  customerId: string
  customerName?: string
  leadId?: string
  version: number
  parentQuotationId?: string
  status: 'draft' | 'pending_approval' | 'approved' | 'management_approved' | 'sent_to_customer' | 'customer_approved' | 'rejected' | 'revision_required'
  assignedPM: string
  assignedPMName?: string
  validUntil?: Timestamp
  paymentTerms?: string         // e.g. "40-30-20-10"
  notes?: string
  subtotal: number
  taxRate: number               // 18 (IGST)
  taxAmount: number
  discount: number
  total: number
  lineItems: QuotationLineItem[]
  approvedBy?: string
  approvedAt?: Timestamp
  projectId?: string
  pdfUrl?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface QuotationLineItem {
  id: string
  productId?: string
  productName: string
  productSpec?: string
  quantity: number
  unitPrice: number             // GSP price
  lineTotal: number
  notes?: string
}
```

### `products`
```typescript
interface Product {
  id: string
  name: string
  category: 'lighting' | 'climate' | 'security' | 'audio_video' | 'networking' | 'curtains' | 'sensors' | 'custom'
  description?: string
  specs?: string
  gsp: number                   // Gross Selling Price
  price: number                 // Internal cost
  isActive: boolean
  createdBy: string
  updatedAt: Timestamp
}
```

### `projects`
```typescript
interface Project {
  id: string
  projectCode: string           // GHA-P-2026-001
  title: string
  customerId: string
  customerName?: string
  quotationId: string
  quotationCode?: string
  leadId?: string
  assignedPM: string
  assignedPMName?: string
  status: 'planning' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
  startDate?: Timestamp
  expectedEndDate?: Timestamp
  actualEndDate?: Timestamp
  projectValue?: number
  totalPaid?: number
  riskLevel: 'low' | 'medium' | 'high'
  riskFlags?: string[]
  completionPercent: number     // 0–100 (stored, but UI now computes from real workflow)
  city?: string
  siteAddress?: string
  clientContact?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `projects/{projectId}/milestones` (subcollection)
```typescript
interface Milestone {
  id: string
  title: string
  description?: string
  assignedWorkers: string[]
  assignedWorkerNames?: string[]
  expectedDate?: Timestamp
  completionDate?: Timestamp
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  linkedPaymentPercent?: number
  orderIndex: number
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `projects/{projectId}/siteReports` (subcollection)
```typescript
interface SiteReport {
  id: string
  projectId: string
  milestoneId?: string
  date: string                  // YYYY-MM-DD
  submittedBy: string
  structured: {
    workDone: string
    issuesFound: string
    materialsNeeded: string
    nextSteps: string
  }
  photos: Array<{ url: string; label: string; uploadedAt: string }>
  createdAt: Timestamp
}
```

### `invoices` & `payments`
```typescript
interface Invoice {
  id: string
  invoiceCode: string           // GHA-INV-2026-001
  projectId: string
  customerId: string
  milestoneId?: string
  status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue'
  amount: number
  paidAmount: number
  balance: number
  dueDate?: Timestamp
  tallyReference?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface Payment {
  id: string
  invoiceId: string
  amount: number
  date: Timestamp
  mode: 'neft' | 'cheque' | 'cash' | 'upi' | 'rtgs'
  reference?: string
  recordedBy: string
  createdAt: Timestamp
}
```

### `inventory`
```typescript
interface InventoryItem {
  id: string
  itemCode: string              // e.g. "EL-009", "VT-012"
  category: string              // ELYSIA_SWITCHES | VITRUM_SWITCHES | LOCKS | CURTAINS | etc.
  itemName: string
  location: string              // e.g. "Rack 5"
  productLine?: string          // elysia | vitrum
  color?: string
  openingStock: number
  importedQty: number
  issuedQty: number
  closingStock: number          // = opening + imported - issued
  reorderLevel: number
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `partners`
```typescript
interface Partner {
  id: string
  name: string
  firmName?: string
  type: 'architect' | 'interior_designer' | 'builder' | 'consultant' | 'dealer' | 'other'
  phone: string
  email?: string
  whatsapp?: string
  city?: string
  gstNo: string
  notes?: string
  status: 'active' | 'inactive'
  totalLeads: number
  totalRevenue: number
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `dailyReports`
```typescript
interface DailyReport {
  id: string
  date: string                  // YYYY-MM-DD
  employeeId: string
  employeeName?: string
  department: Department
  preFilledSummary: string
  topWin?: string
  mainChallenge?: string
  tomorrowPlan?: string
  systemStats: {
    callsLogged?: number
    leadsUpdated?: number
    followUpsCompleted?: number
    // ...10+ metrics
  }
  status: 'not_submitted' | 'submitted' | 'late'
  submittedAt?: Timestamp
}
```

### `notifications`
```typescript
interface AppNotification {
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
```

### `meta/counters`
Single document holding atomic counters:
```typescript
{ leadCount: number, quotationCount: number, projectCount: number }
```

---

## 5. CONTENT STUDIO — TURSO TABLES

All tables prefixed `cmo_*`. Schema auto-migrates on first load via `schema.ts`.

| Table | Purpose |
|-------|---------|
| `cmo_brands` | Brand entities (Galaxy, Elysia, etc.) |
| `cmo_channels` | Social accounts per brand |
| `cmo_content` | Content pipeline items |
| `cmo_scripts` | Script drafts linked to content |
| `cmo_ideas` | Monthly idea pitches |
| `cmo_shoots` | Shoot scheduling |
| `cmo_performance` | Synced social metrics |
| `cmo_team` | Team members & capacity |
| `cmo_sync_log` | API sync history |
| `cmo_comments` | Content feedback thread |
| `cmo_activity_log` | Full audit trail |

### `cmo_content` key fields
```sql
id, brand_id, title, format (Reel|Short|Long-form|Carousel|Post)
platform (Instagram|YouTube|Facebook|LinkedIn)
stage (Idea|Script Writing|Editing|Shooting|Approved|Published)
priority (Low|Normal|High|Urgent)
writer, editor, talent
start_date, due_date, publish_date, shoot_date
ext_platform, ext_id, ext_url   -- for synced content
source (manual|sync)
```

---

## 6. ROUTING

```
/login                          Public — Google Sign-In
/ (protected shell)
├── /                           Dashboard (role-based DashboardRouter)
├── /leads                      Lead list (Kanban/List/Groupby-month)
├── /leads/:id                  Lead detail + activity log
├── /follow-ups                 Overdue/today/upcoming follow-ups
├── /partners                   B2B partner list
├── /partners/:id               Partner detail
├── /customers                  Customer list
├── /customers/:id              Customer detail
├── /quotations                 Quotation list
├── /quotations/new             Create quote (5-step wizard)
├── /quotations/:id/edit        Edit quote
├── /quotations/:id/boq         BOQ PDF preview
├── /projects                   Project list
├── /projects/:id               Project detail
├── /daily-reports              Daily report submission
├── /content-studio             Content Studio (sub-routed)
│   ├── /                       Overview
│   ├── /brands                 Brand management
│   ├── /pipeline               Content kanban
│   ├── /ideas                  Monthly ideas
│   ├── /scripts                Script review
│   ├── /editing                Editing board
│   ├── /calendar               Production calendar
│   ├── /shoots                 Shoot scheduling
│   ├── /performance            Analytics
│   ├── /insights               Aggregated insights
│   ├── /reports                Reports
│   ├── /connections            Social sync status
│   └── /activity               Audit log
├── /notifications              Notification inbox
├── /inventory                  Inventory list
└── /settings                   User & product management
```

All routes are **React.lazy()** loaded — Suspense shows `<PageLoader>` while chunk loads.

---

## 7. ROLE-BASED ACCESS CONTROL (RBAC)

### Roles
| Role | Description |
|------|-------------|
| `super_admin` | Full access, user approval, settings |
| `management` | KPI dashboards, quotation approval, user management |
| `dept_head` | Department dashboard, quotation approval, follow-ups, inventory |
| `bd_exec` | Leads, partners, follow-ups |
| `project_manager` | Projects, quotations, customers, invoices, inventory |
| `marketing` | Content Studio only |
| `ai_team` | Full access + special dashboards |
| `pending` | Logged in but not yet approved |

### Module Access (from `lib/utils.ts`)
```typescript
const MODULE_ACCESS: Record<string, UserRole[]> = {
  'leads':           ['bd_exec', 'dept_head'],
  'partners':        ['bd_exec', 'dept_head'],
  'follow-ups':      ['bd_exec', 'dept_head'],
  'customers':       ['project_manager', 'dept_head', 'bd_exec'],
  'quotations':      ['project_manager', 'dept_head'],
  'projects':        ['project_manager', 'dept_head'],
  'daily-reports':   ['bd_exec', 'project_manager', 'marketing', 'dept_head'],
  'notifications':   ['bd_exec', 'project_manager', 'marketing', 'dept_head'],
  'content-studio':  ['marketing'],
  'inventory':       ['dept_head', 'project_manager'],
  'settings':        []   // fullAccess check (super_admin + ai_team)
}
```

`super_admin` and `ai_team` have full access to everything (bypass module check).

### Auth Flow
1. User clicks "Sign in with Google" → Firebase OAuth popup
2. `onAuthStateChanged` fires → check `users/{uid}` in Firestore
3. **New user:** create `users` doc with `role: 'pending'` + create `accessRequests` doc
4. **Returning pending:** show PendingApprovalPage
5. **Approved:** load user doc into AuthContext → role-specific dashboard

---

## 8. KEY BUSINESS LOGIC

### 8.1 Lead AI Score (0–100)
Calculated automatically on lead creation via `calculateLeadScore()`:
```
Source contribution:
  referral      → +25
  partner       → +20
  google_ads    → +15
  linkedin/meta → +12
  instagram/fb  → +10
  justdial      → +8
  indiamart     → +6
  cold_call     → +3

Budget contribution:
  ≥ 500,000  → +25
  ≥ 200,000  → +12
  ≥ 100,000  → +6

Floor plan uploaded → +20
Max possible = 70 (score is capped at 100)
```

### 8.2 Lead Code Generation
Atomic counter using Firestore transaction on `meta/counters.leadCount`:
```
GHA-L-2026-001, GHA-L-2026-002, ...
```
Same pattern for quotations (`GHA-Q`) and projects (`GHA-P`).

### 8.3 Lead Duplicate Prevention
Phone number normalized to 10 digits before create. Firestore query checks `where('phone', '==', normalizedPhone)`. If exists — toast error with existing lead name + offer Stock In.

### 8.4 Follow-up Notification System

**Two layers:**

1. **Browser notifications** (`useFollowUpNotifier.ts`)
   - Runs every 60 seconds while app is open
   - Fetches ALL leads with `nextFollowUp != null` (not just assigned)
   - Fires `Notification()` API when `dueMs <= now` and not already fired this session
   - Session storage tracks fired lead IDs to prevent duplicates
   - Requires `Notification.permission === 'granted'`

2. **In-app notification panel** (`NotificationPanel.tsx`)
   - Bell icon in header opens dropdown
   - Fetches overdue (`dueMs < now`) + today upcoming (`dueMs > now AND same day`)
   - Sections: Overdue (red), Today (yellow), Other app notifications
   - Count badge = overdue.length + unread app notifications
   - Refetches on every panel open
   - "View all follow-ups →" links to `/follow-ups`

### 8.5 Follow-ups Page Logic
```
Tab: Today
  Overdue = nextFollowUp < now (sorted oldest first = most urgent)
  Today   = nextFollowUp >= now AND same calendar day (sorted by time)

Tab: Tomorrow
  Same calendar day as tomorrow

Tab: Upcoming
  nextFollowUp >= dayAfterTomorrow (first 10 only)

Active = exclude won/lost leads
```

**Mark Done flow:** Circle button → modal opens → pick activity type (call/meeting/whatsapp/email/note) → write notes (required) → optional next follow-up date → saves activity to `leads/{id}/activities` subcollection → sets `nextFollowUp: null` (or new date if rescheduled) → removes from list

### 8.6 Project Progress Bar
Progress shown on ProjectsPage is computed from **real workflow data** (not stored `completionPercent`):
```typescript
const done = workflowSnap.docs.filter(d => d.data().status === 'completed').length
const total = workflowSnap.docs.length
pct = total > 0 ? Math.round((done / total) * 100) : (project.completionPercent ?? 0)
label = `${done}/${total} stages`
```

### 8.7 Quotation Pricing Engine (`lib/pricingEngine.ts`)
```
1. aggregateRoomProducts(rooms[]) → { productId: totalQty }

2. computePricing(rooms, products, sectionDiscounts):
   → lineItems[] sorted by category
   → sections[] per category with:
      - subtotal (qty × unitPrice)
      - discount amount
      - discounted amount
      - installation rate:
          LCD_PANELS → 0%
          LOCKS      → 10%
          all others → 15%
      - installationAmount (applied AFTER discount)
   → totals: productSubtotal, discountAmount, discountedSubtotal,
             totalInstallation, grandSubtotal, taxAmount (18%), total
```

### 8.8 Inventory Stock Calculation
```
closingStock = openingStock + importedQty - issuedQty

stockStatus:
  closingStock === 0         → out_of_stock
  closingStock <= reorderLevel → low_stock
  else                       → in_stock
```

---

## 9. KEY FILES — DETAILED NOTES

### `src/lib/firebase.ts`
Re-exports all Firestore operations + custom helpers:
- `signInWithGoogle()` — OAuth popup
- `signOut()`
- `uploadFile(path, file)` → URL
- `uploadBase64(path, base64, mime)` → URL
- `deleteDocument(collection, id)` — aliased as `deleteDoc` in some places
- Re-exports: `collection, doc, query, where, orderBy, limit, onSnapshot, Timestamp, serverTimestamp, writeBatch, arrayUnion, runTransaction, getDocs, getDoc, addDoc, updateDoc`

### `src/lib/utils.ts`
- `LEAD_STATUS_CONFIG` — maps status → `{ label, color, bg }`
- `canAccess(role, module)` — RBAC check
- `formatDate(ts, fmt?)` — date-fns powered, handles Timestamp/Date/string/null
- `formatCurrency(n)` — Indian rupee format
- `calculateLeadScore({ source, estimatedBudget, floorPlanUrl? })` → number
- `toDate(value)` — safely converts any timestamp to Date (returns null if invalid — **important: prevents "Invalid time value" crashes**)

### `src/modules/leads/LeadDetail.tsx`
Left panel:
- **Contact card**: phone, whatsapp (wa.me link), email, address, source, business type, partner, date added
- **Project Details card**: project type, property size, budget, assigned to, demo given, follow-up, notes (always shown)

Right panel: Activity Timeline

Edit modal fields (in order): Full Name, Phone, Email, WhatsApp, Address, Lead Source, Assign To, Project Type, Property Size, Budget, Date Added, Notes

`saveEdit()` explicitly picks fields — never spreads `editData` directly (prevents Firestore errors from unknown/id fields).

### `src/modules/leads/LeadForm.tsx`
Creates a new lead. Key fields saved to Firestore:
- leadCode, status (new), businessType, source, name, phone, email, whatsapp, address
- projectType, propertySize, estimatedBudget
- assignedTo, assignedToName
- partnerId, partnerName (B2B only)
- demoGiven, notes *(fixed 2026-07-01 — was missing from addDoc)*
- aiScore, aiScoreNote
- createdBy, createdAt, updatedAt

### `src/modules/leads/FollowUpsPage.tsx`
- Mark Done modal: saves to `activities` subcollection, sets `nextFollowUp = null` (or new date)
- Edit date modal: datetime-local picker, updates `nextFollowUp` in Firestore
- All users (super_admin, management, dept_head, bd_exec) see ALL follow-ups

### `src/modules/projects/ProjectsPage.tsx`
Fetches workflow subcollection for each project to compute real progress:
```typescript
// state: Record<string, { total: number; done: number }>
const done = wSnap.docs.filter(d => d.data().status === 'completed').length
counts[p.id] = { total, done }
```

### `src/components/layout/NotificationPanel.tsx`
Self-contained bell — no props needed. Manages own state:
- Fetches follow-ups on mount and on every panel open
- Fetches app notifications via `onSnapshot` (live updates)
- `totalCount = overdue.length + unreadAppNotifs.length` → badge

### `src/hooks/useFollowUpNotifier.ts`
- Queries ALL leads with `nextFollowUp != null` (not filtered by assignedTo)
- Fires browser notification when `dueMs <= now` (no time window restriction)
- Caches fired IDs in `sessionStorage` key `galaxy_crm_fired_followups`
- Resets cache on userId change (prevents cross-user leaks)

---

## 10. CONTENT STUDIO SOCIAL INTEGRATIONS

### Instagram (`integrations/instagram.ts`)
- Graph API v21.0
- Fetches: followers_count, media (up to 50)
- Per post metrics via `/insights`: reach, saved, shares, views
- Direct fields: like_count, comments_count
- Token: Long-lived User Token → set as `VITE_IG_ACCESS_TOKEN`

### Facebook (`integrations/facebook.ts`)
- Graph API v21.0
- Fetches posts via **field expansion** (not `/posts` endpoint — requires `pages_read_user_content` which needs Live app)
- URL pattern: `/{pageId}?fields=posts.limit(N){id,message,reactions.summary(true),comments.summary(true),shares}`
- Reactions/comments/shares come from field expansion (works with `pages_read_engagement`)
- Reach/impressions via `/insights` (needs `read_insights`)
- Token: Page Access Token (never-expiring) from `/me/accounts`
- **App must be in Live/Published mode for `pages_read_user_content`**

### YouTube (`integrations/youtube.ts`)
- YouTube Data API v3
- No OAuth needed — API key only (public channel data)

### LinkedIn (`integrations/linkedin.ts`)
- Marketing API — requires app review approval
- `r_organization_social` + `rw_organization_admin` scopes

### Sync Flow
`syncAll()` in `integrations/index.ts`:
1. Loop through configured providers
2. Call `pull(limit)` → returns `AccountResult { ok, posts[], follower_count, error? }`
3. Upsert `cmo_channels` (follower count, last_synced)
4. For each post: upsert `cmo_content`, then delete + insert `cmo_performance`
5. Log to `cmo_sync_log`
6. Returns `SyncSummary[]` shown in UI

---

## 11. UI COMPONENT CONVENTIONS

- **Dark theme** — bg-gray-950 base, glass-card for panels
- **`glass-card`** CSS class — semi-transparent dark surface with border
- **Status colors** — defined in `LEAD_STATUS_CONFIG`, `PROJECT_STATUS_CONFIG`, etc. Always use config, never hardcode colors
- **Toast** — `react-hot-toast` via `toast.success()` / `toast.error()`
- **Icons** — Lucide React only
- **Forms** — React Hook Form + Zod; custom `Input`, `Select`, `Textarea` components
- **Loading states** — `<LoadingSpinner>` for sections, `<PageLoader>` for full page
- **Empty states** — `<EmptyState>` component with icon, title, subtitle, optional action

---

## 12. TESTING

### Setup
```bash
npm run test          # Run once
npm run test:watch    # Watch mode
npm run test:ui       # Vitest UI
```

### Test Files
- `src/lib/__tests__/pricingEngine.test.ts` — 20+ tests
  - `aggregateRoomProducts` scenarios
  - Installation rate lookups per category
  - Discount applied before installation
  - Multi-category aggregation

- `src/lib/__tests__/utils.test.ts`
  - Module access: follow-ups (bd_exec/dept_head: yes; marketing/PM: no)
  - Module access: inventory (super_admin/management: yes; bd_exec: no)

---

## 13. BUILD & DEPLOYMENT

```bash
npm run dev      # Vite dev server (localhost:5173)
npm run build    # tsc + vite build (production)
npm run preview  # Preview production build locally
```

**Deployment:** Vercel (auto-deploy from GitHub `main` branch)

**Build checks:** TypeScript strict mode (`tsc`) runs before Vite bundle. Any type error fails the build.

**Sentry:** Only initialized when `VITE_SENTRY_DSN` is set. Sampling:
- Browser tracing: 20%
- Session replay: 10%
- Error replay: 100%

---

## 14. KNOWN FIXES & IMPORTANT DECISIONS

| Date | Decision / Fix |
|------|---------------|
| 2026-07-01 | `notes` field added to `Lead` TypeScript interface and to `addDoc` payload in LeadForm — was missing, causing notes to silently not save |
| 2026-07-01 | `toDate()` in utils.ts returns `null` for invalid dates (not throws) — prevents "Invalid time value" crashes from Firestore `serverTimestamp()` in optimistic UI state |
| 2026-07-01 | Activity log optimistic update uses `Timestamp.fromDate(new Date())` not `serverTimestamp()` — FieldValue objects cannot be rendered as dates |
| 2026-07-01 | `saveEdit()` in LeadDetail explicitly picks fields to update — spreading full `editData` causes Firestore errors from invalid/id fields |
| 2026-07-01 | Follow-up overdue logic compares against `now` (not midnight) — same-day past-time leads correctly show as Overdue |
| 2026-07-01 | Browser notifications query all leads (not `where('assignedTo', '==', userId)`) — all BD team + admin get notifications for all follow-ups |
| 2026-07-01 | Facebook posts fetched via field expansion on page object (not `/posts` endpoint) — `/posts` requires `pages_read_user_content` which needs Live app mode |
| 2026-07-01 | Project progress bar computed from real milestone completion counts — `completionPercent` stored field was unreliable |

---

## 15. FIREBASE SECURITY RULES (RECOMMENDED)

Not included in codebase — must be set in Firebase Console. Recommended rules:

```
users: read own doc; admin can read all; admin can write all
leads: bd roles can read/write; admin can read/write
projects: pm roles can read/write; admin can read/write
notifications: read own only
meta/counters: read any authenticated; write none (use transactions from client with proper rules)
```

---

## 16. CODE STYLE & CONVENTIONS

- All code in TypeScript — no `any` unless unavoidable (e.g. Firestore timestamps)
- Tailwind for all styling — no inline style objects except for dynamic values
- `cn()` utility from utils.ts for conditional class merging
- Zod schemas for all form validation
- React Hook Form for all forms (not useState per field)
- No class components — function components only
- File naming: PascalCase for components, camelCase for hooks/utils
- `@/` path alias maps to `src/`
