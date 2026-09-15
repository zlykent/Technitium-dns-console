'use client'

import { useTranslations } from 'next-intl'
import { CirclePlus, Pencil, Trash } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScopeExclusionDialog } from '@/components/dhcp/scope-exclusion-dialog'
import type { AddressExclusion } from '@/lib/api/types/dhcp'

/**
 * Editable sub-table of DHCP scope exclusion ranges.
 *
 * Lives inside the scope form dialog. The parent owns the canonical list; this
 * component emits add/edit/remove intents via `onChange` so the form can track
 * dirty state. Each row is keyed by its index because Technitium does not
 * assign stable IDs to exclusion entries — renaming one would require a
 * positional diff, which is overkill for a list that rarely exceeds a handful.
 */

export interface ScopeExclusionsPanelProps {
  exclusions: AddressExclusion[]
  onChange: (next: AddressExclusion[]) => void
  disabled?: boolean
}

export function ScopeExclusionsPanel({ exclusions, onChange, disabled = false }: ScopeExclusionsPanelProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editIndex, setEditIndex] = React.useState<number | null>(null)
  // Bumped on every open so the dialog remounts with fresh field state;
  // keyed on the nonce (not `dialogOpen`) to preserve Radix's exit animation.
  const [nonce, setNonce] = React.useState(0)

  function handleAdd() {
    setEditIndex(null)
    setNonce((n) => n + 1)
    setDialogOpen(true)
  }

  function handleEdit(index: number) {
    setEditIndex(index)
    setNonce((n) => n + 1)
    setDialogOpen(true)
  }

  function handleRemove(index: number) {
    onChange(exclusions.filter((_, i) => i !== index))
  }

  function handleSave(exclusion: AddressExclusion) {
    if (editIndex !== null) {
      const next = [...exclusions]
      next[editIndex] = exclusion
      onChange(next)
    } else {
      onChange([...exclusions, exclusion])
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{t('tables.exclusions.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('tables.exclusions.hint')}</p>
        </div>
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <CirclePlus className="size-3.5" aria-hidden />
            {t('tables.exclusions.add')}
          </Button>
        )}
      </div>

      {exclusions.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">{t('tables.exclusions.empty')}</p>
      ) : (
        <div className="surface overflow-hidden rounded-md">
          <Table aria-label={t('tables.exclusions.title')}>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 py-2 text-xs">{t('tables.exclusions.startingAddress')}</TableHead>
                <TableHead className="px-3 py-2 text-xs">{t('tables.exclusions.endingAddress')}</TableHead>
                {!disabled && <TableHead className="w-20 px-3 py-2 text-right text-xs">{tc('fields.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {exclusions.map((excl, index) => (
                <TableRow key={`${excl.startingAddress}-${excl.endingAddress}-${index}`}>
                  <TableCell className="font-data px-3 py-2 text-sm">{excl.startingAddress}</TableCell>
                  <TableCell className="font-data px-3 py-2 text-sm">{excl.endingAddress}</TableCell>
                  {!disabled && (
                    <TableCell className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button type="button" variant="ghost" size="icon-xs" onClick={() => handleEdit(index)} aria-label={tc('actions.edit')}>
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRemove(index)}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={tc('actions.delete')}
                        >
                          <Trash className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ScopeExclusionDialog
        key={nonce}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editIndex !== null ? exclusions[editIndex] : null}
        onSave={handleSave}
      />
    </div>
  )
}
