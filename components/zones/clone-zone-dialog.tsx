'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Copy } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/api/client'
import { cloneZone } from '@/lib/api/domains/zones'
import { queryKeys } from '@/lib/api/query-keys'
import type { ZoneSummary } from '@/lib/api/types/zones'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Clone-zone dialog.
 *
 * Two fields only, so it uses plain controlled state rather than
 * react-hook-form (`docs/page-patterns.md`: RHF is for >3 fields). The source
 * zone is fixed by whichever row opened the dialog and shown read-only; the
 * operator only names the copy.
 *
 * `zones/clone` reads `cloneZone(zone, sourceZone)` where `zone` is the **new**
 * name and `sourceZone` the existing one — the argument order is the reverse of
 * what the English reads, so it is worth the comment.
 */

export interface CloneZoneDialogProps {
  /** The zone being cloned; `null` keeps the dialog closed. */
  zone: ZoneSummary | null
  onOpenChange: (open: boolean) => void
}

export function CloneZoneDialog({ zone, onOpenChange }: CloneZoneDialogProps) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const [name, setName] = React.useState('')
  const open = Boolean(zone)

  // Reset the input each time a different source row opens the dialog. Done as
  // a render-phase adjustment (React's documented "adjust state when a value
  // changes" idiom) rather than an effect, so the field is already empty on the
  // first paint instead of a frame later.
  const [prevZone, setPrevZone] = React.useState<string | null>(null)
  const zoneName = zone?.name ?? null
  if (zoneName !== prevZone) {
    setPrevZone(zoneName)
    setName('')
  }

  const mutate = useMutation({
    mutationFn: (newName: string) => cloneZone(newName, zone?.name ?? ''),
    onSuccess: (_r, newName) => {
      toast.success(t('actions.cloneSuccess', { zone: newName }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
      onOpenChange(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    mutate.mutate(trimmed)
  }

  const invalid = name.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('actions.cloneTitle')}</DialogTitle>
          <DialogDescription>{t('actions.cloneHint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="clone-source">{t('actions.cloneSourceLabel')}</FieldLabel>
            <Input id="clone-source" className="font-data" value={zone?.name ?? ''} readOnly disabled />
          </Field>

          <Field>
            <FieldLabel htmlFor="clone-name" required>
              {t('actions.cloneZoneLabel')}
            </FieldLabel>
            <Input
              id="clone-name"
              className="font-data"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('create.zonePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid && name.length > 0 ? true : undefined}
            />
            <FieldDescription>{t('create.zoneHelp')}</FieldDescription>
            {invalid && name.length > 0 ? <FieldError>{tc('form.required')}</FieldError> : null}
          </Field>

          {mutate.error ? <ErrorState error={mutate.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={mutate.isPending} disabled={invalid}>
              {!mutate.isPending && <Copy className="size-4" aria-hidden />}
              {mutate.isPending ? tc('actions.creating') : t('actions.clone')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
