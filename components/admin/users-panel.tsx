'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { EllipsisVertical, KeyRound, Pencil, RefreshCw, ShieldOff, Trash, UserPlus, Users } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { SearchInput } from '@/components/app/search-input'
import { ErrorState, LoadingState } from '@/components/app/states'
import { CreateTokenDialog } from '@/components/admin/sessions-panel'
import { UserDialog } from '@/components/admin/user-dialog'
import { Badge, StatusDot } from '@/components/ui/badge'
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
import { deleteAnySession, deleteUser, getUser, listUsers, setUser } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { SessionEntry } from '@/lib/api/types/common'
import type { UserSummary } from '@/lib/api/types/admin'
import { useCan, useSession } from '@/lib/auth/session'
import { formatDateTime, formatRelative, isNeverTimestamp, maskSecret } from '@/lib/format'
import type { Locale } from '@/lib/i18n/config'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Users tab: the account inventory plus a detail pane for the selected user.
 *
 * `admin/users/list` returns a *summary* — no `sessionTimeoutSeconds`, no
 * `memberOfGroups`, no sessions. Selecting a row therefore fires
 * `admin/users/get` under `queryKeys.user(target, name)`; that is a second
 * round trip on every selection, but pre-fetching details for all accounts
 * would be N calls on a server that may hold hundreds of them.
 *
 * Three safety rules that upstream does *not* enforce for us:
 *
 *  - **You cannot delete yourself.** `admin/users/delete?user=<me>` succeeds and
 *    immediately invalidates the session cookie, dropping the operator into the
 *    login screen with no explanation. The menu item is hidden for the current
 *    account and `users.form.cannotDeleteSelf` is the message if it ever leaks.
 *  - **Revoking "all sessions" keeps the current one.** There is no
 *    `admin/sessions/deleteAll` endpoint (`lib/api/registry.ts:86-88`), so the
 *    bulk action loops `deleteAnySession` — and must skip `isCurrentSession`,
 *    otherwise the loop's own first request signs you out and the rest fail.
 *  - **Resetting TOTP is just `setUser({ totpEnabled: false })`.** Technitium
 *    stores the secret alongside the flag; clearing the flag is what forces
 *    re-enrolment at the next sign-in (`users.form.totpHelp` says exactly this).
 */

const ALL_FILTER = '__all__'
type UserFilter = typeof ALL_FILTER | 'enabled' | 'disabled' | 'sso'

export function UsersPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Administration')
  const { session } = useSession()
  const me = session?.username ?? null

  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<UserFilter>(ALL_FILTER)
  const [selected, setSelected] = React.useState<string | null>(null)

  const [dialogUser, setDialogUser] = React.useState<UserSummary | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogNonce, setDialogNonce] = React.useState(0)

  const [deleteTarget, setDeleteTarget] = React.useState<UserSummary | null>(null)
  const [totpTarget, setTotpTarget] = React.useState<UserSummary | null>(null)
  const [tokenTarget, setTokenTarget] = React.useState<UserSummary | null>(null)
  const [revokeTarget, setRevokeTarget] = React.useState<SessionEntry | null>(null)
  const [revokeAllTarget, setRevokeAllTarget] = React.useState<string | null>(null)

  const users = useQuery({
    queryKey: queryKeys.users(target),
    queryFn: () => listUsers(),
    enabled: can.canView,
  })

  const detail = useQuery({
    queryKey: queryKeys.user(target, selected ?? '__none__'),
    queryFn: () => getUser(selected!),
    enabled: can.canView && selected !== null,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const remove = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => {
      toast.success(t('users.delete.success'))
      invalidate()
      setDeleteTarget(null)
      setSelected(null)
    },
    onError,
  })

  const resetTotp = useMutation({
    mutationFn: (username: string) => setUser({ user: username, totpEnabled: false }),
    onSuccess: () => {
      toast.success(t('users.form.resetTotpSuccess'))
      invalidate()
      setTotpTarget(null)
    },
    onError,
  })

  const revoke = useMutation({
    mutationFn: (partialToken: string) => deleteAnySession(partialToken),
    onSuccess: () => {
      toast.success(t('users.sessions.revokeSuccess'))
      invalidate()
      setRevokeTarget(null)
    },
    onError,
  })

  /** No bulk endpoint exists; walk the list and stop if any call fails. */
  const revokeAll = useMutation({
    mutationFn: async (username: string) => {
      const rows = (detail.data?.sessions ?? []).filter((row) => row.username === username && !row.isCurrentSession)
      for (const row of rows) await deleteAnySession(row.partialToken)
      return rows.length
    },
    onSuccess: () => {
      toast.success(t('users.sessions.revokeSuccess'))
      invalidate()
      setRevokeAllTarget(null)
    },
    onError,
  })

  const filtered = React.useMemo(() => {
    let rows = users.data?.users ?? []
    if (filter === 'enabled') rows = rows.filter((row) => !row.disabled)
    if (filter === 'disabled') rows = rows.filter((row) => row.disabled)
    if (filter === 'sso') rows = rows.filter((row) => row.isSsoUser)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (row) => row.username.toLowerCase().includes(q) || row.displayName.toLowerCase().includes(q),
      )
    }
    return rows
  }, [users.data, filter, search])

  function openCreate() {
    setDialogUser(null)
    setDialogNonce((n) => n + 1)
    setDialogOpen(true)
  }

  function openEdit(row: UserSummary) {
    setDialogUser(row)
    setDialogNonce((n) => n + 1)
    setDialogOpen(true)
  }

  const columns = React.useMemo(
    () => [
      textColumn<UserSummary>({
        id: 'displayName',
        accessorKey: 'displayName',
        header: t('users.columns.displayName'),
        flex: true,
        cell: (value) => <span className="text-sm">{String(value) || '—'}</span>,
      }),
      textColumn<UserSummary>({
        id: 'username',
        accessorKey: 'username',
        header: t('users.columns.username'),
        cell: (value) => <span className="font-data text-sm">{String(value)}</span>,
      }),
      textColumn<UserSummary>({
        id: 'isSsoUser',
        accessorKey: 'isSsoUser',
        header: t('users.columns.isSsoUser'),
        cell: (value) => (
          <Badge variant={value === true ? 'info' : 'secondary'}>
            {value === true ? t('users.source.sso') : t('users.source.local')}
          </Badge>
        ),
      }),
      textColumn<UserSummary>({
        id: 'totpEnabled',
        accessorKey: 'totpEnabled',
        header: t('users.columns.totpEnabled'),
        cell: (value) =>
          value === true ? (
            <Badge variant="success">{tc('fields.yes')}</Badge>
          ) : (
            <Badge variant="muted">{tc('fields.no')}</Badge>
          ),
      }),
      textColumn<UserSummary>({
        id: 'disabled',
        accessorKey: 'disabled',
        header: t('users.columns.disabled'),
        cell: (value) => (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <StatusDot tone={value === true ? 'danger' : 'success'} />
            {value === true ? tc('fields.disabled') : tc('fields.enabled')}
          </span>
        ),
      }),
      textColumn<UserSummary>({
        id: 'recentSession',
        accessorKey: 'recentSessionLoggedOn',
        header: t('users.columns.recentSession'),
        cell: (value, row) => {
          const at = value as string | null
          // Upstream reports an account that has never signed in with .NET's
          // `DateTime.MinValue`, which parses as a legitimate year-1 date, so it
          // has to be caught before `formatRelative` renders "2027 years ago".
          // The address goes with it: the same sentinel row carries `0.0.0.0`,
          // and "never (0.0.0.0)" reads like a fact about a real sign-in.
          if (isNeverTimestamp(at)) {
            return <span className="text-xs text-muted-foreground">{tc('time.never')}</span>
          }
          return (
            <span className="text-xs text-muted-foreground" title={formatDateTime(at, locale)}>
              {formatRelative(at, locale)}
              {row.recentSessionRemoteAddress ? (
                <span className="font-data ml-1">({row.recentSessionRemoteAddress})</span>
              ) : null}
            </span>
          )
        },
      }),
      textColumn<UserSummary>({
        id: 'actions',
        header: t('users.columns.actions'),
        align: 'right' as const,
        hug: true,
        enableSorting: false,
        cell: (_value: unknown, row: UserSummary) => (
          <UserRowActions
            row={row}
            isSelf={row.username === me}
            canModify={can.canModify}
            canDelete={can.canDelete}
            onEdit={openEdit}
            onDetails={setSelected}
            onToken={setTokenTarget}
            onResetTotp={setTotpTarget}
            onDelete={setDeleteTarget}
          />
        ),
      }),
    ],
    [t, tc, locale, can.canModify, can.canDelete, me],
  )

  const detailSessions = React.useMemo(
    () => (detail.data?.sessions ?? []).filter((row) => row.username === selected),
    [detail.data, selected],
  )

  return (
    // Flex column so the scrollable table fills the tab's leftover height;
    // the detail pane keeps its natural size underneath.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <DataTable<UserSummary>
        label={t('users.title')}
        columns={columns}
        data={filtered}
        scrollable
        getRowId={(row) => row.username}
        loading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        clientPagination={{ pageSize: 25 }}
        // The `filtered` memo above owns both the status filter and the search,
        // so an empty table here means "no match", not "no users".
        filterActive={filter !== ALL_FILTER || Boolean(search.trim())}
        onRowClick={(row) => setSelected(row.username === selected ? null : row.username)}
        empty={{ title: tc('table.empty'), body: tc('table.emptyHint'), icon: Users }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('users.searchPlaceholder')} />
            <Select value={filter} onValueChange={(value) => setFilter(value as UserFilter)}>
              <SelectTrigger size="sm" className="w-44" aria-label={tc('actions.filter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER}>{t('users.filterAll')}</SelectItem>
                <SelectItem value="enabled">{t('users.filterEnabled')}</SelectItem>
                <SelectItem value="disabled">{t('users.filterDisabled')}</SelectItem>
                <SelectItem value="sso">{t('users.filterSso')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void users.refetch()} loading={users.isFetching}>
                {!users.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
                {tc('actions.refresh')}
              </Button>
              {can.canModify && (
                <Button size="sm" onClick={openCreate}>
                  <UserPlus className="size-3.5" aria-hidden />
                  {t('users.add')}
                </Button>
              )}
            </div>
          </>
        }
        footerNote={t('users.totalUsers', { count: filtered.length })}
      />

      {selected && (
        <Section
          className="shrink-0"
          title={t('users.details.title', { name: selected })}
          actions={
            <Button variant="outline" size="xs" onClick={() => setSelected(null)}>
              {tc('actions.close')}
            </Button>
          }
        >
          {detail.isPending ? (
            <LoadingState rows={4} />
          ) : detail.error ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.data ? (
            <div className="flex flex-col gap-6">
              <DefinitionList
                items={[
                  { label: t('users.columns.displayName'), value: detail.data.displayName || '—' },
                  { label: t('users.columns.username'), value: <span className="font-data">{detail.data.username}</span> },
                  {
                    label: t('users.columns.isSsoUser'),
                    value: detail.data.isSsoUser ? t('users.source.sso') : t('users.source.local'),
                  },
                  {
                    label: t('users.columns.totpEnabled'),
                    value: detail.data.totpEnabled ? tc('fields.yes') : tc('fields.no'),
                  },
                  {
                    label: t('users.columns.disabled'),
                    value: detail.data.disabled ? tc('fields.disabled') : tc('fields.enabled'),
                  },
                  {
                    label: t('users.form.sessionTimeoutSeconds'),
                    value: <span className="font-data">{detail.data.sessionTimeoutSeconds}</span>,
                  },
                  {
                    label: t('users.form.ssoManagedGroups'),
                    value: detail.data.ssoManagedGroups ? tc('fields.yes') : tc('fields.no'),
                  },
                  {
                    label: t('users.columns.memberOfGroups'),
                    value:
                      detail.data.memberOfGroups.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {detail.data.memberOfGroups.map((name) => (
                            <Badge key={name} variant="outline" className="font-data">
                              {name}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        tc('fields.none')
                      ),
                  },
                  {
                    label: t('users.columns.recentSession'),
                    // Same sentinel rule as the table column above: the dialog
                    // and the row describe one account, so they must not disagree
                    // about whether it has ever signed in.
                    value: isNeverTimestamp(detail.data.recentSessionLoggedOn)
                      ? tc('time.never')
                      : formatDateTime(detail.data.recentSessionLoggedOn, locale),
                  },
                ]}
              />

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t('users.sessions.title', { name: selected })}</h3>
                  {can.canDelete && detailSessions.length > 0 && (
                    <Button variant="outline" size="xs" onClick={() => setRevokeAllTarget(selected)}>
                      {t('users.sessions.revokeAll')}
                    </Button>
                  )}
                </div>
                <UserSessionList
                  sessions={detailSessions}
                  locale={locale}
                  canDelete={can.canDelete}
                  onRevoke={setRevokeTarget}
                />
              </div>
            </div>
          ) : null}
        </Section>
      )}

      <UserDialog key={dialogNonce} open={dialogOpen} onOpenChange={setDialogOpen} user={dialogUser} />

      <CreateTokenDialog
        open={tokenTarget !== null}
        onOpenChange={(open) => !open && setTokenTarget(null)}
        username={tokenTarget?.username ?? null}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? t('users.delete.title', { name: deleteTarget.username }) : ''}
        description={deleteTarget ? t('users.delete.body', { name: deleteTarget.username }) : undefined}
        confirmLabel={t('users.delete.submit')}
        requireText={deleteTarget?.username}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.username)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(totpTarget)}
        onOpenChange={(open) => !open && setTotpTarget(null)}
        title={t('users.form.resetTotp')}
        description={totpTarget ? t('users.form.resetTotpConfirm', { name: totpTarget.username }) : undefined}
        confirmLabel={t('users.form.resetTotp')}
        tone="default"
        onConfirm={async () => {
          if (totpTarget) await resetTotp.mutateAsync(totpTarget.username)
        }}
        pending={resetTotp.isPending}
        error={resetTotp.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('users.sessions.revoke')}
        description={
          revokeTarget
            ? t('sessions.deleteConfirm', { user: revokeTarget.username })
            : undefined
        }
        confirmLabel={t('users.sessions.revoke')}
        onConfirm={async () => {
          if (revokeTarget) await revoke.mutateAsync(revokeTarget.partialToken)
        }}
        pending={revoke.isPending}
        error={revoke.error ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(revokeAllTarget)}
        onOpenChange={(open) => !open && setRevokeAllTarget(null)}
        title={t('users.sessions.revokeAll')}
        description={revokeAllTarget ? t('users.sessions.revokeAllConfirm', { name: revokeAllTarget }) : undefined}
        confirmLabel={t('users.sessions.revokeAll')}
        onConfirm={async () => {
          if (revokeAllTarget) await revokeAll.mutateAsync(revokeAllTarget)
        }}
        pending={revokeAll.isPending}
        error={revokeAll.error ?? undefined}
      >
        <p className="text-sm text-muted-foreground">{t('sessions.deleteAllPreservesCurrent')}</p>
      </ConfirmDialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface UserRowActionsProps {
  row: UserSummary
  isSelf: boolean
  canModify: boolean
  canDelete: boolean
  onEdit: (row: UserSummary) => void
  onDetails: (username: string) => void
  onToken: (row: UserSummary) => void
  onResetTotp: (row: UserSummary) => void
  onDelete: (row: UserSummary) => void
}

function UserRowActions({
  row,
  isSelf,
  canModify,
  canDelete,
  onEdit,
  onDetails,
  onToken,
  onResetTotp,
  onDelete,
}: UserRowActionsProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onDetails(row.username)
          }}
        >
          <Users aria-hidden />
          {tc('actions.details')}
        </DropdownMenuItem>
        {canModify && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onEdit(row)
            }}
          >
            <Pencil aria-hidden />
            {tc('actions.edit')}
          </DropdownMenuItem>
        )}
        {canModify && !row.isSsoUser && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onToken(row)
            }}
          >
            <KeyRound aria-hidden />
            {t('users.createToken.action')}
          </DropdownMenuItem>
        )}
        {canModify && row.totpEnabled && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onResetTotp(row)
            }}
          >
            <ShieldOff aria-hidden />
            {t('users.form.resetTotp')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            {/* Deleting yourself would invalidate this very session mid-request,
                so the entry stays visible but inert and spells out why — a
                silently missing "Delete" reads like a permissions bug. */}
            <DropdownMenuItem
              variant="destructive"
              disabled={isSelf}
              onSelect={(event) => {
                event.preventDefault()
                onDelete(row)
              }}
            >
              <Trash aria-hidden />
              {isSelf ? t('users.form.cannotDeleteSelf') : t('users.delete.action')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ------------------------------------------------------------------ */

interface UserSessionListProps {
  sessions: SessionEntry[]
  locale: Locale
  canDelete: boolean
  onRevoke: (session: SessionEntry) => void
}

/** Compact session list for the detail pane — the full table lives on its own tab. */
function UserSessionList({ sessions, locale, canDelete, onRevoke }: UserSessionListProps) {
  const t = useTranslations('admin')

  if (sessions.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t('users.sessions.empty')}</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
      {sessions.map((row) => (
        <li key={row.partialToken} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <Badge variant={row.type === 'ApiToken' ? 'info' : 'secondary'}>
            {t(`sessions.types.${row.type}`)}
          </Badge>
          {row.tokenName ? <span className="font-data">{row.tokenName}</span> : null}
          <span className="font-data text-muted-foreground" title={row.partialToken}>
            {maskSecret(row.partialToken, 4)}
          </span>
          <span className="text-muted-foreground">{formatRelative(row.lastSeen, locale)}</span>
          {row.lastSeenRemoteAddress ? (
            <span className="font-data text-muted-foreground">{row.lastSeenRemoteAddress}</span>
          ) : null}
          {row.isCurrentSession ? <Badge variant="success">{t('sessions.current')}</Badge> : null}
          {/* The current session is never revocable from here — killing it would
              invalidate the request that asked for it. */}
          {canDelete && !row.isCurrentSession ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => onRevoke(row)}
            >
              <Trash className="size-3.5" aria-hidden />
              {t('users.sessions.revoke')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
