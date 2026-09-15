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
import type { AddressExclusion } from '@/lib/api/types/dhcp'

/**
 * Add / edit dialog for a single DHCP scope exclusion range.
 *
 * Validation is intentionally minimal — only "both fields non-empty and look
 * like IPv4" — because the server performs the authoritative range check
 * against the scope's subnet. The dialog never fires a network request; it
 * returns the edited row to the parent form which serialises the full list
 * on save.
 */

export interface ScopeExclusionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled values when editing; `null` means "add new". */
  initial: AddressExclusion | null
  onSave: (exclusion: AddressExclusion) => void
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

export function ScopeExclusionDialog({ open, onOpenChange, initial, onSave }: ScopeExclusionDialogProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')

  const [start, setStart] = React.useState(initial?.startingAddress ?? '')
  const [end, setEnd] = React.useState(initial?.endingAddress ?? '')
  const [errors, setErrors] = React.useState<{ start?: string; end?: string }>({})

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: { start?: string; end?: string } = {}
    if (!start.trim() || !IPV4_RE.test(start.trim())) nextErrors.start = tc('form.invalidIp')
    if (!end.trim() || !IPV4_RE.test(end.trim())) nextErrors.end = tc('form.invalidIp')
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSave({ startingAddress: start.trim(), endingAddress: end.trim() })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? tc('actions.edit') : t('tables.exclusions.add')}</DialogTitle>
          <DialogDescription>{t('tables.exclusions.hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="excl-start" required>
              {t('tables.exclusions.startingAddress')}
            </FieldLabel>
            <Input
              id="excl-start"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={t('tables.exclusions.startingAddressPlaceholder')}
              className="font-data"
              aria-invalid={Boolean(errors.start)}
              autoComplete="off"
            />
            <FieldError>{errors.start}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="excl-end" required>
              {t('tables.exclusions.endingAddress')}
            </FieldLabel>
            <Input
              id="excl-end"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder={t('tables.exclusions.endingAddressPlaceholder')}
              className="font-data"
              aria-invalid={Boolean(errors.end)}
              autoComplete="off"
            />
            <FieldError>{errors.end}</FieldError>
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
