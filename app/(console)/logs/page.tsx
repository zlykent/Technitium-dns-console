import { QueryLogsView } from '@/components/logs/query-logs-view'

/**
 * `/logs` — query logs for anyone with `Logs.canView`.
 *
 * A Server Component that only mounts the client view. Nothing can be fetched
 * here: the rows come from a *query logging DNS app's* database, so the request
 * needs the app identity from `apps/list`, the session, and the selected server —
 * all three of which exist only in the browser.
 */
export default function LogsPage() {
  return <QueryLogsView />
}
