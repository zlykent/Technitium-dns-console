'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { KeyRound, LogIn, Plus, Trash } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { CreateTokenDialog } from '@/components/account/create-token-dialog'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { CopyButton } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Section } from '@/components/app/page-shell'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TARGET_HEADER, describeError } from '@/lib/api/client'
import { deleteSession, getProfile } from '@/lib/api/domains/user'
import { DnsApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import type { Session, SessionEntry } from '@/lib/api/types/common'
import { useSession } from '@/lib/auth/session'
import { formatRelative, maskSecret, parseTimestamp } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useServers, useTargetKey } from '@/lib/servers/provider'

/**
 * API tokens tab.
 *
 * Technitium has **no "list my tokens" endpoint** — a token is stored only as a
 * SHA-256 hash and the plaintext is returned exactly once, at creation. The only
 * place a minted token is subsequently visible is `user/profile/get`'s `sessions`
 * array, where it appears as an entry with `type === 'ApiToken'`. So this table
 * is that array filtered to API tokens, which is why every mutation here
 * invalidates `queryKeys.profile` rather than a dedicated token key.
 *
 * Two consequences worth remembering:
 *  - there is no creation timestamp upstream, so the "created" column the message
 *    bundle anticipates is intentionally omitted rather than filled with `—`;
 *  - deleting a token is `user/session/delete` keyed by `partialToken` — the same
 *    call the sessions tab uses — because a token *is* a session upstream.
 *
 * The `loginWithToken` block mirrors `components/auth/login-form.tsx` exactly
 * (same `/api/auth/token` POST, same conditional `X-Dns-Target` header, same
 * `adopt` + `refresh`) so an operator can switch identity from inside the console
 * without a round trip to the login screen.
 */

export function TokensPanel() {
  const t = useTranslations('account')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<SessionEntry | null>(null)

  const profile = useQuery({
    queryKey: queryKeys.profile(target),
    queryFn: () => getProfile(),
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
  }, [queryClient, target])

  const remove = useMutation({
    mutationFn: (partialToken: string) => deleteSession(partialToken),
    onSuccess: () => {
      toast.success(t('tokens.deleted'))
      invalidate()
      setDeleteTarget(null)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const tokens = React.useMemo(
    () => (profile.data?.sessions ?? []).filter((entry) => entry.type === 'ApiToken'),
    [profile.data],
  )

  const columns = React.useMemo(
    () => [
      textColumn<SessionEntry>({
        id: 'name',
        accessorKey: 'tokenName',
        header: t('tokens.table.name'),
        flex: true,
        cell: (value) => <span className="text-sm">{String(value ?? '') || '—'}</span>,
      }),
      textColumn<SessionEntry>({
        id: 'partial',
        accessorKey: 'partialToken',
        header: t('tokens.table.partial'),
        cell: (value) => (
          <span className="inline-flex items-center gap-1">
            <span className="font-data text-xs" title={String(value)}>
              {maskSecret(String(value), 4)}
            </span>
            <CopyButton value={String(value)} size="icon-xs" />
          </span>
        ),
      }),
      textColumn<SessionEntry>({
        id: 'lastUsed',
        accessorKey: 'lastSeen',
        header: t('tokens.table.lastUsed'),
        cell: (value) => {
          const seen = parseTimestamp(value as string)
          return (
            <span className="text-xs text-muted-foreground">
              {seen ? formatRelative(value as string, locale) : t('tokens.table.never')}
            </span>
          )
        },
      }),
      textColumn<SessionEntry>({
        id: 'actions',
        header: t('tokens.table.actions'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value: unknown, row: SessionEntry) => (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive"
            aria-label={t('tokens.delete')}
            onClick={() => setDeleteTarget(row)}
          >
            <Trash className="size-3.5" aria-hidden />
          </Button>
        ),
      }),
    ],
    [t, locale],
  )

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('tokens.title')}
        description={t('tokens.subtitle')}
        contentClassName="p-3"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t('tokens.create')}
          </Button>
        }
      >
        <DataTable<SessionEntry>
          label={t('tokens.title')}
          columns={columns}
          data={tokens}
          getRowId={(row) => row.partialToken}
          loading={profile.isPending}
          error={profile.error}
          onRetry={() => void profile.refetch()}
          enableSorting={false}
          clientPagination={false}
          empty={{ title: t('tokens.table.empty'), icon: KeyRound }}
        />
      </Section>

      <LoginWithToken />

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('tokens.delete')}
        description={
          deleteTarget ? t('tokens.deleteConfirm', { name: deleteTarget.tokenName || deleteTarget.partialToken }) : undefined
        }
        confirmLabel={t('tokens.delete')}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.partialToken)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function LoginWithToken() {
  const t = useTranslations('account')
  const ta = useTranslations('auth')
  const router = useRouter()
  const { active, defaultTarget } = useServers()
  const { adopt, refresh } = useSession()

  const [token, setToken] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // This call bypasses the SDK client, so the target header is set by hand.
      // A null/default target is addressed by omitting it entirely.
      const target = active?.url ?? null
      if (target && target !== defaultTarget) headers[TARGET_HEADER] = target

      const response = await fetch('/api/auth/token', {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: token.trim() }),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const body = (await response.json()) as Session & { code?: string; message?: string }
      if (!response.ok) throw DnsApiError.from(body, response.status)

      setToken('')
      adopt(body)
      refresh()
      toast.success(ta('login.signedIn'))
      router.replace('/account')
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Section title={t('tokens.loginWithToken.title')} description={t('tokens.loginWithToken.body')}>
      <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="login-token" className="sr-only">
            {t('tokens.loginWithToken.title')}
          </FieldLabel>
          <Input
            id="login-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t('tokens.loginWithToken.placeholder')}
            className="font-data"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </Field>

        {error ? <ErrorState error={error} compact /> : null}

        <div>
          <Button type="submit" loading={pending} disabled={token.trim().length < 16}>
            {!pending && <LogIn className="size-4" aria-hidden />}
            {t('tokens.loginWithToken.submit')}
          </Button>
        </div>
      </form>
    </Section>
  )
}
