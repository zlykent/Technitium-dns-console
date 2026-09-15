'use client'

import { useTranslations } from 'next-intl'
import { RotateCcw, Terminal, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { ResolverPicker, CUSTOM_RESOLVER } from '@/components/resolve/resolver-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { QUERY_RECORD_TYPES, RESOLVER_PROTOCOLS, type QueryRecordType, type ResolverProtocol } from '@/lib/api/enums'

/**
 * Query form for the DNS client tool.
 *
 * Deliberately plain controlled state, not `react-hook-form`: it is a handful of
 * independent controls with two "is it non-empty" validations, and the whole
 * point of a diagnostic tool is that Enter in the domain box fires the query
 * immediately. A `<form>` with a real submit button gives us that for free, so
 * the submit button is never `disabled` on validity grounds (that would swallow
 * implicit submission) — instead an invalid submit flips `touched` and renders
 * inline `FieldError`s.
 *
 * Two behaviours copied from the stock console (`dnsclient.js`):
 *  - choosing a DoH preset switches `protocol` to HTTPS in the same tick;
 *    choosing a plain address downgrades a secure transport back to UDP so you
 *    cannot accidentally ask `8.8.8.8` over DoH.
 *  - `import` is a write side-effect, so it is gated on `canModify` and its
 *    toggle is disabled (not hidden) for read-only operators.
 */

export interface ResolveFormValues {
  /** Preset address or `CUSTOM_RESOLVER`. */
  preset: string
  customServer: string
  domain: string
  type: QueryRecordType
  protocol: ResolverProtocol
  dnssec: boolean
  eDnsClientSubnet: string
  import: boolean
}

/** The server string actually sent to `dnsClient/resolve`. */
export function effectiveServer(values: ResolveFormValues): string {
  return values.preset === CUSTOM_RESOLVER ? values.customServer.trim() : values.preset.trim()
}

export interface ResolveFormProps {
  values: ResolveFormValues
  onChange: (patch: Partial<ResolveFormValues>) => void
  onSubmit: () => void
  onReset: () => void
  pending?: boolean
  /** Import writes records into a zone — a modify permission. */
  canModify?: boolean
}

export function ResolveForm({ values, onChange, onSubmit, onReset, pending = false, canModify = true }: ResolveFormProps) {
  const t = useTranslations('dnsClient')
  const [touched, setTouched] = React.useState(false)

  const server = effectiveServer(values)
  const domainValid = values.domain.trim().length > 0
  const serverValid = server.length > 0

  function handlePresetChange(preset: string, protocol?: ResolverProtocol) {
    if (preset === CUSTOM_RESOLVER) {
      onChange({ preset })
      return
    }
    if (protocol) {
      onChange({ preset, protocol })
      return
    }
    // Plain address: never leave a secure transport selected against a bare IP.
    const safeProtocol: ResolverProtocol = values.protocol === 'TCP' ? 'TCP' : 'UDP'
    onChange({ preset, protocol: safeProtocol })
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!domainValid || !serverValid) return
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ResolverPicker
          id="resolve-server"
          preset={values.preset}
          customServer={values.customServer}
          onPresetChange={handlePresetChange}
          onCustomServerChange={(customServer) => onChange({ customServer })}
          disabled={pending}
        />
        {touched && !serverValid && (
          <p className="-mt-2 text-sm text-destructive" role="alert">
            {t('form.invalidServer')}
          </p>
        )}

        <Field>
          <FieldLabel htmlFor="resolve-domain" required>
            {t('form.domain')}
          </FieldLabel>
          <Input
            id="resolve-domain"
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-data"
            value={values.domain}
            disabled={pending}
            placeholder={t('form.domainPlaceholder')}
            aria-invalid={touched && !domainValid ? true : undefined}
            onChange={(event) => onChange({ domain: event.target.value })}
          />
          <FieldError>{touched && !domainValid ? t('form.invalidDomain') : undefined}</FieldError>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="resolve-type">{t('form.type')}</FieldLabel>
            <Select value={values.type} onValueChange={(type) => onChange({ type: type as QueryRecordType })} disabled={pending}>
              <SelectTrigger id="resolve-type" className="font-data">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUERY_RECORD_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="font-data">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="resolve-protocol">{t('form.protocol')}</FieldLabel>
            <Select
              value={values.protocol}
              onValueChange={(protocol) => onChange({ protocol: protocol as ResolverProtocol })}
              disabled={pending}
            >
              <SelectTrigger id="resolve-protocol" className="font-data">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLVER_PROTOCOLS.map((protocol) => (
                  <SelectItem key={protocol} value={protocol} className="font-data">
                    {protocol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t('form.protocolHelp')}</FieldDescription>
          </Field>
        </div>
      </div>

      <Field>
        <FieldLabel htmlFor="resolve-subnet">{t('form.eDnsClientSubnet')}</FieldLabel>
        <Input
          id="resolve-subnet"
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="font-data max-w-sm"
          value={values.eDnsClientSubnet}
          disabled={pending}
          placeholder={t('form.eDnsClientSubnetPlaceholder')}
          onChange={(event) => onChange({ eDnsClientSubnet: event.target.value })}
        />
        <FieldDescription>{t('form.eDnsClientSubnetHelp')}</FieldDescription>
      </Field>

      <div className="flex flex-col gap-3">
        <ToggleRow
          id="resolve-dnssec"
          label={t('form.dnssec')}
          description={t('form.dnssecHelp')}
          checked={values.dnssec}
          disabled={pending}
          onCheckedChange={(dnssec) => onChange({ dnssec })}
        />
        <ToggleRow
          id="resolve-import"
          label={t('form.import')}
          description={t('form.importHelp')}
          checked={values.import}
          disabled={pending || !canModify}
          onCheckedChange={(importRecords) => onChange({ import: importRecords })}
        />
        {values.import && (
          // `dnsClient/resolve` has no zone parameter — its query string is
          // exactly `server, domain, type, protocol, dnssec, eDnsClientSubnet,
          // import, node` (`.probe/console-js/endpoints-params.json:801-813`).
          // The server chooses the destination itself, and creates a primary
          // zone when nothing matches, which is why the stock console stops to
          // warn before sending (`.probe/console-js/dnsclient.js:149-152`).
          // Showing that consequence is the only honest option here; a "target
          // zone" field would advertise a choice the API cannot honour.
          <Alert variant="warning" className="ml-11 px-3 py-2 text-xs">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-xs">{t('form.importWarning')}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          {!pending && <Terminal className="size-4" aria-hidden />}
          {pending ? t('form.submitting') : t('form.submit')}
        </Button>
        <Button type="button" variant="outline" onClick={onReset} disabled={pending}>
          <RotateCcw className="size-4" aria-hidden />
          {t('form.reset')}
        </Button>
      </div>
    </form>
  )
}

/** Label + description on the left, `Switch` on the trailing edge. */
function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {label}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
    </div>
  )
}
