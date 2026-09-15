import { FilterView } from '@/components/filtering/filter-view'

/**
 * `/blocked` — blocked-list manager for anyone with `Blocked.canView`.
 *
 * A Server Component that only mounts the client view: the domain tree is
 * lazily fetched per node and every action (add, delete, import, export,
 * flush, temporary-disable) needs the session plus the selected server, both
 * of which live only in the browser. The blocked page additionally checks
 * `enableBlocking` from settings to surface a warning banner when blocking is
 * turned off server-wide.
 */
export default function BlockedPage() {
  return <FilterView scope="blocked" />
}
