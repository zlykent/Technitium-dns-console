import { ZonesView } from '@/components/zones/zones-view'

/**
 * `/zones` — the zone inventory for anyone with `Zones.canView`.
 *
 * A Server Component that only mounts the client view: the list is server-side
 * paginated and every action needs the session plus the selected server, both of
 * which live only in the browser. The `?new=1` query (the dashboard's "add
 * zone" shortcut) is read inside the client view, not here.
 */
export default function ZonesPage() {
  return <ZonesView />
}
