import { DhcpView } from '@/components/dhcp/dhcp-view'

/**
 * `/dhcp` — DHCP scope and lease management.
 *
 * A Server Component that only mounts the client view: every piece of data
 * comes from the live server session, so there is nothing to prerender.
 */
export default function DhcpPage() {
  return <DhcpView />
}
