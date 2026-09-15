'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CircleCheck,
  CircleStop,
  Download,
  FolderPlus,
  FolderTree,
  RefreshCw,
  Trash,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DebouncedSearch } from '@/components/app/search-input'
import { PageHeader, PageShell } from '@/components/app/page-shell'
import { CreateZoneDialog } from '@/components/zones/create-zone-dialog'
import { CloneZoneDialog } from '@/components/zones/clone-zone-dialog'
import { ConvertZoneDialog } from '@/components/zones/convert-zone-dialog'
import { ImportZoneDialog } from '@/components/zones/import-zone-dialog'
import { ZoneRowActions } from '@/components/zones/zone-row-actions'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/api/client'
import {
  deleteZones,
  disableZone,
  enableZone,
  exportZone,
  listZones,
  resyncZone,
} from '@/lib/api/domains/zones'
import { ZONE_TYPES, type ZoneType } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import type { ZoneSummary } from '@/lib/api/types/zones'
import { useCan } from '@/lib/auth/session'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Zone inventory — the landing page of the whole DNS module.
 *
 * `zones/list` paginates on the server, so *all* filtering (name substring and
 * type) is a query parameter, never a client-side `.filter()`: the browser only
 * ever holds one page. That is why the search box is debounced — every keystroke
 * would otherwise be a round trip to a single-threaded admin API on a LAN box.
 *
 * Two details that are easy to get wrong:
 *
 *  - `queryKeys.zoneList` takes an `extra` bag for exactly this: type and page
 *    size are part of the request, so they must be part of the key or switching
 *    either would serve a stale cached page. Passing them as a trailing array
 *    element instead would also work for prefix invalidation but would break a
 *    targeted `invalidateQueries(zoneList(target, page, name))`, so they go in
 *    the bag.
 *  - The dashboard's "add zone" shortcut links here with `?new=1`. The flag is
 *    read from `window.location` in an effect (not `useSearchParams`) so the
 *    route keeps prerendering without a Suspense boundary, then stripped via
 *    `history.replaceState` so a manual refresh does not re-open the dialog.
 *
 * Every destructive path (disable, single delete, bulk delete) routes through a
 * `ConfirmDialog`; bulk delete additionally requires typing the count.
 */

/** Sentinel for the "all types" entry — Radix `Select` forbids an empty value. */
const ALL_TYPES = '__all__'

export function ZonesView() {
  const t = useTranslations('zones')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const router = useRouter()
  const queryClient = useQueryClient()
  const can = useCan('Zones')

  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [filterName, setFilterName] = React.useState('')
  const [filterType, setFilterType] = React.useState<ZoneType | ''>('')
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({})

  // The dashboard's "add zone" shortcut links here with `?new=1`. Seed the
  // dialog's open state from the query string during the initial state
  // initialiser (reading `window.location` is a one-shot platform read, not a
  // subscription), then strip the flag in an effect so a manual refresh does
  // not re-open the dialog. Keeping the `setState` out of the effect avoids a
  // cascading render.
  const [createOpen, setCreateOpen] = React.useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1',
  )
  const [importOpen, setImportOpen] = React.useState(false)
  const [cloneZone, setCloneZone] = React.useState<ZoneSummary | null>(null)
  const [convertTarget, setConvertTarget] = React.useState<ZoneSummary | null>(null)
  const [disableTarget, setDisableTarget] = React.useState<ZoneSummary | null>(null)
  const [resyncTarget, setResyncTarget] = React.useState<ZoneSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<ZoneSummary | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [exportAllOpen, setExportAllOpen] = React.useState(false)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    params.delete('new')
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [])

  const zones = useQuery({
    queryKey: queryKeys.zoneList(target, page, filterName, { filterType, pageSize }),
    queryFn: () =>
      listZones({
        pageNumber: page,
        zonesPerPage: pageSize,
        filterName: filterName || undefined,
        filterType: filterType || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: can.canView,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  // Technitium rejects a delete on a protected zone with a generic upstream
  // message, and `ZoneSummary` carries no `isDeleteProtected` flag — so the
  // guard can only be applied *after* the rejection. Swap in the actionable
  // hint when the server says the zone is protected.
  const onDeleteError = React.useCallback(
    (error: unknown) => {
      const message = describeError(error).message
      toast.error(/delete protect|isDeleteProtected/i.test(message) ? t('actions.deleteProtected') : message)
    },
    [t],
  )

  const enable = useMutation({
    mutationFn: (name: string) => enableZone(name),
    onSuccess: (_r, name) => {
      toast.success(t('actions.enableSuccess', { zone: name }))
      invalidate()
    },
    onError,
  })

  const disable = useMutation({
    mutationFn: (name: string) => disableZone(name),
    onSuccess: (_r, name) => {
      toast.success(t('actions.disableSuccess', { zone: name }))
      invalidate()
      setDisableTarget(null)
    },
    onError,
  })

  const resync = useMutation({
    mutationFn: (name: string) => resyncZone(name),
    onSuccess: (_r, name) => {
      toast.success(t('actions.resyncSuccess', { zone: name }))
      invalidate()
      setResyncTarget(null)
    },
    onError,
  })

  const exportOne = useMutation({
    mutationFn: (name: string) => exportZone(name),
    onSuccess: (_r, name) => toast.success(t('export.success', { zone: name })),
    onError,
  })

  const remove = useMutation({
    mutationFn: (name: string) => deleteZones([name]),
    onSuccess: (_r, name) => {
      toast.success(t('actions.deleteSuccess', { zone: name }))
      invalidate()
      setDeleteTarget(null)
    },
    onError: onDeleteError,
  })

  const bulkRemove = useMutation({
    mutationFn: (names: string[]) => deleteZones(names),
    onSuccess: (_r, names) => {
      toast.success(t('actions.deleteBulkSuccess', { count: names.length }))
      invalidate()
      setRowSelection({})
      setBulkDeleteOpen(false)
    },
    onError: onDeleteError,
  })

  const bulkEnable = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) await enableZone(name)
    },
    onSuccess: () => {
      toast.success(tc('toast.updated'))
      invalidate()
      setRowSelection({})
    },
    onError,
  })

  const bulkDisable = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) await disableZone(name)
    },
    onSuccess: () => {
      toast.success(tc('toast.updated'))
      invalidate()
      setRowSelection({})
    },
    onError,
  })

  // Sequentially download every zone file. Pages through the whole inventory so
  // "export all" is not limited to the visible page. Browsers may throttle the
  // burst of downloads; that is a client-side constraint, not an API one.
  const exportAll = useMutation({
    mutationFn: async () => {
      let pageNumber = 1
      const names: string[] = []
      for (;;) {
        const result = await listZones({ pageNumber, zonesPerPage: 500 })
        names.push(...result.zones.map((zone) => zone.name))
        if (pageNumber >= result.totalPages || result.zones.length === 0) break
        pageNumber += 1
      }
      for (const name of names) await exportZone(name)
    },
    onSuccess: () => {
      toast.success(tc('actions.done'))
      setExportAllOpen(false)
    },
    onError,
  })

  const selectedNames = React.useMemo(
    () => Object.keys(rowSelection).filter((key) => rowSelection[key]),
    [rowSelection],
  )

  const busyName =
    (enable.isPending && (enable.variables as string)) ||
    (disable.isPending && (disable.variables as string)) ||
    (resync.isPending && (resync.variables as string)) ||
    (exportOne.isPending && (exportOne.variables as string)) ||
    null

  const goRecords = React.useCallback(
    (zone: ZoneSummary) => router.push(`/zones/${encodeURIComponent(zone.name)}`),
    [router],
  )
  const goOptions = React.useCallback(
    (zone: ZoneSummary) => router.push(`/zones/${encodeURIComponent(zone.name)}/options`),
    [router],
  )
  const goPermissions = React.useCallback(
    (zone: ZoneSummary) => router.push(`/zones/${encodeURIComponent(zone.name)}/permissions`),
    [router],
  )

  const columns = React.useMemo(
    () => [
      textColumn<ZoneSummary>({
        id: 'name',
        accessorKey: 'name',
        header: t('list.columns.name'),
        cell: (value, row) => (
          <Link
            href={`/zones/${encodeURIComponent(row.name)}`}
            className="font-data rounded-sm text-sm font-medium hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {String(value)}
          </Link>
        ),
      }),
      textColumn<ZoneSummary>({
        id: 'type',
        accessorKey: 'type',
        header: t('list.columns.type'),
        cell: (value) => <Badge variant={typeVariant(value as ZoneType)}>{t(`types.${value as string}.label`)}</Badge>,
      }),
      textColumn<ZoneSummary>({
        id: 'status',
        header: t('list.columns.status'),
        cell: (_value, row) => {
          const status = zoneStatus(row, t)
          return (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <StatusDot tone={status.tone} />
              {status.label}
            </span>
          )
        },
        enableSorting: false,
      }),
      textColumn<ZoneSummary>({
        id: 'soaSerial',
        accessorKey: 'soaSerial',
        header: t('list.columns.soaSerial'),
        align: 'right',
        cell: (value) => <span className="font-data text-xs">{String(value)}</span>,
      }),
      textColumn<ZoneSummary>({
        id: 'dnssec',
        accessorKey: 'dnssecStatus',
        header: t('list.columns.dnssec'),
        cell: (value) => (
          <Badge variant={dnssecVariant(value as string)}>{t(`list.dnssecStatus.${value as string}`)}</Badge>
        ),
        enableSorting: false,
      }),
      textColumn<ZoneSummary>({
        id: 'lastModified',
        accessorKey: 'lastModified',
        header: t('list.columns.lastModified'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground" title={formatDateTime(value as string, locale)}>
            {formatRelative(value as string, locale)}
          </span>
        ),
      }),
      textColumn<ZoneSummary>({
        id: 'catalog',
        accessorKey: 'catalog',
        header: t('list.columns.catalog'),
        cell: (value) =>
          value ? <span className="font-data text-xs text-muted-foreground">{String(value)}</span> : <span className="text-muted-foreground">—</span>,
        enableSorting: false,
      }),
      textColumn<ZoneSummary>({
        id: 'actions',
        header: tc('fields.actions'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value, row) => (
          <ZoneRowActions
            zone={row}
            canModify={can.canModify}
            canDelete={can.canDelete}
            busy={busyName === row.name}
            onViewRecords={goRecords}
            onEnable={(zone) => enable.mutate(zone.name)}
            onDisable={setDisableTarget}
            onResync={setResyncTarget}
            onClone={setCloneZone}
            onConvert={setConvertTarget}
            onExport={(zone) => exportOne.mutate(zone.name)}
            onOptions={goOptions}
            onPermissions={goPermissions}
            onDelete={setDeleteTarget}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, locale, can.canModify, can.canDelete, busyName, goRecords, goOptions, goPermissions],
  )

  const rows = zones.data?.zones ?? []
  const canBulk = can.canModify || can.canDelete

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void zones.refetch()} loading={zones.isFetching}>
              {!zones.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {tc('actions.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportAllOpen(true)} disabled={!can.canView}>
              <Download className="size-3.5" aria-hidden />
              {t('export.downloadAll')}
            </Button>
            {can.canModify && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-3.5" aria-hidden />
                {tc('actions.import')}
              </Button>
            )}
            {can.canModify && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <FolderPlus className="size-3.5" aria-hidden />
                {t('create.submit')}
              </Button>
            )}
          </>
        }
      />

      <DataTable<ZoneSummary>
        label={t('title')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.name}
        loading={zones.isPending}
        error={zones.error}
        onRetry={() => void zones.refetch()}
        enableRowSelection={canBulk}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        filterActive={Boolean(filterName.trim()) || Boolean(filterType)}
        empty={{
          title: t('list.empty'),
          body: t('list.emptyHint'),
          icon: FolderTree,
          action: can.canModify ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="size-3.5" aria-hidden />
              {t('create.submit')}
            </Button>
          ) : undefined,
        }}
        toolbar={
          <>
            <DebouncedSearch
              onSearch={(value) => {
                setFilterName(value)
                setPage(1)
              }}
              placeholder={t('list.searchPlaceholder')}
            />
            <Select
              value={filterType || ALL_TYPES}
              onValueChange={(value) => {
                setFilterType(value === ALL_TYPES ? '' : (value as ZoneType))
                setPage(1)
              }}
            >
              <SelectTrigger size="sm" className="w-44" aria-label={t('list.filterType')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>{t('list.filterType')}</SelectItem>
                {ZONE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`types.${type}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        selectionActions={
          canBulk
            ? (selectedIds) => (
                <>
                  {can.canModify && (
                    <Button size="xs" variant="outline" onClick={() => bulkEnable.mutate(selectedIds)} loading={bulkEnable.isPending}>
                      {!bulkEnable.isPending && <CircleCheck className="size-3.5" aria-hidden />}
                      {t('list.bulkEnable')}
                    </Button>
                  )}
                  {can.canModify && (
                    <Button size="xs" variant="outline" onClick={() => bulkDisable.mutate(selectedIds)} loading={bulkDisable.isPending}>
                      {!bulkDisable.isPending && <CircleStop className="size-3.5" aria-hidden />}
                      {t('list.bulkDisable')}
                    </Button>
                  )}
                  {can.canDelete && (
                    <Button size="xs" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                      <Trash className="size-3.5" aria-hidden />
                      {t('list.bulkDelete')}
                    </Button>
                  )}
                </>
              )
            : undefined
        }
        server={{
          page: zones.data?.pageNumber ?? page,
          pageSize,
          total: zones.data?.totalZones ?? 0,
          totalPages: zones.data?.totalPages ?? 1,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size)
            setPage(1)
          },
        }}
        footerNote={
          selectedNames.length > 0
            ? t('list.selected', { count: selectedNames.length })
            : t('list.totalZones', { count: zones.data?.totalZones ?? 0 })
        }
      />

      <CreateZoneDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportZoneDialog open={importOpen} onOpenChange={setImportOpen} />
      <CloneZoneDialog zone={cloneZone} onOpenChange={(open) => !open && setCloneZone(null)} />
      <ConvertZoneDialog zone={convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)} />

      {/* Resync is not destructive, but it kicks off a full zone transfer from
          the primaries — hence the same "explain, then confirm" treatment. */}
      <ConfirmDialog
        open={Boolean(resyncTarget)}
        onOpenChange={(open) => !open && setResyncTarget(null)}
        title={t('actions.resync')}
        description={t('actions.resyncHint')}
        confirmLabel={resync.isPending ? t('actions.resyncing') : t('actions.resync')}
        tone="default"
        onConfirm={async () => {
          if (resyncTarget) await resync.mutateAsync(resyncTarget.name)
        }}
        pending={resync.isPending}
        error={resync.error ?? undefined}
      />

      {/* "Export all" pages through the entire inventory and fires one download
          per zone, so the operator gets a heads-up before the browser starts
          popping files. */}
      <ConfirmDialog
        open={exportAllOpen}
        onOpenChange={setExportAllOpen}
        title={t('export.title')}
        description={t('export.downloadAllHint')}
        confirmLabel={exportAll.isPending ? t('export.exporting') : t('export.downloadAll')}
        tone="default"
        onConfirm={async () => {
          await exportAll.mutateAsync()
        }}
        pending={exportAll.isPending}
        error={exportAll.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        title={t('actions.disable')}
        description={disableTarget ? t('actions.disableConfirm') : undefined}
        confirmLabel={t('actions.disable')}
        onConfirm={async () => {
          if (disableTarget) await disable.mutateAsync(disableTarget.name)
        }}
        pending={disable.isPending}
        error={disable.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('actions.deleteTitle')}
        description={deleteTarget ? t('actions.deleteConfirm', { zone: deleteTarget.name }) : undefined}
        confirmLabel={t('actions.delete')}
        requireText={deleteTarget?.name}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.name)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={t('actions.deleteTitle')}
        description={t('actions.deleteBulkConfirm', { count: selectedNames.length })}
        confirmLabel={t('list.bulkDelete')}
        requireText={String(selectedNames.length)}
        onConfirm={async () => {
          await bulkRemove.mutateAsync(selectedNames)
        }}
        pending={bulkRemove.isPending}
        error={bulkRemove.error ?? undefined}
      />
    </PageShell>
  )
}

/** Badge tone per zone type — stable colour language across the module. */
function typeVariant(type: ZoneType): 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'muted' {
  switch (type) {
    case 'Primary':
      return 'default'
    case 'Secondary':
      return 'info'
    case 'Stub':
      return 'secondary'
    case 'Forwarder':
    case 'SecondaryForwarder':
      return 'warning'
    case 'Catalog':
    case 'SecondaryCatalog':
      return 'success'
    default:
      return 'muted'
  }
}

function dnssecVariant(status: string): 'success' | 'warning' | 'muted' {
  if (status === 'Signed') return 'success'
  if (status === 'PendingSigning') return 'warning'
  return 'muted'
}

/**
 * Collapse the handful of boolean health flags `zones/list` returns into one
 * status. Precedence matters: a disabled zone is "disabled" regardless of a
 * stale notify, and expiry/sync outrank a soft validation warning.
 */
function zoneStatus(
  zone: ZoneSummary,
  t: (key: string) => string,
): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (zone.disabled) return { label: t('list.statusDisabled'), tone: 'neutral' }
  if (zone.isExpired) return { label: t('list.statusExpired'), tone: 'danger' }
  if (zone.syncFailed) return { label: t('list.statusSyncFailed'), tone: 'danger' }
  if (zone.validationFailed) return { label: t('list.statusValidationFailed'), tone: 'warning' }
  if (zone.notifyFailed) return { label: t('list.statusNotifyFailed'), tone: 'warning' }
  return { label: t('list.statusActive'), tone: 'success' }
}
