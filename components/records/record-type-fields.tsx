'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_MATCHING_TYPES,
  TLSA_SELECTORS,
  type RecordType,
} from '@/lib/api/enums'
import { specFor, type RecordField } from '@/lib/api/record-params'
import { cn } from '@/lib/utils'

/**
 * SPEC-driven rData field renderer.
 *
 * The whole point of `lib/api/record-params.ts` is that the add/edit form is
 * *generated*, not hand-written per type: this component walks `specFor(type)`
 * and paints one control per `RecordField`, keyed by `field.add` (the exact
 * parameter name `addRecord`/`updateRecord` expect). Adding a record type is
 * therefore a SPEC edit, never a new form component.
 *
 * Non-obvious details:
 *
 *  - **Values are `unknown`, not strings.** The parent keeps a single
 *    `Record<string, unknown>` bag; switches store real booleans (so
 *    `encodeFieldValue` emits `false` for an untouched box), text/number fields
 *    store the raw input string. rData number fields (SOA `serial`, MX
 *    `preference`, SRV `port`, …) are plain non-negative integers, so they get
 *    `type="number"` + `inputMode="numeric"`; the `1h30m`-style parsing lives on
 *    the dialog's TTL inputs, not here.
 *  - **`select` fields need an enum source.** `enumRef` names an array in
 *    `lib/api/enums`; the option label is the raw wire value (`RSASHA256`,
 *    `Udp`, `SPKI`) because these are DNS protocol constants with no meaningful
 *    translation and no message keys. APP's `appName`/`classPath` declare
 *    `select` but ship **no** `enumRef` (the console populates them from the
 *    installed-app inventory at runtime), so they degrade to a text input —
 *    flagged in the report.
 *  - **Placeholders are opt-in.** Only ten `placeholders.*` keys exist; passing
 *    any other name to `t()` throws, so a field only gets a placeholder when its
 *    `add` name is in `PLACEHOLDER_KEYS`.
 */

/** `enumRef` (a string in the SPEC) -> the concrete enum array to render. */
const ENUM_BY_REF: Record<string, readonly string[]> = {
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_SELECTORS,
  TLSA_MATCHING_TYPES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
}

/** The subset of `field.add` names that have a `placeholders.*` message. */
const PLACEHOLDER_KEYS = new Set([
  'ipAddress',
  'nameServer',
  'cname',
  'exchange',
  'text',
  'mailbox',
  'target',
  'uri',
  'forwarder',
  'digest',
])

/** Radix `Select` forbids an empty item value; this stands in for "unset". */
const UNSET = '__unset__'

export interface RecordTypeFieldsProps {
  type: RecordType
  /** Form bag keyed by each field's `add` parameter name. */
  values: Record<string, unknown>
  onChange: (add: string, value: unknown) => void
  /** Validation messages keyed by `field.add`; omit for none. */
  errors?: Record<string, string>
  disabled?: boolean
  /** Prefix for control ids so two forms can coexist on a page. */
  idPrefix?: string
  className?: string
}

export function RecordTypeFields({
  type,
  values,
  onChange,
  errors,
  disabled = false,
  idPrefix = 'rf',
  className,
}: RecordTypeFieldsProps) {
  const t = useTranslations('records')
  const fields = React.useMemo(() => specFor(type), [type])

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {fields.map((field) => (
        <RecordFieldControl
          key={field.add}
          field={field}
          id={`${idPrefix}-${field.add}`}
          label={t(`fields.${field.add}`)}
          placeholder={PLACEHOLDER_KEYS.has(field.add) ? t(`placeholders.${field.add}`) : undefined}
          value={values[field.add]}
          error={errors?.[field.add]}
          disabled={disabled}
          onChange={(value) => onChange(field.add, value)}
        />
      ))}
    </div>
  )
}

interface RecordFieldControlProps {
  field: RecordField
  id: string
  label: string
  placeholder?: string
  value: unknown
  error?: string
  disabled: boolean
  onChange: (value: unknown) => void
}

function RecordFieldControl({ field, id, label, placeholder, value, error, disabled, onChange }: RecordFieldControlProps) {
  const text = value === null || value === undefined ? '' : String(value)
  const invalid = Boolean(error)

  if (field.kind === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
        <FieldLabel htmlFor={id} className="text-sm font-normal">
          {label}
        </FieldLabel>
        <Switch id={id} checked={value === true || value === 'true'} onCheckedChange={onChange} disabled={disabled} />
      </div>
    )
  }

  if (field.kind === 'select' && field.enumRef && ENUM_BY_REF[field.enumRef]) {
    const options = ENUM_BY_REF[field.enumRef]
    return (
      <Field>
        <FieldLabel htmlFor={id} required={field.required}>
          {label}
        </FieldLabel>
        <Select
          value={text || UNSET}
          onValueChange={(next) => onChange(next === UNSET ? '' : next)}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-invalid={invalid || undefined}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{placeholder ?? '—'}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option} value={option} className="font-data">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{error}</FieldError>
      </Field>
    )
  }

  if (field.kind === 'textarea' || field.kind === 'pem') {
    return (
      <Field>
        <FieldLabel htmlFor={id} required={field.required}>
          {label}
        </FieldLabel>
        <Textarea
          id={id}
          className="font-data"
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldError>{error}</FieldError>
      </Field>
    )
  }

  // text | domain | ip | number, and `select` with no enum source (APP).
  return (
    <Field>
      <FieldLabel htmlFor={id} required={field.required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        className="font-data"
        type={field.kind === 'number' ? 'number' : 'text'}
        inputMode={field.kind === 'number' ? 'numeric' : field.kind === 'ip' ? 'numeric' : undefined}
        min={field.kind === 'number' ? 0 : undefined}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}
