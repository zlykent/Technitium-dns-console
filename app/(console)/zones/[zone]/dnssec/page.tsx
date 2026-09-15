import { DnssecView } from '@/components/dnssec/dnssec-view'

/**
 * `/zones/[zone]/dnssec` — signing, private keys and DS publication for one zone.
 *
 * Server Component shim. The `[zone]` segment carries a DNS name, which may
 * contain dots (legal in a path segment) and arrives percent-encoded, so it is
 * decoded here once and handed to the client view as a plain string. All data
 * fetching happens client-side: the session token lives in an httpOnly cookie
 * and the active target server is browser-only state.
 */
export default async function ZoneDnssecPage({ params }: { params: Promise<{ zone: string }> }) {
  const { zone } = await params
  return <DnssecView zone={decodeURIComponent(zone)} />
}
