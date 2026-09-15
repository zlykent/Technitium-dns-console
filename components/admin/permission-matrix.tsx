'use client'

import { useTranslations } from 'next-intl'
import { CirclePlus, Trash } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { PermissionTableRow } from '@/lib/api/types/admin'

/**
 * The three-checkbox ACL row editor shared by the per-section user table and
 * group table on the Permissions tab.
 *
 * It is deliberately a hand-rolled `<table>` and *not* a `DataTable`: the rows
 * are local edit state (never paginated, never sorted, never filtered) and the
 * whole point is that a checkbox change must not re-run TanStack Table's row
 * model. `components/zones/zone-permissions-view.tsx` uses the same shape for
 * the zone ACL; this module exists so the two administration tables do not each
 * carry a private copy of it.
 *
 * Two non-obvious rules live here:
 *
 *  - **`key` is not what goes on the wire.** Users are keyed by `username` and
 *    groups by `name` upstream, but both tables are edited as one `AclRow`
 *    shape. `toTableRow` renames `key -> name` so `serializePermissionTable`
 *    emits a principal instead of `undefined`; forgetting it silently corrupts
 *    the whole ACL because the endpoint is a full replace.
 *  - **Modify implies view.** Technitium stores the three flags independently,
 *    so a row with `canModify: true, canView: false` is representable but
 *    meaningless — the user could edit a page they cannot open. Ticking modify
 *    therefore also ticks view; unticking view clears all three.
 */

/** One editable ACL row. `key` is a username (users table) or a group name. */
export interface AclRow {
  key: string
  canView: boolean
  canModify: boolean
  canDelete: boolean
}

export type AclFlag = 'canView' | 'canModify' | 'canDelete'

/**
 * The picker's "nothing chosen yet" value.
 *
 * It has to be `""`: Radix only renders `SelectValue`'s `placeholder` when the
 * root's value is `""` or `undefined` (`shouldShowPlaceholder` in
 * `@radix-ui/react-select`). A non-empty sentinel such as `__pick__` matches no
 * `SelectItem`, so the trigger renders *nothing* and the control looks broken.
 * The well-known "Radix forbids an empty string" rule applies to `SelectItem`,
 * not to the root value — and `undefined` would flip the Select into
 * uncontrolled mode, so the reset after an add would not clear the trigger.
 */
const NOTHING = ''

/** A new grant starts fully locked-down; the operator opts in per column. */
export function blankRow(key: string): AclRow {
  return { key, canView: false, canModify: false, canDelete: false }
}

/** Rename `key` -> `name` so the row matches what `serializePermissionTable` reads. */
export function toTableRow(row: AclRow): PermissionTableRow {
  return { name: row.key, canView: row.canView, canModify: row.canModify, canDelete: row.canDelete }
}

/** Principals not already granted, for the add-picker. */
export function remainingPrincipals(all: readonly string[], rows: readonly AclRow[]): string[] {
  const taken = new Set(rows.map((row) => row.key))
  return all.filter((name) => !taken.has(name))
}

/**
 * Apply one flag change, keeping the view/modify/delete lattice consistent.
 * Exported so callers that build rows outside the table (a "grant everything"
 * shortcut, say) get the same behaviour as a click.
 */
export function withFlag(rows: AclRow[], key: string, flag: AclFlag, value: boolean): AclRow[] {
  return rows.map((row) => {
    if (row.key !== key) return row
    const next = { ...row, [flag]: value }
    // Granting modify/delete is useless without view; revoking view revokes all.
    if (flag === 'canModify' && value) next.canView = true
    if (flag === 'canDelete' && value) next.canView = true
    if (flag === 'canView' && !value) {
      next.canModify = false
      next.canDelete = false
    }
    return next
  })
}

export interface PermissionMatrixProps {
  rows: AclRow[]
  onChange: (rows: AclRow[]) => void
  /** False renders every control disabled — a view-only operator still sees the ACL. */
  canEdit: boolean
  className?: string
}

export function PermissionMatrix({ rows, onChange, canEdit, className }: PermissionMatrixProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  if (rows.length === 0) {
    return (
      <div className={cn('py-6 text-center', className)}>
        <p className="text-sm text-muted-foreground">{t('permissions.empty')}</p>
        <p className="mt-1 text-xs text-muted-foreground/80">{t('permissions.emptyHint')}</p>
      </div>
    )
  }

  const flags: AclFlag[] = ['canView', 'canModify', 'canDelete']

  return (
    <div className={cn('-mx-4 overflow-x-auto px-4', className)}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t('permissions.title')}</caption>
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t('permissions.principal')}
            </th>
            {flags.map((flag) => (
              <th key={flag} scope="col" title={t(`permissions.flags.${flag}`)} className="px-3 py-2 text-center font-medium">
                {t(`permissions.${flag}`)}
              </th>
            ))}
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
              {flags.map((flag) => (
                <td key={flag} className="px-3 py-2">
                  <div className="flex justify-center">
                    <Checkbox
                      checked={row[flag]}
                      disabled={!canEdit}
                      aria-label={`${t(`permissions.${flag}`)}: ${row.key}`}
                      onCheckedChange={(value) => onChange(withFlag(rows, row.key, flag, value === true))}
                    />
                  </div>
                </td>
              ))}
              <td className="py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
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
      <p className="mt-2 text-xs text-muted-foreground">{t('permissions.flags.modifyImpliesView')}</p>
    </div>
  )
}

export interface PrincipalPickerProps {
  /** Principals that can still be added (already-granted ones are removed). */
  available: string[]
  placeholder: string
  onAdd: (key: string) => void
}

/**
 * Select + add button. The pending choice resets after every add so the same
 * principal cannot be granted twice, which the wire format would render as two
 * rows with the same name — the server keeps the last one and the UI would show
 * a duplicate that silently disagrees with what was saved.
 */
export function PrincipalPicker({ available, placeholder, onAdd }: PrincipalPickerProps) {
  const tc = useTranslations('common')
  const [pending, setPending] = React.useState(NOTHING)

  function commit() {
    if (!pending) return
    onAdd(pending)
    setPending(NOTHING)
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
      <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!pending}>
        <CirclePlus className="size-3.5" aria-hidden />
        {tc('actions.add')}
      </Button>
    </div>
  )
}
