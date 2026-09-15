import { ZoneOptionsView } from '@/components/zones/zone-options-view'

/**
 * `/zones/[zone]/options` — replication and access policy for a single zone.
 *
 * Server Component shim. The `[zone]` segment carries a DNS name, which may
 * contain dots (legal in a path segment) and arrives percent-encoded, so it is
 * decoded here once and handed to the client view as a plain string. All data
 * fetching happens client-side because it needs the session and target server.
 */
export default async function ZoneOptionsPage({ params }: { params: Promise<{ zone: string }> }) {
  const { zone } = await params
  return <ZoneOptionsView zone={decodeURIComponent(zone)} />
}
