'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
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
import { signZone } from '@/lib/api/domains/dnssec'
import {
  ECDSA_CURVES,
  EDDSA_CURVES,
  KEY_GENERATION_MODES,
  NX_PROOF_TYPES,
  RSA_HASH_ALGORITHMS,
  RSA_KEY_SIZES,
  SIGNING_ALGORITHMS,
  type EcdsaCurve,
  type EddsaCurve,
  type KeyGenerationMode,
  type NxProofType,
  type RsaKeySize,
  type ZoneType,
} from '@/lib/api/enums'
import type { SignZoneParams } from '@/lib/api/types/dnssec'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * Sign-zone dialog.
 *
 * `zones/dnssec/sign` flattens the parameters of all three signing algorithms
 * into one endpoint, so the visible fields depend on `algorithm`:
 *
 *   RSA    -> hashAlgorithm + kskKeySize + zskKeySize
 *   ECDSA  -> curve (P256 | P384)
 *   EDDSA  -> curve (ED25519 | ED448)
 *
 * Traps encoded here:
 *
 *  - **There is no "generation mode" parameter upstream.** Leaving
 *    `pemKskPrivateKey` / `pemZskPrivateKey` off the request *is* what asks the
 *    server to generate the key, so the Automatic/UseSpecified radio only
 *    decides whether the PEM textareas render and whether the values are sent.
 *  - **`iterations` / `saltLength` are sent only for NSEC3.** Posting them with
 *    `nxProof=NSEC` makes Technitium reject the call.
 *  - **Numeric bounds are RFC 5155's, not ours.** NSEC3 iterations and salt
 *    length are each a single octet on the wire, so 0–255 is the honest ceiling;
 *    iterations default to 0 per RFC 9276 (a non-zero count no longer buys
 *    meaningful offline-brute-force resistance).
 *  - PEM material is write-only: it is never re-read from the server, never
 *    logged, and the field is cleared on close so it does not survive in the
 *    form's reset snapshot.
 */

/** DNSKEY TTL ceiling: Technitium stores it in a .NET `int`. */
const MAX_TTL = 2147483647

/** RFC 5155: NSEC3 iterations and salt length are each one octet. */
const MAX_NSEC3_OCTET = 255

/** Upper bound for the ZSK rollover period, in days. */
const MAX_ROLLOVER_DAYS = 3650

export interface SignZoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zone: string
  /** Only `Primary` zones can be signed; anything else disables the submit. */
  zoneType: ZoneType
  /** Seeds the DNSKEY TTL field with the zone's current value. */
  defaultDnsKeyTtl: number
  /** Called after a successful sign so the parent can invalidate its caches. */
  onSigned: () => void
}

export function SignZoneDialog({ open, onOpenChange, zone, zoneType, defaultDnsKeyTtl, onSigned }: SignZoneDialogProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')

  // Pre-resolved copy: next-intl's translator is `Translator<Messages, Namespace>`
  // and is not assignable to a plain call signature under `strictFunctionTypes`.
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
          algorithm: z.enum(SIGNING_ALGORITHMS),
          hashAlgorithm: z.enum(RSA_HASH_ALGORITHMS),
          kskKeySize: z.string(),
          zskKeySize: z.string(),
          curve: z.string(),
          generationMode: z.enum(KEY_GENERATION_MODES),
          pemKsk: pemField(t('sign.pemInvalid')),
          pemZsk: pemField(t('sign.pemInvalid')),
          dnsKeyTtl: integerField(1, MAX_TTL, numberMessages),
          zskRolloverDays: integerField(0, MAX_ROLLOVER_DAYS, numberMessages),
          nxProof: z.enum(NX_PROOF_TYPES),
          iterations: integerField(0, MAX_NSEC3_OCTET, numberMessages),
          saltLength: integerField(0, MAX_NSEC3_OCTET, numberMessages),
        })
        .superRefine((data, ctx) => {
          // "Use my PEM private key" makes both blocks mandatory; Automatic mode
          // leaves them blank, which is how the server is told to generate them.
          // `pemField` already rejects a malformed non-empty block.
          if (data.generationMode === 'UseSpecified') {
            for (const path of ['pemKsk', 'pemZsk'] as const) {
              if (!data[path].trim()) {
                ctx.addIssue({ code: 'custom', path: [path], message: t('sign.pemInvalid') })
              }
            }
          }
        }),
    [t, numberMessages],
  )

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      algorithm: 'ECDSA',
      hashAlgorithm: 'SHA256',
      kskKeySize: '2048',
      zskKeySize: '1024',
      curve: 'P256',
      generationMode: 'Automatic',
      pemKsk: '',
      pemZsk: '',
      dnsKeyTtl: String(defaultDnsKeyTtl),
      zskRolloverDays: '30',
      nxProof: 'NSEC3',
      iterations: '0',
      saltLength: '8',
    },
  })

  const algorithm = useWatch({ control: form.control, name: 'algorithm' })
  const generationMode = useWatch({ control: form.control, name: 'generationMode' })
  const nxProof = useWatch({ control: form.control, name: 'nxProof' })

  // The curve list changes with the algorithm; keeping a stale `P256` while
  // EDDSA is selected would post a value the server cannot map to a curve.
  React.useEffect(() => {
    if (algorithm === 'ECDSA') form.setValue('curve', 'P256')
    else if (algorithm === 'EDDSA') form.setValue('curve', 'ED25519')
  }, [algorithm, form])

  const sign = useMutation({
    mutationFn: (params: SignZoneParams) => signZone(params),
    onSuccess: () => {
      toast.success(t('sign.success', { zone }))
      onSigned()
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    // Reset after the close animation starts so a reopen is always clean, and so
    // the pasted PEM never outlives the dialog.
    setTimeout(() => {
      form.reset()
      sign.reset()
    }, 0)
  }

  function onSubmit(values: FormValues) {
    const params: SignZoneParams = {
      zone,
      algorithm: values.algorithm,
      dnsKeyTtl: Number(values.dnsKeyTtl),
      zskRolloverDays: Number(values.zskRolloverDays),
      nxProof: values.nxProof,
    }

    if (values.algorithm === 'RSA') {
      params.hashAlgorithm = values.hashAlgorithm
      params.kskKeySize = Number(values.kskKeySize) as RsaKeySize
      params.zskKeySize = Number(values.zskKeySize) as RsaKeySize
    } else {
      params.curve = values.curve as EcdsaCurve | EddsaCurve
    }

    if (values.generationMode === 'UseSpecified') {
      params.pemKskPrivateKey = values.pemKsk.trim()
      params.pemZskPrivateKey = values.pemZsk.trim()
    }

    if (values.nxProof === 'NSEC3') {
      params.iterations = Number(values.iterations)
      params.saltLength = Number(values.saltLength)
    }

    sign.mutate(params)
  }

  const primary = zoneType === 'Primary'
  const specified = generationMode === 'UseSpecified'
  const curves = algorithm === 'EDDSA' ? EDDSA_CURVES : ECDSA_CURVES

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('sign.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-data">{zone}</span> — {t('sign.subtitle')}
          </DialogDescription>
        </DialogHeader>

        {!primary && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('sign.requiresPrimary')}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="sz-algorithm">{t('sign.algorithm')}</FieldLabel>
            <Controller
              control={form.control}
              name="algorithm"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="sz-algorithm">
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

          {algorithm === 'RSA' ? (
            <>
              <Field>
                <FieldLabel htmlFor="sz-hash">{t('sign.hashAlgorithm')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="hashAlgorithm"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="sz-hash">
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
                <FieldDescription>{t('sign.hashAlgorithmHelp')}</FieldDescription>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <KeySizeField
                  id="sz-ksk-size"
                  label={t('sign.kskKeySize')}
                  control={form.control}
                  name="kskKeySize"
                />
                <KeySizeField
                  id="sz-zsk-size"
                  label={t('sign.zskKeySize')}
                  control={form.control}
                  name="zskKeySize"
                />
              </div>
              <FieldDescription className="-mt-2 text-xs">{t('sign.keySizeHelp')}</FieldDescription>
            </>
          ) : (
            <Field>
              <FieldLabel htmlFor="sz-curve">{t('sign.curve')}</FieldLabel>
              <Controller
                control={form.control}
                name="curve"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="sz-curve">
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
                  {KEY_GENERATION_MODES.map((mode) => (
                    <div key={mode} className="flex items-center gap-2">
                      <RadioGroupItem value={mode} id={`sz-mode-${mode}`} />
                      <Label htmlFor={`sz-mode-${mode}`}>{generationLabel(mode, t)}</Label>
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
                <FieldLabel htmlFor="sz-pem-ksk" required>
                  {t('sign.pemKsk')}
                </FieldLabel>
                <Textarea
                  id="sz-pem-ksk"
                  className="font-data"
                  rows={5}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(form.formState.errors.pemKsk)}
                  {...form.register('pemKsk')}
                />
                <FieldDescription>{t('sign.pemHelp')}</FieldDescription>
                <FieldError>{form.formState.errors.pemKsk?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="sz-pem-zsk" required>
                  {t('sign.pemZsk')}
                </FieldLabel>
                <Textarea
                  id="sz-pem-zsk"
                  className="font-data"
                  rows={5}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(form.formState.errors.pemZsk)}
                  {...form.register('pemZsk')}
                />
                <FieldError>{form.formState.errors.pemZsk?.message}</FieldError>
              </Field>
            </>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="sz-ttl" required>
                {t('sign.dnsKeyTtl')}
              </FieldLabel>
              <Input
                id="sz-ttl"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TTL}
                className="font-data"
                aria-invalid={Boolean(form.formState.errors.dnsKeyTtl)}
                {...form.register('dnsKeyTtl')}
              />
              <FieldDescription>{t('sign.dnsKeyTtlHelp')}</FieldDescription>
              <FieldError>{form.formState.errors.dnsKeyTtl?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="sz-rollover" required>
                {t('sign.zskRolloverDays')}
              </FieldLabel>
              <Input
                id="sz-rollover"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_ROLLOVER_DAYS}
                className="font-data"
                aria-invalid={Boolean(form.formState.errors.zskRolloverDays)}
                {...form.register('zskRolloverDays')}
              />
              <FieldDescription>{t('sign.zskRolloverDaysHelp')}</FieldDescription>
              <FieldError>{form.formState.errors.zskRolloverDays?.message}</FieldError>
            </Field>
          </div>

          <Field>
            <FieldLabel>{t('sign.nxProof')}</FieldLabel>
            <Controller
              control={form.control}
              name="nxProof"
              render={({ field }) => (
                <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                  {NX_PROOF_TYPES.map((value: NxProofType) => (
                    <div key={value} className="flex items-center gap-2">
                      <RadioGroupItem value={value} id={`sz-nx-${value}`} />
                      <Label htmlFor={`sz-nx-${value}`} className="font-data font-normal">
                        {value}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            />
            <FieldDescription>{t('sign.nxProofHelp')}</FieldDescription>
          </Field>

          {nxProof === 'NSEC3' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sz-iterations" required>
                  {t('sign.iterations')}
                </FieldLabel>
                <Input
                  id="sz-iterations"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_NSEC3_OCTET}
                  className="font-data"
                  aria-invalid={Boolean(form.formState.errors.iterations)}
                  {...form.register('iterations')}
                />
                <FieldDescription>{t('sign.iterationsHelp')}</FieldDescription>
                <FieldError>{form.formState.errors.iterations?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="sz-salt" required>
                  {t('sign.saltLength')}
                </FieldLabel>
                <Input
                  id="sz-salt"
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

          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('sign.warning')}</AlertDescription>
          </Alert>

          {sign.error ? <ErrorState error={sign.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={sign.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={sign.isPending} disabled={!primary}>
              {!sign.isPending && <ShieldCheck className="size-4" aria-hidden />}
              {sign.isPending ? t('sign.signing') : t('sign.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * RSA key-size picker. `RSA_KEY_SIZES` holds numbers, and Radix `Select` values
 * must be strings, so the option value is stringified and parsed back on submit.
 *
 * Generic over the form shape because `Control` is invariant in its type
 * parameter — typing it as `Control<FieldValues>` makes the concrete
 * `Control<FormValues>` from the caller unassignable.
 */
function KeySizeField<TFieldValues extends FieldValues>({
  id,
  label,
  control,
  name,
}: {
  id: string
  label: string
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={id}>
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
    </Field>
  )
}

/** Wire value -> `sign.generation*` label. */
function generationLabel(mode: KeyGenerationMode, t: (key: string) => string): string {
  return mode === 'Automatic' ? t('sign.generationAuto') : t('sign.generationSpecified')
}
