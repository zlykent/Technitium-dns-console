'use client'

import * as React from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * One control of the schema-driven app-config form.
 *
 * The hard part is that Technitium's `apps/config/get` does **not** return a
 * field schema — it returns the app's configuration as a single opaque string
 * (`AppConfigResult = { config: string }`, see `lib/api/types/apps.ts:45`). There
 * is no name/type/default/options metadata to drive a form. So the "schema" is
 * inferred from the parsed JSON's *values* (`inferFieldType` below): a boolean
 * becomes a Switch, a number an `<input type=number>`, a short string an Input,
 * a long/multiline string a Textarea, and any array/object/null a nested JSON
 * Textarea. The `select` branch exists for completeness (an enum with a closed
 * option list) but stays dormant because the live contract never supplies options.
 *
 * Two non-obvious details:
 *
 *  - `number` and `json` are the only types that can be *transiently* invalid
 *    (an emptied number box, a half-typed `{`). Those keep a local text draft and
 *    only call `onChange` once the draft parses, reporting validity through
 *    `onInvalidChange` so the dialog can block Save. The directly-controlled types
 *    (boolean/string/text/select) can never be invalid, so they skip the draft.
 *  - Drafts are seeded once on mount. The dialog remounts the whole field set
 *    (via a `key`) whenever it reloads or restores defaults, which is what resets
 *    a stale draft — there is deliberately no `useEffect` re-syncing draft↔prop,
 *    because that would clobber the operator's cursor mid-keystroke.
 */

export type DynamicFieldType = 'boolean' | 'number' | 'string' | 'text' | 'json' | 'select'

/** Infer the control for a config value. Exported so the dialog can pre-compute. */
export function inferFieldType(value: unknown): DynamicFieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return value.includes('\n') || value.length > 80 ? 'text' : 'string'
  // null, arrays and nested objects are edited as raw JSON.
  return 'json'
}

export interface DynamicFieldProps {
  /** Stable id used for `<label for>` binding. */
  id: string
  /** Visible label — the JSON key, which is app data and never translated. */
  label: string
  value: unknown
  type: DynamicFieldType
  /** Closed option list; only meaningful for `type="select"`. */
  options?: string[]
  /** Muted one-liner under the control. */
  hint?: string
  disabled?: boolean
  /** Emits the parsed value. Called only when the draft is valid. */
  onChange: (next: unknown) => void
  /** Reports whether the current draft cannot be parsed (number/json only). */
  onInvalidChange?: (invalid: boolean) => void
}

export function DynamicField({ id, label, value, type, options, hint, disabled, onChange, onInvalidChange }: DynamicFieldProps) {
  if (type === 'boolean') {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <FieldLabel htmlFor={id} className="font-data text-sm">
            {label}
          </FieldLabel>
          {hint && <FieldDescription className="mt-0.5 text-xs">{hint}</FieldDescription>}
        </div>
        <Switch id={id} checked={Boolean(value)} disabled={disabled} onCheckedChange={(next) => onChange(next)} />
      </div>
    )
  }

  if (type === 'select') {
    return (
      <Field>
        <FieldLabel htmlFor={id} className="font-data">
          {label}
        </FieldLabel>
        <Select value={typeof value === 'string' ? value : ''} onValueChange={(next) => onChange(next)} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((option) => (
              <SelectItem key={option} value={option} className="font-data">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
      </Field>
    )
  }

  if (type === 'number') {
    return (
      <NumberField id={id} label={label} value={value} hint={hint} disabled={disabled} onChange={onChange} onInvalidChange={onInvalidChange} />
    )
  }

  if (type === 'json') {
    return (
      <JsonField id={id} label={label} value={value} hint={hint} disabled={disabled} onChange={onChange} onInvalidChange={onInvalidChange} />
    )
  }

  // string / text — directly controlled, never invalid.
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return (
    <Field>
      <FieldLabel htmlFor={id} className="font-data">
        {label}
      </FieldLabel>
      {type === 'text' ? (
        <Textarea
          id={id}
          className="font-data min-h-20"
          value={text}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input id={id} className="font-data" value={text} spellCheck={false} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  )
}

/** Number box with a local text draft so an emptied/half-typed value is not committed. */
function NumberField({
  id,
  label,
  value,
  hint,
  disabled,
  onChange,
  onInvalidChange,
}: {
  id: string
  label: string
  value: unknown
  hint?: string
  disabled?: boolean
  onChange: (next: unknown) => void
  onInvalidChange?: (invalid: boolean) => void
}) {
  const [draft, setDraft] = React.useState(() => (typeof value === 'number' && Number.isFinite(value) ? String(value) : ''))
  const [invalid, setInvalid] = React.useState(false)

  function update(raw: string) {
    setDraft(raw)
    const parsed = Number(raw)
    const ok = raw.trim() !== '' && Number.isFinite(parsed)
    setInvalid(!ok)
    onInvalidChange?.(!ok)
    if (ok) onChange(parsed)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id} className="font-data">
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        className="font-data"
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => update(event.target.value)}
      />
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  )
}

/** Nested array/object/null edited as a JSON blob; commits only when it parses. */
function JsonField({
  id,
  label,
  value,
  hint,
  disabled,
  onChange,
  onInvalidChange,
}: {
  id: string
  label: string
  value: unknown
  hint?: string
  disabled?: boolean
  onChange: (next: unknown) => void
  onInvalidChange?: (invalid: boolean) => void
}) {
  const [draft, setDraft] = React.useState(() => safeStringify(value))
  const [invalid, setInvalid] = React.useState(false)

  function update(raw: string) {
    setDraft(raw)
    try {
      const parsed = JSON.parse(raw)
      setInvalid(false)
      onInvalidChange?.(false)
      onChange(parsed)
    } catch {
      setInvalid(true)
      onInvalidChange?.(true)
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={id} className="font-data">
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        className={cn('font-data min-h-24', invalid && 'border-destructive focus-visible:ring-destructive/30')}
        value={draft}
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => update(event.target.value)}
      />
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null'
  } catch {
    return ''
  }
}
