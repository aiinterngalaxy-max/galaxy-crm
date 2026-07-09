import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './modules/auth/LoginPage'
import { PendingApprovalPage } from './modules/auth/PendingApprovalPage'
import { PageLoader } from './components/ui/LoadingSpinner'
import { canAccess } from './lib/utils'
import type { UserRole } from './types'

const DashboardRouter = lazy(() => import('./modules/dashboard/DashboardRouter').then(m => ({ default: m.DashboardRouter })))
const LeadsPage = lazy(() => import('./modules/leads/LeadsPage').then(m => ({ default: m.LeadsPage })))
const LeadDetail = lazy(() => import('./modules/leads/LeadDetail').then(m => ({ default: m.LeadDetail })))
const CustomersPage = lazy(() => import('./modules/customers/CustomersPage').then(m => ({ default: m.CustomersPage })))
const CustomerDetail = lazy(() => import('./modules/customers/CustomerDetail').then(m => ({ default: m.CustomerDetail })))
const QuotationsPage = lazy(() => import('./modules/quotations/QuotationsPage').then(m => ({ default: m.QuotationsPage })))
const QuotationBuilder = lazy(() => import('./modules/quotations/QuotationBuilder').then(m => ({ default: m.QuotationBuilder })))
const BOQPreview = lazy(() => import('./modules/quotations/BOQPreview').then(m => ({ default: m.BOQPreview })))
const ProjectsPage = lazy(() => import('./modules/projects/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const ProjectDetail = lazy(() => import('./modules/projects/ProjectDetail').then(m => ({ default: m.ProjectDetail })))
const DailyReportsPage = lazy(() => import('./modules/daily-reports/DailyReportsPage').then(m => ({ default: m.DailyReportsPage })))
const ContentStudioLayout = lazy(() => import('./components/content-studio/ContentStudioLayout').then(m => ({ default: m.ContentStudioLayout })))
const OverviewPage = lazy(() => import('./pages/content-studio/OverviewPage').then(m => ({ default: m.OverviewPage })))
const BrandsPage = lazy(() => import('./pages/content-studio/BrandsPage').then(m => ({ default: m.BrandsPage })))
const PipelinePage = lazy(() => import('./pages/content-studio/PipelinePage').then(m => ({ default: m.PipelinePage })))
const IdeasPage = lazy(() => import('./pages/content-studio/IdeasPage').then(m => ({ default: m.IdeasPage })))
const ScriptsPage = lazy(() => import('./pages/content-studio/ScriptsPage').then(m => ({ default: m.ScriptsPage })))
const EditingPage = lazy(() => import('./pages/content-studio/EditingPage').then(m => ({ default: m.EditingPage })))
const CalendarPage = lazy(() => import('./pages/content-studio/CalendarPage').then(m => ({ default: m.CalendarPage })))
const ShootsPage = lazy(() => import('./pages/content-studio/ShootsPage').then(m => ({ default: m.ShootsPage })))
const PerformancePage = lazy(() => import('./pages/content-studio/PerformancePage').then(m => ({ default: m.PerformancePage })))
const InsightsPage = lazy(() => import('./pages/content-studio/InsightsPage').then(m => ({ default: m.InsightsPage })))
const ReportsPage = lazy(() => import('./pages/content-studio/ReportsPage').then(m => ({ default: m.ReportsPage })))
const ConnectionsPage = lazy(() => import('./pages/content-studio/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })))
const ActivityPage = lazy(() => import('./pages/content-studio/ActivityPage').then(m => ({ default: m.ActivityPage })))
const NotificationsPage = lazy(() => import('./modules/notifications/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const FollowUpsPage = lazy(() => import('./modules/leads/FollowUpsPage').then(m => ({ default: m.FollowUpsPage })))
const PartnersPage = lazy(() => import('./modules/partners/PartnersPage').then(m => ({ default: m.PartnersPage })))
const PartnerDetail = lazy(() => import('./modules/partners/PartnerDetail').then(m => ({ default: m.PartnerDetail })))
const SettingsPage = lazy(() => import('./modules/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const InventoryPage = lazy(() => import('./modules/inventory/InventoryPage').then(m => ({ default: m.InventoryPage })))
const NonWorkingPage = lazy(() => import('./modules/inventory/NonWorkingPage').then(m => ({ default: m.NonWorkingPage })))
const B2BCampaignPage = lazy(() => import('./modules/b2b/B2BCampaignPage').then(m => ({ default: m.B2BCampaignPage })))
const HRPage = lazy(() => import('./modules/hr/HRPage').then(m => ({ default: m.HRPage })))
const JDWizard = lazy(() => import('./modules/hr/JDWizard').then(m => ({ default: m.JDWizard })))
const RecycleBin = lazy(() => import('./modules/recycle-bin/RecycleBin').then(m => ({ default: m.RecycleBin })))
const TopzLayout = lazy(() => import('./modules/topz/TopzLayout').then(m => ({ default: m.TopzLayout })))
const TopzDashboard = lazy(() => import('./modules/topz/TopzDashboard').then(m => ({ default: m.TopzDashboard })))
const QuotationTool = lazy(() => import('./modules/topz/QuotationTool').then(m => ({ default: m.QuotationTool })))
const TopzSettings = lazy(() => import('./modules/topz/TopzSettings').then(m => ({ default: m.TopzSettings })))
const QuotationHistory = lazy(() => import('./modules/topz/QuotationHistory').then(m => ({ default: m.QuotationHistory })))
const TopzBookings = lazy(() => import('./modules/topz/Bookings').then(m => ({ default: m.Bookings })))
const TopzTerms = lazy(() => import('./modules/topz/Terms').then(m => ({ default: m.TopzTerms })))

// Route guard
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { firebaseUser, role, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (role === 'pending') return <PendingApprovalPage />
  if (role === 'topz') return <Navigate to="/topz" replace />
  return <>{children}</>
}

function RequireTopz({ children }: { children: React.ReactNode }) {
  const { firebaseUser, role, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (role === 'pending') return <PendingApprovalPage />
  if (role !== 'topz' && role !== 'super_admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireRole({
  children,
  module,
}: {
  children: React.ReactNode
  module: string
}) {
  const { role } = useAuth()
  if (!role) return <PageLoader />
  const allowed = ['super_admin', 'management', 'ai_team'].includes(role) || canAccess(role as UserRole, module)
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { firebaseUser, loading } = useAuth()

  if (loading) return <PageLoader />

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={firebaseUser ? <Navigate to="/" replace /> : <LoginPage />}
        />

        {/* Protected app shell */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          {/* Dashboard â€” everyone */}
          <Route index element={<DashboardRouter />} />

          {/* Leads */}
          <Route path="leads" element={<RequireRole module="leads"><LeadsPage /></RequireRole>} />
          <Route path="leads/:id" element={<RequireRole module="leads"><LeadDetail /></RequireRole>} />

          {/* Follow-ups */}
          <Route path="follow-ups" element={<RequireRole module="follow-ups"><FollowUpsPage /></RequireRole>} />

          {/* Partners (B2B) */}
          <Route path="partners" element={<RequireRole module="partners"><PartnersPage /></RequireRole>} />
          <Route path="partners/:id" element={<RequireRole module="partners"><PartnerDetail /></RequireRole>} />

          {/* Customers */}
          <Route path="customers" element={<RequireRole module="customers"><CustomersPage /></RequireRole>} />
          <Route path="customers/:id" element={<RequireRole module="customers"><CustomerDetail /></RequireRole>} />

          {/* Quotations */}
          <Route path="quotations" element={<RequireRole module="quotations"><QuotationsPage /></RequireRole>} />
          <Route path="quotations/new" element={<RequireRole module="quotations"><QuotationBuilder /></RequireRole>} />
          <Route path="quotations/:id/edit" element={<RequireRole module="quotations"><QuotationBuilder /></RequireRole>} />
          <Route path="quotations/:id/boq" element={<RequireRole module="quotations"><BOQPreview /></RequireRole>} />

          {/* Projects */}
          <Route path="projects" element={<RequireRole module="projects"><ProjectsPage /></RequireRole>} />
          <Route path="projects/:id" element={<RequireRole module="projects"><ProjectDetail /></RequireRole>} />

          {/* Daily Reports */}
          <Route path="daily-reports" element={<RequireRole module="daily-reports"><DailyReportsPage /></RequireRole>} />

          {/* Content Studio */}
          <Route path="content-studio" element={<RequireRole module="content-studio"><ContentStudioLayout /></RequireRole>}>
            <Route index element={<OverviewPage />} />
            <Route path="brands" element={<BrandsPage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="ideas" element={<IdeasPage />} />
            <Route path="scripts" element={<ScriptsPage />} />
            <Route path="editing" element={<EditingPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="shoots" element={<ShootsPage />} />
            <Route path="performance" element={<PerformancePage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>

          {/* Notifications â€” everyone */}
          <Route path="notifications" element={<NotificationsPage />} />

          {/* B2B Campaign */}
          <Route path="b2b-campaign" element={<RequireRole module="b2b-campaign"><B2BCampaignPage /></RequireRole>} />

          {/* Inventory */}
          <Route path="inventory" element={<RequireRole module="inventory"><InventoryPage /></RequireRole>} />
          <Route path="inventory/non-working" element={<RequireRole module="inventory"><NonWorkingPage /></RequireRole>} />
          <Route path="inventory/:line" element={<RequireRole module="inventory"><InventoryPage /></RequireRole>} />

          {/* HR */}
          <Route path="hr" element={<RequireRole module="hr"><HRPage /></RequireRole>} />
          <Route path="recycle-bin" element={<RequireRole module="recycle-bin"><RecycleBin /></RequireRole>} />
          <Route path="hr/new" element={<RequireRole module="hr"><JDWizard /></RequireRole>} />

          {/* Settings */}
          <Route path="settings" element={<RequireRole module="settings"><SettingsPage /></RequireRole>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        {/* Topz Cab — super_admin + topz role */}
        <Route path="/topz" element={<RequireTopz><Suspense fallback={<PageLoader />}><TopzLayout /></Suspense></RequireTopz>}>
          <Route index element={<Suspense fallback={<PageLoader />}><TopzDashboard /></Suspense>} />
          <Route path="quotation" element={<Suspense fallback={<PageLoader />}><QuotationTool /></Suspense>} />
          <Route path="quotations" element={<Suspense fallback={<PageLoader />}><QuotationHistory /></Suspense>} />
          <Route path="bookings" element={<Suspense fallback={<PageLoader />}><TopzBookings /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoader />}><TopzSettings /></Suspense>} />
          <Route path="terms" element={<Suspense fallback={<PageLoader />}><TopzTerms /></Suspense>} />
        </Route>

        {/* Catch-all to login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}

const ORBS: Record<string, { color1: string; color2: string; color3: string; color4: string } | null> = {
  'dark-cosmos': {
    color1: 'rgba(201,168,64,0.22)',
    color2: 'rgba(110,80,220,0.16)',
    color3: 'rgba(201,168,64,0.13)',
    color4: 'rgba(50,110,230,0.12)',
  },
  'light-glass': {
    color1: 'rgba(210,210,230,0.75)',
    color2: 'rgba(195,200,225,0.60)',
    color3: 'rgba(220,220,238,0.65)',
    color4: 'rgba(200,205,230,0.50)',
  },
  'funky-chaos': {
    color1: 'rgba(255,0,200,0.40)',
    color2: 'rgba(0,255,180,0.30)',
    color3: 'rgba(255,200,0,0.28)',
    color4: 'rgba(0,150,255,0.25)',
  },
  'dark-classic': null,
}

function OrbBackground() {
  const { theme } = useTheme()
  const orbs = ORBS[theme]
  if (!orbs) return null
  const s = (top?: string, left?: string, right?: string, bottom?: string, w = 600, h = 600, color = '', blur = 75) => ({
    position: 'fixed' as const, borderRadius: '50%', pointerEvents: 'none' as const,
    width: w, height: h, top, left, right, bottom,
    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
    filter: `blur(${blur}px)`,
  })
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={s('-5%', '5%', undefined, undefined, 650, 650, orbs.color1, 80)} />
      <div style={s('35%', undefined, '-5%', undefined, 550, 550, orbs.color2, 80)} />
      <div style={s(undefined, '20%', undefined, '-15%', 750, 550, orbs.color3, 90)} />
      <div style={s('15%', '42%', undefined, undefined, 380, 380, orbs.color4, 65)} />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <OrbBackground />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </div>
      </ThemeProvider>
    </ErrorBoundary>
  )
}


