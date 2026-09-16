'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Package, Store } from 'lucide-react'
import { PageShell } from '@/components/app/page-shell'
import { AppStorePanel } from '@/components/apps/app-store-panel'
import { InstalledAppsPanel } from '@/components/apps/installed-apps-panel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { listApps, listStoreApps } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * DNS Applications — the page shell that owns both queries and splits the UI
 * into "Installed" and "Store" tabs.
 *
 * Both `useQuery` calls live *here*, not in the panels, for one reason: they
 * invalidate together. Installing from the store changes the installed set *and*
 * flips a store card's `installed` flag, so a single mutation must be able to
 * refresh both from one cache owner. The panels are then near-pure views plus
 * their own mutations, reaching back through `queryClient.invalidateQueries` on
 * the two keys below rather than owning the reads.
 *
 * `queryKeys.apps(target)` is deliberately the *same* key the Logs ▸ Query view
 * uses (`query-logs-view.tsx`) to discover logging apps — same cache entry, so an
 * install here is reflected there without a second fetch. The store key is
 * private to this page.
 *
 * Both reads are eager (they sit above the `Tabs`, so they run even while the
 * inactive panel is unmounted by Radix). That is intentional: the installed
 * panel's "go to store" empty-state action and the store's update-detection join
 * (`installedApps` by name) both need the other query's data the instant the
 * operator switches tabs. Neither read writes, and both tolerate a server with
 * zero apps installed — the live target currently returns `{ apps: [] }`.
 */

type AppsTab = 'installed' | 'store'

export function AppsView() {
  const t = useTranslations('apps')
  const target = useTargetKey()
  const can = useCan('Apps')

  const [tab, setTab] = React.useState<AppsTab>('installed')

  const installed = useQuery({
    queryKey: queryKeys.apps(target),
    queryFn: () => listApps(),
    enabled: can.canView,
    staleTime: 30_000,
  })

  const store = useQuery({
    queryKey: queryKeys.storeApps(target),
    queryFn: () => listStoreApps(),
    enabled: can.canView,
    // The storefront only changes when the upstream repo publishes, so a minute
    // of staleness avoids re-pulling ~27 rows on every tab switch.
    staleTime: 60_000,
  })

  const installedApps = installed.data?.apps ?? []

  return (
    <PageShell className="h-full">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as AppsTab)}
        // Flex chain down to the panels so the installed table can fill the
        // leftover viewport height and scroll internally.
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="installed">
            <Package className="size-4" aria-hidden />
            {t('tabs.installed')}
          </TabsTrigger>
          <TabsTrigger value="store">
            <Store className="size-4" aria-hidden />
            {t('tabs.store')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="flex min-h-0 flex-col">
          <InstalledAppsPanel
            apps={installedApps}
            loading={installed.isPending}
            checking={installed.isFetching}
            error={installed.error}
            onRetry={() => void installed.refetch()}
            onCheckUpdates={() => void installed.refetch()}
            canModify={can.canModify}
            canDelete={can.canDelete}
            onGoToStore={() => setTab('store')}
          />
        </TabsContent>

        <TabsContent value="store" className="min-h-0 overflow-y-auto">
          <AppStorePanel
            storeApps={store.data?.storeApps ?? []}
            installedApps={installedApps}
            loading={store.isPending}
            refreshing={store.isFetching}
            error={store.error}
            onRetry={() => void store.refetch()}
            onRefresh={() => void store.refetch()}
            canModify={can.canModify}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
