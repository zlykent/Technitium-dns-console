'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ReservedLease } from '@/lib/api/types/dhcp'

/**
 * Add / edit dialog for a single DHCP reserved lease (static IP binding).
 *
 * The form collects address, hostname, hardware (MAC) address and comments.
 * Like the exclusion dialog it is purely local — the parent form serialises the
 * full list into Technitium's pipe-delimited format on save. MAC validation is
 * loose (accepts both `:` and `-` separators) because different OSes report
 * differently and the server normalises on its end.
 */

export interface ScopeStaticIpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled values when editing; `null` means "add new". */
  initial: ReservedLease | null
  /** Index in the parent list when editing, for replacement. */
  editIndex?: number
  onSave: (lease: ReservedLease, editIndex?: number) => void
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const MAC_RE = /^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$/

export function ScopeStaticIpDialog({ open, onOpenChange, initial, editIndex, onSave }: ScopeStaticIpDialogProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')

  const [address, setAddress] = React.useState(initial?.address ?? '')
  const [hostName, setHostName] = React.useState(initial?.hostName ?? '')
  const [hardwareAddress, setHardwareAddress] = React.useState(initial?.hardwareAddress ?? '')
  const [comments, setComments] = React.useState(initial?.comments ?? '')
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({})

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: Record<string, string | undefined> = {}
    if (!address.trim() || !IPV4_RE.test(address.trim())) nextErrors.address = tc('form.invalidIp')
    if (!hardwareAddress.trim() || !MAC_RE.test(hardwareAddress.trim())) nextErrors.hardwareAddress = t('tables.reservedLeases.invalidMac')
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSave(
      {
        address: address.trim(),
        hostName: hostName.trim(),
        hardwareAddress: hardwareAddress.trim(),
        comments: comments.trim(),
      },
      editIndex,
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? tc('actions.edit') : t('tables.reservedLeases.add')}</DialogTitle>
          <DialogDescription>{t('tables.reservedLeases.hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="res-address" required>
              {t('tables.reservedLeases.address')}
            </FieldLabel>
            <Input
              id="res-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('tables.reservedLeases.addressPlaceholder')}
              className="font-data"
              aria-invalid={Boolean(errors.address)}
              autoComplete="off"
            />
            <FieldError>{errors.address}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="res-hostname">
              {t('tables.reservedLeases.hostName')}
            </FieldLabel>
            <Input
              id="res-hostname"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder={t('tables.reservedLeases.hostNamePlaceholder')}
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="res-mac" required>
              {t('tables.reservedLeases.hardwareAddress')}
            </FieldLabel>
            <Input
              id="res-mac"
              value={hardwareAddress}
              onChange={(e) => setHardwareAddress(e.target.value)}
              placeholder={t('tables.reservedLeases.hardwareAddressPlaceholder')}
              className="font-data"
              aria-invalid={Boolean(errors.hardwareAddress)}
              autoComplete="off"
            />
            <FieldError>{errors.hardwareAddress}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="res-comments">
              {t('tables.reservedLeases.comments')}
            </FieldLabel>
            <Input
              id="res-comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit">{initial ? tc('actions.save') : tc('actions.add')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
