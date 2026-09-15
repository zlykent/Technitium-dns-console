'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ArrowUpDown, Info, ListFilter, RefreshCw, Store } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DebouncedSearch } from '@/components/app/search-input'
import { EmptyState, ErrorState, NoResultsState } from '@/components/app/states'
import { AppCard } from '@/components/apps/app-card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/api/client'
import { downloadAndInstallApp, downloadAndUpdateApp } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import type { InstalledApp, StoreApp } from '@/lib/api/types/apps'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * The storefront: a searchable, sortable card grid over `apps/listStoreApps`.
 *
 * Data ownership stays in `apps-view` (which holds both queries so the installed
 * list and the store share one cache and invalidate together); this panel is a
 * pure view over `storeApps` plus the two download mutations.
 *
 * Three non-obvious bits:
 *
 *  - **Update detection is a join.** `StoreApp` has no `updateAvailable` /
 *    `installedVersion`, so "is there a newer version?" is answered by matching
 *    each store app against `apps/list` by name (`installedByName`). The store's
 *    own `installed` flag drives the badge; the join only supplies the update.
 *  - **`size` sorts as a parsed number.** It arrives pre-formatted (`"10.75 MB"`),
 *    so `parseSizeToBytes` turns it back into a magnitude for ordering — the one
 *    place the string is interpreted rather than displayed.
 *  - **Downloads are confirmed, then serialised.** Installing/updating makes the
 *    DNS server fetch the package (tens of seconds on a slow uplink), so a
 *    `ConfirmDialog` warns first and `anyBusy` disables every other card's action
 *    while one is in flight. Search and filtering are all client-side: the store
 *    is ~27 rows and re-querying per keystroke would hammer a single-threaded API.
 */

type StoreFilter = 'all' | 'installed' | 'not'
type StoreSort = 'name' | 'size'

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  PB: 1024 ** 5,
}

/** `"61.54 KB"` -> bytes, for sorting only. Unparseable sizes sink to 0. */
function parseSizeToBytes(size: string): number {
  const match = size.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/)
  if (!match) return 0
  const value = Number.parseFloat(match[1])
  const unit = SIZE_UNITS[match[2].toUpperCase()] ?? 1
  return Number.isFinite(value) ? value * unit : 0
}

export interface AppStorePanelProps {
  storeApps: StoreApp[]
  /** Live installed set, joined by name to surface available updates. */
  installedApps: InstalledApp[]
  loading: boolean
  refreshing: boolean
  error: unknown
  onRetry: () => void
  onRefresh: () => void
  canModify: boolean
}

export function AppStorePanel({ storeApps, installedApps, loading, refreshing, error, onRetry, onRefresh, canModify }: AppStorePanelProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<StoreFilter>('all')
  const [sortBy, setSortBy] = React.useState<StoreSort>('name')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [installTarget, setInstallTarget] = React.useState<StoreApp | null>(null)
  const [updateTarget, setUpdateTarget] = React.useState<{ app: StoreApp; version: string } | null>(null)

  const installedByName = React.useMemo(() => {
    const map = new Map<string, InstalledApp>()
    for (const app of installedApps) map.set(app.name, app)
    return map
  }, [installedApps])

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.apps(target) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.storeApps(target) })
  }, [queryClient, target])

  const install = useMutation({
    // The server downloads the package itself, so it needs the store row's
    // `url` alongside the name — omitting it earns "Parameter 'url' missing.".
    mutationFn: (app: StoreApp) => downloadAndInstallApp(app.name, app.url),
    onSuccess: (result) => {
      toast.success(t('install.success', { name: result.installedApp.name }))
      invalidate()
      setInstallTarget(null)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  const update = useMutation({
    mutationFn: (app: StoreApp) => downloadAndUpdateApp(app.name, app.url),
    onSuccess: (result) => {
      toast.success(t('update.success', { name: result.updatedApp.name, version: result.updatedApp.version }))
      invalidate()
      setUpdateTarget(null)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  const anyBusy = install.isPending || update.isPending

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = storeApps.filter((app) => {
      if (filter === 'installed' && !app.installed) return false
      if (filter === 'not' && app.installed) return false
      if (q && !`${app.name} ${app.description}`.toLowerCase().includes(q)) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      const cmp = sortBy === 'size' ? parseSizeToBytes(a.size) - parseSizeToBytes(b.size) : a.name.localeCompare(b.name)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [storeApps, search, filter, sortBy, sortDir])

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{t('store.title')}</h2>
      <p className="text-sm text-muted-foreground text-pretty">{t('store.subtitle')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearch onSearch={setSearch} placeholder={t('store.searchPlaceholder')} />

        <Select value={filter} onValueChange={(value) => setFilter(value as StoreFilter)}>
          <SelectTrigger size="sm" className="w-auto min-w-32" aria-label={tc('actions.filter')}>
            <ListFilter className="size-3.5" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tc('fields.all')}</SelectItem>
            <SelectItem value="installed">{t('store.filterInstalled')}</SelectItem>
            <SelectItem value="not">{t('store.filterNotInstalled')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('store.totalApps', { count: storeApps.length })}</span>

          <div className="flex items-center gap-1">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as StoreSort)}>
              <SelectTrigger size="sm" className="w-auto min-w-28" aria-label={tc('table.sortBy')}>
                <ArrowUpDown className="size-3.5" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t('store.columns.name')}</SelectItem>
                <SelectItem value="size">{t('store.columns.size')}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
              aria-label={tc('table.sortBy')}
              title={tc('table.sortBy')}
            >
              {sortDir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
            </Button>
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={onRefresh}
            loading={refreshing}
            aria-label={refreshing ? t('store.refreshing') : t('store.refresh')}
            title={refreshing ? t('store.refreshing') : t('store.refresh')}
          >
            {!refreshing && <RefreshCw aria-hidden />}
          </Button>
        </div>
      </div>

      {!loading && !error && storeApps.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground text-pretty">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('store.downloadHint')}
        </p>
      )}

      {loading ? (
        <StoreGridSkeleton />
      ) : error ? (
        <div className="flex flex-col gap-3">
          <ErrorState error={error} title={t('store.loadFailed')} onRetry={onRetry} />
          <p className="text-xs text-muted-foreground text-pretty">{t('store.loadFailedHint')}</p>
        </div>
      ) : storeApps.length === 0 ? (
        <div className="surface rounded-lg">
          <EmptyState title={t('store.empty')} body={t('store.emptyHint')} icon={Store} />
        </div>
      ) : visible.length === 0 ? (
        <div className="surface rounded-lg">
          <NoResultsState />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((app) => {
            const joined = installedByName.get(app.name)
            const updateAvailable = app.installed && (joined?.updateAvailable ?? false)
            return (
              <AppCard
                key={app.name}
                app={app}
                updateAvailable={updateAvailable}
                canModify={canModify}
                installing={install.isPending && install.variables?.name === app.name}
                updating={update.isPending && update.variables?.name === app.name}
                anyBusy={anyBusy}
                onInstall={() => setInstallTarget(app)}
                onUpdate={() => setUpdateTarget({ app, version: joined?.updateVersion ?? app.version })}
              />
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(installTarget)}
        onOpenChange={(open) => !open && setInstallTarget(null)}
        title={installTarget ? t('install.fromStoreTitle', { name: installTarget.name }) : ''}
        description={
          <span className="flex flex-col gap-2">
            <span>{t('install.fromStoreBody')}</span>
            <span className="text-xs text-muted-foreground">{t('store.downloadHint')}</span>
          </span>
        }
        confirmLabel={install.isPending ? t('store.installing') : t('install.fromStoreSubmit')}
        tone="default"
        onConfirm={async () => {
          if (installTarget) await install.mutateAsync(installTarget)
        }}
        pending={install.isPending}
        error={install.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(updateTarget)}
        onOpenChange={(open) => !open && setUpdateTarget(null)}
        title={updateTarget ? t('update.fromStoreTitle', { name: updateTarget.app.name }) : ''}
        description={updateTarget ? t('update.fromStoreBody', { version: updateTarget.version }) : undefined}
        confirmLabel={update.isPending ? t('store.updating') : t('update.submit')}
        tone="default"
        onConfirm={async () => {
          if (updateTarget) await update.mutateAsync(updateTarget.app)
        }}
        pending={update.isPending}
        error={update.error ?? undefined}
      />
    </div>
  )
}

/** Card-shaped placeholders in the same grid, so the layout does not jump. */
function StoreGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={cn('surface flex flex-col gap-3 rounded-lg p-4')}>
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-1 h-8 w-full" />
        </div>
      ))}
    </div>
  )
}
