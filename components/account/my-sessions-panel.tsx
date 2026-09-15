'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { MonitorSmartphone, Trash } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Section } from '@/components/app/page-shell'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { describeError } from '@/lib/api/client'
import { deleteSession, getProfile } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import type { SessionEntry } from '@/lib/api/types/common'
import { formatDateTime, formatRelative, maskSecret } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * My sessions tab: every live sign-in and API token for *this* account.
 *
 * Same data source as the tokens tab — `user/profile/get`'s `sessions` array —
 * but unfiltered, so an operator sees the whole picture (browser logins *and*
 * tokens) in one place and can revoke a suspicious device. There is no
 * per-user session endpoint; `admin/sessions/list` is server-wide and needs the
 * Administration permission, which a self-service page must not assume.
 *
 * The current session is protected two ways: its revoke button is disabled (with
 * a tooltip explaining why) and the bulk "revoke others" walk skips it. Revoking
 * your own session mid-request signs you out and every later call in the same
 * batch fails with an auth error that looks like a server fault.
 *
 * Bulk revoke is **serial**, not `Promise.all`: Technitium's admin API is
 * single-threaded, so parallel deletes queue behind one another and time out.
 * Walking the list one `await` at a time is slower but reliable — the same
 * choice the admin sessions panel makes.
 */

export function MySessionsPanel() {
  const t = useTranslations('account')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [revokeTarget, setRevokeTarget] = React.useState<SessionEntry | null>(null)
  const [revokeOthersOpen, setRevokeOthersOpen] = React.useState(false)

  const profile = useQuery({
    queryKey: queryKeys.profile(target),
    queryFn: () => getProfile(),
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const revoke = useMutation({
    mutationFn: (partialToken: string) => deleteSession(partialToken),
    onSuccess: () => {
      toast.success(t('sessions.revoked'))
      invalidate()
      setRevokeTarget(null)
    },
    onError,
  })

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const rows = (profile.data?.sessions ?? []).filter((entry) => !entry.isCurrentSession)
      for (const row of rows) await deleteSession(row.partialToken)
      return rows.length
    },
    onSuccess: () => {
      toast.success(t('sessions.revoked'))
      invalidate()
      setRevokeOthersOpen(false)
    },
    onError,
  })

  const sessions = React.useMemo(() => profile.data?.sessions ?? [], [profile.data])
  const othersCount = React.useMemo(() => sessions.filter((entry) => !entry.isCurrentSession).length, [sessions])

  const columns = React.useMemo(
    () => [
      textColumn<SessionEntry>({
        id: 'current',
        accessorKey: 'isCurrentSession',
        header: t('sessions.current'),
        cell: (value) =>
          value ? (
            <Badge variant="success">
              <StatusDot tone="success" pulse />
              {t('sessions.current')}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      textColumn<SessionEntry>({
        id: 'token',
        accessorKey: 'partialToken',
        header: t('sessions.token'),
        cell: (value) => (
          <span className="font-data text-xs" title={String(value)}>
            {maskSecret(String(value), 4)}
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'type',
        accessorKey: 'type',
        header: t('sessions.type'),
        cell: (value) => (
          <Badge variant={value === 'ApiToken' ? 'info' : 'secondary'}>
            {value === 'ApiToken' ? t('sessions.typeApi') : t('sessions.typeSession')}
          </Badge>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'typeName',
        accessorKey: 'tokenName',
        header: t('sessions.typeName'),
        cell: (value) => <span className="font-data text-xs">{String(value ?? '') || '—'}</span>,
      }),
      textColumn<SessionEntry>({
        id: 'lastSeen',
        accessorKey: 'lastSeen',
        header: t('sessions.lastSeen'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground" title={formatDateTime(value as string, locale)}>
            {formatRelative(value as string, locale)}
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'address',
        accessorKey: 'lastSeenRemoteAddress',
        header: t('sessions.address'),
        cell: (value) => <span className="font-data text-xs">{String(value) || '—'}</span>,
      }),
      textColumn<SessionEntry>({
        id: 'userAgent',
        accessorKey: 'lastSeenUserAgent',
        header: t('sessions.userAgent'),
        cell: (value) => {
          const ua = String(value ?? '')
          if (!ua) return <span className="text-muted-foreground">—</span>
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block max-w-56 truncate text-xs text-muted-foreground">{ua}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm break-words">{ua}</TooltipContent>
            </Tooltip>
          )
        },
      }),
      textColumn<SessionEntry>({
        id: 'actions',
        header: t('sessions.revoke'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value: unknown, row: SessionEntry) => <SessionRowActions row={row} onRevoke={setRevokeTarget} />,
      }),
    ],
    [t, locale],
  )

  return (
    <>
      <Section
        title={t('sessions.title')}
        description={t('sessions.subtitle')}
        contentClassName="p-3"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setRevokeOthersOpen(true)}
            disabled={othersCount === 0}
          >
            <Trash className="size-3.5" aria-hidden />
            {t('sessions.revokeOthers')}
          </Button>
        }
      >
        <DataTable<SessionEntry>
          label={t('sessions.title')}
          columns={columns}
          data={sessions}
          getRowId={(row) => row.partialToken}
          loading={profile.isPending}
          error={profile.error}
          onRetry={() => void profile.refetch()}
          enableSorting={false}
          clientPagination={false}
          empty={{ title: t('sessions.empty'), icon: MonitorSmartphone }}
        />
      </Section>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('sessions.revoke')}
        description={t('sessions.revokeConfirm')}
        confirmLabel={t('sessions.revoke')}
        onConfirm={async () => {
          if (revokeTarget) await revoke.mutateAsync(revokeTarget.partialToken)
        }}
        pending={revoke.isPending}
        error={revoke.error ?? undefined}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title={t('sessions.revokeOthers')}
        description={t('sessions.revokeOthersConfirm')}
        confirmLabel={t('sessions.revokeOthers')}
        onConfirm={async () => {
          await revokeOthers.mutateAsync()
        }}
        pending={revokeOthers.isPending}
        error={revokeOthers.error ?? undefined}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */

function SessionRowActions({ row, onRevoke }: { row: SessionEntry; onRevoke: (row: SessionEntry) => void }) {
  const t = useTranslations('account')

  // The current session cannot be revoked from here — doing so signs the
  // operator out mid-request. The button is disabled and wrapped in a tooltip
  // (on a focusable span, since a disabled button fires no pointer events).
  if (row.isCurrentSession) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button variant="ghost" size="icon-xs" disabled aria-label={t('sessions.revoke')}>
              <Trash className="size-3.5" aria-hidden />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('sessions.current')}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-destructive hover:text-destructive"
      aria-label={t('sessions.revoke')}
      onClick={() => onRevoke(row)}
    >
      <Trash className="size-3.5" aria-hidden />
    </Button>
  )
}
