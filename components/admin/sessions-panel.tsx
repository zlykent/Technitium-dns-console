'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { EllipsisVertical, KeyRound, MonitorSmartphone, RefreshCw, Trash, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { CopyButton } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Section } from '@/components/app/page-shell'
import { SearchInput } from '@/components/app/search-input'
import { ErrorState } from '@/components/app/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/api/client'
import { createTokenForUser, deleteAnySession, listSessions } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { CreateTokenResult } from '@/lib/api/types/admin'
import type { SessionEntry, SessionType } from '@/lib/api/types/common'
import { useCan } from '@/lib/auth/session'
import { formatDateTime, formatRelative, maskSecret } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Sessions tab: every live sign-in and API token, plus the token minting dialog.
 *
 * `admin/sessions/list` is server-wide — there is no per-user filter — so the
 * Users tab's detail pane re-filters the same shape client-side. Both go through
 * `queryKeys.sessions` / `queryKeys.user`, and every revoke invalidates the
 * whole `admin` domain so neither view can go stale.
 *
 * Two things that will bite if changed carelessly:
 *
 *  - **`deleteAnySession` takes `partialToken`, not the username.** The 16 hex
 *    characters are the *identifier* upstream, so a session with an empty
 *    fingerprint cannot be revoked at all — the confirm button stays disabled.
 *  - **The current session is protected.** Revoking it signs the operator out
 *    mid-request and every subsequent mutation in the same batch fails with an
 *    auth error that looks like a server fault. The row action is hidden and the
 *    bulk revoke skips `isCurrentSession`; `sessions.currentHint` explains why.
 *
 * `CreateTokenDialog` lives here rather than in the Users tab even though the
 * Users row menu is its most common entry point: the created token *is* a
 * session (`type: 'ApiToken'`) and the only place it can be inspected afterwards
 * is this table. Both `users-panel.tsx` and this panel's own row menu mount it —
 * minting from a session row is how an operator reissues a token for a user
 * whose account they are not currently looking at.
 */

const ALL_TYPES = '__all__'
type TypeFilter = typeof ALL_TYPES | SessionType

export function SessionsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Administration')

  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>(ALL_TYPES)
  const [deleteTarget, setDeleteTarget] = React.useState<SessionEntry | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = React.useState(false)
  // Username the token dialog mints for; `null` keeps it closed.
  const [tokenUser, setTokenUser] = React.useState<string | null>(null)

  const sessions = useQuery({
    queryKey: queryKeys.sessions(target),
    queryFn: () => listSessions(),
    enabled: can.canView,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const remove = useMutation({
    mutationFn: (partialToken: string) => deleteAnySession(partialToken),
    onSuccess: () => {
      toast.success(t('sessions.deleteSuccess'))
      invalidate()
      setDeleteTarget(null)
    },
    onError,
  })

  /**
   * There is no `admin/sessions/deleteAll` endpoint (`lib/api/registry.ts:86-88`),
   * so "revoke all" walks the list. The current session is skipped on purpose —
   * see the file header.
   */
  const removeAll = useMutation({
    mutationFn: async () => {
      const rows = (sessions.data?.sessions ?? []).filter((row) => !row.isCurrentSession)
      for (const row of rows) await deleteAnySession(row.partialToken)
      return rows.length
    },
    onSuccess: () => {
      toast.success(t('sessions.deleteAllSuccess'))
      invalidate()
      setDeleteAllOpen(false)
    },
    onError,
  })

  const filtered = React.useMemo(() => {
    let rows = sessions.data?.sessions ?? []
    if (typeFilter !== ALL_TYPES) rows = rows.filter((row) => row.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (row) =>
          row.username.toLowerCase().includes(q) ||
          row.partialToken.toLowerCase().includes(q) ||
          row.lastSeenRemoteAddress.toLowerCase().includes(q) ||
          (row.tokenName ?? '').toLowerCase().includes(q),
      )
    }
    return rows
  }, [sessions.data, typeFilter, search])

  const columns = React.useMemo(
    () => [
      textColumn<SessionEntry>({
        id: 'username',
        accessorKey: 'username',
        header: t('sessions.columns.username'),
        cell: (value, row) => (
          <span className="inline-flex items-center gap-2">
            <span className="font-data text-sm">{String(value)}</span>
            {row.isCurrentSession ? <Badge variant="success">{t('sessions.current')}</Badge> : null}
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'type',
        accessorKey: 'type',
        header: t('sessions.columns.type'),
        cell: (value) => (
          <Badge variant={value === 'ApiToken' ? 'info' : 'secondary'}>
            {t(`sessions.types.${String(value)}`)}
          </Badge>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'tokenName',
        accessorKey: 'tokenName',
        header: t('sessions.columns.tokenName'),
        cell: (value) => <span className="font-data text-xs">{String(value ?? '') || '—'}</span>,
      }),
      textColumn<SessionEntry>({
        id: 'partialToken',
        accessorKey: 'partialToken',
        header: t('sessions.columns.partialToken'),
        cell: (value, row) => (
          <span className="inline-flex items-center gap-1">
            <span className="font-data text-xs" title={String(value)}>
              {maskSecret(String(value), 4)}
            </span>
            <CopyButton value={String(value)} size="icon-xs" />
            {row.isCurrentSession ? <span className="sr-only">{t('sessions.currentHint')}</span> : null}
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'lastSeen',
        accessorKey: 'lastSeen',
        header: t('sessions.columns.lastSeen'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground" title={formatDateTime(value as string, locale)}>
            {formatRelative(value as string, locale)}
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'remoteAddress',
        accessorKey: 'lastSeenRemoteAddress',
        header: t('sessions.columns.remoteAddress'),
        cell: (value) => <span className="font-data text-xs">{String(value) || '—'}</span>,
      }),
      textColumn<SessionEntry>({
        id: 'userAgent',
        accessorKey: 'lastSeenUserAgent',
        header: t('sessions.columns.userAgent'),
        cell: (value) => {
          const ua = String(value ?? '')
          return (
            <span className="block max-w-56 truncate text-xs text-muted-foreground" title={t('sessions.parseUserAgent')}>
              {ua || t('sessions.unknownClient')}
            </span>
          )
        },
      }),
      // `canModify` alone still earns an actions column: minting a token is a
      // write that does not need the delete permission.
      ...(can.canDelete || can.canModify
        ? [
            textColumn<SessionEntry>({
              id: 'actions',
              header: t('sessions.columns.actions'),
              align: 'right' as const,
              hug: true,
              enableSorting: false,
              cell: (_value: unknown, row: SessionEntry) => (
                <SessionRowActions
                  row={row}
                  canRevoke={can.canDelete}
                  canCreateToken={can.canModify}
                  onRevoke={setDeleteTarget}
                  onCreateToken={(username) => setTokenUser(username)}
                />
              ),
            }),
          ]
        : []),
    ],
    [t, locale, can.canDelete, can.canModify],
  )

  return (
    // Flex column so the Section — and the scrollable table inside it — fills
    // the tab's leftover height.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Section
        title={t('sessions.title')}
        description={t('sessions.subtitle')}
        className="flex min-h-0 flex-1 flex-col"
        contentClassName="flex min-h-0 flex-1 flex-col p-3"
      >
        <DataTable<SessionEntry>
          label={t('sessions.title')}
          columns={columns}
          data={filtered}
          scrollable
          getRowId={(row) => row.partialToken}
          loading={sessions.isPending}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          clientPagination={{ pageSize: 25 }}
          // Both narrowing inputs, not just the search. The filtering happens in
          // the `filtered` memo above; this flag only decides which of the two
          // zero-row states to show. Omitting `typeFilter` made "仅 API 令牌"
          // with no matches claim there are no sessions at all.
          filterActive={Boolean(search.trim()) || typeFilter !== ALL_TYPES}
          empty={{ title: t('sessions.empty'), icon: MonitorSmartphone }}
          toolbar={
            <>
              <SearchInput value={search} onChange={setSearch} placeholder={t('sessions.searchPlaceholder')} />
              <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
                <SelectTrigger size="sm" className="w-44" aria-label={tc('actions.filter')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>{t('sessions.filterAll')}</SelectItem>
                  <SelectItem value="Standard">{t('sessions.filterStandard')}</SelectItem>
                  <SelectItem value="ApiToken">{t('sessions.filterApiToken')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void sessions.refetch()} loading={sessions.isFetching}>
                  {!sessions.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
                  {tc('actions.refresh')}
                </Button>
                {can.canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteAllOpen(true)}
                    disabled={filtered.length === 0}
                  >
                    <Trash className="size-3.5" aria-hidden />
                    {t('sessions.deleteAll')}
                  </Button>
                )}
              </div>
            </>
          }
          footerNote={t('sessions.totalSessions', { count: filtered.length })}
        />
      </Section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('sessions.delete')}
        description={deleteTarget ? t('sessions.deleteConfirm', { user: deleteTarget.username }) : undefined}
        confirmLabel={t('sessions.delete')}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.partialToken)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      >
        {deleteTarget?.isCurrentSession ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t('sessions.current')}</AlertTitle>
            <AlertDescription>{t('sessions.currentHint')}</AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title={t('sessions.deleteAllTitle')}
        description={t('sessions.deleteAllBody')}
        confirmLabel={t('sessions.deleteAll')}
        onConfirm={async () => {
          await removeAll.mutateAsync()
        }}
        pending={removeAll.isPending}
        error={removeAll.error ?? undefined}
      >
        <p className="text-sm text-muted-foreground">{t('sessions.deleteAllPreservesCurrent')}</p>
      </ConfirmDialog>

      <CreateTokenDialog
        open={Boolean(tokenUser)}
        onOpenChange={(open) => !open && setTokenUser(null)}
        username={tokenUser}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface SessionRowActionsProps {
  row: SessionEntry
  canRevoke: boolean
  canCreateToken: boolean
  onRevoke: (row: SessionEntry) => void
  onCreateToken: (username: string) => void
}

function SessionRowActions({ row, canRevoke, canCreateToken, onRevoke, onCreateToken }: SessionRowActionsProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  // Your own session stays revocable through the confirm dialog (which warns),
  // but the menu entry is withheld so a stray click cannot sign you out.
  const revocable = canRevoke && !row.isCurrentSession

  if (!revocable && !canCreateToken) {
    return <Badge variant="outline">{t('sessions.current')}</Badge>
  }

  return (
    <span className="inline-flex items-center justify-end gap-1">
      {row.isCurrentSession ? <Badge variant="outline">{t('sessions.current')}</Badge> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
            <EllipsisVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canCreateToken ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onCreateToken(row.username)
              }}
            >
              <KeyRound aria-hidden />
              {t('users.createToken.action')}
            </DropdownMenuItem>
          ) : null}
          {revocable ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault()
                onRevoke(row)
              }}
            >
              <Trash aria-hidden />
              {t('sessions.delete')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/* ------------------------------------------------------------------ */

export interface CreateTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The account the token is minted for; `null` closes the dialog. */
  username: string | null
}

/**
 * Mints an API token via `admin/sessions/createToken` and shows it exactly once.
 *
 * Upstream stores only the SHA-256 hash, so the plaintext in
 * `CreateTokenResult.token` exists for the lifetime of this component and never
 * again. The dialog therefore has two distinct states: a one-field form, and a
 * read-only reveal with a copy button and a warning that closing loses the value
 * for good. Swapping back to the form on reopen is handled by clearing the
 * result in `close()`.
 */
export function CreateTokenDialog({ open, onOpenChange, username }: CreateTokenDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [tokenName, setTokenName] = React.useState('')
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<CreateTokenResult | null>(null)

  /**
   * Both callers drop `username` back to `null` the instant `open` flips false,
   * but Radix keeps the content mounted through its exit animation — long enough
   * to flash a title reading "create a token for " with nobody in it. Holding on
   * to the last real name costs one render-time state adjustment (React's
   * blessed "derive state from props" pattern, no effect, no extra paint).
   */
  const [lastUsername, setLastUsername] = React.useState(username)
  if (username !== null && username !== lastUsername) setLastUsername(username)

  const create = useMutation({
    mutationFn: (name: string) => createTokenForUser(lastUsername!, name),
    onSuccess: (data) => {
      setResult(data)
      toast.success(t('users.createToken.created'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    // Deferred so the exit animation does not flash an empty form.
    setTimeout(() => {
      setTokenName('')
      setNameError(null)
      setResult(null)
      create.reset()
    }, 0)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const name = tokenName.trim()
    if (!name || !lastUsername) {
      setNameError(tc('form.required'))
      return
    }
    setNameError(null)
    void create.mutateAsync(name)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('users.createToken.title', { name: lastUsername ?? '' })}</DialogTitle>
          <DialogDescription>{t('users.createToken.action')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>{t('users.createToken.created')}</AlertTitle>
              <AlertDescription>{t('users.createToken.warning')}</AlertDescription>
            </Alert>
            <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-3">
              <code className="font-data min-w-0 flex-1 break-all text-xs">{result.token}</code>
              <CopyButton value={result.token} label={t('users.createToken.copy')} variant="outline" size="icon-sm" />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-data">{result.partialToken}</span> — {t('sessions.columns.partialToken')}
            </p>
            <DialogFooter showCloseButton={false}>
              <Button type="button" onClick={close}>
                {tc('actions.done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
            <Field>
              <FieldLabel htmlFor="ct-name" required>
                {t('users.createToken.tokenName')}
              </FieldLabel>
              <Input
                id="ct-name"
                value={tokenName}
                autoComplete="off"
                placeholder={t('users.createToken.tokenNamePlaceholder')}
                aria-invalid={Boolean(nameError)}
                onChange={(event) => setTokenName(event.target.value)}
              />
              <FieldDescription>{t('users.createToken.warning')}</FieldDescription>
              <FieldError>{nameError}</FieldError>
            </Field>

            {create.error ? <ErrorState error={create.error} compact /> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {!create.isPending && <KeyRound className="size-4" aria-hidden />}
                {t('users.createToken.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
