import { FilterView } from '@/components/filtering/filter-view'

/**
 * `/cache` — resolver cache browser for anyone with `Cache.canView`.
 *
 * A Server Component that only mounts the client view: the domain tree is
 * lazily fetched per node and every action (evict, flush) needs the session
 * plus the selected server, both of which live only in the browser.
 */
export default function CachePage() {
  return <FilterView scope="cache" />
}
