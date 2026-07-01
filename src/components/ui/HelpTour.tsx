import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types'

// ─── Tour step definition ──────────────────────────────────────────────────────
interface TourStep {
  title: string
  content: string
  // CSS selector to highlight. If omitted, shows as a centered modal with no highlight.
  selector?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}

// ─── Tour content — per page, per role ────────────────────────────────────────

const TOURS: Record<string, Record<string, TourStep[]>> = {

  // ── Dashboard ──────────────────────────────────────────────────────────────
  '/': {
    default: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard — your home base. Everything you need for your day is right here. Let\'s take a quick tour so you\'re comfortable using the system.' },
      { title: 'Sidebar Navigation', content: 'On the left side you\'ll see the menu. Each item takes you to a different part of the system — Leads, Projects, Inventory, and more. Tap any item to navigate.', selector: 'nav, aside, [class*="sidebar"]' },
      { title: 'Your Stats', content: 'These cards show you live numbers — how many leads are active, projects running, and tasks pending. They update automatically as the team uses the system.', selector: '[class*="stat"], [class*="card"]:first-of-type' },
      { title: 'Notifications Bell 🔔', content: 'See that bell icon in the top right? That\'s where all your alerts go — new leads assigned to you, follow-up reminders, approvals needed. Always check it when you log in.', selector: '[href*="notification"], a[href="/notifications"]' },
      { title: 'You\'re all set!', content: 'That\'s the dashboard. Use the sidebar to explore each section. Tap "?" anytime on any page to get a guide for that specific page.' },
    ],
    bd_exec: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard. As a BD Executive your main job here is managing leads — the people who are interested in Galaxy\'s products. Let\'s walk through it.' },
      { title: 'Your Lead Stats', content: 'These numbers show how your leads are doing — how many are new, how many you\'ve contacted, how many have converted. Track this daily.', selector: '[class*="stat"], [class*="card"]:first-of-type' },
      { title: 'Quick Access', content: 'The sidebar on the left has Leads, Follow Ups, and B2B Partners — those are your main sections. Everything else is secondary for your role.' },
      { title: 'Notifications 🔔', content: 'The bell icon shows follow-up reminders and new leads assigned to you. Check it every morning when you start work.', selector: 'a[href="/notifications"]' },
      { title: 'You\'re good to go!', content: 'Head to the Leads section to get started. Tap "?" on any page for a guide specific to that page.' },
    ],
    project_manager: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard. As a Project Manager you\'ll mainly work in Projects, Inventory, and Quotations. Let\'s orient you.' },
      { title: 'Project Stats', content: 'These cards show your active projects, pending milestones, and any overdue tasks. Check these every morning.', selector: '[class*="stat"], [class*="card"]:first-of-type' },
      { title: 'Your Sections', content: 'In the sidebar — Projects is where you manage site work, Inventory is for tracking materials, Quotations is where you review and approve estimates.' },
      { title: 'Notifications 🔔', content: 'You\'ll get alerts here when quotations need your approval, or when a milestone is overdue. Don\'t ignore the bell.', selector: 'a[href="/notifications"]' },
      { title: 'Ready!', content: 'Go to Projects to see your current work. Tap "?" on any page for help.' },
    ],
    management: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Management Dashboard — a full overview of the entire business. Revenue, leads, projects, team performance — all in one place.' },
      { title: 'Business Overview', content: 'These top cards show the key numbers — total revenue, active projects, conversion rate, and team activity. These update in real time.', selector: '[class*="stat"], [class*="card"]:first-of-type' },
      { title: 'Full Access', content: 'As management you can see and control everything — approve quotations, manage staff roles in Settings, view all reports, and more.' },
      { title: 'Settings for Staff', content: 'Go to Settings to approve new staff who have signed up, change their roles, and manage the product catalog.', selector: 'a[href="/settings"]' },
      { title: 'You\'re all set!', content: 'Tap "?" on any page for a guide to that specific section.' },
    ],
  },

  // ── Leads ──────────────────────────────────────────────────────────────────
  '/leads': {
    default: [
      { title: 'Leads — Your Sales Pipeline', content: 'A lead is anyone who has shown interest in Galaxy\'s products. This page shows all leads the team is working on. Every potential customer starts here.' },
      { title: 'Lead Status Pipeline', content: 'At the top you\'ll see status tabs — New, Contacted, Qualified, Quote Sent, Won, Lost. A lead moves through these stages as you progress with the customer.', selector: '[class*="tab"], [class*="filter"]' },
      { title: 'Search & Filter', content: 'Use the search bar to find a lead by name or phone. Use the dropdowns to filter by status, source, or who the lead is assigned to.', selector: 'input[type="search"], input[placeholder*="Search"]' },
      { title: 'Each Lead Card', content: 'Each row shows the customer name, phone, status, AI score, and who it\'s assigned to. The AI score (0-100) shows how likely this lead is to convert — higher is better.' },
      { title: 'Add a New Lead', content: 'See the gold "+ Add Lead" button at the top right? Tap that whenever a new customer contacts you. Fill in their details and assign it to yourself or a teammate.', selector: 'button[class*="primary"]' },
      { title: 'Tap to Open', content: 'Tap any lead in the list to open their full profile — where you can log calls, update their status, upload a floor plan, and see the full history.' },
      { title: 'B2C vs B2B', content: 'B2C means the customer came directly. B2B means they came through an architect, designer, or builder (a partner). Both work the same way, B2B just links to a partner.' },
    ],
    bd_exec: [
      { title: 'Your Leads', content: 'This is where you spend most of your time. Every potential customer is a lead. Your job is to move them from "New" to "Won" by calling, following up, and qualifying them.' },
      { title: 'Status Tabs', content: 'These tabs filter leads by where they are in the process. Start with "New" every morning — those are the freshest leads that need a call.', selector: '[class*="tab"]' },
      { title: 'AI Score', content: 'The number next to each lead (0-100) is an AI score — it tells you how likely this lead is to convert based on source and budget. Prioritise higher scores first.' },
      { title: 'Add New Lead', content: 'Got a new inquiry? Tap "+ Add Lead". Fill in the name, phone, source (where they heard about us), and assign it to yourself.', selector: 'button[class*="primary"]' },
      { title: 'Follow Up reminder', content: 'After calling a lead, always set a follow-up date inside their profile. That\'s how you make sure nothing falls through the cracks.' },
    ],
  },

  // ── Lead Detail ────────────────────────────────────────────────────────────
  '/leads/:id': {
    default: [
      { title: 'Lead Profile', content: 'This is the full profile of one lead. Everything about this customer lives here — their contact info, status, history, and all your notes.' },
      { title: 'Update Status', content: 'As you progress with this customer, change their status — from New → Contacted → Qualified → Quote Sent → Won or Lost. This keeps the pipeline accurate.' },
      { title: 'Log a Call or Note', content: 'Every time you call this customer, tap "Log Activity". Select Call, add what happened, and set the next follow-up date. This builds a history so anyone on the team can see what\'s been done.' },
      { title: 'Activity Timeline', content: 'Scroll down to see the full history — every call, note, and status change is recorded here with a timestamp and who did it.' },
      { title: 'AI Score', content: 'The AI score updates automatically based on the lead\'s budget and source. You can\'t manually change it — it\'s calculated by the system.' },
      { title: 'Convert to Customer', content: 'When a lead says yes and you\'ve got a project starting, mark them as "Won". Management will then convert them to a Customer and create a project.' },
    ],
  },

  // ── Follow Ups ─────────────────────────────────────────────────────────────
  '/follow-ups': {
    default: [
      { title: 'Follow Ups', content: 'This page shows all the leads where you\'ve set a follow-up date. Think of it as your daily call list — these are the customers you promised to call back.' },
      { title: 'Overdue First', content: 'Red items are overdue — you were supposed to call these already. Handle these first thing every morning.' },
      { title: 'Today\'s Follow Ups', content: 'These are the calls scheduled for today. Work through this list during the day.' },
      { title: 'Tap to Open', content: 'Tap any item to open the full lead profile and log what happened on the call. Always update the follow-up date after each call.' },
    ],
  },

  // ── Partners ───────────────────────────────────────────────────────────────
  '/partners': {
    default: [
      { title: 'B2B Partners', content: 'Partners are architects, interior designers, and builders who refer clients to Galaxy. When a customer comes through a partner, the partner gets credit for that lead.' },
      { title: 'Partner Cards', content: 'Each card shows a partner\'s name, firm, type, and how many leads and how much revenue they\'ve brought in. This helps you know who your best partners are.' },
      { title: 'Add a Partner', content: 'When you tie up with a new architect or designer, tap "+ Add Partner". You\'ll need their GST number — it\'s required.', selector: 'button[class*="primary"]' },
      { title: 'Partner Stats', content: 'The top row shows total partners, active partners, and total B2B leads and conversions. Use this to track which channel is performing.' },
      { title: 'Tap to View', content: 'Tap any partner card to see their full profile — all leads they\'ve sent, revenue generated, and contact details.' },
    ],
  },

  // ── Customers ──────────────────────────────────────────────────────────────
  '/customers': {
    default: [
      { title: 'Customers', content: 'Customers are leads that have been won — they\'ve agreed to work with Galaxy. A lead becomes a customer when management converts them after a deal is confirmed.' },
      { title: 'Customer List', content: 'Each customer here has an active or past project with Galaxy. You can see their total project value and how much has been paid.' },
      { title: 'Search', content: 'Use the search bar to find a customer by name or phone quickly.', selector: 'input[type="search"], input[placeholder*="Search"]' },
      { title: 'Tap to Open', content: 'Tap any customer to see their full details — contact info, linked projects, and payment history.' },
    ],
  },

  // ── Quotations ─────────────────────────────────────────────────────────────
  '/quotations': {
    default: [
      { title: 'Quotations', content: 'A quotation is a detailed price estimate sent to a customer before a project starts. It lists all the products, quantities, and total cost.' },
      { title: 'Quotation Status', content: 'Each quotation goes through stages — Draft → Pending Approval → Approved → Sent to Customer → Customer Approved. Management approves before it goes to the customer.' },
      { title: 'Create Quotation', content: 'Tap "+ New Quotation" to start building one. You\'ll pick the customer, add rooms, add products from the catalog, and the system calculates totals automatically.', selector: 'button[class*="primary"]' },
      { title: 'Approval Flow', content: 'Once you submit a quotation, management reviews it. You\'ll get a notification when it\'s approved or if changes are needed. Don\'t send it to the customer yourself — wait for approval.' },
    ],
    project_manager: [
      { title: 'Quotations', content: 'Quotations are price estimates for customers. As a PM you\'ll create and manage these — listing all products needed for a project.' },
      { title: 'Create New', content: 'Tap "+ New Quotation" to start. Pick the customer, add each room, then add products from Galaxy\'s catalog. The system calculates GST and totals automatically.', selector: 'button[class*="primary"]' },
      { title: 'Get Approval', content: 'After creating, submit it for approval. Management reviews it before it goes to the customer. You\'ll get a notification on the result.' },
      { title: 'Revisions', content: 'If management requests changes, you\'ll see it marked "Revision Required". Open it, make the changes, and resubmit.' },
    ],
  },

  // ── Projects ───────────────────────────────────────────────────────────────
  '/projects': {
    default: [
      { title: 'Projects', content: 'A project is an active installation job at a customer\'s site. Every project has a customer, a PM assigned, milestones, tasks, and a budget.' },
      { title: 'Project Status', content: 'Projects can be Planning, In Progress, On Hold, or Completed. The status shows where each job is right now.' },
      { title: 'Completion %', content: 'Each project card shows a completion percentage — this updates as milestones and tasks are marked done.' },
      { title: 'Tap to Open', content: 'Tap any project to see the full detail — milestones, tasks, site reports, materials, and payment status.' },
    ],
    project_manager: [
      { title: 'Your Projects', content: 'This is where you manage all your installation jobs. Each project here is an active job at a customer\'s site that you\'re responsible for.' },
      { title: 'Project Cards', content: 'Each card shows the project name, customer, completion percentage, and risk level. Red risk means something needs attention.' },
      { title: 'Open a Project', content: 'Tap any project to manage it — update milestones, log site reports, track materials, and see payment status.' },
      { title: 'Create Project', content: 'New projects are created by management after a quotation is approved. You\'ll be assigned to it and get a notification.', selector: 'button[class*="primary"]' },
    ],
  },

  // ── Project Detail ─────────────────────────────────────────────────────────
  '/projects/:id': {
    default: [
      { title: 'Project Detail', content: 'This is the full view of one project. Everything about this job is here — the customer, timeline, tasks, materials, payments, and site reports.' },
      { title: 'Milestones', content: 'Milestones are the big stages of the project — like "Wiring Done" or "Devices Installed". Each milestone has tasks under it. Mark them complete as work progresses.' },
      { title: 'Tasks', content: 'Tasks are smaller steps inside each milestone. Assign them to team members and mark them done as they\'re completed.' },
      { title: 'Site Reports', content: 'After every site visit, log a site report — what work was done, any issues found, what\'s needed next. This keeps everyone informed.' },
      { title: 'Materials Tab', content: 'The Materials tab shows what products are needed for this project and what\'s been dispatched from inventory.' },
      { title: 'Payments', content: 'The payment section shows invoices raised, how much has been collected, and what\'s still pending.' },
    ],
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  '/inventory': {
    default: [
      { title: 'Inventory', content: 'This is where all stock is tracked — every switch, socket, and panel that Galaxy has in the warehouse. You can see what\'s in stock, what\'s low, and what\'s out.' },
      { title: 'Product Lines', content: 'At the top you\'ll see tabs — Elysia and Vitrum. These are Galaxy\'s two product lines. Select the one you want to view.', selector: '[class*="tab"]' },
      { title: 'Stock Status', content: 'Each item shows a colour — Green means in stock, Yellow means low stock (reorder soon), Red means out of stock. Always reorder when you see yellow.' },
      { title: 'Filters', content: 'Use the filters to find items by type, colour, module, or rack location. This helps when you\'re looking for a specific variant.', selector: '[class*="filter"]' },
      { title: 'Stock In / Stock Out', content: 'When new stock arrives tap "Stock In" on that item. When stock is sent to a project tap "Issue". Every movement is recorded automatically.' },
      { title: 'Scan Switch', content: 'See the "Scan Switch" button at the top? Tap it to use your camera to identify an Elysia switch and do stock in/out without searching manually.', selector: 'button' },
      { title: 'Export CSV', content: 'Need the full stock list in Excel? Tap "Export CSV" to download it instantly.', selector: 'button' },
    ],
    project_manager: [
      { title: 'Inventory', content: 'This is the stock room — everything Galaxy has in the warehouse. As a PM you can issue items to your project when materials are dispatched to site.' },
      { title: 'Finding Items', content: 'Use the tabs to switch between Elysia and Vitrum. Use filters to narrow down by colour or module type.', selector: '[class*="tab"]' },
      { title: 'Issuing Stock', content: 'When materials go to your site, find the item and tap "Issue". Enter the quantity and your project reference. This deducts from stock.' },
      { title: 'Low Stock Alert', content: 'If you see a yellow or red item you need for your project, flag it to management immediately so they can reorder.' },
    ],
  },

  // ── Daily Reports ──────────────────────────────────────────────────────────
  '/daily-reports': {
    default: [
      { title: 'Daily Reports', content: 'Every team member submits a daily report at end of day. It summarises what you did, your top win, any challenges, and your plan for tomorrow.' },
      { title: 'Submit Today\'s Report', content: 'Tap "Submit Report" or the gold button to fill in today\'s report. It takes 2-3 minutes. Do this before you leave for the day.', selector: 'button[class*="primary"]' },
      { title: 'Pre-filled Summary', content: 'The system automatically fills in your activity stats — calls made, leads updated, etc. You just need to add your personal notes.' },
      { title: 'Top Win & Challenge', content: 'Fill in your biggest win of the day (even something small counts) and the main challenge you faced. Management reads these.' },
      { title: 'History', content: 'You can see all your past reports below. Management can also see them to track team performance.' },
    ],
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  '/notifications': {
    default: [
      { title: 'Notifications', content: 'This is your notification centre — every alert, reminder, and update from the system appears here.' },
      { title: 'Types of Notifications', content: 'You\'ll get notified when: a lead is assigned to you, a follow-up is due, a quotation is approved or rejected, a payment is received, or a project milestone is overdue.' },
      { title: 'Mark as Read', content: 'Tap any notification to mark it as read and go to the related item. Unread notifications show a blue dot.' },
      { title: 'Check Daily', content: 'Make it a habit to check notifications every morning. Missing a follow-up reminder or an approval request can delay the whole pipeline.' },
    ],
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  '/settings': {
    default: [
      { title: 'Settings', content: 'This is the Settings area — mainly used by management. Here you can manage staff accounts, approve new users, and manage the product catalog.' },
      { title: 'Staff Management', content: 'New staff sign in with their Google account and get a "Pending" status. Come here to approve them and assign their role — BD Exec, Project Manager, etc.' },
      { title: 'Roles Matter', content: 'The role you assign determines what each person can see and do in the system. Assign carefully — a BD Exec can\'t access projects, a PM can\'t see leads.' },
      { title: 'Product Catalog', content: 'The Products tab has all the products available when creating quotations. Add new products here when Galaxy introduces new items.' },
    ],
  },

}

// ─── Get tour for current page and role ────────────────────────────────────────
function getTour(pathname: string, role: UserRole | undefined): TourStep[] {
  // Normalize dynamic routes
  const normalized = pathname
    .replace(/\/leads\/[^/]+/, '/leads/:id')
    .replace(/\/projects\/[^/]+/, '/projects/:id')
    .replace(/\/partners\/[^/]+/, '/partners/:id')
    .replace(/\/customers\/[^/]+/, '/customers/:id')

  const pageTours = TOURS[normalized] ?? TOURS[pathname]
  if (!pageTours) return []

  return pageTours[role ?? 'default'] ?? pageTours['default'] ?? []
}

function tourKey(pathname: string, role: string) {
  return `help_tour_seen_${role}_${pathname.replace(/\//g, '_')}`
}

// ─── Highlight overlay ─────────────────────────────────────────────────────────
function HighlightBox({ selector }: { selector?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!selector) { setRect(null); return }
    const el = document.querySelector(selector)
    if (el) {
      const r = el.getBoundingClientRect()
      setRect(r)
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      setRect(null)
    }
  }, [selector])

  if (!rect || !selector) return null

  const pad = 6
  return (
    <div
      className="fixed z-[9998] pointer-events-none rounded-xl transition-all duration-300"
      style={{
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        boxShadow: '0 0 0 4px #C9A840, 0 0 0 9999px rgba(0,0,0,0.45)',
      }}
    />
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export function HelpTour() {
  const { user } = useAuth()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [step, setStep]   = useState(0)

  const steps = getTour(location.pathname, user?.role)
  const current = steps[step]
  const key = tourKey(location.pathname, user?.role ?? 'default')

  // Auto-show once per page per role
  useEffect(() => {
    setOpen(false)
    setStep(0)
    if (steps.length === 0) return
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => setOpen(true), 800)
      return () => clearTimeout(t)
    }
  }, [location.pathname, user?.role])

  const close = useCallback(() => {
    localStorage.setItem(key, '1')
    setOpen(false)
    setStep(0)
  }, [key])

  const next = () => {
    if (step < steps.length - 1) setStep(s => s + 1)
    else close()
  }

  const prev = () => setStep(s => Math.max(0, s - 1))

  if (steps.length === 0) return null

  return (
    <>
      {/* Floating "?" button */}
      <button
        onClick={() => { setStep(0); setOpen(true) }}
        className="fixed bottom-6 right-6 z-[9997] w-12 h-12 rounded-full bg-gold-500 shadow-lg flex items-center justify-center hover:bg-gold-400 active:scale-95 transition-all"
        title="Help"
      >
        <HelpCircle className="w-6 h-6 text-gray-900" />
      </button>

      {/* Tour overlay */}
      {open && current && (
        <>
          {/* Backdrop (only when no selector) */}
          {!current.selector && (
            <div className="fixed inset-0 z-[9998] bg-black/50" onClick={close} />
          )}

          {/* Highlight ring around target element */}
          <HighlightBox selector={current.selector} />

          {/* Tooltip card */}
          <div className="fixed z-[9999] bottom-24 left-1/2 -translate-x-1/2 w-[92vw] max-w-sm">
            <div className="glass-card rounded-2xl p-5 shadow-2xl border border-gold-500/30">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-sm font-bold text-gray-100 leading-snug">{current.title}</h3>
                <button onClick={close} className="text-gray-500 hover:text-gray-300 shrink-0 mt-0.5">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <p className="text-sm text-gray-400 leading-relaxed mb-4">{current.content}</p>

              {/* Progress dots */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {steps.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setStep(i)}
                      className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-gold-400 w-4' : 'bg-gray-600 hover:bg-gray-500'}`}
                    />
                  ))}
                </div>

                <div className="flex gap-2">
                  {step > 0 && (
                    <button onClick={prev}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg hover:border-gray-500 transition-colors">
                      <ChevronLeft className="w-3 h-3" /> Back
                    </button>
                  )}
                  <button onClick={next}
                    className="flex items-center gap-1 px-4 py-1.5 text-xs font-semibold bg-gold-500 text-gray-900 rounded-lg hover:bg-gold-400 transition-colors">
                    {step === steps.length - 1 ? 'Done' : 'Next'} {step < steps.length - 1 && <ChevronRight className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
