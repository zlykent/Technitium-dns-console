'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CircleCheck, CircleStop, EllipsisVertical, Network, Pencil, Trash } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/api/client'
import { deleteScope, disableScope, enableScope } from '@/lib/api/domains/dhcp'
import { queryKeys } from '@/lib/api/query-keys'
import type { ScopeSummary } from '@/lib/api/types/dhcp'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * DHCP scope list table.
 *
 * Displays every scope returned by `dhcp/scopes/list` with an inline enable /
 * disable Switch (immediate mutation, no confirm needed for enable — disable
 * gets a ConfirmDialog because it stops address assignment). Row actions offer
 * edit (opens the scope form dialog) and delete (ConfirmDialog + requireText).
 *
 * The "enabled" column uses a `Switch` instead of a `Badge` so operators can
 * toggle a scope without entering the full edit form — matching the stock
 * Technitium console's behaviour. The switch is disabled while the mutation is
 * in flight to prevent double-fires against the single-threaded admin API.
 */

export interface ScopeListProps {
  scopes: ScopeSummary[]
  loading: boolean
  error: unknown
  onRetry: () => void
  onEdit: (scope: ScopeSummary) => void
}

export function ScopeList({ scopes, loading, error, onRetry, onEdit }: ScopeListProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('DhcpServer')

  const [deleteTarget, setDeleteTarget] = React.useState<ScopeSummary | null>(null)
  const [disableTarget, setDisableTarget] = React.useState<ScopeSummary | null>(null)

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'dhcp') })
  }, [queryClient, target])

  const onError = React.useCallback((err: unknown) => toast.error(describeError(err).message), [])

  const enable = useMutation({
    mutationFn: (name: string) => enableScope(name),
    onSuccess: (_r, name) => {
      toast.success(t('scopes.enableSuccess', { name }))
      invalidate()
    },
    onError,
  })

  const disable = useMutation({
    mutationFn: (name: string) => disableScope(name),
    onSuccess: (_r, name) => {
      toast.success(t('scopes.disableSuccess', { name }))
      invalidate()
      setDisableTarget(null)
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: (name: string) => deleteScope(name),
    onSuccess: () => {
      toast.success(t('scopes.deleteSuccess'))
      invalidate()
      setDeleteTarget(null)
    },
    onError,
  })

  const busyName =
    (enable.isPending && (enable.variables as string)) ||
    (disable.isPending && (disable.variables as string)) ||
    null

  const columns = React.useMemo(
    () => [
      textColumn<ScopeSummary>({
        id: 'name',
        accessorKey: 'name',
        header: t('scopes.columns.name'),
        flex: true,
        cell: (value) => <span className="text-sm font-medium">{String(value)}</span>,
      }),
      textColumn<ScopeSummary>({
        id: 'enabled',
        accessorKey: 'enabled',
        header: t('scopes.columns.enabled'),
        enableSorting: false,
        cell: (_value, row) =>
          can.canModify ? (
            <Switch
              checked={row.enabled}
              disabled={busyName === row.name}
              onCheckedChange={(checked) => {
                if (checked) enable.mutate(row.name)
                else setDisableTarget(row)
              }}
              aria-label={row.enabled ? t('scopes.disable') : t('scopes.enable')}
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs">
              {row.enabled ? (
                <CircleCheck className="size-3.5 text-success" aria-hidden />
              ) : (
                <CircleStop className="size-3.5 text-muted-foreground" aria-hidden />
              )}
              {row.enabled ? tc('fields.enabled') : tc('fields.disabled')}
            </span>
          ),
      }),
      textColumn<ScopeSummary>({
        id: 'range',
        header: t('scopes.columns.range'),
        cell: (_value, row) => (
          <span className="font-data text-xs">
            {row.startingAddress} – {row.endingAddress}
          </span>
        ),
      }),
      textColumn<ScopeSummary>({
        id: 'subnetMask',
        accessorKey: 'subnetMask',
        header: t('scopes.columns.subnetMask'),
        cell: (value) => <span className="font-data text-xs">{String(value)}</span>,
      }),
      textColumn<ScopeSummary>({
        id: 'networkAddress',
        accessorKey: 'networkAddress',
        header: t('scopes.columns.network'),
        cell: (value) => <span className="font-data text-xs">{String(value)}</span>,
      }),
      textColumn<ScopeSummary>({
        id: 'actions',
        header: t('scopes.columns.actions'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value, row) => (
          <ScopeRowActions
            scope={row}
            canModify={can.canModify}
            canDelete={can.canDelete}
            onEdit={onEdit}
            onDisable={setDisableTarget}
            onEnable={(s) => enable.mutate(s.name)}
            onDelete={setDeleteTarget}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, can.canModify, can.canDelete, busyName, onEdit],
  )

  return (
    // Flex column so the scrollable table fills the tab's leftover height.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DataTable<ScopeSummary>
        label={t('scopes.title')}
        columns={columns}
        data={scopes}
        scrollable
        getRowId={(row) => row.name}
        loading={loading}
        error={error}
        onRetry={onRetry}
        clientPagination={{ pageSize: 25 }}
        empty={{
          title: t('scopes.empty'),
          body: t('scopes.emptyHint'),
          icon: Network,
        }}
        footerNote={t('scopes.totalScopes', { count: scopes.length })}
      />

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        title={t('scopes.disable')}
        description={t('scopes.disableConfirm')}
        confirmLabel={t('scopes.disable')}
        onConfirm={async () => {
          if (disableTarget) await disable.mutateAsync(disableTarget.name)
        }}
        pending={disable.isPending}
        error={disable.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('scopes.delete')}
        description={deleteTarget ? t('scopes.deleteConfirm', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('scopes.delete')}
        requireText={deleteTarget?.name}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.name)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface ScopeRowActionsProps {
  scope: ScopeSummary
  canModify: boolean
  canDelete: boolean
  onEdit: (scope: ScopeSummary) => void
  onEnable: (scope: ScopeSummary) => void
  onDisable: (scope: ScopeSummary) => void
  onDelete: (scope: ScopeSummary) => void
}

function ScopeRowActions({ scope, canModify, canDelete, onEdit, onEnable, onDisable, onDelete }: ScopeRowActionsProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')

  if (!canModify && !canDelete) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {canModify && (
          <DropdownMenuItem onSelect={() => onEdit(scope)}>
            <Pencil aria-hidden />
            {tc('actions.edit')}
          </DropdownMenuItem>
        )}
        {canModify && (
          <>
            {scope.enabled ? (
              <DropdownMenuItem onSelect={() => onDisable(scope)}>
                <CircleStop aria-hidden />
                {t('scopes.disable')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onEnable(scope)}>
                <CircleCheck aria-hidden />
                {t('scopes.enable')}
              </DropdownMenuItem>
            )}
          </>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(scope)}>
              <Trash aria-hidden />
              {t('scopes.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
