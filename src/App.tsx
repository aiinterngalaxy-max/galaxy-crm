import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './modules/auth/LoginPage'
import { PendingApprovalPage } from './modules/auth/PendingApprovalPage'
import { DashboardRouter } from './modules/dashboard/DashboardRouter'
import { LeadsPage } from './modules/leads/LeadsPage'
import { LeadDetail } from './modules/leads/LeadDetail'
import { CustomersPage } from './modules/customers/CustomersPage'
import { CustomerDetail } from './modules/customers/CustomerDetail'
import { QuotationsPage } from './modules/quotations/QuotationsPage'
import { QuotationBuilder } from './modules/quotations/QuotationBuilder'
import { BOQPreview } from './modules/quotations/BOQPreview'
import { ProjectsPage } from './modules/projects/ProjectsPage'
import { ProjectDetail } from './modules/projects/ProjectDetail'
import { SiteOpsPage } from './modules/site-ops/SiteOpsPage'
import { DailyReportsPage } from './modules/daily-reports/DailyReportsPage'
import { AccountsPage } from './modules/accounts/AccountsPage'
import { ContentStudioPage } from './modules/content-studio/ContentStudioPage'
import { NotificationsPage } from './modules/notifications/NotificationsPage'
import { PartnersPage } from './modules/partners/PartnersPage'
import { PartnerDetail } from './modules/partners/PartnerDetail'
import { SettingsPage } from './modules/settings/SettingsPage'
import { PageLoader } from './components/ui/LoadingSpinner'
import { canAccess } from './lib/utils'
import type { UserRole } from './types'

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

        {/* Site Ops */}
        <Route path="site-ops" element={<RequireRole module="site-ops"><SiteOpsPage /></RequireRole>} />

        {/* Daily Reports */}
        <Route path="daily-reports" element={<RequireRole module="daily-reports"><DailyReportsPage /></RequireRole>} />

        {/* Accounts */}
        <Route path="accounts" element={<RequireRole module="accounts"><AccountsPage /></RequireRole>} />

        {/* Content Studio */}
        <Route path="content-studio" element={<RequireRole module="content-studio"><ContentStudioPage /></RequireRole>} />

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
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
