import { AdminView } from '@/components/admin/admin-view'

/**
 * `/admin` — users, groups, permissions, sessions, SSO and the cluster.
 *
 * A Server Component that only mounts the client view. Nothing here can be
 * prerendered: every panel is driven by `admin/*` calls that need the session
 * cookie and the currently selected server, and both exist only in the browser.
 * The route guard in `lib/nav.ts` already blocks anyone without
 * `Administration.canView`, so this shim has no permission logic of its own.
 */
export default function AdminPage() {
  return <AdminView />
}
