import { useAuth } from '../../contexts/AuthContext'
import { ManagementDashboard } from './ManagementDashboard'
import { BDDashboard } from './BDDashboard'
import { PMDashboard } from './PMDashboard'
import { SiteWorkerDashboard } from './SiteWorkerDashboard'
import { GenericDashboard } from './GenericDashboard'
import { PageLoader } from '../../components/ui/LoadingSpinner'

export function DashboardRouter() {
  const { role, loading } = useAuth()

  if (loading) return <PageLoader />

  switch (role) {
    case 'super_admin':
    case 'management':
      return <ManagementDashboard />
    case 'bd_exec':
    case 'dept_head':
      return <BDDashboard />
    case 'project_manager':
      return <PMDashboard />
    case 'site_worker':
      return <SiteWorkerDashboard />
    default:
      return <GenericDashboard />
  }
}
