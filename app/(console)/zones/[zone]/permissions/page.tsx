import { ZonePermissionsView } from '@/components/zones/zone-permissions-view'

/**
 * `/zones/[zone]/permissions` — per-zone ACL for users and groups.
 *
 * Server Component shim, mirroring the options page: decode the `[zone]`
 * segment once and mount the client view, which owns the session-scoped query
 * and the pipe-delimited `zones/permissions/set` round trip.
 */
export default async function ZonePermissionsPage({ params }: { params: Promise<{ zone: string }> }) {
  const { zone } = await params
  return <ZonePermissionsView zone={decodeURIComponent(zone)} />
}
