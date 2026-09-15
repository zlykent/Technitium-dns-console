'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { EllipsisVertical, Lock, LockOpen, Network } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { CopyButton } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { SearchInput } from '@/components/app/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/api/client'
import { convertLeaseToDynamic, convertLeaseToReserved, listLeases, removeLease } from '@/lib/api/domains/dhcp'
import { LEASE_TYPES } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import type { Lease, ScopeSummary } from '@/lib/api/types/dhcp'
import { useCan } from '@/lib/auth/session'
import { formatRelative } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * DHCP leases table with client-side scope/type filtering and row actions.
 *
 * `dhcp/leases/list` returns every lease across all scopes (the endpoint has no
 * `scopeName` parameter — only `node`), so filtering and grouping happen here.
 * The query key uses `'*'` as the scope discriminator to avoid cache collisions
 * when the operator switches the scope filter; invalidation goes through
 * `domain(target, 'dhcp')` which matches all dhcp sub-keys.
 *
 * Row actions (`removeLease`, `convertLeaseToReserved`, `convertLeaseToDynamic`)
 * all address a lease by `name` (scope) + `clientIdentifier`. When the server
 * did not receive an explicit client-identifier option it falls back to the
 * hardware address — the Lease type models this as `clientIdentifier: string | null`,
 * so we pass `hardwareAddress` as the fallback.
 */

const ALL_SCOPES = '__all__'
const ALL_TYPES = '__all__'

export interface LeasesPanelProps {
  scopes: ScopeSummary[]
}

export function LeasesPanel({ scopes }: LeasesPanelProps) {
  const t = useTranslations('dhcp')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('DhcpServer')

  const [filterScope, setFilterScope] = React.useState(ALL_SCOPES)
  const [filterType, setFilterType] = React.useState(ALL_TYPES)
  const [search, setSearch] = React.useState('')
  const [removeTarget, setRemoveTarget] = React.useState<Lease | null>(null)

  const leases = useQuery({
    queryKey: queryKeys.dhcpLeases(target, '*'),
    queryFn: () => listLeases(),
    enabled: can.canView,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'dhcp') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const remove = useMutation({
    mutationFn: (lease: Lease) =>
      removeLease({ name: lease.scope, clientIdentifier: lease.clientIdentifier ?? lease.hardwareAddress }),
    onSuccess: () => {
      toast.success(t('leases.removeSuccess'))
      invalidate()
      setRemoveTarget(null)
    },
    onError,
  })

  const toReserved = useMutation({
    mutationFn: (lease: Lease) =>
      convertLeaseToReserved({ name: lease.scope, clientIdentifier: lease.clientIdentifier ?? lease.hardwareAddress }),
    onSuccess: () => {
      toast.success(t('leases.convertToReservedSuccess'))
      invalidate()
    },
    onError,
  })

  const toDynamic = useMutation({
    mutationFn: (lease: Lease) =>
      convertLeaseToDynamic({ name: lease.scope, clientIdentifier: lease.clientIdentifier ?? lease.hardwareAddress }),
    onSuccess: () => {
      toast.success(t('leases.convertToDynamicSuccess'))
      invalidate()
    },
    onError,
  })

  const filtered = React.useMemo(() => {
    let rows = leases.data?.leases ?? []
    if (filterScope !== ALL_SCOPES) rows = rows.filter((l) => l.scope === filterScope)
    if (filterType !== ALL_TYPES) rows = rows.filter((l) => l.type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (l) =>
          l.address.toLowerCase().includes(q) ||
          l.hostName.toLowerCase().includes(q) ||
          l.hardwareAddress.toLowerCase().includes(q),
      )
    }
    return rows
  }, [leases.data, filterScope, filterType, search])

  const columns = React.useMemo(
    () => [
      textColumn<Lease>({
        id: 'clientIdentifier',
        accessorKey: 'clientIdentifier',
        header: t('leases.columns.clientIdentifier'),
        cell: (value, row) => (
          <span className="font-data text-xs">{String(value ?? row.hardwareAddress)}</span>
        ),
      }),
      textColumn<Lease>({
        id: 'hostName',
        accessorKey: 'hostName',
        header: t('leases.columns.hostName'),
        cell: (value) => <span className="text-sm">{String(value) || '—'}</span>,
      }),
      textColumn<Lease>({
        id: 'address',
        accessorKey: 'address',
        header: t('leases.columns.address'),
        cell: (value) => (
          <span className="inline-flex items-center gap-1">
            <span className="font-data text-sm">{String(value)}</span>
            <CopyButton value={String(value)} size="icon-xs" />
          </span>
        ),
      }),
      textColumn<Lease>({
        id: 'hardwareAddress',
        accessorKey: 'hardwareAddress',
        header: t('leases.columns.hardwareAddress'),
        cell: (value) => <span className="font-data text-xs">{String(value)}</span>,
      }),
      textColumn<Lease>({
        id: 'leaseExpires',
        accessorKey: 'leaseExpires',
        header: t('leases.columns.leaseExpires'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground">{formatRelative(value as string, locale)}</span>
        ),
      }),
      textColumn<Lease>({
        id: 'type',
        accessorKey: 'type',
        header: t('leases.columns.type'),
        cell: (value) => (
          <Badge variant={value === 'Reserved' ? 'info' : 'secondary'}>
            {t(`leases.types.${value as string}`)}
          </Badge>
        ),
      }),
      textColumn<Lease>({
        id: 'scope',
        accessorKey: 'scope',
        header: t('leases.columns.scope'),
        cell: (value) => <span className="text-xs text-muted-foreground">{String(value)}</span>,
      }),
      ...(can.canModify
        ? [
            textColumn<Lease>({
              id: 'actions',
              header: t('leases.columns.actions'),
              align: 'right' as const,
              hug: true,
              enableSorting: false,
              cell: (_value: unknown, row: Lease) => (
                <LeaseRowActions
                  lease={row}
                  canModify={can.canModify}
                  canDelete={can.canDelete}
                  onRemove={setRemoveTarget}
                  onToReserved={(l) => toReserved.mutate(l)}
                  onToDynamic={(l) => toDynamic.mutate(l)}
                />
              ),
            }),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, can.canModify, can.canDelete],
  )

  return (
    <>
      <DataTable<Lease>
        label={t('leases.title')}
        columns={columns}
        data={filtered}
        getRowId={(row) => `${row.scope}-${row.clientIdentifier ?? row.hardwareAddress}-${row.address}`}
        loading={leases.isPending}
        error={leases.error}
        onRetry={() => void leases.refetch()}
        clientPagination={{ pageSize: 25 }}
        // Scope, type and search all run in the `filtered` memo, not here.
        filterActive={filterScope !== ALL_SCOPES || filterType !== ALL_TYPES || Boolean(search.trim())}
        empty={{
          title: t('leases.empty'),
          body: t('leases.emptyHint'),
          icon: Network,
        }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('leases.searchPlaceholder')} />
            <Select value={filterScope} onValueChange={setFilterScope}>
              <SelectTrigger size="sm" className="w-40" aria-label={t('leases.filterScope')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SCOPES}>{t('leases.filterScope')}</SelectItem>
                {scopes.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger size="sm" className="w-36" aria-label={t('leases.filterType')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>{t('leases.filterType')}</SelectItem>
                {LEASE_TYPES.map((lt) => (
                  <SelectItem key={lt} value={lt}>
                    {t(`leases.types.${lt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        footerNote={t('leases.totalLeases', { count: filtered.length })}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t('leases.remove')}
        description={removeTarget ? t('leases.removeConfirm', { address: removeTarget.address }) : undefined}
        confirmLabel={t('leases.remove')}
        onConfirm={async () => {
          if (removeTarget) await remove.mutateAsync(removeTarget)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */

interface LeaseRowActionsProps {
  lease: Lease
  canModify: boolean
  canDelete: boolean
  onRemove: (lease: Lease) => void
  onToReserved: (lease: Lease) => void
  onToDynamic: (lease: Lease) => void
}

function LeaseRowActions({ lease, canModify, canDelete, onRemove, onToReserved, onToDynamic }: LeaseRowActionsProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {canModify && lease.type === 'Dynamic' && (
          <DropdownMenuItem onSelect={() => onToReserved(lease)}>
            <Lock aria-hidden />
            {t('leases.convertToReserved')}
          </DropdownMenuItem>
        )}
        {canModify && lease.type === 'Reserved' && (
          <DropdownMenuItem onSelect={() => onToDynamic(lease)}>
            <LockOpen aria-hidden />
            {t('leases.convertToDynamic')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onRemove(lease)}>
              {t('leases.remove')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
