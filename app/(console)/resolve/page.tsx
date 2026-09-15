import { ResolveView } from '@/components/resolve/resolve-view'

/**
 * `/resolve` — the DNS client "resolve a name on my behalf" tool.
 *
 * A Server Component that only mounts the client view: every query is fired by an
 * explicit user action against the selected server, needs the live session, and
 * may carry the `import` write side-effect — none of which can be rendered on the
 * server. Access is gated by `useCan('DnsClient')` inside the client view.
 */
export default function ResolvePage() {
  return <ResolveView />
}
