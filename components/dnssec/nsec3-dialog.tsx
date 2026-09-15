'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowRightLeft, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState } from '@/components/app/states'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/api/client'
import { convertToNsec, convertToNsec3, updateNsec3Params } from '@/lib/api/domains/dnssec'
import type { NxProofType } from '@/lib/api/enums'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * NSEC / NSEC3 transitions — one dialog driving three different endpoints.
 *
 *  - `toNsec`   -> `zones/dnssec/convertToNsec`   (no parameters at all)
 *  - `toNsec3`  -> `zones/dnssec/convertToNsec3`  (iterations + saltLength)
 *  - `params`   -> `zones/dnssec/updateNsec3Params` (same two, re-signs in place)
 *
 * Traps encoded here:
 *
 *  - **`convertToNsec` takes no NSEC3 parameters**, so the two inputs are
 *    unmounted for that mode. Sending them anyway is harmless upstream but
 *    implies to the operator that they had an effect.
 *  - **Both bounds are one octet.** RFC 5155 puts the salt length and the
 *    iteration count in single bytes on the wire; 0–255 is the real ceiling.
 *    Iterations default to 0 per RFC 9276 — a non-zero count no longer buys
 *    meaningful offline-brute-force resistance and costs a hash per lookup.
 *  - **The salt itself is never sent, only its length.** The server generates
 *    fresh random salt bytes, so `nsec3Salt` is read here purely to pre-fill a
 *    length the operator is likely to want to keep. A non-hex salt ( Technitium
 *    may return `-` for "no salt") falls back to 8 octets.
 *  - Re-signing a zone is not atomic from a validator's point of view: every
 *    NSEC/NSEC3 change briefly leaves the zone unverifiable, hence the standing
 *    off-peak warning.
 */

/** RFC 5155: salt length and iteration count are each a single octet. */
const MAX_NSEC3_OCTET = 255

/** Fallback salt length when the current salt cannot be measured. */
const DEFAULT_SALT_LENGTH = 8

/** Which of the three endpoints the dialog is driving. */
export type Nsec3DialogMode = 'toNsec' | 'toNsec3' | 'params'

export interface Nsec3DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Nsec3DialogMode
  zone: string
  /** Current NSEC3 salt (hex); used only to derive a sensible salt length. */
  nsec3Salt?: string
  /** Current iteration count; seeds the field for `toNsec3` / `params`. */
  nsec3Iterations?: number
  onSaved: () => void
}

export function Nsec3Dialog({ open, onOpenChange, mode, zone, nsec3Salt, nsec3Iterations, onSaved }: Nsec3DialogProps) {
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
    () =>
      z.object({
        iterations: integerField(0, MAX_NSEC3_OCTET, numberMessages),
        saltLength: integerField(0, MAX_NSEC3_OCTET, numberMessages),
      }),
    [numberMessages],
  )

  type FormValues = z.infer<typeof schema>

  const defaults = React.useMemo<FormValues>(
    () => ({
      iterations: String(nsec3Iterations ?? 0),
      saltLength: String(saltLengthFrom(nsec3Salt)),
    }),
    [nsec3Iterations, nsec3Salt],
  )

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults })

  const run = useMutation({
    mutationFn: (values: FormValues) => {
      if (mode === 'toNsec') return convertToNsec(zone)
      const params = { zone, iterations: Number(values.iterations), saltLength: Number(values.saltLength) }
      return mode === 'toNsec3' ? convertToNsec3(params) : updateNsec3Params(params)
    },
    onSuccess: () => {
      if (mode === 'params') {
        toast.success(t('nsec3.paramsSuccess'))
      } else {
        const target: NxProofType = mode === 'toNsec' ? 'NSEC' : 'NSEC3'
        toast.success(t('nsec3.convertSuccess', { type: target }))
      }
      onSaved()
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  // Re-seed on every open rather than relying on `defaultValues`, which RHF only
  // reads once at mount — otherwise a second visit shows the previous attempt.
  React.useEffect(() => {
    if (open) form.reset(defaults)
  }, [open, defaults, form])

  function close() {
    onOpenChange(false)
    setTimeout(() => run.reset(), 0)
  }

  const showParams = mode !== 'toNsec'
  const title = mode === 'toNsec' ? t('nsec3.convertToNsec') : mode === 'toNsec3' ? t('nsec3.convertToNsec3') : t('nsec3.updateParams')
  const pendingLabel = mode === 'params' ? tc('actions.saving') : t('nsec3.converting')
  const Icon = mode === 'params' ? SlidersHorizontal : ArrowRightLeft

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <span className="font-data">{zone}</span> — {t('nsec3.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => run.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('nsec3.confirmConvert')}</AlertDescription>
          </Alert>

          <p className="text-xs text-muted-foreground">
            {mode === 'toNsec' ? t('nsec3.nsecHint') : t('nsec3.nsec3Hint')}
          </p>

          {showParams && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="nsec3-iterations" required>
                  {t('nsec3.iterations')}
                </FieldLabel>
                <Input
                  id="nsec3-iterations"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_NSEC3_OCTET}
                  className="font-data"
                  aria-invalid={Boolean(form.formState.errors.iterations)}
                  {...form.register('iterations')}
                />
                <FieldError>{form.formState.errors.iterations?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="nsec3-salt" required>
                  {t('nsec3.saltLength')}
                </FieldLabel>
                <Input
                  id="nsec3-salt"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_NSEC3_OCTET}
                  className="font-data"
                  aria-invalid={Boolean(form.formState.errors.saltLength)}
                  {...form.register('saltLength')}
                />
                <FieldDescription>{t('sign.saltLengthHelp')}</FieldDescription>
                <FieldError>{form.formState.errors.saltLength?.message}</FieldError>
              </Field>
            </div>
          )}

          {run.error ? <ErrorState error={run.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={run.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={run.isPending}>
              {!run.isPending && <Icon className="size-4" aria-hidden />}
              {run.isPending ? pendingLabel : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Salt length in octets from the hex salt the server reported. Technitium writes
 * `-` when the zone has no salt, and a hex string of length 2n for n octets.
 */
function saltLengthFrom(salt: string | undefined): number {
  if (!salt) return DEFAULT_SALT_LENGTH
  const trimmed = salt.trim()
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return DEFAULT_SALT_LENGTH
  return Math.min(MAX_NSEC3_OCTET, Math.round(trimmed.length / 2))
}
