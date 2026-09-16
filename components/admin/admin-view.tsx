'use client'

import { useTranslations } from 'next-intl'
import { KeyRound, MonitorSmartphone, Network, ShieldCheck, Users, UsersRound } from 'lucide-react'
import * as React from 'react'
import { PageShell } from '@/components/app/page-shell'
import { EmptyState } from '@/components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClusterPanel } from '@/components/admin/cluster-panel'
import { GroupsPanel } from '@/components/admin/groups-panel'
import { PermissionsPanel } from '@/components/admin/permissions-panel'
import { SessionsPanel } from '@/components/admin/sessions-panel'
import { SsoPanel } from '@/components/admin/sso-panel'
import { UsersPanel } from '@/components/admin/users-panel'
import { useCan } from '@/lib/auth/session'

/**
 * Administration — users, groups, permissions, sessions, SSO and the cluster.
 *
 * Six tabs share one page because they are all facets of the same upstream
 * subsystem (`admin/*`) and operators move between them constantly: fixing a
 * permission means finding the user, then the group, then the section.
 *
 * Two non-obvious points:
 *
 *  - **No data is fetched here.** Unlike `components/dhcp/dhcp-view.tsx`, which
 *    hoists the scope list because two tabs consume it, the only payload shared
 *    across these tabs is the user/group inventory — and every panel already
 *    needs it under a *different* query key (the groups panel wants members, the
 *    permissions panel wants selectable principals). Hoisting would just add a
 *    second cache entry for the same bytes, so each panel owns its own query.
 *
 *  - **The tab state is local, not a URL segment.** `?tab=` was considered and
 *    dropped: the panels are cheap to mount and TanStack keeps their caches warm
 *    for `DEFAULT_STALE_TIME`, so deep links would not save a round trip. The
 *    sidebar entry points at `/admin` plain (see `lib/nav.ts`).
 *
 * `canView` is enforced twice — by the route guard in `lib/nav.ts` and again
 * here — because the guard runs against the session snapshot available at
 * navigation time, and permissions can be revoked underneath a signed-in
 * operator without a reload.
 */

type AdminTab = 'users' | 'groups' | 'permissions' | 'sessions' | 'sso' | 'cluster'

export function AdminView() {
  const t = useTranslations('admin')
  const can = useCan('Administration')
  const [tab, setTab] = React.useState<AdminTab>('users')

  if (!can.canView) {
    return (
      <PageShell>
        <EmptyState icon={ShieldCheck} title={t('title')} body={t('subtitle')} />
      </PageShell>
    )
  }

  return (
    <PageShell className="h-full">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as AdminTab)}
        // Flex chain down to the panels so their scrollable tables can fill
        // the leftover viewport height (see `TabsContent` in ui/tabs).
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="users">
            <Users className="size-4" aria-hidden />
            {t('tabs.users')}
          </TabsTrigger>
          <TabsTrigger value="groups">
            <UsersRound className="size-4" aria-hidden />
            {t('tabs.groups')}
          </TabsTrigger>
          <TabsTrigger value="permissions">
            <ShieldCheck className="size-4" aria-hidden />
            {t('tabs.permissions')}
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <MonitorSmartphone className="size-4" aria-hidden />
            {t('tabs.sessions')}
          </TabsTrigger>
          <TabsTrigger value="sso">
            <KeyRound className="size-4" aria-hidden />
            {t('tabs.sso')}
          </TabsTrigger>
          <TabsTrigger value="cluster">
            <Network className="size-4" aria-hidden />
            {t('tabs.cluster')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="flex min-h-0 flex-col">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="groups" className="flex min-h-0 flex-col">
          <GroupsPanel />
        </TabsContent>
        <TabsContent value="permissions" className="min-h-0 overflow-y-auto">
          <PermissionsPanel />
        </TabsContent>
        <TabsContent value="sessions" className="flex min-h-0 flex-col">
          <SessionsPanel />
        </TabsContent>
        <TabsContent value="sso" className="min-h-0 overflow-y-auto">
          <SsoPanel />
        </TabsContent>
        <TabsContent value="cluster" className="min-h-0 overflow-y-auto">
          <ClusterPanel />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
