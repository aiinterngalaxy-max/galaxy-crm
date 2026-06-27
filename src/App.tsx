import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './contexts/AuthContext'
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
const PartnersPage = lazy(() => import('./modules/partners/PartnersPage').then(m => ({ default: m.PartnersPage })))
const PartnerDetail = lazy(() => import('./modules/partners/PartnerDetail').then(m => ({ default: m.PartnerDetail })))
const SettingsPage = lazy(() => import('./modules/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))

// Route guard
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { firebaseUser, role, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (role === 'pending') return <PendingApprovalPage />
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
          {/* Dashboard — everyone */}
          <Route index element={<DashboardRouter />} />

          {/* Leads */}
          <Route path="leads" element={<RequireRole module="leads"><LeadsPage /></RequireRole>} />
          <Route path="leads/:id" element={<RequireRole module="leads"><LeadDetail /></RequireRole>} />

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

          {/* Notifications — everyone */}
          <Route path="notifications" element={<NotificationsPage />} />

          {/* Settings */}
          <Route path="settings" element={<RequireRole module="settings"><SettingsPage /></RequireRole>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        {/* Catch-all to login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  )
}
