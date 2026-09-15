import { AccountView } from '@/components/account/account-view'
import pkg from '@/package.json'

/**
 * `/account` — the signed-in operator's self-service hub: profile, security
 * (password + TOTP), API tokens, live sessions and an About pane.
 *
 * A Server Component that only mounts the client view. Nothing here can be
 * prerendered: every panel is driven by `user/*` calls that need the httpOnly
 * session cookie and the currently selected server, both of which exist only in
 * the browser. The route is reachable by any authenticated user (see
 * `lib/nav.ts`, where it is the `landingRoute` fallback for an account with no
 * module permission at all), so there is no permission gate of its own.
 *
 * Two things are resolved on the server and handed down as props rather than
 * read client-side:
 *  - `initialTab` comes from `?tab=` so the deep links in `user-menu.tsx`
 *    (`/account?tab=security`) land on the right pane. Reading it here avoids a
 *    `useSearchParams` Suspense boundary in the client view.
 *  - `consoleVersion` is `package.json`'s version. Importing the manifest in a
 *    Server Component keeps it out of the client bundle; only the string crosses
 *    the boundary.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <AccountView initialTab={tab} consoleVersion={pkg.version} />
}
