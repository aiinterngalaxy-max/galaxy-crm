# Galaxy CRM — Full Project Handover
**For: Manan (AI Head)**
**From: Aryan Mehta**
**Date: July 2026**

---

## 1. What This Project Is

Galaxy CRM is a custom internal CRM built specifically for **Galaxy Home Automation** — a company that installs smart home systems (switches, lighting, curtains, audio/video, etc.). It replaces spreadsheets and WhatsApp threads with a structured system for managing leads, quotations, projects, invoices, inventory, and B2B partners.

**Live URL:** `https://galaxy-home-automation-crm.vercel.app`
**GitHub:** `https://github.com/aiinterngalaxy-max/galaxy-crm`
**Firebase Project:** Galaxy Home Automation (check Aryan for credentials)

---

## 2. Tech Stack — Quick Reference

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript (strict), Vite |
| Styling | Tailwind CSS, glass-morphism dark UI, gold (#C9A840) brand colour |
| Backend | **Firebase only** — Auth (Google OAuth), Firestore (real-time), Storage |
| Routing | React Router DOM v6 |
| Forms | React Hook Form + Zod |
| Notifications | react-hot-toast |
| Deployment | Vercel (auto-deploys on push to `main`) |

**There is no backend server.** Everything is Firebase. Firestore rules enforce security server-side.

> For the full architecture deep-dive, read `GALAXY_CRM_REFERENCE.md` in the project root. It covers every file, every Firestore collection, every TypeScript type, and every business logic rule.

---

## 3. Running Locally

```bash
npm install
npm run dev        # starts at localhost:5173
```

Firebase config is in `src/lib/firebase.ts` — already connected to production Firebase. Do not create a separate Firebase project unless you want a staging environment.

**To deploy:** just `git push origin main` — Vercel auto-deploys in ~2 minutes.

---

## 4. Codebase Map

```
src/
├── App.tsx                        # All routes defined here
├── types/index.ts                 # Every TypeScript interface
├── lib/
│   ├── firebase.ts                # Firebase init + helpers (addDocument, updateDocument)
│   ├── utils.ts                   # canAccess(), calculateLeadScore(), cn(), etc.
│   └── counters.ts                # nextLeadCode(), nextQuotationCode(), etc.
├── contexts/
│   └── AuthContext.tsx            # useAuth() hook — user, role, loading
├── components/
│   ├── ui/                        # Button, Input, Select, Card, Badge, Modal, Textarea
│   └── layout/                   # Sidebar, Header, RequireRole
└── modules/
    ├── auth/                      # LoginPage, PendingApprovalPage
    ├── dashboard/                 # Role-specific dashboards (Management, BD, PM, AI)
    ├── leads/                     # LeadsPage, LeadDetail, LeadForm, ActivityLog, FollowUpsPage
    ├── customers/                 # CustomersPage, CustomerDetail
    ├── quotations/                # QuotationsPage, QuotationBuilder (full wizard)
    ├── projects/                  # ProjectsPage, ProjectDetail, ProjectMaterials
    ├── inventory/                 # InventoryPage, ScannerModal
    ├── partners/                  # PartnersPage, PartnerDetail  (B2B module)
    ├── notifications/             # NotificationsPage
    ├── daily-reports/             # DailyReportsPage
    └── settings/                  # SettingsPage, ProductCatalogTab
```

---

## 5. Roles & Access Control

Roles (stored in Firestore `users` collection):

| Role | Access |
|------|--------|
| `super_admin` | Everything |
| `management` | Everything except super_admin-only deletes |
| `dept_head` | Leads, Quotations, Projects, Inventory, Partners |
| `bd_exec` | Leads, Partners |
| `project_manager` | Projects, Quotations (view), Inventory (issue only) |
| `marketing` | Dashboard, Daily Reports |
| `ai_team` | Dashboard, AI Digest |
| `pending` | Only sees pending approval page |

Access gating uses `canAccess(role, module)` from `src/lib/utils.ts` and `<RequireRole module="x">` wrapper in routes.

New users sign in with Google → get `pending` role → management approves in Settings.

---

## 6. Firestore Collections

| Collection | Purpose |
|------------|---------|
| `users` | Staff accounts with roles |
| `leads` | All sales leads (B2B + B2C) |
| `leads/{id}/activities` | Call logs, notes, status changes |
| `customers` | Converted clients |
| `quotations` | Quotation wizard output |
| `projects` | Active installation projects |
| `projects/{id}/orderItems` | Materials mapped from CSV quotation upload |
| `inventory` | Stock items (Elysia switches/sockets, Vitrum panels) |
| `stockTransactions` | Immutable stock in/out log |
| `partners` | B2B partners (architects, designers, builders) |
| `notifications` | Per-user notifications |
| `dailyReports` | Staff daily activity reports |
| `meta` | Counters for lead codes, quotation codes, etc. |
| `auditLogs` | Write-only audit trail |

---

## 7. Key Business Logic

### Lead Flow
`new → contacted → qualified → floor_plan → quote_sent → won / lost`

- Leads can be **B2C** (direct client) or **B2B** (via an architect/designer/builder partner)
- B2B leads: client phone/email are hidden — only the partner relationship matters
- Lead score = base(30) + source score + budget score + floor plan bonus (max 100)
- Source scores: referral=25, partner=20, google_ads=15, linkedin=12, meta_ads=10, justdial=7, indiamart=7, cold_call=3

### Quotation Wizard
Multi-step: Customer → Floor Plan → Rooms → Products → Pricing → Preview → Approval workflow

### Inventory
Two product lines:
- **Elysia** — Galaxy's own switches/sockets. Items named as `{Module} {Color}` e.g. `4T Grey`
- **Vitrum** — Third-party panels. Items have complex module/finish codes.

Stock In/Out tracked via `stockTransactions` (append-only).

### B2B Partners
Tracked in `partners` collection. Each lead stores `partnerId` + `partnerName`. PartnersPage computes per-partner stats (total leads, conversions, revenue) live from the leads collection.

---

## 8. What Has Been Built (Recent Work by Aryan + Claude)

### ✅ B2B Partners Module
- `src/modules/partners/PartnersPage.tsx` — grid of partner cards, stats, add modal
- `src/modules/partners/PartnerDetail.tsx` — full profile, edit, leads table
- GST number required field (15-char, auto-uppercase)
- Sidebar entry between Leads and Customers
- Firestore rules added for `partners` collection

### ✅ Lead Form Updated for B2B
- B2B/B2C radio toggle at top of form
- Partner picker dropdown (active partners only)
- Phone optional for B2B, email/WhatsApp hidden for B2B
- Auto-sets source to `'partner'` for B2B leads
- Saves `partnerId`, `partnerName`, `businessType`

### ✅ Lead Sources Updated
New sources: `referral`, `partner`, `google_ads`, `linkedin`, `meta_ads`, `instagram`, `facebook`, `justdial`, `indiamart`, `cold_call`, `other`

### ✅ Lead Scoring Reworked
Source-weighted scoring replacing old flat system (see `src/lib/utils.ts → calculateLeadScore`)

### ✅ Elysia Switch Scanner (INCOMPLETE — see Section 9)
- `src/modules/inventory/ScannerModal.tsx`
- Camera modal on Inventory page (Elysia tab only, `canManage` roles)
- Uses back camera + torch on mobile
- Attempts to count icons via projection-based CV
- **Currently inaccurate** — needs ML to be reliable

---

## 9. Pending Work — Your Main Task

### 🔴 Elysia Switch Scanner — Needs ML Model

**The problem:** Aryan wants to hold an Elysia switch up to the camera and have the app automatically identify which variant it is (1 Touch, 4 Touch, 6 Touch, 8 Touch) so he can do a stock in/out without searching manually.

**Why pure CV failed:** The icons on each switch are small and visually similar in terms of pixel counts. Projection-based blob counting keeps getting wrong results across different lighting, angles, and switch colours.

**The right solution: Google Teachable Machine**

This is a free, no-code ML training tool that exports a TensorFlow.js model you drop directly into the React app. Accuracy will be 90%+.

**Steps for Manan:**

**Step A — Train the model (Aryan does this, ~20 minutes)**
1. Go to https://teachablemachine.withgoogle.com
2. Click **Get Started → Image Project → Standard image model**
3. Create 4 classes:
   - `1T` — hold each 1-Touch switch in front of webcam, record ~50 samples. Vary the angle slightly, vary distance. Do multiple switch colours if available.
   - `4T` — same for 4-Touch
   - `6T` — same for 6-Touch (3 slim panels side by side)
   - `8T` — same for 8-Touch (2 stacked panels, 4 icons each)
4. Click **Train Model** (takes 2-3 minutes in browser)
5. Click **Export Model → TensorFlow.js → Download**
6. Share the downloaded zip with Manan

**Step B — Integrate into the app (Manan does this)**

The exported zip contains:
- `model.json`
- `weights.bin`
- `metadata.json`

1. Put these files in `public/elysia-model/`
2. Install TensorFlow.js:
   ```bash
   npm install @tensorflow/tfjs @tensorflow-models/mobilenet
   ```
   Actually Teachable Machine uses its own loader:
   ```bash
   npm install @tensorflow/tfjs @teachablemachine/image
   ```
3. Replace the `analyzeFrame` CV logic in `ScannerModal.tsx` with the Teachable Machine loader:

```typescript
import * as tmImage from '@teachablemachine/image'

// Load once when modal opens
const MODEL_URL = '/elysia-model/'
const model = await tmImage.load(MODEL_URL + 'model.json', MODEL_URL + 'metadata.json')

// Each frame:
const prediction = await model.predict(videoElement)
// prediction = [{ className: '1T', probability: 0.95 }, ...]
const best = prediction.reduce((a, b) => a.probability > b.probability ? a : b)
if (best.probability > 0.80) {
  // best.className is '1T', '4T', '6T', or '8T'
  const touchCount = parseInt(best.className)
  // feed into existing lock/confirm flow
}
```

4. The existing lock-after-1.5s stability logic and StockModal integration stays exactly as-is — only the detection function changes.

**Current scanner flow (keep this, just replace detection):**
- User opens scanner from Inventory page header (Elysia tab only)
- Camera opens with guide box overlay
- Detection runs every 250ms
- When same result holds at >80% confidence for 1.5s → locks
- Shows matched inventory items (filtered by touch variant)
- User taps Stock In or Issue → opens existing StockModal

**Switch visual reference (for training photos):**

| Variant | Description |
|---------|-------------|
| 1T | 1 wide panel, 1 small icon (2×2 dot grid) at bottom-center |
| 4T | 2 wide panels stacked, 1 icon per corner = 4 icons total (2 rows × 2 cols) |
| 6T | 3 slim panels side by side, 2 dash icons per panel = 6 total |
| 8T | 2 wide panels stacked, 4 icons per panel = 8 total (4 rows × 2 cols) |

---

## 10. Environment Setup Checklist

- [ ] Clone: `git clone https://github.com/aiinterngalaxy-max/galaxy-crm`
- [ ] `npm install`
- [ ] `npm run dev` — should run at localhost:5173
- [ ] Sign in with your Google account → you'll get `pending` role → ask Aryan to approve in Settings
- [ ] Aryan sets your role to `super_admin` or `ai_team` as needed
- [ ] Vercel is already connected to `main` branch — just push to deploy

---

## 11. Coding Conventions (Follow These)

- **No comments** unless the why is genuinely non-obvious
- **No console.logs** in committed code
- **Tailwind only** for styling — use `cn()` from `src/lib/utils.ts` for conditional classes
- **Glass-morphism classes:** `glass-card`, `page-title`, `form-label` (defined in `src/index.css`)
- **Gold colour:** `text-gold-400`, `border-gold-500`, `bg-gold-500/10` etc.
- **Firestore writes:** always include `updatedAt: serverTimestamp()`, use helpers from `src/lib/firebase.ts`
- **Icons:** Lucide React only — pass as JSX: `icon={<Camera className="w-4 h-4" />}` (not the component reference)
- **Forms:** React Hook Form + Zod always — no uncontrolled inputs
- **Toast notifications:** `import toast from 'react-hot-toast'` — `toast.success()`, `toast.error()`
- **Commit and push every change** — Vercel auto-deploys, treat every push as a deploy

---

## 12. Files to Read First

In order of importance:

1. `GALAXY_CRM_REFERENCE.md` — complete project bible (architecture, all types, all collections, all patterns)
2. `src/types/index.ts` — every TypeScript interface
3. `src/lib/utils.ts` — canAccess(), calculateLeadScore(), utility functions
4. `src/App.tsx` — all routes and role guards
5. `src/modules/inventory/ScannerModal.tsx` — the scanner you'll be fixing
6. `src/components/layout/Sidebar.tsx` — navigation structure
7. `firestore.rules` — security rules for all collections

---

## 13. Contact

- **Aryan Mehta** — product owner, knows all the business logic
- **Firebase Console** — ask Aryan for access (galaxy.homeauto@gmail.com account)
- **Vercel Dashboard** — connected to the same GitHub account

Good luck Manan 🤝
