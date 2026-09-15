import { SettingsView } from '@/components/settings/settings-view'

/**
 * `/settings` — every parameter `settings/get` returns, for `Settings.canView`.
 *
 * A Server Component that only mounts the client view. Nothing can be resolved
 * here: the payload depends on the selected server, the httpOnly session cookie
 * and (for the node dropdown) a second cluster call, all three of which exist
 * only in the browser. Permission gating lives in `lib/nav.ts` for the sidebar
 * and in `useCan('Settings')` for the write side.
 */
export default function SettingsPage() {
  return <SettingsView />
}
