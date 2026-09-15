'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslations } from 'next-intl'
import { Boxes, CircleCheck, EllipsisVertical, Info, Package, RefreshCw, Settings, Store, Trash, Upload } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable } from '@/components/app/data-table'
import { AppDetailsDialog } from '@/components/apps/app-details-dialog'
import { AppConfigDialog } from '@/components/apps/app-config-dialog'
import { InstallAppDialog } from '@/components/apps/install-app-dialog'
import { UpdateAppDialog } from '@/components/apps/update-app-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { describeError } from '@/lib/api/client'
import { downloadAndUpdateApp, uninstallApp } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import type { InstalledApp } from '@/lib/api/types/apps'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * The installed set: a table of packages with per-row config / update / uninstall.
 *
 * Deliberately a `DataTable` (not cards) — this is dense operational data with
 * real columns (`installed.columns.*`), unlike the storefront next door. Sorting
 * is client-side; there is no paging upstream and the set is small.
 *
 * Two update paths coexist and must not be confused:
 *
 *  - **from the store** (`downloadAndUpdateApp`) — the row has `updateAvailable`
 *    plus the `updateUrl` the server downloads; a `ConfirmDialog` warns that
 *    queries may blip, then the server fetches the package.
 *  - **from a local ZIP** (`updateApp`) — always offered via `UpdateAppDialog`,
 *    for offline servers or sideloaded builds.
 *
 * "Update all" has no bulk endpoint, so it loops `downloadAndUpdateApp`
 * sequentially (the same shape as `filter-view`'s bulk delete). Dialogs live at
 * panel level and rows only set target state — the proven `filter-view`
 * child-trigger → parent-dialog pattern, which keeps one dialog instance alive
 * instead of one per row.
 */

export interface InstalledAppsPanelProps {
  apps: InstalledApp[]
  loading: boolean
  /** `apps/list` is refetching — drives the "check for updates" spinner. */
  checking: boolean
  error: unknown
  onRetry: () => void
  onCheckUpdates: () => void
  canModify: boolean
  canDelete: boolean
  /** Switches the parent Tabs to the store — the empty state's primary action. */
  onGoToStore: () => void
}

export function InstalledAppsPanel({
  apps,
  loading,
  checking,
  error,
  onRetry,
  onCheckUpdates,
  canModify,
  canDelete,
  onGoToStore,
}: InstalledAppsPanelProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [configName, setConfigName] = React.useState<string | null>(null)
  const [detailsApp, setDetailsApp] = React.useState<InstalledApp | null>(null)
  const [localUpdateName, setLocalUpdateName] = React.useState<string | null>(null)
  const [installOpen, setInstallOpen] = React.useState(false)
  const [uninstallTarget, setUninstallTarget] = React.useState<InstalledApp | null>(null)
  const [storeUpdateTarget, setStoreUpdateTarget] = React.useState<InstalledApp | null>(null)
  const [updateAllOpen, setUpdateAllOpen] = React.useState(false)

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.apps(target) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.storeApps(target) })
  }, [queryClient, target])

  const onError = React.useCallback((err: unknown) => toast.error(describeError(err).message), [])

  const uninstall = useMutation({
    mutationFn: (name: string) => uninstallApp(name),
    onSuccess: (_result, name) => {
      toast.success(t('uninstall.success', { name }))
      invalidate()
      setUninstallTarget(null)
    },
    onError,
  })

  const storeUpdate = useMutation({
    mutationFn: (app: InstalledApp) => downloadAndUpdateApp(app.name, app.updateUrl ?? ''),
    onSuccess: (result) => {
      toast.success(t('update.success', { name: result.updatedApp.name, version: result.updatedApp.version }))
      invalidate()
      setStoreUpdateTarget(null)
    },
    onError,
  })

  const updateAll = useMutation({
    mutationFn: async (targets: InstalledApp[]) => {
      for (const app of targets) await downloadAndUpdateApp(app.name, app.updateUrl ?? '')
    },
    onSuccess: () => {
      toast.success(tc('toast.updated'))
      invalidate()
      setUpdateAllOpen(false)
    },
    onError,
  })

  // `updateUrl` is part of the gate: the store-sourced download endpoints take
  // name + url, so an updatable row without a url has no working download path.
  const updatable = React.useMemo(() => apps.filter((app) => app.updateAvailable && Boolean(app.updateUrl)), [apps])
  const totalDnsApps = React.useMemo(() => apps.reduce((sum, app) => sum + app.dnsApps.length, 0), [apps])

  const columns = React.useMemo<ColumnDef<InstalledApp, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('installed.columns.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'description',
        header: t('installed.columns.description'),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-sm text-xs text-muted-foreground" title={row.original.description}>
            {row.original.description || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'version',
        header: t('installed.columns.version'),
        cell: ({ row }) => <span className="font-data text-xs">{row.original.version}</span>,
      },
      {
        id: 'dnsApps',
        header: t('installed.columns.dnsApps'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button variant="ghost" size="xs" onClick={() => setDetailsApp(row.original)} aria-label={t('dnsApps.title')}>
            <Boxes className="size-3.5" aria-hidden />
            {row.original.dnsApps.length}
          </Button>
        ),
      },
      {
        id: 'update',
        header: t('installed.columns.update'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.updateAvailable ? (
            <Badge variant="warning">
              <RefreshCw aria-hidden />
              {t('installed.updateAvailable', { version: row.original.updateVersion ?? row.original.version })}
            </Badge>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CircleCheck className="size-3.5 text-success" aria-hidden />
              {t('installed.upToDate')}
            </span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('installed.columns.actions')}</span>,
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => {
          const app = row.original
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={t('installed.columns.actions')}>
                  <EllipsisVertical className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDetailsApp(app)}>
                  <Boxes aria-hidden />
                  {tc('actions.details')}
                </DropdownMenuItem>
                {canModify && (
                  <DropdownMenuItem onSelect={() => setConfigName(app.name)}>
                    <Settings aria-hidden />
                    {t('config.action')}
                  </DropdownMenuItem>
                )}
                {canModify && app.updateAvailable && app.updateUrl && (
                  <DropdownMenuItem onSelect={() => setStoreUpdateTarget(app)}>
                    <RefreshCw aria-hidden />
                    {tc('actions.update')}
                  </DropdownMenuItem>
                )}
                {canModify && (
                  <DropdownMenuItem onSelect={() => setLocalUpdateName(app.name)}>
                    <Upload aria-hidden />
                    {t('update.localTitle')}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setUninstallTarget(app)}>
                      <Trash aria-hidden />
                      {t('uninstall.action')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [t, tc, canModify, canDelete],
  )

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{t('installed.title')}</h2>

      <div className="flex flex-wrap items-center gap-2">
        {canModify && (
          <Button variant="outline" size="sm" onClick={() => setInstallOpen(true)}>
            <Upload className="size-3.5" aria-hidden />
            {t('installed.installLocal')}
          </Button>
        )}
        {canModify && updatable.length > 0 && (
          <Button size="sm" onClick={() => setUpdateAllOpen(true)}>
            <RefreshCw className="size-3.5" aria-hidden />
            {t('update.updateAll')}
          </Button>
        )}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={onCheckUpdates} loading={checking} disabled={loading}>
            {!checking && <RefreshCw className="size-3.5" aria-hidden />}
            {checking ? t('installed.checking') : t('installed.checkUpdates')}
          </Button>
        </div>
      </div>

      {!loading && !error && apps.length > 0 && (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>{t('installed.autoUpdate')}</AlertTitle>
          <AlertDescription>{t('installed.autoUpdateHint')}</AlertDescription>
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={apps}
        getRowId={(row) => row.name}
        loading={loading}
        error={error}
        onRetry={onRetry}
        label={t('installed.title')}
        empty={{
          title: t('installed.empty'),
          body: t('installed.emptyHint'),
          icon: Package,
          action: (
            <Button size="sm" onClick={onGoToStore}>
              <Store className="size-4" aria-hidden />
              {t('installed.goToStore')}
            </Button>
          ),
        }}
        footerNote={
          apps.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-3">
              <span>{t('installed.totalApps', { count: apps.length })}</span>
              <span>{t('installed.totalDnsApps', { count: totalDnsApps })}</span>
            </span>
          ) : undefined
        }
      />

      <InstallAppDialog open={installOpen} onOpenChange={setInstallOpen} />
      <UpdateAppDialog open={Boolean(localUpdateName)} onOpenChange={(open) => !open && setLocalUpdateName(null)} appName={localUpdateName} />
      <AppConfigDialog open={Boolean(configName)} onOpenChange={(open) => !open && setConfigName(null)} appName={configName} />
      <AppDetailsDialog open={Boolean(detailsApp)} onOpenChange={(open) => !open && setDetailsApp(null)} app={detailsApp} />

      <ConfirmDialog
        open={Boolean(uninstallTarget)}
        onOpenChange={(open) => !open && setUninstallTarget(null)}
        title={uninstallTarget ? t('uninstall.title', { name: uninstallTarget.name }) : ''}
        description={uninstallTarget ? t('uninstall.body', { name: uninstallTarget.name }) : undefined}
        confirmLabel={uninstall.isPending ? t('uninstall.submitting') : t('uninstall.submit')}
        requireText={uninstallTarget?.name}
        tone="destructive"
        onConfirm={async () => {
          if (uninstallTarget) await uninstall.mutateAsync(uninstallTarget.name)
        }}
        pending={uninstall.isPending}
        error={uninstall.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(storeUpdateTarget)}
        onOpenChange={(open) => !open && setStoreUpdateTarget(null)}
        title={storeUpdateTarget ? t('update.fromStoreTitle', { name: storeUpdateTarget.name }) : ''}
        description={storeUpdateTarget ? t('update.fromStoreBody', { version: storeUpdateTarget.updateVersion ?? storeUpdateTarget.version }) : undefined}
        confirmLabel={storeUpdate.isPending ? t('update.submitting') : t('update.submit')}
        tone="default"
        onConfirm={async () => {
          if (storeUpdateTarget) await storeUpdate.mutateAsync(storeUpdateTarget)
        }}
        pending={storeUpdate.isPending}
        error={storeUpdate.error ?? undefined}
      />

      <ConfirmDialog
        open={updateAllOpen}
        onOpenChange={setUpdateAllOpen}
        title={t('update.updateAll')}
        description={t('update.updateAllConfirm')}
        confirmLabel={updateAll.isPending ? t('update.submitting') : t('update.submit')}
        tone="default"
        onConfirm={async () => {
          await updateAll.mutateAsync(updatable)
        }}
        pending={updateAll.isPending}
        error={updateAll.error ?? undefined}
      />
    </div>
  )
}
