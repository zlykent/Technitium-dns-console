import { FilterView } from '@/components/filtering/filter-view'

/**
 * `/allowed` — allowed-list manager for anyone with `Allowed.canView`.
 *
 * A Server Component that only mounts the client view: the domain tree is
 * lazily fetched per node and every action (add, delete, import, export,
 * flush) needs the session plus the selected server, both of which live only
 * in the browser.
 */
export default function AllowedPage() {
  return <FilterView scope="allowed" />
}
