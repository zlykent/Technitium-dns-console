'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { KeyRound, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState } from '@/components/app/states'
import { pemField } from '@/components/dnssec/validation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { addPrivateKey, updatePrivateKey } from '@/lib/api/domains/dnssec'
import {
  ECDSA_CURVES,
  EDDSA_CURVES,
  KEY_GENERATION_MODES,
  KEY_TYPES,
  RSA_HASH_ALGORITHMS,
  RSA_KEY_SIZES,
  SIGNING_ALGORITHMS,
  type DnssecKeyType,
  type EcdsaCurve,
  type EddsaCurve,
  type RsaKeySize,
} from '@/lib/api/enums'
import type { AddPrivateKeyParams } from '@/lib/api/types/dnssec'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * Add / update a DNSSEC private key.
 *
 * Two very different endpoints share this dialog because the console presents
 * them as one "manage key" gesture:
 *
 *   add    -> `zones/dnssec/addPrivateKey`    keyType + algorithm + sizes + PEM
 *   update -> `zones/dnssec/updatePrivateKey` **rolloverDays only**
 *
 * Traps encoded here:
 *
 *  - **`updatePrivateKey` cannot change the algorithm, the key type or the PEM
 *    block.** It is a rollover-schedule editor keyed by `keyTag`, so the update
 *    mode hides every other control rather than rendering inputs that would be
 *    silently dropped upstream.
 *  - As with signing, **there is no "generation mode" parameter**: omitting
 *    `pemPrivateKey` is what asks Technitium to generate the key. The radio only
 *    decides whether the textarea renders and whether the value is sent.
 *  - `algorithm` again selects the size parameters — RSA wants `hashAlgorithm` +
 *    `keySize` (note: a single `keySize` here, unlike signing's KSK/ZSK pair),
 *    ECDSA/EDDSA want `curve`.
 *  - The PEM textarea is write-only: never read back, never logged, and cleared
 *    on close so it does not linger in the form's reset snapshot.
 */

/** Upper bound for a key rollover period, in days. */
const MAX_ROLLOVER_DAYS = 3650

/** `add` collects a full key spec; `update` only edits the rollover schedule. */
export type PrivateKeyDialogMode = { kind: 'add' } | { kind: 'update'; keyTag: number; rolloverDays: number }

export interface AddPrivateKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zone: string
  mode: PrivateKeyDialogMode
  onSaved: () => void
}

export function AddPrivateKeyDialog({ open, onOpenChange, zone, mode, onSaved }: AddPrivateKeyDialogProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')

  const isUpdate = mode.kind === 'update'

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
      z
        .object({
          keyType: z.enum(KEY_TYPES),
          algorithm: z.enum(SIGNING_ALGORITHMS),
          hashAlgorithm: z.enum(RSA_HASH_ALGORITHMS),
          keySize: z.string(),
          curve: z.string(),
          generationMode: z.enum(KEY_GENERATION_MODES),
          pemPrivateKey: pemField(t('sign.pemInvalid')),
          rolloverDays: integerField(0, MAX_ROLLOVER_DAYS, numberMessages),
        })
        .superRefine((data, ctx) => {
          if (data.generationMode === 'UseSpecified' && !data.pemPrivateKey.trim()) {
            ctx.addIssue({ code: 'custom', path: ['pemPrivateKey'], message: t('sign.pemInvalid') })
          }
        }),
    [t, numberMessages],
  )

  type FormValues = z.infer<typeof schema>

  const defaults = React.useMemo<FormValues>(
    () => ({
      keyType: 'ZoneSigningKey',
      algorithm: 'ECDSA',
      hashAlgorithm: 'SHA256',
      keySize: '2048',
      curve: 'P256',
      generationMode: 'Automatic',
      pemPrivateKey: '',
      rolloverDays: String(isUpdate && mode.kind === 'update' ? mode.rolloverDays : 30),
    }),
    [isUpdate, mode],
  )

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults })

  const algorithm = useWatch({ control: form.control, name: 'algorithm' })
  const generationMode = useWatch({ control: form.control, name: 'generationMode' })

  // The curve list depends on the algorithm; a stale `P256` under EDDSA would be
  // posted as a value the server cannot map.
  React.useEffect(() => {
    if (algorithm === 'ECDSA') form.setValue('curve', 'P256')
    else if (algorithm === 'EDDSA') form.setValue('curve', 'ED25519')
  }, [algorithm, form])

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const rolloverDays = Number(values.rolloverDays)
      if (mode.kind === 'update') return updatePrivateKey({ zone, keyTag: mode.keyTag, rolloverDays })

      const params: AddPrivateKeyParams = {
        zone,
        keyType: values.keyType as DnssecKeyType,
        algorithm: values.algorithm,
        rolloverDays,
      }
      if (values.algorithm === 'RSA') {
        params.hashAlgorithm = values.hashAlgorithm
        params.keySize = Number(values.keySize) as RsaKeySize
      } else {
        params.curve = values.curve as EcdsaCurve | EddsaCurve
      }
      if (values.generationMode === 'UseSpecified') params.pemPrivateKey = values.pemPrivateKey.trim()
      return addPrivateKey(params)
    },
    onSuccess: () => {
      toast.success(isUpdate ? t('keys.updateRolloverSuccess') : t('keys.addSuccess'))
      onSaved()
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  // Re-seed on every open: `defaultValues` is read once at mount, so without
  // this a second "edit rollover" on a different key would show the first one.
  React.useEffect(() => {
    if (open) form.reset(defaults)
  }, [open, defaults, form])

  function close() {
    onOpenChange(false)
    // Deferred so the close animation is not interrupted, and so pasted PEM
    // material never survives the dialog.
    setTimeout(() => {
      form.reset(defaults)
      save.reset()
    }, 0)
  }

  const curves = algorithm === 'EDDSA' ? EDDSA_CURVES : ECDSA_CURVES
  const specified = generationMode === 'UseSpecified'
  const title = isUpdate ? t('keys.updateRolloverTitle') : t('keys.addTitle')

  let submitLabel: string
  if (isUpdate) submitLabel = save.isPending ? tc('actions.saving') : tc('actions.save')
  else submitLabel = save.isPending ? t('keys.adding') : t('keys.add')

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <span className="font-data">{zone}</span>
            {mode.kind === 'update' && (
              <>
                {' — '}
                {t('keys.columns.keyTag')} <span className="font-data">{mode.keyTag}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4" noValidate>
          {!isUpdate && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="apk-key-type">{t('keys.keyType')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="keyType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="apk-key-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {KEY_TYPES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`keys.keyTypes.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="apk-algorithm">{t('keys.algorithm')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="algorithm"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="apk-algorithm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SIGNING_ALGORITHMS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>{t('sign.algorithmHelp')}</FieldDescription>
                </Field>
              </div>

              {algorithm === 'RSA' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="apk-hash">{t('sign.hashAlgorithm')}</FieldLabel>
                    <Controller
                      control={form.control}
                      name="hashAlgorithm"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="apk-hash">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RSA_HASH_ALGORITHMS.map((value) => (
                              <SelectItem key={value} value={value}>
                                {value}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="apk-key-size">{t('keys.keySize')}</FieldLabel>
                    <Controller
                      control={form.control}
                      name="keySize"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="apk-key-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RSA_KEY_SIZES.map((size) => (
                              <SelectItem key={size} value={String(size)} className="font-data">
                                {String(size)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldDescription>{t('sign.keySizeHelp')}</FieldDescription>
                  </Field>
                </div>
              ) : (
                <Field>
                  <FieldLabel htmlFor="apk-curve">{t('sign.curve')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="curve"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="apk-curve">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {curves.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>{t('sign.curveHelp')}</FieldDescription>
                </Field>
              )}

              <Field>
                <FieldLabel>{t('sign.generationMode')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="generationMode"
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                      {KEY_GENERATION_MODES.map((value) => (
                        <div key={value} className="flex items-center gap-2">
                          <RadioGroupItem value={value} id={`apk-mode-${value}`} />
                          <Label htmlFor={`apk-mode-${value}`}>
                            {value === 'Automatic' ? t('sign.generationAuto') : t('sign.generationSpecified')}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}
                />
              </Field>

              {specified && (
                <>
                  <Alert variant="info">
                    <TriangleAlert aria-hidden />
                    <AlertDescription>{t('pemSecret')}</AlertDescription>
                  </Alert>

                  <Field>
                    <FieldLabel htmlFor="apk-pem" required>
                      {t('keys.pemPrivateKey')}
                    </FieldLabel>
                    <Textarea
                      id="apk-pem"
                      className="font-data"
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={Boolean(form.formState.errors.pemPrivateKey)}
                      {...form.register('pemPrivateKey')}
                    />
                    <FieldDescription>{t('keys.pemHelp')}</FieldDescription>
                    <FieldError>{form.formState.errors.pemPrivateKey?.message}</FieldError>
                  </Field>
                </>
              )}
            </>
          )}

          <Field>
            <FieldLabel htmlFor="apk-rollover" required>
              {t('keys.rolloverDays')}
            </FieldLabel>
            <Input
              id="apk-rollover"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_ROLLOVER_DAYS}
              className="font-data"
              aria-invalid={Boolean(form.formState.errors.rolloverDays)}
              {...form.register('rolloverDays')}
            />
            <FieldDescription>{t('keys.rolloverDaysHelp')}</FieldDescription>
            <FieldError>{form.formState.errors.rolloverDays?.message}</FieldError>
          </Field>

          {save.error ? <ErrorState error={save.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {!save.isPending && !isUpdate && <KeyRound className="size-4" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
