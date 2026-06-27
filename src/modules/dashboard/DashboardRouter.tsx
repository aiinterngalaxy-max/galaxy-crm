import { useAuth } from '../../contexts/AuthContext'
import { ManagementDashboard } from './ManagementDashboard'
import { BDDashboard } from './BDDashboard'
import { PMDashboard } from './PMDashboard'
import { AccountsDashboard } from './AccountsDashboard'
import { AIDashboard } from './AIDashboard'
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
      return <BDDashboard />
    case 'project_manager':
      return <PMDashboard />
    case 'accounts':
      return <AccountsDashboard />
    case 'ai_team':
      return <AIDashboard />
    case 'dept_head':
      return <ManagementDashboard />
    default:
      return <GenericDashboard />
  }
}
