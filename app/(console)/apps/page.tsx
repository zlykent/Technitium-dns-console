import { AppsView } from '@/components/apps/apps-view'

/**
 * `/apps` — DNS application manager (installed set + app store).
 *
 * A Server Component that only mounts the client view: the page is entirely
 * driven by live `apps/list` + `apps/listStoreApps` reads and the session's
 * `Apps` permission flags, none of which exist on the server. Route access is
 * already guarded by `lib/nav.ts` (`Apps.canView`), so this shim stays logic-free.
 */
export default function AppsPage() {
  return <AppsView />
}
