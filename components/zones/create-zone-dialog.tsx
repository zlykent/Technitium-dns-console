'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Upload } from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch, Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { listCatalogZones, createZone } from '@/lib/api/domains/zones'
import { getTsigKeyNames } from '@/lib/api/domains/settings'
import {
  CREATABLE_ZONE_TYPES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
  ZONE_TRANSFER_PROTOCOLS,
  type CreatableZoneType,
} from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import type { CreateZoneParams } from '@/lib/api/types/zones'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Create-zone dialog.
 *
 * One form drives every zone type, which is why it looks large: Technitium's
 * `zones/create` flattens the parameters of all seven kinds into one endpoint,
 * and the visible fields change with `type`. The gotchas encoded here:
 *
 *  - Secondary / Stub / SecondaryRoot / Secondary* zones require at least one
 *    primary name server (a `<textarea>`, one address per line) — the server
 *    rejects the call without it, so we validate before submitting.
 *  - Forwarder zones take an upstream address plus the whole proxy block; the
 *    proxy fields only matter once a proxy type is chosen. A forwarder may also
 *    be "this server" (Technitium models that as a null forwarder, i.e. resolve
 *    recursively in-process), which is what the `forwarderThisServer` switch
 *    sends — the parameter is then omitted entirely rather than sent empty.
 *  - Every parameter travels in the query string; only the optional zone file
 *    goes in a multipart body (handled inside `createZone`).
 *
 * The `<File>` cannot live in the zod schema (not serialisable), so it is kept
 * in local state and merged into the params on submit.
 */

const NEEDS_PRIMARY = new Set<CreatableZoneType>([
  'Secondary',
  'Stub',
  'SecondaryRoot',
  'SecondaryCatalog',
  'SecondaryForwarder',
])

/** Sentinel for the "no catalog / no TSIG" select entries (Radix forbids ""). */
const NONE = '__none__'

export interface CreateZoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful create so the list can highlight/navigate. */
  onCreated?: (zone: string) => void
}

export function CreateZoneDialog({ open, onOpenChange, onCreated }: CreateZoneDialogProps) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const [file, setFile] = React.useState<File | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const schema = React.useMemo(
    () =>
      z
        .object({
          zone: z.string().trim(),
          type: z.enum(CREATABLE_ZONE_TYPES),
          catalog: z.string(),
          useSoaSerialDateScheme: z.boolean(),
          primaryNameServers: z.string(),
          zoneTransferProtocol: z.enum(ZONE_TRANSFER_PROTOCOLS),
          tsigKeyName: z.string(),
          validateZone: z.boolean(),
          forwarder: z.string(),
          forwarderThisServer: z.boolean(),
          protocol: z.enum(FORWARDER_PROTOCOLS),
          dnssecValidation: z.boolean(),
          initializeForwarder: z.boolean(),
          proxyType: z.enum(FORWARDER_PROXY_TYPES),
          proxyAddress: z.string(),
          proxyPort: z.string(),
          proxyUsername: z.string(),
          proxyPassword: z.string(),
        })
        .superRefine((data, ctx) => {
          const zone = data.zone.trim()
          if (!zone || !/^[a-zA-Z0-9._:\-/]+$/.test(zone)) {
            ctx.addIssue({ code: 'custom', path: ['zone'], message: t('create.invalidZoneName') })
          }
          if (NEEDS_PRIMARY.has(data.type) && !parseLines(data.primaryNameServers).length) {
            ctx.addIssue({ code: 'custom', path: ['primaryNameServers'], message: t('create.requiresNameServers') })
          }
          if (data.type === 'Forwarder' && !data.forwarderThisServer && !data.forwarder.trim()) {
            ctx.addIssue({ code: 'custom', path: ['forwarder'], message: t('create.requiresForwarder') })
          }
          if (data.proxyType !== 'NoProxy' && data.proxyPort.trim() && !/^\d+$/.test(data.proxyPort.trim())) {
            ctx.addIssue({ code: 'custom', path: ['proxyPort'], message: tc('form.invalidNumber') })
          }
        }),
    [t, tc],
  )

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      zone: '',
      type: 'Primary',
      catalog: NONE,
      useSoaSerialDateScheme: false,
      primaryNameServers: '',
      zoneTransferProtocol: 'Tcp',
      tsigKeyName: NONE,
      validateZone: false,
      forwarder: '',
      forwarderThisServer: false,
      protocol: 'Udp',
      dnssecValidation: false,
      initializeForwarder: false,
      proxyType: 'NoProxy',
      proxyAddress: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
    },
  })

  const type = useWatch({ control: form.control, name: 'type' })
  const proxyType = useWatch({ control: form.control, name: 'proxyType' })
  const forwarderThisServer = useWatch({ control: form.control, name: 'forwarderThisServer' })
  const needsPrimary = NEEDS_PRIMARY.has(type)
  const isForwarder = type === 'Forwarder'

  const catalogs = useQuery({
    queryKey: queryKeys.catalogs(target),
    queryFn: () => listCatalogZones(),
    enabled: open,
    staleTime: 60_000,
  })
  const tsigKeys = useQuery({
    queryKey: queryKeys.tsigKeys(target),
    queryFn: () => getTsigKeyNames(),
    enabled: open && needsPrimary,
    staleTime: 60_000,
  })

  const create = useMutation({
    mutationFn: (params: CreateZoneParams) => createZone(params),
    onSuccess: (result, params) => {
      toast.success(t('create.success', { zone: result.domain || params.zone }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogs(target) })
      onCreated?.(result.domain || params.zone)
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    // Reset after the close animation starts so a reopen is always clean.
    setTimeout(() => {
      form.reset()
      setFile(null)
      create.reset()
    }, 0)
  }

  function onSubmit(values: FormValues) {
    const params: CreateZoneParams = {
      zone: values.zone.trim(),
      type: values.type,
      useSoaSerialDateScheme: values.useSoaSerialDateScheme || undefined,
      catalog: values.catalog === NONE ? undefined : values.catalog,
    }
    if (needsPrimary) {
      params.primaryNameServerAddresses = parseLines(values.primaryNameServers)
      params.zoneTransferProtocol = values.zoneTransferProtocol
      params.tsigKeyName = values.tsigKeyName === NONE ? undefined : values.tsigKeyName
      params.validateZone = values.validateZone
    }
    if (isForwarder) {
      // Omit the parameter for "this server" so the API stores a null forwarder
      // (an empty string would be a literal, invalid address).
      params.forwarder = values.forwarderThisServer ? undefined : values.forwarder.trim()
      params.protocol = values.protocol
      params.dnssecValidation = values.dnssecValidation
      params.initializeForwarder = values.initializeForwarder
      if (values.proxyType !== 'NoProxy') {
        params.proxyType = values.proxyType
        params.proxyAddress = values.proxyAddress.trim() || undefined
        params.proxyPort = values.proxyPort.trim() ? Number(values.proxyPort.trim()) : undefined
        params.proxyUsername = values.proxyUsername.trim() || undefined
        params.proxyPassword = values.proxyPassword || undefined
      }
    }
    if (file) params.fileImportZone = file
    create.mutate(params)
  }

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="cz-type">{t('create.typeLabel')}</FieldLabel>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="cz-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATABLE_ZONE_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`types.${value}.label`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>{t(`types.${type}.hint`)}</FieldDescription>
            <FieldDescription className="text-xs">{t('create.typeHelp')}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="cz-zone" required>
              {t('create.zoneLabel')}
            </FieldLabel>
            <Input
              id="cz-zone"
              className="font-data"
              placeholder={t('create.zonePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(form.formState.errors.zone)}
              {...form.register('zone')}
            />
            <FieldDescription>{t('create.zoneHelp')}</FieldDescription>
            <FieldError>{form.formState.errors.zone?.message}</FieldError>
          </Field>

          {needsPrimary && (
            <>
              <Field>
                <FieldLabel htmlFor="cz-primary" required>
                  {t('create.primaryNameServers')}
                </FieldLabel>
                <Textarea
                  id="cz-primary"
                  className="font-data"
                  placeholder={t('create.primaryNameServersPlaceholder')}
                  rows={3}
                  aria-invalid={Boolean(form.formState.errors.primaryNameServers)}
                  {...form.register('primaryNameServers')}
                />
                <FieldDescription>{t('create.primaryNameServersHelp')}</FieldDescription>
                <FieldError>{form.formState.errors.primaryNameServers?.message}</FieldError>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="cz-transfer-protocol">{t('create.zoneTransferProtocol')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="zoneTransferProtocol"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cz-transfer-protocol">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ZONE_TRANSFER_PROTOCOLS.map((value) => (
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
                  <FieldLabel htmlFor="cz-tsig">{t('create.tsigKeyName')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="tsigKeyName"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cz-tsig">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t('create.tsigKeyNone')}</SelectItem>
                          {(tsigKeys.data?.tsigKeyNames ?? []).map((key) => (
                            <SelectItem key={key} value={key} className="font-data">
                              {key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>{t('create.tsigKeyHelp')}</FieldDescription>
                </Field>
              </div>

              <SwitchRow
                id="cz-validate"
                label={t('create.validateZone')}
                help={t('create.validateZoneHelp')}
                control={form.control}
                name="validateZone"
              />
            </>
          )}

          {isForwarder && (
            <>
              <SwitchRow
                id="cz-forwarder-this-server"
                label={t('create.forwarderThisServer')}
                control={form.control}
                name="forwarderThisServer"
              />

              <Field>
                <FieldLabel htmlFor="cz-forwarder" required={!forwarderThisServer}>
                  {t('create.forwarder')}
                </FieldLabel>
                <Input
                  id="cz-forwarder"
                  className="font-data"
                  placeholder={t('create.forwarderPlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={forwarderThisServer}
                  aria-invalid={Boolean(form.formState.errors.forwarder)}
                  {...form.register('forwarder')}
                />
                <FieldError>{form.formState.errors.forwarder?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="cz-protocol">{t('create.protocol')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="protocol"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="cz-protocol">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORWARDER_PROTOCOLS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <SwitchRow
                id="cz-dnssec-validation"
                label={t('create.dnssecValidation')}
                control={form.control}
                name="dnssecValidation"
              />
              <SwitchRow
                id="cz-init-forwarder"
                label={t('create.initializeForwarder')}
                control={form.control}
                name="initializeForwarder"
              />

              <Field>
                <FieldLabel htmlFor="cz-proxy-type">{t('create.proxyType')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="proxyType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="cz-proxy-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORWARDER_PROXY_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              {proxyType !== 'NoProxy' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="cz-proxy-address">{t('create.proxyAddress')}</FieldLabel>
                    <Input id="cz-proxy-address" className="font-data" autoComplete="off" {...form.register('proxyAddress')} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cz-proxy-port">{t('create.proxyPort')}</FieldLabel>
                    <Input
                      id="cz-proxy-port"
                      className="font-data"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={Boolean(form.formState.errors.proxyPort)}
                      {...form.register('proxyPort')}
                    />
                    <FieldError>{form.formState.errors.proxyPort?.message}</FieldError>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cz-proxy-user">{t('create.proxyUsername')}</FieldLabel>
                    <Input id="cz-proxy-user" autoComplete="off" {...form.register('proxyUsername')} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cz-proxy-pass">{t('create.proxyPassword')}</FieldLabel>
                    <Input id="cz-proxy-pass" type="password" autoComplete="new-password" {...form.register('proxyPassword')} />
                  </Field>
                </div>
              )}
            </>
          )}

          <Field>
            <FieldLabel htmlFor="cz-catalog">{t('create.catalogLabel')}</FieldLabel>
            <Controller
              control={form.control}
              name="catalog"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="cz-catalog">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('create.catalogNone')}</SelectItem>
                    {(catalogs.data?.catalogZones ?? []).map((name) => (
                      <SelectItem key={name} value={name} className="font-data">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>{t('create.catalogHelp')}</FieldDescription>
          </Field>

          <SwitchRow
            id="cz-soa-date"
            label={t('create.useSoaSerialDateScheme')}
            help={t('create.useSoaSerialDateSchemeHelp')}
            control={form.control}
            name="useSoaSerialDateScheme"
          />

          <Field>
            <FieldLabel>{t('create.importFileLabel')}</FieldLabel>
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const dropped = event.dataTransfer.files?.[0]
                if (dropped) setFile(dropped)
              }}
              className={cnDrop(dragging)}
            >
              <Upload className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-data truncate text-xs">{file ? file.name : t('create.importFileDrop')}</span>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" size="xs" onClick={() => fileInputRef.current?.click()}>
                {tc('actions.upload')}
              </Button>
            </div>
            <FieldDescription>{t('create.importFileHelp')}</FieldDescription>
          </Field>

          {create.error ? <ErrorState error={create.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {!create.isPending && <FolderPlus className="size-4" aria-hidden />}
              {create.isPending ? t('create.submitting') : t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Label + Switch on one row, wired through react-hook-form's `Controller`. */
function SwitchRow<TFieldValues extends FieldValues>({
  id,
  label,
  help,
  control,
  name,
}: {
  id: string
  label: string
  help?: string
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
      />
    </div>
  )
}

function cnDrop(dragging: boolean): string {
  return [
    'flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-muted-foreground transition-colors',
    dragging ? 'border-primary bg-primary/5' : 'border-border',
  ].join(' ')
}

/** `<textarea>` (one entry per line) -> trimmed non-empty array. */
function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}
