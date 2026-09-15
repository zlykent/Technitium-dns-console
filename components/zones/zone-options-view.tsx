'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CirclePlus, Save, Trash } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState } from '@/components/app/states'
import { PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ZoneTabs } from '@/components/zones/zone-tabs'
import { describeError } from '@/lib/api/client'
import { getZoneOptions, setZoneOptions } from '@/lib/api/domains/zones'
import {
  NOTIFY_POLICIES,
  QUERY_ACCESS_POLICIES,
  ZONE_TRANSFER_PROTOCOLS,
  ZONE_UPDATE_POLICIES,
  type QueryAccessPolicy,
  type ZoneType,
  type ZoneUpdatePolicy,
} from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import { formatNetworkAclText, parseNetworkAclText } from '@/lib/api/types/common'
import type { SetZoneOptionsParams, ZoneOptions } from '@/lib/api/types/zones'
import { serializeUpdateSecurityPolicies } from '@/lib/api/types/zones'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Zone options — the replication and access policy for a single zone.
 *
 * `zones/options/get` returns ~19 configurable keys plus two "available names"
 * lists (catalog zones and TSIG keys) that feed the pickers. Every one of them
 * is rendered here; the page is long because the surface is long, not because it
 * is complicated. The non-obvious parts:
 *
 *  - **Enum values ≠ i18n keys.** The wire enums (`AllowOnlyPrivateNetworks`,
 *    notify `None`, `ZoneNameServers`) do not match the label keys the message
 *    file uses (`AllowOnlyForPrivateNetworks`, `Disable`, `ThisServer`), so two
 *    lookup tables bridge them. Adding an enum value without a bridge entry
 *    throws at render, which is the point.
 *  - **Clearing a list.** `appendParams` skips empty arrays, so an ACL the
 *    operator emptied would silently keep its old value. `listOrClear` sends
 *    `['']` instead, which serialises to `key=` and actually clears it. The same
 *    reasoning sends `catalog: ''` / `tsigKeyName: ''` to unset those.
 *  - **Read-only fields.** `isDeleteProtected`, `overrideCatalogUpdate` and
 *    `overrideCatalogUpdateSecurityPolicies` are returned by `get` but have no
 *    slot in `SetZoneOptionsParams`, so they render disabled — see the report.
 *  - **updateSecurityPolicies** is a structured list on read but a single string
 *    on write; the SDK ships no serialiser, so this page emits JSON and only
 *    includes the parameter when the list is non-empty.
 */

/** Sentinel for the "none" entries in Select controls (Radix forbids ""). */
const NONE = '__none__'

/** Zone types that pull their data from a primary and expose the source block. */
const SECONDARY_TYPES = new Set<ZoneType>(['Secondary', 'Stub', 'SecondaryCatalog', 'SecondaryForwarder'])

/** Wire enum -> `options.policies.*` message key. */
const POLICY_LABEL_KEY: Record<string, string> = {
  Deny: 'Deny',
  Allow: 'Allow',
  AllowOnlyPrivateNetworks: 'AllowOnlyForPrivateNetworks',
  AllowOnlyZoneNameServers: 'AllowOnlyForZoneNameServers',
  UseSpecifiedNetworkACL: 'UseSpecifiedNetworkACL',
  AllowZoneNameServersAndUseSpecifiedNetworkACL: 'AllowZoneNameServersAndUseSpecifiedNetworkACL',
}

/** Wire enum -> `options.notifyPolicies.*` message key. */
const NOTIFY_LABEL_KEY: Record<string, string> = {
  None: 'Disable',
  ZoneNameServers: 'ThisServer',
  SpecifiedNameServers: 'SpecifiedNameServers',
  BothZoneAndSpecifiedNameServers: 'BothThisServerAndSpecifiedNameServers',
  SeparateNameServersForCatalogAndMemberZones: 'SeparateNameServersForCatalogAndMemberZones',
}

const optionsSchema = z.object({
  queryAccess: z.enum(QUERY_ACCESS_POLICIES),
  queryAccessNetworkACL: z.string(),
  zoneTransfer: z.enum(ZONE_UPDATE_POLICIES),
  zoneTransferNetworkACL: z.string(),
  zoneTransferTsigKeyNames: z.string(),
  notify: z.enum(NOTIFY_POLICIES),
  notifyNameServers: z.string(),
  notifySecondaryCatalogsNameServers: z.string(),
  update: z.enum(ZONE_UPDATE_POLICIES),
  updateNetworkACL: z.string(),
  primaryNameServerAddresses: z.string(),
  primaryZoneTransferProtocol: z.enum(ZONE_TRANSFER_PROTOCOLS),
  primaryZoneTransferTsigKeyName: z.string(),
  validateZone: z.boolean(),
  catalog: z.string(),
  overrideCatalogNotify: z.boolean(),
  overrideCatalogQueryAccess: z.boolean(),
  overrideCatalogZoneTransfer: z.boolean(),
})

type OptionsFormValues = z.infer<typeof optionsSchema>

/** One editable row of the dynamic-update security policy table. */
interface PolicyRow {
  domain: string
  tsigKeyName: string
  /** Comma-separated record types, split on save. */
  allowedTypes: string
}

export interface ZoneOptionsViewProps {
  zone: string
}

export function ZoneOptionsView({ zone }: ZoneOptionsViewProps) {
  const target = useTargetKey()
  const can = useCan('Zones')

  const options = useQuery({
    queryKey: queryKeys.zoneOptions(target, zone),
    queryFn: () => getZoneOptions(zone),
    enabled: can.canView,
  })

  const data = options.data

  return (
    <PageShell>
      {options.isPending ? (
        <>
          <OptionsHeader zone={zone} />
          <OptionsSkeleton />
        </>
      ) : options.error ? (
        <>
          <OptionsHeader zone={zone} />
          <ErrorState error={options.error} onRetry={() => void options.refetch()} />
        </>
      ) : data ? (
        // `key={zone}` remounts the form when navigating between zones. The child
        // seeds `defaultValues` straight from `data` so every Radix `Select`
        // mounts already holding its final value. Resetting a mounted, controlled
        // `Select` to a value whose `SelectItem` is not currently rendered makes
        // Radix blank it (and fire `onValueChange('')`), which would silently wipe
        // `zoneTransfer` / `notify` on the next save — so the form is mounted
        // *after* the payload is known rather than reset in an effect.
        <ZoneOptionsForm key={zone} zone={zone} data={data} can={can} />
      ) : null}
    </PageShell>
  )
}

/** Breadcrumb + title for the loading and error states (no Save action yet). */
function OptionsHeader({ zone }: { zone: string }) {
  const t = useTranslations('zones')
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('detail.backToList'), href: '/zones' }, { label: zone }, { label: t('options.title') }]}
        title={<span className="font-data">{zone}</span>}
        description={t('options.subtitle', { zone })}
      />
      <ZoneTabs zone={zone} current="options" />
    </>
  )
}

interface ZoneOptionsFormProps {
  zone: string
  data: ZoneOptions
  can: { canView: boolean; canModify: boolean; canDelete: boolean }
}

/**
 * The editable options form. Split out from `ZoneOptionsView` so it can be
 * mounted (and remounted per zone) with the server payload as its
 * `defaultValues`; see the note at the call site for why a post-mount `reset`
 * is not enough here.
 */
function ZoneOptionsForm({ zone, data, can }: ZoneOptionsFormProps) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const form = useForm<OptionsFormValues>({
    resolver: zodResolver(optionsSchema),
    defaultValues: toFormValues(data),
  })

  const [policies, setPolicies] = React.useState<PolicyRow[]>(() => toPolicyRows(data))

  const isSecondary = SECONDARY_TYPES.has(data.type)
  const isCatalogMember = Boolean(data.catalog)
  const notify = useWatch({ control: form.control, name: 'notify' })
  const showSecondaryCatalogNotify = notify === 'SeparateNameServersForCatalogAndMemberZones'

  const save = useMutation({
    mutationFn: (params: SetZoneOptionsParams) => setZoneOptions(params),
    onSuccess: () => {
      toast.success(t('options.saved'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.zoneOptions(target, zone) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function onSubmit(values: OptionsFormValues) {
    if (!data) return
    const params: SetZoneOptionsParams = {
      zone,
      queryAccess: values.queryAccess as QueryAccessPolicy,
      queryAccessNetworkACL: listOrClear(parseNetworkAclText(values.queryAccessNetworkACL)),
      zoneTransfer: values.zoneTransfer as ZoneUpdatePolicy,
      zoneTransferNetworkACL: listOrClear(parseNetworkAclText(values.zoneTransferNetworkACL)),
      zoneTransferTsigKeyNames: listOrClear(parseLines(values.zoneTransferTsigKeyNames)),
      notify: values.notify,
      notifyNameServers: listOrClear(parseLines(values.notifyNameServers)),
      update: values.update as ZoneUpdatePolicy,
      updateNetworkACL: listOrClear(parseNetworkAclText(values.updateNetworkACL)),
      catalog: values.catalog === NONE ? '' : values.catalog,
    }

    if (showSecondaryCatalogNotify) {
      params.notifySecondaryCatalogsNameServers = listOrClear(parseLines(values.notifySecondaryCatalogsNameServers))
    }

    if (isSecondary) {
      params.primaryNameServerAddresses = listOrClear(parseLines(values.primaryNameServerAddresses))
      params.primaryZoneTransferProtocol = values.primaryZoneTransferProtocol
      params.primaryZoneTransferTsigKeyName = values.primaryZoneTransferTsigKeyName === NONE ? '' : values.primaryZoneTransferTsigKeyName
      params.validateZone = values.validateZone
    }

    if (isCatalogMember) {
      params.overrideCatalogNotify = values.overrideCatalogNotify
      params.overrideCatalogQueryAccess = values.overrideCatalogQueryAccess
      params.overrideCatalogZoneTransfer = values.overrideCatalogZoneTransfer
    }

    // Always sent, exactly as the stock console does: an empty table becomes the
    // literal `false`, which is how the server is told to clear every policy.
    // Omitting the parameter instead would leave the old policies in place, so
    // the last row could never be deleted.
    params.updateSecurityPolicies = serializeUpdateSecurityPolicies(
      policies
        .filter((row) => row.domain.trim().length > 0)
        .map((row) => ({
          domain: row.domain.trim(),
          tsigKeyName: row.tsigKeyName === NONE ? '' : row.tsigKeyName,
          allowedTypes: splitCsv(row.allowedTypes),
        })),
    )

    save.mutate(params)
  }

  const tsigKeyNames = data?.availableTsigKeyNames ?? []
  const catalogNames = data?.availableCatalogZoneNames ?? []

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('detail.backToList'), href: '/zones' }, { label: zone }, { label: t('options.title') }]}
        title={<span className="font-data">{zone}</span>}
        description={t('options.subtitle', { zone })}
        actions={
          can.canModify && (
            <Button size="sm" onClick={() => void form.handleSubmit(onSubmit)()} loading={save.isPending}>
              {!save.isPending && <Save className="size-3.5" aria-hidden />}
              {save.isPending ? t('options.saving') : t('options.save')}
            </Button>
          )
        }
      />

      <ZoneTabs zone={zone} current="options" />

      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <Section title={t('options.general')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{tc('fields.type')}</FieldLabel>
                  <div>
                    <Badge>{t(`types.${data.type}.label`)}</Badge>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="zo-catalog">{t('create.catalogLabel')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="catalog"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!can.canModify}>
                        <SelectTrigger id="zo-catalog">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t('create.catalogNone')}</SelectItem>
                          {catalogNames.map((name) => (
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
              </div>

              <div className="mt-4">
                <SwitchRow
                  id="zo-delete-protected"
                  label={t('options.deleteProtection')}
                  help={t('options.deleteProtectionHelp')}
                  checked={Boolean(data.isDeleteProtected)}
                  disabled
                />
              </div>
            </Section>

            <Section title={t('options.queryAccess')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PolicySelect
                  id="zo-query-access"
                  label={t('options.queryAccessPolicy')}
                  values={QUERY_ACCESS_POLICIES}
                  labelKey={(value) => POLICY_LABEL_KEY[value]}
                  control={form.control}
                  name="queryAccess"
                  disabled={!can.canModify}
                  translate={t}
                />
                <Field>
                  <FieldLabel htmlFor="zo-query-acl">{t('options.queryAccessNetworkACL')}</FieldLabel>
                  <Textarea
                    id="zo-query-acl"
                    className="font-data"
                    rows={4}
                    disabled={!can.canModify}
                    {...form.register('queryAccessNetworkACL')}
                  />
                  <FieldDescription>{t('options.queryAccessNetworkACLHelp')}</FieldDescription>
                </Field>
              </div>
            </Section>

            <Section title={t('options.zoneTransfer')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PolicySelect
                  id="zo-transfer"
                  label={t('options.zoneTransferPolicy')}
                  values={ZONE_UPDATE_POLICIES}
                  labelKey={(value) => POLICY_LABEL_KEY[value]}
                  control={form.control}
                  name="zoneTransfer"
                  disabled={!can.canModify}
                  translate={t}
                />
                <Field>
                  <FieldLabel htmlFor="zo-transfer-acl">{t('options.zoneTransferNetworkACL')}</FieldLabel>
                  <Textarea id="zo-transfer-acl" className="font-data" rows={4} disabled={!can.canModify} {...form.register('zoneTransferNetworkACL')} />
                </Field>
              </div>
              <Field className="mt-4">
                <FieldLabel htmlFor="zo-transfer-tsig">{t('options.zoneTransferTsigKeyNames')}</FieldLabel>
                <Textarea
                  id="zo-transfer-tsig"
                  className="font-data"
                  rows={3}
                  placeholder={tsigKeyNames.join('\n')}
                  disabled={!can.canModify}
                  {...form.register('zoneTransferTsigKeyNames')}
                />
                <FieldDescription>{t('options.zoneTransferTsigHelp')}</FieldDescription>
              </Field>
            </Section>

            <Section title={t('options.notify')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PolicySelect
                  id="zo-notify"
                  label={t('options.notifyPolicy')}
                  values={NOTIFY_POLICIES}
                  labelKey={(value) => NOTIFY_LABEL_KEY[value]}
                  control={form.control}
                  name="notify"
                  disabled={!can.canModify}
                  translate={t}
                  namespace="notifyPolicies"
                />
                <Field>
                  <FieldLabel htmlFor="zo-notify-ns">{t('options.notifyNameServers')}</FieldLabel>
                  <Textarea id="zo-notify-ns" className="font-data" rows={4} disabled={!can.canModify} {...form.register('notifyNameServers')} />
                  <FieldDescription>{t('options.notifyNameServersHelp')}</FieldDescription>
                </Field>
              </div>
              {showSecondaryCatalogNotify && (
                <Field className="mt-4">
                  <FieldLabel htmlFor="zo-notify-secondary">{t('options.notifySecondaryCatalogsNameServers')}</FieldLabel>
                  <Textarea
                    id="zo-notify-secondary"
                    className="font-data"
                    rows={3}
                    disabled={!can.canModify}
                    {...form.register('notifySecondaryCatalogsNameServers')}
                  />
                </Field>
              )}
            </Section>

            <Section title={t('options.update')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PolicySelect
                  id="zo-update"
                  label={t('options.updatePolicy')}
                  values={ZONE_UPDATE_POLICIES}
                  labelKey={(value) => POLICY_LABEL_KEY[value]}
                  control={form.control}
                  name="update"
                  disabled={!can.canModify}
                  translate={t}
                />
                <Field>
                  <FieldLabel htmlFor="zo-update-acl">{t('options.updateNetworkACL')}</FieldLabel>
                  <Textarea id="zo-update-acl" className="font-data" rows={4} disabled={!can.canModify} {...form.register('updateNetworkACL')} />
                </Field>
              </div>

              <SecurityPoliciesEditor
                rows={policies}
                onChange={setPolicies}
                tsigKeyNames={tsigKeyNames}
                disabled={!can.canModify}
                labels={{
                  title: t('options.updateSecurityPolicies'),
                  help: t('options.updateSecurityPoliciesHelp'),
                  domain: t('options.policyDomain'),
                  tsigKey: t('options.policyTsigKey'),
                  allowedTypes: t('options.policyAllowedTypes'),
                  add: t('options.addPolicy'),
                  none: t('create.tsigKeyNone'),
                  remove: tc('actions.remove'),
                }}
              />
            </Section>

            {isSecondary && (
              <Section title={t('options.secondary')}>
                <Field>
                  <FieldLabel htmlFor="zo-primary-ns">{t('options.primaryNameServerAddresses')}</FieldLabel>
                  <Textarea id="zo-primary-ns" className="font-data" rows={3} disabled={!can.canModify} {...form.register('primaryNameServerAddresses')} />
                </Field>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="zo-primary-protocol">{t('options.primaryZoneTransferProtocol')}</FieldLabel>
                    <Controller
                      control={form.control}
                      name="primaryZoneTransferProtocol"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange} disabled={!can.canModify}>
                          <SelectTrigger id="zo-primary-protocol">
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
                    <FieldLabel htmlFor="zo-primary-tsig">{t('options.primaryZoneTransferTsigKeyName')}</FieldLabel>
                    <Controller
                      control={form.control}
                      name="primaryZoneTransferTsigKeyName"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange} disabled={!can.canModify}>
                          <SelectTrigger id="zo-primary-tsig">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t('create.tsigKeyNone')}</SelectItem>
                            {tsigKeyNames.map((key) => (
                              <SelectItem key={key} value={key} className="font-data">
                                {key}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>
                <div className="mt-4">
                  <SwitchRow
                    id="zo-validate"
                    label={t('create.validateZone')}
                    help={t('create.validateZoneHelp')}
                    control={form.control}
                    name="validateZone"
                    disabled={!can.canModify}
                  />
                </div>
              </Section>
            )}

            {isCatalogMember && (
              <Section title={t('options.catalogOverrides')} description={t('options.overrideHint')}>
                <div className="flex flex-col gap-2">
                  <SwitchRow
                    id="zo-override-notify"
                    label={t('options.overrideCatalogNotify')}
                    control={form.control}
                    name="overrideCatalogNotify"
                    disabled={!can.canModify}
                  />
                  <SwitchRow
                    id="zo-override-query"
                    label={t('options.overrideCatalogQueryAccess')}
                    control={form.control}
                    name="overrideCatalogQueryAccess"
                    disabled={!can.canModify}
                  />
                  <SwitchRow
                    id="zo-override-transfer"
                    label={t('options.overrideCatalogZoneTransfer')}
                    control={form.control}
                    name="overrideCatalogZoneTransfer"
                    disabled={!can.canModify}
                  />
                  {/* Returned by `get` but absent from `SetZoneOptionsParams`. */}
                  <SwitchRow id="zo-override-update" label={t('options.overrideCatalogUpdate')} checked={Boolean(data.overrideCatalogUpdate)} disabled />
                  <SwitchRow
                    id="zo-override-update-sec"
                    label={t('options.overrideCatalogUpdateSecurityPolicies')}
                    checked={Boolean(data.overrideCatalogUpdateSecurityPolicies)}
                    disabled
                  />
                </div>
              </Section>
            )}

            {save.error ? <ErrorState error={save.error} compact /> : null}

            {can.canModify && (
              <div className="flex justify-end">
                <Button type="submit" loading={save.isPending}>
                  {!save.isPending && <Save className="size-4" aria-hidden />}
                  {save.isPending ? t('options.saving') : t('options.save')}
                </Button>
              </div>
            )}
          </form>
    </>
  )
}

/** Enum-backed `<Select>` whose option labels come from a message sub-namespace. */
function PolicySelect<TFieldValues extends FieldValues>({
  id,
  label,
  values,
  labelKey,
  control,
  name,
  disabled,
  translate,
  namespace = 'policies',
}: {
  id: string
  label: string
  values: readonly string[]
  labelKey: (value: string) => string
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  disabled?: boolean
  translate: (key: string) => string
  namespace?: 'policies' | 'notifyPolicies'
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={String(field.value)} onValueChange={field.onChange} disabled={disabled}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {values.map((value) => (
                <SelectItem key={value} value={value}>
                  {translate(`options.${namespace}.${labelKey(value)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  )
}

/** Repeatable editor for the dynamic-update TSIG security policy table. */
function SecurityPoliciesEditor({
  rows,
  onChange,
  tsigKeyNames,
  disabled,
  labels,
}: {
  rows: PolicyRow[]
  onChange: (rows: PolicyRow[]) => void
  tsigKeyNames: string[]
  disabled?: boolean
  labels: { title: string; help: string; domain: string; tsigKey: string; allowedTypes: string; add: string; none: string; remove: string }
}) {
  function update(index: number, patch: Partial<PolicyRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">{labels.title}</p>
        <p className="text-xs text-muted-foreground">{labels.help}</p>
      </div>

      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field>
            <FieldLabel htmlFor={`sec-domain-${index}`}>{labels.domain}</FieldLabel>
            <Input
              id={`sec-domain-${index}`}
              className="font-data"
              value={row.domain}
              disabled={disabled}
              onChange={(event) => update(index, { domain: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`sec-tsig-${index}`}>{labels.tsigKey}</FieldLabel>
            <Select value={row.tsigKeyName || NONE} onValueChange={(value) => update(index, { tsigKeyName: value === NONE ? '' : value })} disabled={disabled}>
              <SelectTrigger id={`sec-tsig-${index}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{labels.none}</SelectItem>
                {tsigKeyNames.map((key) => (
                  <SelectItem key={key} value={key} className="font-data">
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`sec-types-${index}`}>{labels.allowedTypes}</FieldLabel>
            <Input
              id={`sec-types-${index}`}
              className="font-data"
              value={row.allowedTypes}
              disabled={disabled}
              placeholder="A, AAAA"
              onChange={(event) => update(index, { allowedTypes: event.target.value })}
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={labels.remove}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash className="size-4" aria-hidden />
          </Button>
        </div>
      ))}

      <div>
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => onChange([...rows, { domain: '', tsigKeyName: '', allowedTypes: '' }])}>
          <CirclePlus className="size-3.5" aria-hidden />
          {labels.add}
        </Button>
      </div>
    </div>
  )
}

/**
 * Label + Switch row. Two modes: a `control`+`name` pair wires it into
 * react-hook-form; a plain `checked` renders a detached (read-only) switch for
 * the fields the write API does not accept.
 */
function SwitchRow<TFieldValues extends FieldValues>({
  id,
  label,
  help,
  disabled,
  control,
  name,
  checked,
}: {
  id: string
  label: string
  help?: string
  disabled?: boolean
} & (
  | { control: Control<TFieldValues>; name: FieldPath<TFieldValues>; checked?: never }
  | { control?: never; name?: never; checked: boolean }
)) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      {control && name ? (
        <Controller
          control={control}
          name={name}
          render={({ field }) => <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />}
        />
      ) : (
        <Switch id={id} checked={Boolean(checked)} disabled={disabled} />
      )}
    </div>
  )
}

function OptionsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="surface rounded-lg p-4">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** `zones/options/get` -> the flat string/boolean shape the form edits. */
function toFormValues(data: ZoneOptions): OptionsFormValues {
  return {
    queryAccess: data.queryAccess,
    queryAccessNetworkACL: formatNetworkAclText(data.queryAccessNetworkACL),
    zoneTransfer: data.zoneTransfer,
    zoneTransferNetworkACL: formatNetworkAclText(data.zoneTransferNetworkACL),
    zoneTransferTsigKeyNames: (data.zoneTransferTsigKeyNames ?? []).join('\n'),
    notify: data.notify,
    notifyNameServers: (data.notifyNameServers ?? []).join('\n'),
    notifySecondaryCatalogsNameServers: (data.notifySecondaryCatalogsNameServers ?? []).join('\n'),
    update: data.update,
    updateNetworkACL: formatNetworkAclText(data.updateNetworkACL),
    primaryNameServerAddresses: (data.primaryNameServerAddresses ?? []).join('\n'),
    primaryZoneTransferProtocol: data.primaryZoneTransferProtocol ?? 'Tcp',
    primaryZoneTransferTsigKeyName: data.primaryZoneTransferTsigKeyName || NONE,
    validateZone: data.validateZone ?? false,
    catalog: data.catalog || NONE,
    overrideCatalogNotify: data.overrideCatalogNotify ?? false,
    overrideCatalogQueryAccess: data.overrideCatalogQueryAccess ?? false,
    overrideCatalogZoneTransfer: data.overrideCatalogZoneTransfer ?? false,
  }
}

/** `zones/options/get` -> the editable dynamic-update security policy rows. */
function toPolicyRows(data: ZoneOptions): PolicyRow[] {
  return (data.updateSecurityPolicies ?? []).map((policy) => ({
    domain: policy.domain,
    tsigKeyName: policy.tsigKeyName,
    allowedTypes: policy.allowedTypes.join(', '),
  }))
}

/** An emptied list must still reach the server, and `appendParams` drops `[]`. */
function listOrClear(items: string[]): string[] {
  return items.length > 0 ? items : ['']
}

/** `<textarea>` (one entry per line) -> trimmed non-empty array. */
function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** Comma-separated record types -> trimmed array. */
function splitCsv(text: string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}
