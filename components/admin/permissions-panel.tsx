'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { RotateCcw, Save, ShieldCheck, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Section } from '@/components/app/page-shell'
import { ErrorState, LoadingState } from '@/components/app/states'
import {
  blankRow,
  PrincipalPicker,
  PermissionMatrix,
  remainingPrincipals,
  toTableRow,
  type AclRow,
} from '@/components/admin/permission-matrix'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/api/client'
import { getPermissions, getUser, listPermissions, setPermissions } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import { serializePermissionTable } from '@/lib/api/types/admin'
import type { SectionPermissions } from '@/lib/api/types/admin'
import { PERMISSION_SECTIONS, type PermissionSection } from '@/lib/api/types/common'
import { useCan, useSession } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Permissions tab: the eleven section ACLs.
 *
 * Two endpoints, two shapes. `admin/permissions/list` returns every section with
 * its grants but **without** the `users[]` / `groups[]` picker lists; only
 * `admin/permissions/get?section=X` includes those (compare
 * `.probe/admin.permissions.list.json` with `.probe/admin.permissions.get.json`).
 * So the overview table is driven by `list` and the editor by `get`, and
 * selecting a row is what triggers the second call.
 *
 * Save semantics — copied from `components/zones/zone-permissions-view.tsx`
 * because `admin/permissions/set` behaves identically:
 *
 *  - **Full replace.** Both tables are serialised with `serializePermissionTable`
 *    into one flat pipe-delimited stream and both are *always* sent; omitting one
 *    clears it upstream.
 *  - **Rows are keyed by `key`, the wire by `name`.** `toTableRow` bridges them.
 *    Skipping it emits `undefined|false|false|false` and corrupts the whole ACL.
 *  - **Local rows are re-seeded on the data reference, not in an effect.** The
 *    render-phase comparison against `source` is what stops a background refetch
 *    from wiping unsaved edits while still resetting them when fresh data lands.
 *
 * The self-lockout warning is not decoration: revoking your own `Administration`
 * grant takes effect on the *next* request, so a successful save is immediately
 * followed by a 403 on every panel of this page with no way back except another
 * administrator. Upstream does not refuse the call, so the UI has to.
 */

const NONE = '__none__'

export function PermissionsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Administration')
  const { session, flagsFor } = useSession()
  const me = session?.username ?? null

  const [section, setSection] = React.useState<PermissionSection | null>(null)
  const [resetOpen, setResetOpen] = React.useState(false)
  /** The editor card; the overview's edit affordance scrolls it into view. */
  const editorRef = React.useRef<HTMLDivElement>(null)

  const sections = useQuery({
    queryKey: queryKeys.permissionSections(target),
    queryFn: () => listPermissions(),
    enabled: can.canView,
  })

  const detail = useQuery({
    queryKey: queryKeys.permissions(target, section ?? NONE),
    queryFn: () => getPermissions(section!),
    enabled: can.canView && section !== null,
  })

  /** Only needed to know which groups would lock *me* out. */
  const meDetail = useQuery({
    queryKey: queryKeys.user(target, me ?? NONE),
    queryFn: () => getUser(me!),
    enabled: can.canView && me !== null,
  })

  /**
   * Selecting from the overview also scrolls the editor into view: the card
   * sits below a table of eleven sections that fills the fold on a laptop
   * viewport, so a bare state change reads as a dead click. The `Select`
   * lives inside the editor itself and needs no scroll.
   *
   * One scroll is not enough. At click time the card still holds the skeleton,
   * and being the last card on the page its `scrollIntoView` clamps to whatever
   * the short document allows; once the matrix lands the card grows back below
   * the fold. So the follow flag stays set until the detail query settles and
   * each interim layout gets one more `nearest` nudge. The flag is a ref plus
   * a tick: the tick re-runs the effect when the *same* row is re-clicked,
   * without putting a setState in the effect body.
   */
  const [followTick, setFollowTick] = React.useState(0)
  const following = React.useRef(false)
  React.useEffect(() => {
    if (!following.current) return
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    if (!detail.isPending) following.current = false
  }, [followTick, section, detail.data, detail.isPending])

  const openSection = React.useCallback((value: PermissionSection) => {
    setSection(value)
    following.current = true
    setFollowTick((tick) => tick + 1)
  }, [])

  const [userRows, setUserRows] = React.useState<AclRow[]>([])
  const [groupRows, setGroupRows] = React.useState<AclRow[]>([])

  // Render-phase re-seed keyed on the data reference — see the file header.
  const [source, setSource] = React.useState<SectionPermissions | null>(null)
  const incoming = detail.data ?? null
  if (incoming !== source) {
    setSource(incoming)
    setUserRows(
      incoming
        ? incoming.userPermissions.map((entry) => ({
            key: entry.username,
            canView: entry.canView,
            canModify: entry.canModify,
            canDelete: entry.canDelete,
          }))
        : [],
    )
    setGroupRows(
      incoming
        ? incoming.groupPermissions.map((entry) => ({
            key: entry.name,
            canView: entry.canView,
            canModify: entry.canModify,
            canDelete: entry.canDelete,
          }))
        : [],
    )
  }

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const save = useMutation({
    mutationFn: () =>
      setPermissions({
        section: section!,
        userPermissions: serializePermissionTable(userRows.map(toTableRow)),
        groupPermissions: serializePermissionTable(groupRows.map(toTableRow)),
      }),
    onSuccess: () => {
      toast.success(t('permissions.saved'))
      invalidate()
    },
    onError,
  })

  const reset = useMutation({
    mutationFn: () =>
      setPermissions({ section: section!, userPermissions: '', groupPermissions: '' }),
    onSuccess: () => {
      toast.success(t('permissions.saved'))
      invalidate()
      setResetOpen(false)
    },
    onError,
  })

  const myGroups = meDetail.data?.memberOfGroups ?? []
  const touchesSelf =
    section === 'Administration' &&
    (userRows.some((row) => row.key === me) || groupRows.some((row) => myGroups.includes(row.key)))

  const columns = React.useMemo(
    () => [
      textColumn<SectionPermissions>({
        id: 'section',
        accessorKey: 'section',
        header: t('permissions.sectionLabel'),
        flex: true,
        cell: (value) => {
          const key = String(value) as PermissionSection
          const known = (PERMISSION_SECTIONS as readonly string[]).includes(key)
          return (
            <span className="block min-w-0">
              <span className="text-sm font-medium">
                {known ? t(`permissions.sections.${key}.label`) : key}
              </span>
              <span className="block text-xs text-muted-foreground">
                {known ? t(`permissions.sections.${key}.hint`) : key}
              </span>
            </span>
          )
        },
      }),
      textColumn<SectionPermissions>({
        id: 'own',
        header: tc('fields.status'),
        enableSorting: false,
        cell: (_value: unknown, row: SectionPermissions) => {
          const flags = flagsFor(row.section as PermissionSection)
          if (!flags.canView) return <Badge variant="muted">{tc('fields.none')}</Badge>
          return (
            <Badge variant={flags.canModify || flags.canDelete ? 'success' : 'outline'}>
              {flags.canModify || flags.canDelete ? t('permissions.fullAccess') : t('permissions.viewOnly')}
            </Badge>
          )
        },
      }),
      textColumn<SectionPermissions>({
        id: 'users',
        header: t('permissions.users'),
        align: 'right' as const,
        enableSorting: false,
        cell: (_value: unknown, row: SectionPermissions) => (
          <span className="font-data text-xs">{row.userPermissions.length}</span>
        ),
      }),
      textColumn<SectionPermissions>({
        id: 'groups',
        header: t('permissions.groups'),
        align: 'right' as const,
        enableSorting: false,
        cell: (_value: unknown, row: SectionPermissions) => (
          <span className="font-data text-xs">{row.groupPermissions.length}</span>
        ),
      }),
      textColumn<SectionPermissions>({
        id: 'actions',
        header: tc('fields.actions'),
        align: 'right' as const,
        hug: true,
        enableSorting: false,
        cell: (_value: unknown, row: SectionPermissions) => (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={(event) => {
              event.stopPropagation()
              openSection(row.section as PermissionSection)
            }}
          >
            {tc('actions.edit')}
          </Button>
        ),
      }),
    ],
    [t, tc, flagsFor, openSection],
  )

  return (
    <>
      <Section title={t('permissions.title')} description={t('permissions.subtitle')} contentClassName="p-3">
        <DataTable<SectionPermissions>
          label={t('permissions.title')}
          columns={columns}
          data={sections.data?.permissions ?? []}
          getRowId={(row) => row.section}
          loading={sections.isPending}
          error={sections.error}
          onRetry={() => void sections.refetch()}
          // Not `clientPagination={false}`: `DataTable`'s `rows` memo
          // (`components/app/data-table.tsx:173-178`) keys on the *stable* table
          // instance plus this prop, so a stable `false` freezes the row list at
          // whatever it was on the first render — an empty table forever, because
          // the sections load after mount. A fresh object literal keeps it live.
          clientPagination={{ pageSize: 25 }}
          onRowClick={(row) => openSection(row.section as PermissionSection)}
          empty={{ title: tc('table.empty'), icon: ShieldCheck }}
          footerNote={t('permissions.sectionHelp')}
        />
      </Section>

      <div ref={editorRef}>
        <Section
          title={t('permissions.sectionLabel')}
          description={t('permissions.sectionHelp')}
          actions={
            <Select
              value={section ?? NONE}
              onValueChange={(value) => setSection(value === NONE ? null : (value as PermissionSection))}
            >
              <SelectTrigger size="sm" className="w-52" aria-label={t('permissions.sectionLabel')}>
                <SelectValue placeholder={t('permissions.sectionLabel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tc('fields.none')}</SelectItem>
                {PERMISSION_SECTIONS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {t(`permissions.sections.${name}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          {!section ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('permissions.emptyHint')}</p>
          ) : detail.isPending ? (
            <LoadingState rows={4} />
          ) : detail.error ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <div className="flex flex-col gap-5">
              {touchesSelf && (
                <Alert variant="warning">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>{t('permissions.title')}</AlertTitle>
                  <AlertDescription>{t('permissions.selfLockoutWarning')}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t('permissions.users')}</h3>
                  {can.canModify && detail.data && (
                    <PrincipalPicker
                      available={remainingPrincipals(detail.data.users ?? [], userRows)}
                      placeholder={t('permissions.addUser')}
                      onAdd={(key) => setUserRows((rows) => [...rows, blankRow(key)])}
                    />
                  )}
                </div>
                <PermissionMatrix rows={userRows} onChange={setUserRows} canEdit={can.canModify} />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t('permissions.groups')}</h3>
                  {can.canModify && detail.data && (
                    <PrincipalPicker
                      available={remainingPrincipals(detail.data.groups ?? [], groupRows)}
                      placeholder={t('permissions.addGroup')}
                      onAdd={(key) => setGroupRows((rows) => [...rows, blankRow(key)])}
                    />
                  )}
                </div>
                <PermissionMatrix rows={groupRows} onChange={setGroupRows} canEdit={can.canModify} />
              </div>

              <p className="text-xs text-muted-foreground">{t('permissions.inheritNote')}</p>

              {can.canModify && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
                    {!save.isPending && <Save className="size-3.5" aria-hidden />}
                    {save.isPending ? t('permissions.saving') : t('permissions.save')}
                  </Button>
                  {can.canDelete && (
                    <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                      <RotateCcw className="size-3.5" aria-hidden />
                      {t('permissions.reset')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t('permissions.reset')}
        description={t('permissions.resetConfirm')}
        confirmLabel={t('permissions.reset')}
        onConfirm={async () => {
          await reset.mutateAsync()
        }}
        pending={reset.isPending}
        error={reset.error ?? undefined}
      >
        {touchesSelf ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('permissions.selfLockoutWarning')}</AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
