import { RecordsView } from '@/components/records/records-view'

/**
 * `/zones/[zone]` — the record browser/editor for a single zone (t11).
 *
 * Server Component shim, identical in shape to the sibling `options` and
 * `permissions` routes. The `[zone]` segment carries a DNS name, which may
 * contain dots (legal in a path segment) and arrives percent-encoded, so it is
 * decoded exactly once here and handed to the client view as a plain string.
 * All data fetching happens client-side: it needs the session and the selected
 * server, both of which only exist in the browser.
 */
export default async function ZoneRecordsPage({ params }: { params: Promise<{ zone: string }> }) {
  const { zone } = await params
  return <RecordsView zone={decodeURIComponent(zone)} />
}
