import { DashboardView } from '@/components/dashboard/dashboard-view'

/**
 * `/dashboard` — landing page for anyone with `Dashboard.canView`.
 *
 * A Server Component that only mounts the client view: the entire page is
 * derived from live statistics, so there is nothing to render on the server.
 */
export default function DashboardPage() {
  return <DashboardView />
}
