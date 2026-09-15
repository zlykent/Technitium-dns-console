'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CirclePlus, Save, Trash } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/app/states'
import { PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ZoneTabs } from '@/components/zones/zone-tabs'
import { describeError } from '@/lib/api/client'
import { getZonePermissions, setZonePermissions } from '@/lib/api/domains/zones'
import { queryKeys } from '@/lib/api/query-keys'
import { serializePermissionTable } from '@/lib/api/types/admin'
import type { ZonePermissions } from '@/lib/api/types/zones'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Zone permissions — the per-zone ACL for individual users and groups.
 *
 * `zones/permissions/get` returns two parallel arrays (`userPermissions` keyed
 * by `username`, `groupPermissions` keyed by `name`) plus the full `users[]` /
 * `groups[]` picker lists. The page keeps both as locally-editable rows and
 * replaces the whole ACL on save. The non-obvious parts:
 *
 *  - **Rows are keyed by `key`, the wire is keyed by `name`.** The local `PermRow`
 *    uses one `key` field for both tables (a username or a group name), while
 *    `serializePermissionTable` emits the principal in its first column. `toNamed`
 *    bridges the two; skipping it would emit `undefined|…` and silently corrupt
 *    the ACL.
 *  - **Save is a full replace.** `zones/permissions/set` overwrites both lists
 *    with the pipe-delimited payload; there is no incremental add/remove, so a
 *    deleted row is dropped simply by not being in the array we send.
 *  - **Both lists are always sent.** Omitting one would clear it upstream, so
 *    even an untouched table is re-serialised on every save.
 */

/** One editable ACL row. `key` is a username (users) or a group name. */
interface PermRow {
  key: string
  canView: boolean
  canModify: boolean
  canDelete: boolean
}

/** Sentinel for the "nothing chosen yet" state of the add-picker (Radix forbids ""). */
const PICK = '__pick__'

export interface ZonePermissionsViewProps {
  zone: string
}

export function ZonePermissionsView({ zone }: ZonePermissionsViewProps) {
  const t = useTranslations('zones')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Zones')

  const permissions = useQuery({
    queryKey: queryKeys.zonePermissions(target, zone),
    queryFn: () => getZonePermissions(zone),
    enabled: can.canView,
  })

  const [userRows, setUserRows] = React.useState<PermRow[]>([])
  const [groupRows, setGroupRows] = React.useState<PermRow[]>([])

  // Seed both tables when the server answer arrives (and re-seed when it is
  // refetched). Render-phase adjustment keyed on the data reference rather than
  // an effect, so local edits are not clobbered on every render but the rows do
  // reset the moment fresh data lands.
  const [source, setSource] = React.useState<ZonePermissions | null>(null)
  const incoming = permissions.data ?? null
  if (incoming !== source) {
    setSource(incoming)
    setUserRows(incoming ? incoming.userPermissions.map((entry) => ({ key: entry.username, canView: entry.canView, canModify: entry.canModify, canDelete: entry.canDelete })) : [])
    setGroupRows(incoming ? incoming.groupPermissions.map((entry) => ({ key: entry.name, canView: entry.canView, canModify: entry.canModify, canDelete: entry.canDelete })) : [])
  }

  const data = permissions.data

  const save = useMutation({
    mutationFn: () =>
      setZonePermissions({
        zone,
        userPermissions: serializePermissionTable(userRows.map(toNamed)),
        groupPermissions: serializePermissionTable(groupRows.map(toNamed)),
      }),
    onSuccess: () => {
      toast.success(t('permissions.saved'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.zonePermissions(target, zone) })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: t('detail.backToList'), href: '/zones' }, { label: zone }, { label: t('permissions.title') }]}
        title={<span className="font-data">{zone}</span>}
        description={t('permissions.subtitle', { zone })}
        actions={
          can.canModify && (
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!data}>
              {!save.isPending && <Save className="size-3.5" aria-hidden />}
              {save.isPending ? t('permissions.saving') : t('permissions.save')}
            </Button>
          )
        }
        footer={<p className="text-xs text-muted-foreground">{t('permissions.inheritHint')}</p>}
      />

      <ZoneTabs zone={zone} current="permissions" />

      {permissions.isPending ? (
        <LoadingState rows={6} />
      ) : permissions.error ? (
        <ErrorState error={permissions.error} onRetry={() => void permissions.refetch()} />
      ) : (
        data && (
          <div className="flex flex-col gap-4">
            <Section
              title={t('permissions.users')}
              actions={
                can.canModify && (
                  <AddPicker
                    available={remaining(data.users, userRows)}
                    placeholder={t('permissions.addUser')}
                    onAdd={(key) => setUserRows((rows) => [...rows, blank(key)])}
                  />
                )
              }
            >
              <PermissionTable rows={userRows} onChange={setUserRows} canEdit={can.canModify} />
            </Section>

            <Section
              title={t('permissions.groups')}
              actions={
                can.canModify && (
                  <AddPicker
                    available={remaining(data.groups, groupRows)}
                    placeholder={t('permissions.addGroup')}
                    onAdd={(key) => setGroupRows((rows) => [...rows, blank(key)])}
                  />
                )
              }
            >
              <PermissionTable rows={groupRows} onChange={setGroupRows} canEdit={can.canModify} />
            </Section>
          </div>
        )
      )}
    </PageShell>
  )
}

/** A new grant starts fully locked-down; the operator opts in per column. */
function blank(key: string): PermRow {
  return { key, canView: false, canModify: false, canDelete: false }
}

/** Rename `key` -> `name` so the row matches what `serializePermissionTable` reads. */
function toNamed(row: PermRow) {
  return { name: row.key, canView: row.canView, canModify: row.canModify, canDelete: row.canDelete }
}

/** Principals not already granted, for the add-picker. */
function remaining(all: string[], rows: PermRow[]): string[] {
  const taken = new Set(rows.map((row) => row.key))
  return all.filter((name) => !taken.has(name))
}

function AddPicker({ available, placeholder, onAdd }: { available: string[]; placeholder: string; onAdd: (key: string) => void }) {
  const tc = useTranslations('common')
  const [pending, setPending] = React.useState(PICK)

  function commit() {
    if (pending === PICK) return
    onAdd(pending)
    setPending(PICK)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={pending} onValueChange={setPending} disabled={available.length === 0}>
        <SelectTrigger size="sm" className="w-48" aria-label={placeholder}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {available.map((name) => (
            <SelectItem key={name} value={name}>
              <span className="font-data">{name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="sm" onClick={commit} disabled={pending === PICK}>
        <CirclePlus className="size-3.5" aria-hidden />
        {tc('actions.add')}
      </Button>
    </div>
  )
}

function PermissionTable({ rows, onChange, canEdit }: { rows: PermRow[]; onChange: (rows: PermRow[]) => void; canEdit: boolean }) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')

  function setFlag(key: string, flag: 'canView' | 'canModify' | 'canDelete', value: boolean) {
    onChange(rows.map((row) => (row.key === key ? { ...row, [flag]: value } : row)))
  }

  function remove(key: string) {
    onChange(rows.filter((row) => row.key !== key))
  }

  if (rows.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">{t('permissions.empty')}</p>
        <p className="mt-1 text-xs text-muted-foreground/80">{t('permissions.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t('permissions.principal')}
            </th>
            <th scope="col" className="px-3 py-2 text-center font-medium">
              {t('permissions.canView')}
            </th>
            <th scope="col" className="px-3 py-2 text-center font-medium">
              {t('permissions.canModify')}
            </th>
            <th scope="col" className="px-3 py-2 text-center font-medium">
              {t('permissions.canDelete')}
            </th>
            <th scope="col" className="w-10 py-2">
              <span className="sr-only">{tc('fields.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/40 last:border-0">
              <td className="py-2 pr-3">
                <span className="font-data">{row.key}</span>
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-center">
                  <Checkbox
                    checked={row.canView}
                    disabled={!canEdit}
                    aria-label={`${t('permissions.canView')}: ${row.key}`}
                    onCheckedChange={(value) => setFlag(row.key, 'canView', value === true)}
                  />
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-center">
                  <Checkbox
                    checked={row.canModify}
                    disabled={!canEdit}
                    aria-label={`${t('permissions.canModify')}: ${row.key}`}
                    onCheckedChange={(value) => setFlag(row.key, 'canModify', value === true)}
                  />
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-center">
                  <Checkbox
                    checked={row.canDelete}
                    disabled={!canEdit}
                    aria-label={`${t('permissions.canDelete')}: ${row.key}`}
                    onCheckedChange={(value) => setFlag(row.key, 'canDelete', value === true)}
                  />
                </div>
              </td>
              <td className="py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => remove(row.key)}
                  disabled={!canEdit}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`${tc('actions.remove')} — ${row.key}`}
                >
                  <Trash className="size-3.5" aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
