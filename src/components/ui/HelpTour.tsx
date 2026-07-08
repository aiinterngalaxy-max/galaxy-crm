import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types'

interface TourStep {
  title: string
  content: string
  selector?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}

// ─── Tour content — per page, per role ────────────────────────────────────────
const TOURS: Record<string, Record<string, TourStep[]>> = {

  '/': {
    default: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard — your home base. Everything you need for your day is right here. Let\'s take a quick tour so you\'re comfortable using the system.' },
      { title: 'Sidebar Navigation', content: 'On the left side you\'ll see the menu. Each item takes you to a different part of the system — Leads, Projects, Inventory, and more. Tap any item to navigate.', selector: '[data-tour="sidebar-nav"]' },
      { title: 'Your Stats', content: 'These cards show you live numbers — how many leads are active, projects running, and tasks pending. They update automatically as the team uses the system.', selector: '[data-tour="stat-cards"]' },
      { title: 'Notifications Bell 🔔', content: 'See that bell icon? That\'s where all your alerts go — new leads assigned to you, follow-up reminders, approvals needed. Always check it when you log in.', selector: '[data-tour="notifications"]' },
      { title: 'You\'re all set!', content: 'That\'s the dashboard. Use the sidebar to explore each section. Tap "?" anytime on any page to get a guide for that specific page.' },
    ],
    bd_exec: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard. As a BD Executive your main job here is managing leads — the people who are interested in Galaxy\'s products. Let\'s walk through it.' },
      { title: 'Your Lead Stats', content: 'These numbers show how your leads are doing — how many are new, how many you\'ve contacted, how many have converted. Track this daily.', selector: '[data-tour="stat-cards"]' },
      { title: 'Quick Access', content: 'The sidebar on the left has Leads, Follow Ups, and B2B Partners — those are your main sections. Everything else is secondary for your role.', selector: '[data-tour="sidebar-nav"]' },
      { title: 'Notifications 🔔', content: 'The bell icon shows follow-up reminders and new leads assigned to you. Check it every morning when you start work.', selector: '[data-tour="notifications"]' },
      { title: 'You\'re good to go!', content: 'Head to the Leads section to get started. Tap "?" on any page for a guide specific to that page.' },
    ],
    project_manager: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Dashboard. As a Project Manager you\'ll mainly work in Projects, Inventory, and Quotations. Let\'s orient you.' },
      { title: 'Project Stats', content: 'These cards show your active projects, pending milestones, and any overdue tasks. Check these every morning.', selector: '[data-tour="stat-cards"]' },
      { title: 'Your Sections', content: 'In the sidebar — Projects is where you manage site work, Inventory is for tracking materials, Quotations is where you review and approve estimates.', selector: '[data-tour="sidebar-nav"]' },
      { title: 'Notifications 🔔', content: 'You\'ll get alerts here when quotations need your approval, or when a milestone is overdue. Don\'t ignore the bell.', selector: '[data-tour="notifications"]' },
      { title: 'Ready!', content: 'Go to Projects to see your current work. Tap "?" on any page for help.' },
    ],
    management: [
      { title: 'Welcome to Galaxy CRM 👋', content: 'This is your Management Dashboard — a full overview of the entire business. Revenue, leads, projects, team performance — all in one place.' },
      { title: 'Business Overview', content: 'These top cards show the key numbers — total revenue, active projects, conversion rate, and team activity. These update in real time.', selector: '[data-tour="stat-cards"]' },
      { title: 'Full Access', content: 'As management you can see and control everything — approve quotations, manage staff roles in Settings, view all reports, and more.' },
      { title: 'Settings for Staff', content: 'Go to Settings to approve new staff who have signed up, change their roles, and manage the product catalog.', selector: '[data-tour="settings"]' },
      { title: 'You\'re all set!', content: 'Tap "?" on any page for a guide to that specific section.' },
    ],
  },

  '/leads': {
    default: [
      { title: 'Leads — Your Sales Pipeline', content: 'A lead is anyone who has shown interest in Galaxy\'s products. This page shows all leads the team is working on. Every potential customer starts here.' },
      { title: 'Filters', content: 'Use these dropdowns to filter leads by stage, source, employee, or month. Narrow down to exactly what you need.', selector: 'select' },
      { title: 'Each Lead Row', content: 'Each row shows the customer name, phone, status, AI score, and who it\'s assigned to. The AI score (0–100) shows how likely this lead is to convert — higher is better.', selector: '[data-tour="lead-row"]' },
      { title: 'Tap to Open', content: 'Tap any lead row to open their full profile — log calls, update status, upload a floor plan, and see the full history.', selector: '[data-tour="lead-row"]' },
      { title: 'Add a New Lead', content: 'Tap the gold "+ New Lead" button whenever a new customer contacts you. Fill in their details and assign it to yourself or a teammate.', selector: '[data-tour="add-lead"]' },
      { title: 'Follow-ups', content: 'The Follow-ups button shows your daily call list — all leads where you\'ve set a callback date. Check it every morning.', selector: '[data-tour="follow-ups"]' },
    ],
    bd_exec: [
      { title: 'Your Leads', content: 'This is where you spend most of your time. Your job is to move leads from "New" to "Won" by calling, following up, and qualifying them.' },
      { title: 'Filter by Stage', content: 'Start with the "New" stage every morning — those are the freshest leads that need a call first.', selector: 'select' },
      { title: 'AI Score', content: 'The number next to each lead (0–100) tells you how likely they are to convert. Prioritise higher scores first.', selector: '[data-tour="lead-row"]' },
      { title: 'Add New Lead', content: 'Got a new inquiry? Tap "+ New Lead". Fill in the name, phone, source, and assign it to yourself.', selector: '[data-tour="add-lead"]' },
      { title: 'Follow Ups', content: 'After calling a lead, always set a follow-up date inside their profile. That\'s how nothing falls through the cracks.', selector: '[data-tour="follow-ups"]' },
    ],
  },

  '/leads/:id': {
    default: [
      { title: 'Lead Profile', content: 'This is the full profile of one lead. Everything about this customer lives here — contact info, status, history, and all notes.' },
      { title: 'AI Score', content: 'The AI score updates automatically based on budget and source — you can\'t edit it manually.', selector: '[data-tour="ai-score"]' },
      { title: 'Update Status', content: 'Change the status as you progress — New → Contacted → Qualified → Quote Sent → Won or Lost. Keeping this updated helps the whole team track the pipeline.', selector: '[data-tour="status-buttons"]' },
      { title: 'Log a Call or Note', content: 'Every time you call, tap "Log Activity". Select Call, write what happened, and set the next follow-up date. This builds a history so anyone on the team knows what\'s been done.', selector: '[data-tour="add-btn"]' },
      { title: 'Activity Timeline', content: 'Scroll down to see the full history — every call, note, and status change is recorded with a timestamp and who did it.', selector: '[data-tour="activity-timeline"]' },
      { title: 'Convert to Customer', content: 'When the lead says yes, mark them as "Won". Then tap "Convert to Customer" here — management will confirm the deal and a project gets created.', selector: '[data-tour="convert-btn"]' },
    ],
  },

  '/follow-ups': {
    default: [
      { title: 'Follow Ups', content: 'This is your daily call list — leads where you\'ve set a callback date. These are customers you promised to call back.' },
      { title: 'Overdue — Act First', content: 'Red items are overdue. You were supposed to call these already. Handle them first thing every morning before anything else.', selector: 'table tbody tr:first-child' },
      { title: 'Today\'s List', content: 'Below the overdue section are today\'s scheduled calls. Work through these during the day.' },
      { title: 'Tap to Open', content: 'Tap any item to open the lead profile, log what happened on the call, and set the next follow-up date.' },
    ],
  },

  '/b2b-campaign': {
    default: [
      { title: 'B2B Campaign', content: 'This is your cold calling campaign tool. You can import lists of potential B2B leads (architects, designers, builders) by city and segment, then call them systematically.' },
      { title: 'Import a List', content: 'Start by importing a CSV file of leads. Select the city and segment (M1 Direct or M2 Channel), then drop your CSV here. The system de-duplicates automatically.', selector: '[data-tour="import-zone"]' },
      { title: 'All Leads Tab', content: 'After importing, switch to All Leads to see everyone in the list. Search by name or phone, filter by city, model, or status.', selector: '[data-tour="tab-leads"]' },
      { title: 'Call Mode', content: 'The most powerful tab — open Call Mode to work through leads one by one. It shows a full call script (Open → Qualify → Pain → Interest → Close) and lets you log outcomes quickly.', selector: '[data-tour="tab-call"]' },
      { title: 'Log Outcome & Move On', content: 'After each call, select the outcome (Interested, Not Interested, Callback, etc.), add a note, set a follow-up date, and tap "Log & Next". It moves to the next lead automatically.', selector: '[data-tour="tab-call"]' },
      { title: 'Stats Tab', content: 'The Stats tab shows your contact rate by city and how many leads had each outcome. Use this to see which cities and segments are most productive.', selector: '[data-tour="tab-stats"]' },
    ],
  },

  '/partners': {
    default: [
      { title: 'B2B Partners', content: 'Partners are architects, interior designers, builders, and dealers who refer clients to Galaxy. Every time a customer comes through a partner, the partner gets credit for that revenue.' },
      { title: 'Partner Stats', content: 'The top cards show total partners, active partners, total B2B leads, and conversions. Use this to see how valuable the B2B channel is.', selector: '[data-tour="stat-cards"]' },
      { title: 'Partner Cards', content: 'Each card shows the partner\'s firm, type, phone, city, and their performance — leads sent, deals won, and revenue generated.', selector: '[data-tour="partner-card"]' },
      { title: 'Filter by Type', content: 'Use the filter dropdown to view partners by type — Architect, Interior Designer, Builder, Dealer, etc.', selector: 'select' },
      { title: 'Add a Partner', content: 'Tied up with a new architect or designer? Tap "+ Add Partner". Fill in their details — GST number is required for commission tracking.', selector: '[data-tour="add-btn"]' },
      { title: 'Tap to View', content: 'Tap any partner card to see their full profile — all leads they\'ve referred, revenue generated, and complete contact details.', selector: '[data-tour="partner-card"]' },
    ],
  },

  '/partners/:id': {
    default: [
      { title: 'Partner Profile', content: 'This is the full profile of one B2B partner. You can see all their contact details, performance stats, and every lead they\'ve sent to Galaxy.' },
      { title: 'Contact Details', content: 'The left card shows their phone, email, city, and GST number. Tap Edit to update any details.', selector: '[data-tour="add-btn"]' },
      { title: 'Performance Stats', content: 'The top row shows Total Leads, Won deals, Revenue generated, and Pipeline value — a quick snapshot of how valuable this partner is.', selector: '[data-tour="stat-cards"]' },
      { title: 'Their Leads', content: 'Scroll down to see every lead this partner has referred, their current status, budget, and property size. Tap any lead to open the full profile.', selector: '[data-tour="partner-leads"]' },
    ],
  },

  '/customers': {
    default: [
      { title: 'Customers', content: 'Customers are leads that have been won — they\'ve agreed to work with Galaxy. A lead becomes a customer only when management confirms the deal and converts them.' },
      { title: 'Portfolio Summary', content: 'The top cards show total customers, total portfolio value, amount collected, and outstanding payments.', selector: '[data-tour="stat-cards"]' },
      { title: 'Search', content: 'Use the search bar to find a customer quickly by name, phone, or address.', selector: 'input' },
      { title: 'Customer Row', content: 'Each row shows the customer name, tags (VIP, Repeat, At Risk), their project value, and how much has been paid.', selector: '[data-tour="customer-row"]' },
      { title: 'Tap to View', content: 'Tap any customer to see their full profile — contact info, all linked projects, quotations, and invoices.', selector: '[data-tour="customer-row"]' },
    ],
  },

  '/customers/:id': {
    default: [
      { title: 'Customer Profile', content: 'This is the complete view for one customer. All their projects, quotations, and invoices are in one place.' },
      { title: 'Summary Cards', content: 'The top cards show total projects, portfolio value, total paid, and outstanding balance at a glance.', selector: '[data-tour="stat-cards"]' },
      { title: 'Contact Info', content: 'Phone, email, and address are in the left card. All contact details are pulled from their original lead profile.', selector: '[data-tour="contact-info"]' },
      { title: 'Projects', content: 'Scroll down to see all projects linked to this customer — their status, value, and timeline. Tap any to open the project detail.', selector: '[data-tour="projects-section"]' },
      { title: 'Quotations & Invoices', content: 'Below projects you\'ll find all quotations and invoices — their status, value, and due dates. This is the full financial record for this customer.', selector: '[data-tour="quotations-invoices"]' },
    ],
  },

  '/quotations': {
    default: [
      { title: 'Quotations', content: 'A quotation is a detailed price estimate for a customer — listing all products, quantities, and the total cost before a project starts.' },
      { title: 'Quotation List', content: 'Each row shows the quotation code, customer name, total value, valid date, and current status. Tap any to open it.', selector: '[data-tour="quotation-row"]' },
      { title: 'Approval Workflow', content: 'A quotation goes: Draft → Pending Approval → Approved → Sent to Customer → Customer Approved. Management reviews and approves before it goes to the customer.', selector: '[data-tour="quotation-row"]' },
      { title: 'Action Buttons', content: 'Each quotation has action buttons — Approve, View BOQ, Convert to Project. These change based on the current status and your role.', selector: '[data-tour="quotation-actions"]' },
      { title: 'Create New Quotation', content: 'Tap "+ New Quotation" to start the builder — you\'ll pick the customer, add rooms, select products from the catalog, and the system calculates all totals and GST.', selector: '[data-tour="add-btn"]' },
    ],
    project_manager: [
      { title: 'Quotations', content: 'Quotations are price estimates you build for customers. As a PM, you create these, get them approved, and then convert them to projects.' },
      { title: 'Your Quotations', content: 'This list shows all quotations — yours and others. Use the search to find by code or customer name.', selector: 'input' },
      { title: 'Create New', content: 'Tap "+ New Quotation" to start. Pick the customer, add rooms, then add products from Galaxy\'s catalog. The system calculates GST and totals automatically.', selector: '[data-tour="add-btn"]' },
      { title: 'Get Approval', content: 'After building, submit for approval. Management reviews and approves before it goes to the customer. You\'ll get a notification either way.', selector: '[data-tour="quotation-actions"]' },
      { title: 'Revision Required', content: 'If management requests changes, the quotation shows "Revision Required". Open it, fix what\'s needed, and resubmit.', selector: '[data-tour="quotation-row"]' },
    ],
  },

  '/quotations/builder': {
    default: [
      { title: 'Quotation Builder', content: 'This is the step-by-step quotation builder. You\'ll go through 5 steps — Client Details, Floor Plan, Rooms & Products, BOQ, and Summary.' },
      { title: 'Step Indicator', content: 'The progress bar at the top shows where you are — Client Details → Floor Plan → Rooms & Products → BOQ → Summary. Complete each step to move forward.', selector: '[data-tour="step-indicator"]' },
      { title: 'Client Details', content: 'Step 1 — Pick the customer, set how many days the quote is valid, and add the payment terms and scope of work notes.', selector: '[data-tour="client-step-content"]' },
      { title: 'Rooms & Products', content: 'Step 3 — Add each room in the project (Living Room, Master Bedroom, etc.) and then add the exact products needed for each room from Galaxy\'s catalog.', selector: '[data-tour="step-rooms-pill"]' },
      { title: 'BOQ — Bill of Quantities', content: 'Step 4 — A full breakdown table of every product, quantity, unit price, and total. You can apply discounts per section here. The grand total calculates automatically.', selector: '[data-tour="step-boq-pill"]' },
      { title: 'Save & Submit', content: 'In the final Summary step, review everything and tap Save. Then submit it for approval — don\'t send to the customer before management approves.', selector: '[data-tour="step-summary-pill"]' },
    ],
  },

  '/projects': {
    default: [
      { title: 'Projects', content: 'A project is an active installation job at a customer\'s site. Each project has a PM, timeline, tasks, materials, and payment milestones.' },
      { title: 'Project Stats', content: 'The top row shows total projects by status — Planning, In Progress, On Hold, Completed, and Overdue. Tap any to filter the list.', selector: '[data-tour="stat-cards"]' },
      { title: 'Search & Filter', content: 'Search by project name, code, client name, or address. Use the status pills to filter by stage.', selector: 'input' },
      { title: 'Project Cards', content: 'Each card shows the project name, client, assigned PM, completion %, start date, and overdue flag. Red means something needs attention now.', selector: '[data-tour="project-card"]' },
      { title: 'Tap to Open', content: 'Tap any project card to open the full detail — workflow stages, tasks, site reports, materials, and payment status.', selector: '[data-tour="project-card"]' },
      { title: 'New Project', content: 'Management creates projects after a quotation is approved. You\'ll be notified and assigned automatically.', selector: '[data-tour="add-btn"]' },
    ],
    project_manager: [
      { title: 'Your Projects', content: 'Every active installation job you\'re responsible for is here. This is your main workspace as a Project Manager.' },
      { title: 'Project Status', content: 'Planning → In Progress → On Hold → Completed. Keep the status updated — management tracks all projects from this view.', selector: '[data-tour="stat-cards"]' },
      { title: 'Completion %', content: 'Each card shows a completion percentage — this updates automatically as you tick off tasks inside the project.', selector: '[data-tour="project-card"]' },
      { title: 'Overdue Alert', content: 'Red "Overdue" badge means the deadline has passed. If a project is delayed, update the status and add a site report explaining why.', selector: '[data-tour="project-card"]' },
      { title: 'Open a Project', content: 'Tap any card to manage it — update milestones, log site reports, track materials dispatched, and see payment status.', selector: '[data-tour="project-card"]' },
    ],
  },

  '/projects/:id': {
    default: [
      { title: 'Project Workspace', content: 'This is the full view of one project. Everything about this installation job is here — customer details, workflow stages, site reports, materials, and payments.' },
      { title: 'Progress & Overview', content: 'The top section shows overall completion %, key dates (start, deadline), the assigned PM, and the project code.', selector: '[data-tour="progress-overview"]' },
      { title: 'Site Details', content: 'The site card shows the client\'s phone, address, Maps link, and who the architect and electrician are. Tap Edit to update it.', selector: '[data-tour="site-details"]' },
      { title: 'Workflow Stages', content: 'Stages are the major phases of installation — like Wiring, Device Installation, Testing. Each stage has tasks inside. Expand a stage to see and tick off tasks.', selector: '[data-tour="workflow-stages"]' },
      { title: 'Site Reports', content: 'After every visit, log a site report — what was done, any issues, what\'s needed next. This is the daily record management reads.', selector: '[data-tour="site-reports"]' },
      { title: 'Materials & Files', content: 'The Materials section tracks what products were dispatched from inventory. You can also upload site layout files, DWG drawings, and site photos here.', selector: '[data-tour="materials-files"]' },
    ],
    project_manager: [
      { title: 'Your Project HQ', content: 'This is where you run the project day to day. Every task, material, report, and payment for this job is tracked here.' },
      { title: 'Workflow Stages', content: 'Expand each stage to see the task checklist. Tick off tasks as work is completed — this updates the completion % automatically.', selector: '[data-tour="workflow-stages"]' },
      { title: 'Log Site Reports', content: 'Tap "Report" to submit a daily site report. Always log what was done, any issues, and what materials or approvals are needed next.', selector: '[data-tour="add-btn"]' },
      { title: 'Materials', content: 'The Materials section shows what was dispatched from inventory to this site. If something is missing, raise it with the inventory manager.', selector: '[data-tour="materials-files"]' },
      { title: 'Client Access', content: 'Your client can track project progress themselves. Share the Client Link from the Client Access card — they\'ll see a read-only view of the project status.', selector: '[data-tour="client-link"]' },
    ],
  },

  '/inventory/elysia': {
    default: [
      { title: 'Elysia Inventory', content: 'This page tracks all Elysia product stock — switches, sockets, panels. You can see exactly what\'s in the warehouse, what\'s low, and what\'s been issued to projects.' },
      { title: 'Stock Table Tabs', content: 'Switch between "Stock Table" (current levels) and "Transaction Log" (full movement history). The log shows every Stock In and Issue with timestamp and who did it.', selector: '[data-tour="inv-tabs"]' },
      { title: 'Search & Status Filters', content: 'Use the search box to find items by name or code. Use the status pills — All, In Stock, Low Stock, Out of Stock — to instantly spot items that need reordering.', selector: '[data-tour="filters"]' },
      { title: 'Stock Table', content: 'Each row shows product code, name, color, module, rack location, and stock quantities — Opening, Imported (+), Issued (−), and Closing balance. Hover a row to see action buttons.', selector: '[data-tour="stock-table"]' },
      { title: 'Add New Item', content: 'Need to add a new Elysia product? Tap "+ Add Item". Select Switch or Socket, module, material, color, rack, and opening stock — the item code is auto-generated.', selector: '[data-tour="add-btn"]' },
    ],
  },

  '/inventory/vitrum': {
    default: [
      { title: 'Vitrum Inventory', content: 'This tracks all Vitrum product stock — the premium touch-panel line. Same stock management as Elysia but for a different product range.' },
      { title: 'Stock Table Tabs', content: 'Switch between "Stock Table" (current levels) and "Transaction Log" (full history). Every stock movement is recorded with a timestamp and the person who did it.', selector: '[data-tour="inv-tabs"]' },
      { title: 'Search & Status Filters', content: 'Use the search box to find items by name or code. Filter by status — In Stock, Low Stock, Out of Stock — to quickly see what needs to be ordered.', selector: '[data-tour="filters"]' },
      { title: 'Stock Table', content: 'Each row shows product code, specifications, rack location, and stock levels — Opening, Imported, Issued, and Closing. Hover a row to reveal Stock In / Issue buttons.', selector: '[data-tour="stock-table"]' },
      { title: 'Add New Item', content: 'Adding a new Vitrum product? Tap "+ Add Item". Fill in module, touch type, connectivity, color, rack, and opening stock — the item code is generated automatically.', selector: '[data-tour="add-btn"]' },
    ],
  },

  '/inventory/curtains': {
    default: [
      { title: 'Curtain Motors Inventory', content: 'This page tracks stock for Galaxy\'s curtain automation products — motors, tracks, and accessories.' },
      { title: 'Stock Table Tabs', content: 'Switch between "Stock Table" (current levels) and "Transaction Log" (full history). Every movement — imports and issues — is logged automatically.', selector: '[data-tour="inv-tabs"]' },
      { title: 'Search & Status Filters', content: 'Use the search box and status pills to filter items. "Low Stock" items are ones where closing stock has dropped below the reorder level.', selector: '[data-tour="filters"]' },
      { title: 'Stock Table', content: 'Each row shows product code, name, rack location, and stock levels. Hover a row to access Stock In (green) and Issue (red) buttons. Use Dispatch for project dispatch records.', selector: '[data-tour="stock-table"]' },
      { title: 'Add Item', content: 'Tap "+ Add Item" to add a new curtain component to the catalog. Fill in the code, category, name, rack, and opening stock.', selector: '[data-tour="add-btn"]' },
    ],
  },

  '/inventory/general': {
    default: [
      { title: 'General Inventory', content: 'This tracks miscellaneous stock items — sensors, hubs, cameras, networking equipment, and accessories that don\'t fall under Elysia or Vitrum.' },
      { title: 'Stock Table Tabs', content: 'Switch between "Stock Table" (current levels) and "Transaction Log" (full history). Every stock movement — imports and issues — is logged with who did it.', selector: '[data-tour="inv-tabs"]' },
      { title: 'Search & Status Filters', content: 'Use the search box to find items by name or code. Filter by status pills to see what\'s in stock, low, or out of stock at a glance.', selector: '[data-tour="filters"]' },
      { title: 'Stock Table', content: 'Each row shows item code, category, name, location, and stock levels. The reorder level column tells you when to place an order — hover a row to Stock In or Issue.', selector: '[data-tour="stock-table"]' },
      { title: 'Add Item', content: 'Need to add a new general item? Tap "+ Add Item". Fill in the code, category, name, rack, opening stock, and reorder level.', selector: '[data-tour="add-btn"]' },
    ],
  },

  '/inventory/non-working': {
    default: [
      { title: 'Non-Working Inventory', content: 'This tracks faulty or damaged items that have been flagged as non-functional — returned from a project site or found defective in the warehouse.' },
      { title: 'Log a Faulty Item', content: 'Found a defective item on site or in the warehouse? Tap "Log Item" to record it here. Select the product line, item details, quantity, and the reason it\'s not working.', selector: '[data-tour="add-btn"]' },
      { title: 'Search & Filter', content: 'Use the search box to find specific items, or filter by product line — Elysia, Vitrum, Curtains, General — to see only those categories.', selector: '[data-tour="filters"]' },
      { title: 'Faulty Items Table', content: 'Each row shows the product line, item code, name, quantity, fault reason, who reported it, and the date. Use this to track recurring defects and support warranty claims.', selector: '[data-tour="items-table"]' },
      { title: 'Why This Matters', content: 'Tracking faulty items helps Galaxy identify recurring product defects and manage warranty claims with suppliers. Always log — never silently discard.' },
    ],
  },

  '/content-studio': {
    default: [
      { title: 'Content Studio — Overview', content: 'This is the executive dashboard for all of Galaxy\'s marketing. It shows every brand, the full production pipeline, team workload, and live performance — all in one place.' },
      { title: 'Key Metrics', content: 'The top row shows active brands, pieces in production, published this month, overdue tasks, upcoming shoots, and pending approvals. Check these every morning.', selector: '[data-tour="stat-cards"]' },
      { title: 'Production Pipeline', content: 'This bar chart shows how many content pieces are sitting in each stage right now — from Idea all the way to Published. Long bars in early stages mean the pipeline is building up.', selector: '[data-tour="pipeline-card"]' },
      { title: 'Team Workload', content: 'Each team member\'s current load vs their capacity is shown here. Red means over capacity — redistribute work before deadlines slip.', selector: '[data-tour="team-workload"]' },
      { title: 'Top Performing Content', content: 'The right panel shows the top 5 pieces by views across all platforms. Use this to understand what format and topic is resonating most.', selector: '[data-tour="top-performing"]' },
    ],
  },

  '/content-studio/brands': {
    default: [
      { title: 'Brands', content: 'Each Galaxy brand — flagship, Elysia, Vitrum, and others — has its own content pipeline, monthly target, and assigned lead. This page gives a per-brand breakdown.' },
      { title: 'Brand Cards', content: 'Each card shows the brand\'s monthly target, how many pieces are published so far, ideas pitched, and what\'s in production. Tap a card to see the brand\'s full content list.', selector: '[data-tour="brands-view"]' },
    ],
  },

  '/content-studio/pipeline': {
    default: [
      { title: 'Content Pipeline', content: 'This is the Kanban board for all content production. Every piece of content moves left to right through stages — Idea, Script Writing, Shoot, Editing, Review, Published.' },
      { title: 'Kanban Board', content: 'Each column is a production stage. Cards show the content title, brand, assigned team, and due date. Drag a card to a new column to advance its stage — changes save instantly.', selector: '[data-tour="kanban-board"]' },
    ],
  },

  '/content-studio/ideas': {
    default: [
      { title: 'Idea Management', content: 'Every content piece starts as an idea. This page tracks how many ideas are required for the month, how many have been pitched, and which ones are approved to move to script.' },
      { title: 'Monthly Stats', content: 'The three cards show total ideas required, how many are pitched so far, and how many are still to be pitched. Keep the pitched count on track throughout the month.', selector: '[data-tour="stat-cards"]' },
      { title: 'Ideas Table', content: 'Each row is one idea — its title, brand, who pitched it, and its status. Management approves ideas here; once approved they automatically advance to Script Writing on the pipeline.', selector: '[data-tour="ideas-view"]' },
    ],
  },

  '/content-studio/scripts': {
    default: [
      { title: 'Script Management', content: 'Once an idea is approved, a script must be written before the shoot happens. This page tracks every script in progress — who\'s writing it, its deadline, and whether it\'s been approved.' },
      { title: 'Scripts List', content: 'Each row shows the script title, brand, writer, deadline, and status — Draft, Submitted, or Approved. Writers submit here; management approves. Overdue scripts are highlighted in red.', selector: '[data-tour="scripts-view"]' },
    ],
  },

  '/content-studio/editing': {
    default: [
      { title: 'Editing', content: 'After a shoot is completed, the raw footage moves here for post-production. This page tracks everything in the Editing → Review → Ready to Publish stages.' },
      { title: 'Editing Queue', content: 'Each row shows the content title, assigned editor, due date, and current stage. Editors update status as they progress. Approved pieces automatically become ready to publish.', selector: '[data-tour="editing-view"]' },
    ],
  },

  '/content-studio/calendar': {
    default: [
      { title: 'Content Calendar', content: 'The calendar shows all scheduled shoot dates and planned publish dates across every brand for the selected month. It\'s the team\'s shared schedule.' },
      { title: 'Monthly View', content: 'Each day shows what\'s happening — shoots marked in rose, published content in their respective brand colours. Use the month navigation to look ahead or review past months.', selector: '[data-tour="calendar-board"]' },
    ],
  },

  '/content-studio/shoots': {
    default: [
      { title: 'Shoot Management', content: 'This page tracks every planned and completed shoot across all brands. A shoot is scheduled once a script is approved and a date is confirmed with the talent and location.' },
      { title: 'Shoots List', content: 'Each row shows the shoot title, brand, scheduled date, talent, location, and status. Update status to Completed once the shoot is done — this automatically advances the content to Editing.', selector: '[data-tour="shoots-view"]' },
    ],
  },

  '/content-studio/performance': {
    default: [
      { title: 'Performance Dashboard', content: 'This page shows live metrics for all published content — pulled directly from YouTube, Instagram, and other platforms. If platforms aren\'t connected yet, demo data is shown.' },
      { title: 'Live Data Banner', content: 'The top banner tells you whether you\'re seeing real platform data or demo data. If it\'s amber, connect your accounts from the Connections page to see real numbers.', selector: '[data-tour="live-banner"]' },
      { title: 'Filters', content: 'Filter by platform (YouTube, Instagram, etc.) or by brand using the pills and dropdown. The stat cards and table update instantly.', selector: '[data-tour="filters"]' },
      { title: 'Key Metrics', content: 'Views, Reach, Engagement, Engagement Rate, Watch Time, and Follower Growth — these six numbers summarise performance across all filtered content.', selector: '[data-tour="stat-cards"]' },
      { title: 'Platform Breakdown', content: 'The charts show views by platform, engagement breakdown (likes/comments/shares/saves), and highlights like the best performing piece.', selector: '[data-tour="charts"]' },
      { title: 'All Content Table', content: 'The full table lists every published piece with its metrics. Sort by Top Views or Newest First. Use this to identify what\'s working and what\'s not.', selector: '[data-tour="content-table"]' },
    ],
  },

  '/content-studio/insights': {
    default: [
      { title: 'Marketing Insights', content: 'Insights analyses published content to surface what\'s actually working — best formats, best platforms, best posting days, and where the pipeline is getting stuck.' },
      { title: 'Best Performing Formats', content: 'Shows which content formats (Reel, Short, Tutorial, etc.) get the highest engagement rate on average. Use this to guide what to produce more of.', selector: '[data-tour="best-formats"]' },
      { title: 'Production Bottlenecks', content: 'Shows which pipeline stages content is sitting in longest. If one stage has a high average age, that\'s where the team needs more capacity or a process fix.', selector: '[data-tour="bottlenecks"]' },
      { title: 'Team Efficiency', content: 'Shows average revision rounds per person — lower is better. High revision counts often mean briefs aren\'t clear enough before production starts.', selector: '[data-tour="team-efficiency"]' },
    ],
  },

  '/content-studio/reports': {
    default: [
      { title: 'Monthly Report', content: 'This page generates the monthly marketing report — KPIs, per-brand production, pipeline status, performance summary, and top content. Export it as CSV or PDF to share with leadership.' },
      { title: 'KPI Summary', content: 'The header card shows the four top-line numbers: active brands, published this month, in production, and total views. This is the one-glance summary.', selector: '[data-tour="report-header"]' },
      { title: 'Brand Production Table', content: 'Shows every brand\'s monthly target, published count, in-production count, ideas pitched, and target hit percentage. Red means below 60%, amber means 60-99%, green means on target.', selector: '[data-tour="brand-table"]' },
      { title: 'Top Performing Content', content: 'The bottom table lists the 8 highest-viewed pieces of the month with platform and engagement data. Great for including in leadership presentations.', selector: '[data-tour="top-content"]' },
    ],
  },

  '/content-studio/connections': {
    default: [
      { title: 'Connections', content: 'This page lets you connect Galaxy\'s social accounts — YouTube, Instagram, LinkedIn — so the Performance dashboard pulls real metrics instead of demo data.' },
      { title: 'Platform Setup Cards', content: 'Each card shows the platform\'s connection status, the environment variables needed, and a step-by-step setup guide. Follow the steps, add the env vars to the server, then Sync.', selector: '[data-tour="platform-cards"]' },
      { title: 'Recent Syncs', content: 'The sync log shows every time the system fetched data from the platforms — when it ran, what was fetched, and whether it succeeded or failed.', selector: '[data-tour="sync-log"]' },
    ],
  },

  '/content-studio/activity': {
    default: [
      { title: 'Activity Log', content: 'Every change made in Content Studio — content created, scripts approved, ideas pitched, shoots completed — is recorded here. It\'s the full audit trail.' },
      { title: 'Filter by Type', content: 'Use the pills to filter by entity type — Content, Brand, Idea, Script, or Shoot. Useful when you want to see only what changed in one area.', selector: '[data-tour="filters"]' },
      { title: 'Activity Table', content: 'Each row shows what changed, who changed it, and when. The action is colour-coded — green for created/approved, red for deleted/rejected, amber for pitched.', selector: '[data-tour="activity-table"]' },
    ],
  },

  '/daily-reports': {
    default: [
      { title: 'Daily Reports', content: 'Every team member submits a daily report at the end of each day. It logs what you worked on, how long, and whether tasks were completed.' },
      { title: 'Submit Today\'s Report', content: 'Tap the gold button to fill in today\'s report. It takes 2–3 minutes. Do this before you leave for the day — every day.', selector: '[data-tour="add-btn"]' },
      { title: 'Auto-tracked Activity', content: 'This card shows today\'s activity pulled automatically from the system — leads added, calls made, quotations created. No manual entry needed.', selector: '[data-tour="activity-tiles"]' },
      { title: 'Task Log', content: 'Inside the report form, list each task you worked on, mark it Done or Pending, and add how long it took. Management reviews this daily.', selector: '[data-tour="add-btn"]' },
      { title: 'Report History', content: 'All your previous reports are listed here. Management can view every team member\'s history to track performance over time.', selector: '[data-tour="report-history"]' },
    ],
    management: [
      { title: 'Daily Reports — Team View', content: 'This page shows every team member\'s daily activity. Use it every morning to see who submitted and what the team accomplished yesterday.' },
      { title: 'Team Reports', content: 'Each row is one employee. Tap to expand and see all their submitted reports with task breakdowns and auto-tracked stats.', selector: '[data-tour="report-history"]' },
      { title: 'Filter by Department', content: 'Use the department dropdown to filter by BD, PM, Marketing, or AI Dept. Useful when you manage a specific team.', selector: 'select' },
      { title: 'Submitted vs Not', content: 'The green "Submitted today" badge shows who\'s already reported. Grey means they haven\'t yet — follow up with them before end of day.', selector: '[data-tour="report-history"]' },
    ],
  },

  '/notifications': {
    default: [
      { title: 'Notifications', content: 'Every alert, reminder, and system update appears here — this is your central inbox for everything that needs your attention.' },
      { title: 'What You\'ll Get', content: 'New lead assigned to you, follow-up due today, quotation approved or rejected, payment received, project milestone overdue — all land here.', selector: 'table tbody tr:first-child' },
      { title: 'Mark as Read', content: 'Tap any notification to mark it read and jump to the related item. Unread ones have a blue dot.' },
      { title: 'Check Every Morning', content: 'Make it a daily habit — open Notifications first thing. Missing a follow-up reminder or approval request can stall the whole pipeline.' },
    ],
  },

  '/settings': {
    default: [
      { title: 'Settings', content: 'This area is mainly for management — approve new staff, assign roles, and manage the product catalog.' },
      { title: 'Staff Management', content: 'When a new employee signs in with their Google account, they get "Pending" status. Come here to approve them and assign their role — BD Exec, Project Manager, etc.', selector: 'select' },
      { title: 'Roles Control Access', content: 'The role you assign decides what each person can see and do. BD Exec can only see leads. PM can only see projects and inventory. Assign carefully.' },
      { title: 'Product Catalog', content: 'The Products tab has all items available when building quotations — Elysia switches, Vitrum panels, sensors, etc. Add new products here when Galaxy launches new items.' },
    ],
    management: [
      { title: 'Settings — Admin Control', content: 'Settings is where you control who has access to what in the CRM. Only management and super admins should be here.' },
      { title: 'Approve New Staff', content: 'Every new employee who logs in appears here as "Pending". Approve them and set their role before they can access the system.', selector: 'select' },
      { title: 'Assign Roles Carefully', content: 'Each role gives different access. BD Exec = leads only. PM = projects + inventory. Management = everything. Super Admin = no restrictions.' },
      { title: 'Product Catalog', content: 'Manage what products appear in the quotation builder. Keep this updated when Galaxy adds new products or retires old ones.' },
    ],
  },

}

function getTour(pathname: string, role: UserRole | undefined): TourStep[] {
  const normalized = pathname
    .replace(/\/leads\/[^/]+/, '/leads/:id')
    .replace(/\/projects\/[^/]+/, '/projects/:id')
    .replace(/\/partners\/[^/]+/, '/partners/:id')
    .replace(/\/customers\/[^/]+/, '/customers/:id')
    .replace(/^\/quotations\/new$/, '/quotations/builder')
    .replace(/\/quotations\/[^/]+\/edit$/, '/quotations/builder')

  const pageTours = TOURS[normalized] ?? TOURS[pathname]
  if (!pageTours) return []

  return pageTours[role ?? 'default'] ?? pageTours['default'] ?? []
}

function tourKey(pathname: string, role: string) {
  return `help_tour_seen_${role}_${pathname.replace(/\//g, '_')}`
}

// ─── Highlight overlay ─────────────────────────────────────────────────────────
function useHighlight(selector?: string) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (retryRef.current) clearTimeout(retryRef.current)
    if (!selector) { setRect(null); return }

    function tryFind(attempts = 0) {
      const el = document.querySelector(selector!)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Re-measure after scroll animation completes so the highlight lands correctly
        retryRef.current = setTimeout(() => {
          setRect(el.getBoundingClientRect())
        }, 400)
      } else if (attempts < 5) {
        retryRef.current = setTimeout(() => tryFind(attempts + 1), 200)
      } else {
        setRect(null)
      }
    }

    tryFind()
    return () => { if (retryRef.current) clearTimeout(retryRef.current) }
  }, [selector])

  return rect
}

// ─── Smart tooltip positioning ─────────────────────────────────────────────────
function getTooltipStyle(rect: DOMRect | null): React.CSSProperties {
  if (!rect) {
    return { position: 'fixed', bottom: '6rem', left: '50%', transform: 'translateX(-50%)' }
  }

  const PAD = 16
  const TIP_W = Math.min(window.innerWidth * 0.92, 384)
  const TIP_H = 200 // approx
  const vw = window.innerWidth
  const vh = window.innerHeight

  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top

  // Vertical: prefer below, fallback above
  let top: number | undefined
  let bottom: number | undefined
  if (spaceBelow >= TIP_H + PAD) {
    top = rect.bottom + PAD
  } else if (spaceAbove >= TIP_H + PAD) {
    bottom = vh - rect.top + PAD
  } else {
    // Not enough space — place below anyway, might overlap
    top = Math.min(rect.bottom + PAD, vh - TIP_H - PAD)
  }

  // Horizontal: center on element, clamp to viewport
  let left = rect.left + rect.width / 2 - TIP_W / 2
  left = Math.max(PAD, Math.min(left, vw - TIP_W - PAD))

  return {
    position: 'fixed',
    ...(top !== undefined ? { top } : { bottom }),
    left,
    width: TIP_W,
    transform: 'none',
  }
}

// ─── Main component ────────────────────────────────────────────────────────────
export function HelpTour() {
  const { user } = useAuth()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  const steps = getTour(location.pathname, user?.role)
  const current = steps[step]
  const key = tourKey(location.pathname, user?.role ?? 'default')

  const rect = useHighlight(open ? current?.selector : undefined)

  // Reset tour state on page change (no longer auto-shows)
  useEffect(() => {
    setOpen(false)
    setStep(0)
  }, [location.pathname])

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

  const tooltipStyle = getTooltipStyle(rect)

  return (
    <>
      {/* Floating "?" button — always visible */}
      <button
        onClick={() => { setStep(0); setOpen(true) }}
        className="fixed bottom-6 right-6 z-[9997] w-12 h-12 rounded-full bg-gold-500 shadow-lg flex items-center justify-center hover:bg-gold-400 active:scale-95 transition-all"
        title="Help"
      >
        <HelpCircle className="w-6 h-6 text-gray-900" />
      </button>

      {open && current && steps.length > 0 && (
        <>
          {/* Click-to-close layer — always present */}
          <div className="fixed inset-0 z-[9998]" onClick={close} />

          {/* Dark backdrop — only when no element is highlighted (box-shadow on the ring handles overlay otherwise) */}
          {(!rect || !current.selector) && (
            <div className="fixed inset-0 z-[9998] bg-black/50 pointer-events-none" />
          )}

          {/* Highlight ring — box-shadow creates both the gold outline AND the dark overlay */}
          {rect && current.selector && (
            <div
              className="fixed z-[9999] pointer-events-none rounded-xl transition-all duration-300"
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
                boxShadow: '0 0 0 4px #C9A840, 0 0 0 9999px rgba(0,0,0,0.6)',
              }}
            />
          )}

          {/* Tooltip card — smart positioned */}
          <div className="z-[9999] w-[92vw] max-w-sm" style={tooltipStyle}>
            <div className="glass-card rounded-2xl p-5 shadow-2xl border border-gold-500/30">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-sm font-bold text-gray-100 leading-snug">{current.title}</h3>
                <button onClick={close} className="text-gray-500 hover:text-gray-300 shrink-0 mt-0.5">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-sm text-gray-400 leading-relaxed mb-4">{current.content}</p>

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
