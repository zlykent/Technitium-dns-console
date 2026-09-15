'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Save } from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/app/states'
import { ScopeExclusionsPanel } from '@/components/dhcp/scope-exclusions-panel'
import { ScopeReservationsPanel } from '@/components/dhcp/scope-reservations-panel'
import { describeError } from '@/lib/api/client'
import { setScope } from '@/lib/api/domains/dhcp'
import { queryKeys } from '@/lib/api/query-keys'
import type { AddressExclusion, DhcpScope, ReservedLease, SetScopeParams } from '@/lib/api/types/dhcp'
import { serializePipeTable } from '@/lib/api/types/dhcp'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Full scope create / edit form covering all 23 keys returned by `dhcp/scopes/get`.
 *
 * Rendered inside a large dialog. The non-obvious parts:
 *
 *  - **Exclusions & reservations** are managed as separate React state arrays
 *    (not through react-hook-form) because they are edited via nested dialogs
 *    and serialised into Technitium's pipe-delimited format only on submit.
 *  - **dnsServers / winsServers / ntpServers** etc. are rendered as textareas
 *    with one entry per line. The SDK's `setScope` omits `dnsServers` when
 *    `useThisDnsServer` is true, so the textarea is disabled in that case.
 *  - **`newName`** is only sent when it differs from `name` — the SDK handles
 *    this, but the form exposes the field only in edit mode.
 *  - The form is remounted (via `key`) when switching between scopes so that
 *    `defaultValues` always reflect the freshly fetched payload without needing
 *    a `reset()` call that could race with Radix Select internals.
 */

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

interface ScopeSchemaMessages {
  required: string
  invalidIp: string
  invalidNumber: string
  min: (value: number) => string
  max: (value: number) => string
}

/**
 * Built per-locale inside the component so every zod message is an i18n string
 * (the console forbids raw English validation text). Kept as a pure factory so
 * the shape type can still be derived at module scope via `ReturnType`.
 */
function buildScopeSchema(m: ScopeSchemaMessages) {
  return z.object({
    name: z.string().min(1, m.required),
    newName: z.string().optional(),
    startingAddress: z.string().regex(IPV4_RE, m.invalidIp),
    endingAddress: z.string().regex(IPV4_RE, m.invalidIp),
    subnetMask: z.string().regex(IPV4_RE, m.invalidIp),
    leaseTimeDays: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)).max(365, m.max(365)),
    leaseTimeHours: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)).max(23, m.max(23)),
    leaseTimeMinutes: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)).max(59, m.max(59)),
    offerDelayTime: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)),
    pingCheckEnabled: z.boolean(),
    pingCheckTimeout: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)),
    pingCheckRetries: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)).max(10, m.max(10)),
    domainName: z.string(),
    domainSearchList: z.string(),
    dnsUpdates: z.boolean(),
    dnsOverwriteForDynamicLease: z.boolean(),
    dnsTtl: z.number({ error: m.invalidNumber }).int().min(0, m.min(0)),
    routerAddress: z.string(),
    useThisDnsServer: z.boolean(),
    dnsServers: z.string(),
    winsServers: z.string(),
    ntpServers: z.string(),
    ntpServerDomainNames: z.string(),
    capwapAcIpAddresses: z.string(),
    tftpServerAddresses: z.string(),
    serverAddress: z.string(),
    serverHostName: z.string(),
    bootFileName: z.string(),
    allowOnlyReservedLeases: z.boolean(),
    blockLocallyAdministeredMacAddresses: z.boolean(),
    ignoreClientIdentifierOption: z.boolean(),
  })
}

type ScopeFormValues = z.infer<ReturnType<typeof buildScopeSchema>>

export interface ScopeFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing scope data for edit mode; `null` for create. */
  scope: DhcpScope | null
}

function toFormValues(scope: DhcpScope | null): ScopeFormValues {
  return {
    name: scope?.name ?? '',
    newName: '',
    startingAddress: scope?.startingAddress ?? '192.168.1.1',
    endingAddress: scope?.endingAddress ?? '192.168.1.254',
    subnetMask: scope?.subnetMask ?? '255.255.255.0',
    leaseTimeDays: scope?.leaseTimeDays ?? 1,
    leaseTimeHours: scope?.leaseTimeHours ?? 0,
    leaseTimeMinutes: scope?.leaseTimeMinutes ?? 0,
    offerDelayTime: scope?.offerDelayTime ?? 0,
    pingCheckEnabled: scope?.pingCheckEnabled ?? false,
    pingCheckTimeout: scope?.pingCheckTimeout ?? 1000,
    pingCheckRetries: scope?.pingCheckRetries ?? 2,
    domainName: scope?.domainName ?? '',
    domainSearchList: (scope?.domainSearchList ?? []).join('\n'),
    dnsUpdates: scope?.dnsUpdates ?? true,
    dnsOverwriteForDynamicLease: scope?.dnsOverwriteForDynamicLease ?? false,
    dnsTtl: scope?.dnsTtl ?? 900,
    routerAddress: scope?.routerAddress ?? '',
    useThisDnsServer: scope?.useThisDnsServer ?? true,
    dnsServers: (scope?.dnsServers ?? []).join('\n'),
    winsServers: (scope?.winsServers ?? []).join('\n'),
    ntpServers: (scope?.ntpServers ?? []).join('\n'),
    ntpServerDomainNames: (scope?.ntpServerDomainNames ?? []).join('\n'),
    capwapAcIpAddresses: (scope?.capwapAcIpAddresses ?? []).join('\n'),
    tftpServerAddresses: (scope?.tftpServerAddresses ?? []).join('\n'),
    serverAddress: scope?.serverAddress ?? '',
    serverHostName: scope?.serverHostName ?? '',
    bootFileName: scope?.bootFileName ?? '',
    allowOnlyReservedLeases: scope?.allowOnlyReservedLeases ?? false,
    blockLocallyAdministeredMacAddresses: scope?.blockLocallyAdministeredMacAddresses ?? false,
    ignoreClientIdentifierOption: scope?.ignoreClientIdentifierOption ?? false,
  }
}

function parseLines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function ScopeForm({ open, onOpenChange, scope }: ScopeFormProps) {
  const t = useTranslations('dhcp')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const isEdit = scope !== null

  const schema = React.useMemo(
    () =>
      buildScopeSchema({
        required: tc('form.required'),
        invalidIp: tc('form.invalidIp'),
        invalidNumber: tc('form.invalidNumber'),
        min: (value) => tc('form.minValue', { min: value }),
        max: (value) => tc('form.maxValue', { max: value }),
      }),
    [tc],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])

  const form = useForm<ScopeFormValues>({
    resolver,
    defaultValues: toFormValues(scope),
  })

  const [exclusions, setExclusions] = React.useState<AddressExclusion[]>(scope?.exclusions ?? [])
  const [reservations, setReservations] = React.useState<ReservedLease[]>(scope?.reservedLeases ?? [])

  const useThisDns = useWatch({ control: form.control, name: 'useThisDnsServer' })
  const pingEnabled = useWatch({ control: form.control, name: 'pingCheckEnabled' })
  const dnsUpdates = useWatch({ control: form.control, name: 'dnsUpdates' })
  const dnsOverwrite = useWatch({ control: form.control, name: 'dnsOverwriteForDynamicLease' })
  const allowOnlyReserved = useWatch({ control: form.control, name: 'allowOnlyReservedLeases' })
  const blockMac = useWatch({ control: form.control, name: 'blockLocallyAdministeredMacAddresses' })
  const ignoreClient = useWatch({ control: form.control, name: 'ignoreClientIdentifierOption' })

  const save = useMutation({
    mutationFn: (params: SetScopeParams) => setScope(params),
    onSuccess: (_r, params) => {
      toast.success(isEdit ? t('form.updateSuccess', { name: params.name }) : t('form.createSuccess', { name: params.name }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'dhcp') })
      onOpenChange(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function onSubmit(values: ScopeFormValues) {
    const params: SetScopeParams = {
      name: values.name.trim(),
      startingAddress: values.startingAddress.trim(),
      endingAddress: values.endingAddress.trim(),
      subnetMask: values.subnetMask.trim(),
      leaseTimeDays: values.leaseTimeDays,
      leaseTimeHours: values.leaseTimeHours,
      leaseTimeMinutes: values.leaseTimeMinutes,
      offerDelayTime: values.offerDelayTime,
      pingCheckEnabled: values.pingCheckEnabled,
      pingCheckTimeout: values.pingCheckTimeout,
      pingCheckRetries: values.pingCheckRetries,
      domainName: values.domainName.trim(),
      dnsUpdates: values.dnsUpdates,
      dnsOverwriteForDynamicLease: values.dnsOverwriteForDynamicLease,
      dnsTtl: values.dnsTtl,
      routerAddress: values.routerAddress.trim(),
      useThisDnsServer: values.useThisDnsServer,
      allowOnlyReservedLeases: values.allowOnlyReservedLeases,
      blockLocallyAdministeredMacAddresses: values.blockLocallyAdministeredMacAddresses,
      ignoreClientIdentifierOption: values.ignoreClientIdentifierOption,
      exclusions: serializePipeTable(exclusions.map((e) => [e.startingAddress, e.endingAddress])),
      reservedLeases: serializePipeTable(reservations.map((r) => [r.address, r.hostName, r.hardwareAddress, r.comments])),
    }

    if (isEdit && values.newName?.trim() && values.newName.trim() !== values.name.trim()) {
      params.newName = values.newName.trim()
    }

    const dsl = parseLines(values.domainSearchList)
    if (dsl.length > 0) params.domainSearchList = dsl

    if (!values.useThisDnsServer) {
      params.dnsServers = parseLines(values.dnsServers)
    }

    const wins = parseLines(values.winsServers)
    if (wins.length > 0) params.winsServers = wins

    const ntp = parseLines(values.ntpServers)
    if (ntp.length > 0) params.ntpServers = ntp

    const ntpDomains = parseLines(values.ntpServerDomainNames)
    if (ntpDomains.length > 0) params.ntpServerDomainNames = ntpDomains

    const capwap = parseLines(values.capwapAcIpAddresses)
    if (capwap.length > 0) params.capwapAcIpAddresses = capwap

    const tftp = parseLines(values.tftpServerAddresses)
    if (tftp.length > 0) params.tftpServerAddresses = tftp

    if (values.serverAddress.trim()) params.serverAddress = values.serverAddress.trim()
    if (values.serverHostName.trim()) params.serverHostName = values.serverHostName.trim()
    if (values.bootFileName.trim()) params.bootFileName = values.bootFileName.trim()

    save.mutate(params)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('scopes.editTitle', { name: scope.name }) : t('scopes.addTitle')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        {/* A plain bounded scroll container, not <ScrollArea>: Radix's viewport
            resolves percentage height against the dialog's max-h flex box and
            overflows the footer, stealing clicks from the submit button. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <form id="scope-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6 pr-3" noValidate>
            {/* ---- General ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.general')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="sf-name" required>{t('form.name')}</FieldLabel>
                  <Input id="sf-name" {...form.register('name')} placeholder={t('form.namePlaceholder')} disabled={isEdit} autoComplete="off" />
                  <FieldError>{form.formState.errors.name?.message}</FieldError>
                </Field>
                {isEdit && (
                  <Field>
                    <FieldLabel htmlFor="sf-newName">{t('form.newName')}</FieldLabel>
                    <Input id="sf-newName" {...form.register('newName')} autoComplete="off" />
                    <FieldDescription>{t('form.newNameHelp')}</FieldDescription>
                  </Field>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="sf-start" required>{t('form.startingAddress')}</FieldLabel>
                  <Input id="sf-start" className="font-data" {...form.register('startingAddress')} autoComplete="off" />
                  <FieldError>{form.formState.errors.startingAddress?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-end" required>{t('form.endingAddress')}</FieldLabel>
                  <Input id="sf-end" className="font-data" {...form.register('endingAddress')} autoComplete="off" />
                  <FieldError>{form.formState.errors.endingAddress?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-mask" required>{t('form.subnetMask')}</FieldLabel>
                  <Input id="sf-mask" className="font-data" {...form.register('subnetMask')} autoComplete="off" />
                  <FieldError>{form.formState.errors.subnetMask?.message}</FieldError>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="sf-router">{t('form.routerAddress')}</FieldLabel>
                <Input id="sf-router" className="font-data" {...form.register('routerAddress')} autoComplete="off" />
              </Field>
            </fieldset>

            {/* ---- Lease duration ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.lease')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="sf-days">{t('form.leaseTimeDays')}</FieldLabel>
                  <Input id="sf-days" type="number" min={0} max={365} {...form.register('leaseTimeDays', { valueAsNumber: true })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-hours">{t('form.leaseTimeHours')}</FieldLabel>
                  <Input id="sf-hours" type="number" min={0} max={23} {...form.register('leaseTimeHours', { valueAsNumber: true })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-minutes">{t('form.leaseTimeMinutes')}</FieldLabel>
                  <Input id="sf-minutes" type="number" min={0} max={59} {...form.register('leaseTimeMinutes', { valueAsNumber: true })} />
                </Field>
              </div>
              <FieldDescription>{t('form.leaseTimeHelp')}</FieldDescription>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="sf-delay">{t('form.offerDelayTime')}</FieldLabel>
                  <Input id="sf-delay" type="number" min={0} {...form.register('offerDelayTime', { valueAsNumber: true })} />
                  <FieldDescription>{t('form.offerDelayHelp')}</FieldDescription>
                </Field>
              </div>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-ping">{t('form.pingCheckEnabled')}</FieldLabel>
                  <FieldDescription>{t('form.pingCheckHelp')}</FieldDescription>
                </div>
                <Switch id="sf-ping" checked={pingEnabled} onCheckedChange={(v) => form.setValue('pingCheckEnabled', v)} />
              </FieldRow>
              {pingEnabled && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="sf-pingTimeout">{t('form.pingCheckTimeout')}</FieldLabel>
                    <Input id="sf-pingTimeout" type="number" min={0} {...form.register('pingCheckTimeout', { valueAsNumber: true })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sf-pingRetries">{t('form.pingCheckRetries')}</FieldLabel>
                    <Input id="sf-pingRetries" type="number" min={0} max={10} {...form.register('pingCheckRetries', { valueAsNumber: true })} />
                  </Field>
                </div>
              )}
            </fieldset>

            {/* ---- DNS integration ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.dns')}</legend>
              <Field>
                <FieldLabel htmlFor="sf-domain">{t('form.domainName')}</FieldLabel>
                <Input id="sf-domain" className="font-data" {...form.register('domainName')} autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="sf-dsl">{t('form.domainSearchList')}</FieldLabel>
                <Textarea id="sf-dsl" className="font-data min-h-16" {...form.register('domainSearchList')} placeholder={t('form.onePerLine')} />
                <FieldDescription>{t('form.domainSearchListHelp')}</FieldDescription>
              </Field>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-dnsUpdates">{t('form.dnsUpdates')}</FieldLabel>
                </div>
                <Switch id="sf-dnsUpdates" checked={dnsUpdates} onCheckedChange={(v) => form.setValue('dnsUpdates', v)} />
              </FieldRow>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-dnsOverwrite">{t('form.dnsOverwriteForDynamicLease')}</FieldLabel>
                </div>
                <Switch id="sf-dnsOverwrite" checked={dnsOverwrite} onCheckedChange={(v) => form.setValue('dnsOverwriteForDynamicLease', v)} />
              </FieldRow>
              <Field>
                <FieldLabel htmlFor="sf-dnsTtl">{t('form.dnsTtl')}</FieldLabel>
                <Input id="sf-dnsTtl" type="number" min={0} className="w-32" {...form.register('dnsTtl', { valueAsNumber: true })} />
              </Field>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-useThis">{t('form.useThisDnsServer')}</FieldLabel>
                  <FieldDescription>{t('form.useThisDnsServerHelp')}</FieldDescription>
                </div>
                <Switch id="sf-useThis" checked={useThisDns} onCheckedChange={(v) => form.setValue('useThisDnsServer', v)} />
              </FieldRow>
              {!useThisDns && (
                <Field>
                  <FieldLabel htmlFor="sf-dnsServers">{t('form.dnsServers')}</FieldLabel>
                  <Textarea id="sf-dnsServers" className="font-data min-h-16" {...form.register('dnsServers')} placeholder={t('form.onePerLine')} />
                </Field>
              )}
            </fieldset>

            {/* ---- Options to publish ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.options')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="sf-wins">{t('form.winsServers')}</FieldLabel>
                  <Textarea id="sf-wins" className="font-data min-h-16" {...form.register('winsServers')} placeholder={t('form.onePerLine')} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-ntp">{t('form.ntpServers')}</FieldLabel>
                  <Textarea id="sf-ntp" className="font-data min-h-16" {...form.register('ntpServers')} placeholder={t('form.onePerLine')} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-ntpDomains">{t('form.ntpServerDomainNames')}</FieldLabel>
                  <Textarea id="sf-ntpDomains" className="font-data min-h-16" {...form.register('ntpServerDomainNames')} placeholder={t('form.onePerLine')} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-tftp">{t('form.tftpServerAddresses')}</FieldLabel>
                  <Textarea id="sf-tftp" className="font-data min-h-16" {...form.register('tftpServerAddresses')} placeholder={t('form.onePerLine')} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-capwap">{t('form.capwapAcIpAddresses')}</FieldLabel>
                  <Textarea id="sf-capwap" className="font-data min-h-16" {...form.register('capwapAcIpAddresses')} placeholder={t('form.onePerLine')} />
                </Field>
              </div>
            </fieldset>

            {/* ---- PXE ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.options')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="sf-serverAddr">{t('form.serverAddress')}</FieldLabel>
                  <Input id="sf-serverAddr" className="font-data" {...form.register('serverAddress')} autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-serverHost">{t('form.serverHostName')}</FieldLabel>
                  <Input id="sf-serverHost" {...form.register('serverHostName')} autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sf-boot">{t('form.bootFileName')}</FieldLabel>
                  <Input id="sf-boot" className="font-data" {...form.register('bootFileName')} autoComplete="off" />
                </Field>
              </div>
            </fieldset>

            {/* ---- Exclusions ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.exclusions')}</legend>
              <ScopeExclusionsPanel exclusions={exclusions} onChange={setExclusions} />
            </fieldset>

            {/* ---- Reserved leases ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.reserved')}</legend>
              <ScopeReservationsPanel reservations={reservations} onChange={setReservations} />
            </fieldset>

            {/* ---- Advanced ---- */}
            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-semibold">{t('form.sections.advanced')}</legend>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-onlyReserved">{t('form.allowOnlyReservedLeases')}</FieldLabel>
                  <FieldDescription>{t('form.allowOnlyReservedLeasesHelp')}</FieldDescription>
                </div>
                <Switch id="sf-onlyReserved" checked={allowOnlyReserved} onCheckedChange={(v) => form.setValue('allowOnlyReservedLeases', v)} />
              </FieldRow>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-blockMac">{t('form.blockLocallyAdministeredMacAddresses')}</FieldLabel>
                  <FieldDescription>{t('form.blockLocallyAdministeredMacHelp')}</FieldDescription>
                </div>
                <Switch id="sf-blockMac" checked={blockMac} onCheckedChange={(v) => form.setValue('blockLocallyAdministeredMacAddresses', v)} />
              </FieldRow>
              <FieldRow>
                <div className="min-w-0">
                  <FieldLabel htmlFor="sf-ignoreClient">{t('form.ignoreClientIdentifierOption')}</FieldLabel>
                  <FieldDescription>{t('form.ignoreClientIdentifierHelp')}</FieldDescription>
                </div>
                <Switch id="sf-ignoreClient" checked={ignoreClient} onCheckedChange={(v) => form.setValue('ignoreClientIdentifierOption', v)} />
              </FieldRow>
            </fieldset>
          </form>
        </div>

        {save.error && <ErrorState error={save.error} compact />}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" form="scope-form" loading={save.isPending}>
            {!save.isPending && <Save className="size-3.5" aria-hidden />}
            {save.isPending ? t('form.submitting') : t('form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
