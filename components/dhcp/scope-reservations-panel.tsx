'use client'

import { useTranslations } from 'next-intl'
import { CirclePlus, Pencil, Trash } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScopeStaticIpDialog } from '@/components/dhcp/scope-static-ip-dialog'
import type { ReservedLease } from '@/lib/api/types/dhcp'

/**
 * Editable sub-table of DHCP reserved leases (static IP bindings).
 *
 * Same ownership model as the exclusions panel: the parent scope form holds the
 * canonical list and this component only emits intents. Reserved leases carry
 * four columns — address, hostname, hardware address and comments — matching
 * Technitium's pipe-delimited wire format exactly (4 columns per row).
 */

export interface ScopeReservationsPanelProps {
  reservations: ReservedLease[]
  onChange: (next: ReservedLease[]) => void
  disabled?: boolean
}

export function ScopeReservationsPanel({ reservations, onChange, disabled = false }: ScopeReservationsPanelProps) {
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
    onChange(reservations.filter((_, i) => i !== index))
  }

  function handleSave(lease: ReservedLease, idx?: number) {
    if (idx !== undefined && idx !== null) {
      const next = [...reservations]
      next[idx] = lease
      onChange(next)
    } else {
      onChange([...reservations, lease])
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{t('tables.reservedLeases.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('tables.reservedLeases.hint')}</p>
        </div>
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <CirclePlus className="size-3.5" aria-hidden />
            {t('tables.reservedLeases.add')}
          </Button>
        )}
      </div>

      {reservations.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">{t('tables.reservedLeases.empty')}</p>
      ) : (
        <div className="surface overflow-hidden rounded-md">
          <Table aria-label={t('tables.reservedLeases.title')}>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 py-2 text-xs">{t('tables.reservedLeases.address')}</TableHead>
                <TableHead className="px-3 py-2 text-xs">{t('tables.reservedLeases.hostName')}</TableHead>
                <TableHead className="px-3 py-2 text-xs">{t('tables.reservedLeases.hardwareAddress')}</TableHead>
                <TableHead className="px-3 py-2 text-xs">{t('tables.reservedLeases.comments')}</TableHead>
                {!disabled && <TableHead className="w-20 px-3 py-2 text-right text-xs">{tc('fields.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((lease, index) => (
                <TableRow key={`${lease.address}-${lease.hardwareAddress}-${index}`}>
                  <TableCell className="font-data px-3 py-2 text-sm">{lease.address}</TableCell>
                  <TableCell className="px-3 py-2 text-sm">{lease.hostName || '—'}</TableCell>
                  <TableCell className="font-data px-3 py-2 text-sm">{lease.hardwareAddress}</TableCell>
                  <TableCell className="px-3 py-2 text-sm text-muted-foreground">{lease.comments || '—'}</TableCell>
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

      <ScopeStaticIpDialog
        key={nonce}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editIndex !== null ? reservations[editIndex] : null}
        editIndex={editIndex ?? undefined}
        onSave={handleSave}
      />
    </div>
  )
}
