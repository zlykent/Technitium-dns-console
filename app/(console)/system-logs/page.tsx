import { SystemLogsView } from '@/components/logs/system-logs-view'

/**
 * `/system-logs` — the server's own log files, for anyone with `Logs.canView`.
 *
 * A Server Component that only mounts the client view. `logs/list` is cheap, but
 * the page is built around destructive actions (delete one / delete all) and a
 * blob-URL "open in new tab", none of which can run on the server, and the file
 * list has to be invalidated from the same cache the mutations write to.
 *
 * Kept on its own route rather than as a tab of `/logs`: the two share the
 * endpoint prefix and the permission section, but nothing else — one queries an
 * app's database, the other browses text files.
 */
export default function SystemLogsPage() {
  return <SystemLogsView />
}
