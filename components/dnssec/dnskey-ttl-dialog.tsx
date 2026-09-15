'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/api/client'
import { updateDnsKeyTtl } from '@/lib/api/domains/dnssec'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * DNSKEY TTL editor (`zones/dnssec/updateDnsKeyTtl`).
 *
 * Deliberately a single-field dialog rather than a row in the options page: the
 * TTL is part of the DNSSEC key-rollover contract, not a generic zone setting.
 * A resolver caches the DNSKEY RRset for this long, so lowering it *after* a KSK
 * has been published does not shorten the wait that is already in flight — the
 * warning copy exists because that is the mistake operators actually make.
 *
 * The value is held as a string in the form (Technitium takes query-string
 * parameters) and parsed on submit; the ceiling is the .NET `int` the server
 * stores it in.
 */

/** Technitium keeps `dnsKeyTtl` in a .NET `int`. */
const MAX_TTL = 2147483647

export interface DnsKeyTtlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zone: string
  /** Current TTL in seconds — seeds the field each time the dialog opens. */
  ttl: number
  onSaved: () => void
}

export function DnsKeyTtlDialog({ open, onOpenChange, zone, ttl, onSaved }: DnsKeyTtlDialogProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')

  const numberMessages = React.useMemo<NumberFieldMessages>(
    () => ({
      invalid: tc('form.invalidNumber'),
      tooSmall: (min) => tc('form.minValue', { min }),
      tooBig: (max) => tc('form.maxValue', { max }),
    }),
    [tc],
  )

  const schema = React.useMemo(
    () => z.object({ ttl: integerField(1, MAX_TTL, numberMessages) }),
    [numberMessages],
  )

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ttl: String(ttl) },
  })

  // `defaultValues` is only read on mount, so an operator who changes the TTL,
  // closes and reopens would otherwise see the value they typed rather than the
  // one now on the server.
  React.useEffect(() => {
    if (open) form.reset({ ttl: String(ttl) })
  }, [open, ttl, form])

  const save = useMutation({
    mutationFn: (value: number) => updateDnsKeyTtl({ zone, ttl: value }),
    onSuccess: (_data, value) => {
      toast.success(t('dnsKeyTtl.success', { ttl: value }))
      onSaved()
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => save.reset(), 0)
  }

  function onSubmit(values: FormValues) {
    save.mutate(Number(values.ttl))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dnsKeyTtl.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-data">{zone}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="dnskey-ttl" required>
              {t('dnsKeyTtl.label')}
            </FieldLabel>
            <Input
              id="dnskey-ttl"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TTL}
              className="font-data"
              aria-invalid={Boolean(form.formState.errors.ttl)}
              {...form.register('ttl')}
            />
            <FieldDescription>{t('dnsKeyTtl.help')}</FieldDescription>
            <FieldError>{form.formState.errors.ttl?.message}</FieldError>
          </Field>

          {save.error ? <ErrorState error={save.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {save.isPending ? tc('actions.saving') : tc('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
