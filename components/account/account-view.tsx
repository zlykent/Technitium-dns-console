'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CircleUser, Info, KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { PageShell } from '@/components/app/page-shell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AboutPanel } from '@/components/account/about-panel'
import { MySessionsPanel } from '@/components/account/my-sessions-panel'
import { ProfilePanel } from '@/components/account/profile-panel'
import { SecurityPanel } from '@/components/account/security-panel'
import { TokensPanel } from '@/components/account/tokens-panel'

/**
 * Account centre — five self-service tabs behind one URL.
 *
 * The tabs share a page (rather than five routes) for the same reason the admin
 * and DHCP views do: they are facets of one subsystem (`user/*`) and an operator
 * moves between them constantly — minting a token, then checking it appears
 * under "My sessions", then revoking an old one.
 *
 * Two non-obvious points:
 *
 *  - **No profile query is hoisted here.** Three panels (profile, tokens,
 *    sessions) all read `user/profile/get`, but they key it identically
 *    (`queryKeys.profile(target)`), so TanStack Query dedupes them into one
 *    in-flight request and one cache entry. Hoisting would only add prop
 *    drilling; each panel owning its query keeps invalidation local and correct.
 *
 *  - **The URL is the single source of truth for the active tab.** `user-menu.tsx`
 *    deep-links with `/account?tab=security` and the tab bar writes the choice
 *    back with `router.replace`, so the menu and the tab bar can never disagree.
 *    An `initialTab`-prop-plus-local-state version went stale the moment an
 *    operator who was *already* on `/account` used the menu: the Server Component
 *    passed a fresh prop but the mounted view kept its old local tab. Deriving
 *    from `useSearchParams` instead also keeps every tab linkable and shareable.
 *    `page.tsx` still reads `?tab=` on the server, which both hands down a
 *    first-paint hint and keeps the route dynamic so `useSearchParams` needs no
 *    Suspense boundary here.
 */

const ACCOUNT_TABS = ['profile', 'security', 'tokens', 'sessions', 'about'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

function isAccountTab(value: string | null | undefined): value is AccountTab {
  return value !== null && value !== undefined && (ACCOUNT_TABS as readonly string[]).includes(value)
}

export interface AccountViewProps {
  /** Server-read `?tab=`; only a first-paint hint — the live value is the URL. */
  initialTab?: string
  /** `package.json` version, resolved on the server (see `page.tsx`). */
  consoleVersion: string
}

export function AccountView({ initialTab, consoleVersion }: AccountViewProps) {
  const t = useTranslations('account')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const requested = searchParams.get('tab') ?? initialTab
  const tab: AccountTab = isAccountTab(requested) ? requested : 'profile'

  /** Tab-bar clicks rewrite the query string; the menu's `push` already did. */
  const selectTab = (value: string) => {
    const next: AccountTab = isAccountTab(value) ? value : 'profile'
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`)
  }

  return (
    <PageShell>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="profile">
            <CircleUser className="size-4" aria-hidden />
            {t('tabs.profile')}
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="size-4" aria-hidden />
            {t('tabs.security')}
          </TabsTrigger>
          <TabsTrigger value="tokens">
            <KeyRound className="size-4" aria-hidden />
            {t('tabs.tokens')}
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <MonitorSmartphone className="size-4" aria-hidden />
            {t('tabs.sessions')}
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="size-4" aria-hidden />
            {t('tabs.about')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfilePanel />
        </TabsContent>
        <TabsContent value="security">
          <SecurityPanel />
        </TabsContent>
        <TabsContent value="tokens">
          <TokensPanel />
        </TabsContent>
        <TabsContent value="sessions">
          <MySessionsPanel />
        </TabsContent>
        <TabsContent value="about">
          <AboutPanel consoleVersion={consoleVersion} />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
