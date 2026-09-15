'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Check, Minus, Save, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataValue } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { EmptyState, ErrorState } from '@/components/app/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/api/client'
import { getProfile, setProfile } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import { NO_PERMISSIONS, PERMISSION_SECTIONS, type PermissionSection } from '@/lib/api/types/common'
import { useSession } from '@/lib/auth/session'
import { formatDateTime, formatDurationSeconds } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Profile tab: the operator's own display name, account provenance, group
 * memberships, effective permission matrix and last sign-in facts.
 *
 * Design notes:
 *
 *  - **`displayName` is the only editable field.** `user/profile/set` accepts a
 *    single parameter, so the form is one input plus a save button; the username
 *    is immutable upstream (`profile.usernameHint` says so) and rendered with
 *    `DataValue` because it is a login identifier, not prose.
 *  - **The permission matrix is read from the session, not the profile.**
 *    `user/profile/get` returns group names but not the merged flag set — that
 *    lives in `session.info.permissions`, which `useSession()` already exposes.
 *    Rendering it here (rather than re-fetching) means the matrix is exactly the
 *    set the route guard used, so it can never disagree with the sidebar.
 *  - **Saving refreshes the session too.** The display name is baked into the
 *    session payload the topbar reads, so a successful `setProfile` invalidates
 *    the profile query *and* calls `refresh()`; without the latter the topbar
 *    would show the stale name until the next navigation.
 *
 * Section labels come from `nav:items.*` — the same copy the sidebar uses — so a
 * permission row and its nav entry always read identically. The three secondary
 * labels with no `account`-namespace equivalent (groups, last sign-in, session
 * timeout) are reused verbatim from the `admin` user-detail bundle rather than
 * duplicating strings.
 */

/** Permission section -> `nav.items.<key>` for a human-readable section name. */
const SECTION_NAV_KEY: Record<PermissionSection, string> = {
  Administration: 'administration',
  Allowed: 'allowed',
  Apps: 'apps',
  Blocked: 'blocked',
  Cache: 'cache',
  Dashboard: 'dashboard',
  DhcpServer: 'dhcp',
  DnsClient: 'dnsClient',
  Logs: 'logs',
  Settings: 'settings',
  Zones: 'zones',
}

interface PermissionRow {
  section: PermissionSection
  label: string
  canView: boolean
  canModify: boolean
  canDelete: boolean
}

export function ProfilePanel() {
  const t = useTranslations('account')
  const tn = useTranslations('nav')
  const tc = useTranslations('common')
  const ta = useTranslations('admin')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const { permissions, refresh } = useSession()

  const profile = useQuery({
    queryKey: queryKeys.profile(target),
    queryFn: () => getProfile(),
  })

  const [displayName, setDisplayName] = React.useState('')
  // Reconcile the input with the server value during render (never in an effect)
  // so a refetch or a save repaints the field without a second render pass.
  const [synced, setSynced] = React.useState<string | null>(null)
  const serverName = profile.data?.displayName ?? null
  if (serverName !== null && serverName !== synced) {
    setSynced(serverName)
    setDisplayName(serverName)
  }

  const save = useMutation({
    mutationFn: (name: string) => setProfile(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
      refresh()
      toast.success(t('profile.saved'))
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const rows = React.useMemo<PermissionRow[]>(
    () =>
      PERMISSION_SECTIONS.map((section) => {
        const flags = permissions[section] ?? NO_PERMISSIONS
        return { section, label: tn(`items.${SECTION_NAV_KEY[section]}.label`), ...flags }
      }),
    [permissions, tn],
  )
  const hasAnyPermission = rows.some((row) => row.canView || row.canModify || row.canDelete)

  const columns = React.useMemo(
    () => [
      textColumn<PermissionRow>({ id: 'label', accessorKey: 'label', header: t('profile.permissions'), flex: true }),
      textColumn<PermissionRow>({
        id: 'canView',
        accessorKey: 'canView',
        header: t('profile.canView'),
        align: 'center',
        cell: (value) => <PermissionFlag granted={Boolean(value)} yes={tc('fields.yes')} no={tc('fields.no')} />,
      }),
      textColumn<PermissionRow>({
        id: 'canModify',
        accessorKey: 'canModify',
        header: t('profile.canModify'),
        align: 'center',
        cell: (value) => <PermissionFlag granted={Boolean(value)} yes={tc('fields.yes')} no={tc('fields.no')} />,
      }),
      textColumn<PermissionRow>({
        id: 'canDelete',
        accessorKey: 'canDelete',
        header: t('profile.canDelete'),
        align: 'center',
        cell: (value) => <PermissionFlag granted={Boolean(value)} yes={tc('fields.yes')} no={tc('fields.no')} />,
      }),
    ],
    [t, tc],
  )

  if (profile.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="surface h-40 w-full rounded-lg" />
        <Skeleton className="surface h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (profile.error || !profile.data) {
    return <ErrorState error={profile.error ?? new Error('no data')} onRetry={() => void profile.refetch()} />
  }

  const data = profile.data
  const dirty = displayName.trim() !== data.displayName

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || save.isPending) return
    void save.mutateAsync(displayName.trim())
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('profile.title')}
        description={t('profile.subtitle')}
        actions={
          <Button type="submit" form="profile-form" size="sm" disabled={!dirty} loading={save.isPending}>
            {!save.isPending && <Save className="size-3.5" aria-hidden />}
            {save.isPending ? t('profile.saving') : t('profile.save')}
          </Button>
        }
      >
        <form id="profile-form" className="flex flex-col gap-4" noValidate onSubmit={submit}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={data.isSsoUser ? 'info' : 'secondary'}>
              <ShieldCheck className="size-3" aria-hidden />
              {data.isSsoUser ? t('profile.ssoUser') : t('profile.localUser')}
            </Badge>
            {data.totpEnabled ? <Badge variant="success">{t('security.totp.statusEnabled')}</Badge> : null}
          </div>

          {data.isSsoUser ? (
            <Alert variant="info">
              <AlertTitle>{t('profile.ssoUser')}</AlertTitle>
              <AlertDescription>{t('profile.ssoUserHint')}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-display-name">{t('profile.displayName')}</FieldLabel>
              <Input
                id="profile-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('profile.displayNamePlaceholder')}
                autoComplete="nickname"
                disabled={save.isPending}
              />
            </Field>

            <Field>
              <FieldLabel>{t('profile.username')}</FieldLabel>
              <div className="flex h-9 items-center">
                <DataValue value={data.username} copy={false} className="text-sm" />
              </div>
              <FieldDescription>{t('profile.usernameHint')}</FieldDescription>
            </Field>
          </div>
        </form>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{ta('users.columns.memberOfGroups')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.memberOfGroups.length > 0 ? (
              data.memberOfGroups.map((group) => (
                <Badge key={group} variant="outline" className="font-data">
                  {group}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">{tc('fields.none')}</span>
            )}
          </div>
        </div>

        <DefinitionList
          className="border-t border-border/60 pt-4"
          items={[
            {
              label: ta('users.columns.recentSession'),
              value: <span className="font-data">{formatDateTime(data.recentSessionLoggedOn, locale)}</span>,
            },
            {
              label: t('sessions.address'),
              value: <span className="font-data">{data.recentSessionRemoteAddress || '—'}</span>,
            },
            {
              label: ta('users.form.sessionTimeoutSeconds'),
              value: <span className="font-data">{formatDurationSeconds(data.sessionTimeoutSeconds, locale)}</span>,
            },
          ]}
        />
      </Section>

      <Section title={t('profile.permissions')} description={t('profile.permissionsHint')} contentClassName="p-3">
        {hasAnyPermission ? (
          <DataTable<PermissionRow>
            label={t('profile.permissions')}
            columns={columns}
            data={rows}
            getRowId={(row) => row.section}
            enableSorting={false}
            clientPagination={false}
            density="compact"
          />
        ) : (
          <EmptyState icon={ShieldCheck} title={t('profile.noPermissions')} />
        )}
      </Section>
    </div>
  )
}

function PermissionFlag({ granted, yes, no }: { granted: boolean; yes: string; no: string }) {
  return granted ? (
    <span className="inline-flex items-center justify-center gap-1 text-success">
      <Check className="size-4" aria-hidden />
      <span className="sr-only">{yes}</span>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center gap-1 text-muted-foreground/50">
      <Minus className="size-4" aria-hidden />
      <span className="sr-only">{no}</span>
    </span>
  )
}
