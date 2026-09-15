'use client'

import { useTranslations } from 'next-intl'
import { CirclePlus } from 'lucide-react'
import * as React from 'react'
import { ErrorState } from '@/components/app/states'
import { RecordSummary } from '@/components/records/record-summary'
import { RecordTypeFields } from '@/components/records/record-type-fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { WRITABLE_RECORD_TYPES } from '@/lib/api/domains/records'
import { type RecordType } from '@/lib/api/enums'
import { readRecordFieldValue, specFor } from '@/lib/api/record-params'
import type { DnsRecord } from '@/lib/api/types/zones'
import { parseTtl, splitRecordName } from '@/lib/format'

/**
 * Unified add/edit record dialog.
 *
 * One component serves both directions because Technitium's `add` and `update`
 * share the same per-type field matrix (`lib/api/record-params.ts`); only the
 * surrounding chrome differs. The deliberate choices:
 *
 *  - **Controlled state, not react-hook-form.** The field set is generated from
 *    the SPEC at runtime and changes when the operator switches type, so a
 *    static zod schema would have to be rebuilt on every keystroke. A single
 *    `Record<string, unknown>` bag keyed by `field.add` is simpler and maps 1:1
 *    onto what `buildAddFields`/`buildUpdateFields` consume. Required-field and
 *    TTL validation are done by hand on submit.
 *  - **Owner name is relative.** The input shows the label (`www`), and
 *    `resolveDomain` re-attaches the zone (`www.example.com`) on submit. Blank
 *    or `@` means the apex. Editing prefills from `splitRecordName`.
 *  - **`disable` on add is a follow-up write.** `zones/records/add` has no
 *    `disable` parameter, so "create disabled" is expressed by the parent
 *    chaining `setRecordState(addedRecord, …, true)` after a successful add —
 *    see the `RecordEditorResult.disable` flag.
 *  - **Update identity is implicit.** The parent passes the whole `DnsRecord`
 *    back to `updateRecord`, which reads the current values for the identity
 *    half of the body; this dialog only collects the *new* values plus the
 *    rename target (`newDomain`).
 */

/** Payload handed to the parent, which owns the mutation + invalidation. */
export interface RecordEditorResult {
  mode: 'add' | 'update'
  type: RecordType
  /** For update: the record's current owner name (identity). For add: resolved owner. */
  domain: string
  /** Resolved owner name after the edit (rename target for update). */
  newDomain: string
  ttl: number
  comments: string
  expiryTtl: number
  overwrite: boolean
  /** Add: create-then-disable. Update: the record's new disabled flag. */
  disable: boolean
  values: Record<string, unknown>
  current: DnsRecord | null
}

export interface RecordEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zone: string
  /** `null` = add mode; a record = edit mode. */
  record: DnsRecord | null
  /** Owner label to prefill in add mode. */
  defaultName?: string
  /** Record type to prefill in add mode. */
  defaultType?: RecordType
  onSubmit: (result: RecordEditorResult) => Promise<void>
  pending?: boolean
  error?: unknown
  /** Offered on NS records so the operator can add an address glue record. */
  onAddGlue?: (record: DnsRecord) => void
}

/**
 * Fallback for the `{default}` in `form.ttlHelp`. Technitium's real default
 * lives in the server's `dnsTtl` setting, which this endpoint does not return;
 * 3600 is the console's own default and is only used as hint copy.
 */
const SERVER_DEFAULT_TTL = 3600

/** Quick-pick TTLs, in seconds. */
const TTL_PRESETS = [300, 3600, 14400, 86400] as const

/** Types with at most one record per owner name — editing replaces in place. */
const SINGLETON_TYPES = new Set<RecordType>(['SOA', 'CNAME', 'DNAME', 'APP'])

export function RecordEditorDialog({
  open,
  onOpenChange,
  zone,
  record,
  defaultName = '',
  defaultType = 'A',
  onSubmit,
  pending = false,
  error,
  onAddGlue,
}: RecordEditorDialogProps) {
  const t = useTranslations('records')
  const tc = useTranslations('common')
  const isEdit = record !== null

  // The parent remounts this dialog with a fresh `key` for every open session,
  // so all state is seeded straight from props here — no reset effect (which
  // would cascade renders). Remounting is what stops one row's rename /
  // "create disabled" / rData edits from leaking into the next row opened.
  const [type, setType] = React.useState<RecordType>(record?.type ?? defaultType)
  const [name, setName] = React.useState(record ? labelOf(record.name, zone) : defaultName)
  const [values, setValues] = React.useState<Record<string, unknown>>(() => (record ? prefill(record) : {}))
  const [ttlText, setTtlText] = React.useState(record ? record.ttlString?.trim() || String(record.ttl ?? '') : '')
  const [expiryText, setExpiryText] = React.useState(
    record && record.expiryTtl && record.expiryTtl > 0 ? String(record.expiryTtl) : '',
  )
  const [comments, setComments] = React.useState(record?.comments ?? '')
  const [overwrite, setOverwrite] = React.useState(false)
  const [disableFlag, setDisableFlag] = React.useState(record?.disabled ?? false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [ttlError, setTtlError] = React.useState<string | undefined>()
  const [expiryError, setExpiryError] = React.useState<string | undefined>()
  const [showRequired, setShowRequired] = React.useState(false)
  const [rawOpen, setRawOpen] = React.useState(false)

  const setValue = React.useCallback((add: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [add]: value }))
    setErrors((prev) => {
      if (!(add in prev)) return prev
      const next = { ...prev }
      delete next[add]
      return next
    })
  }, [])

  function changeType(next: RecordType) {
    setType(next)
    setValues({})
    setErrors({})
    setShowRequired(false)
  }

  function handleSubmit() {
    const nextErrors: Record<string, string> = {}
    for (const field of specFor(type)) {
      if (!field.required) continue
      const raw = values[field.add]
      const blank = raw === undefined || raw === null || String(raw).trim() === ''
      if (blank) nextErrors[field.add] = tc('form.required')
    }

    const ttlSeconds = resolveSeconds(ttlText)
    const expirySeconds = resolveSeconds(expiryText)
    const nextTtlError = ttlSeconds === null ? tc('form.invalidNumber') : undefined
    const nextExpiryError = expirySeconds === null ? tc('form.invalidNumber') : undefined

    setErrors(nextErrors)
    setTtlError(nextTtlError)
    setExpiryError(nextExpiryError)

    if (Object.keys(nextErrors).length > 0 || nextTtlError || nextExpiryError) {
      setShowRequired(true)
      return
    }

    const resolvedNew = resolveDomain(name, zone)
    void onSubmit({
      mode: isEdit ? 'update' : 'add',
      type,
      domain: record ? record.name : resolvedNew,
      newDomain: resolvedNew,
      ttl: ttlSeconds ?? 0,
      comments: comments.trim(),
      expiryTtl: expirySeconds ?? 0,
      overwrite,
      disable: disableFlag,
      values,
      current: record,
    })
  }

  const glue = record?.glueRecords ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.editTitle') : t('form.addTitle')}</DialogTitle>
          <DialogDescription>{t(`types.${type}.hint`)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ---------------------------------------------------------- owner */}
          <Field>
            <FieldLabel htmlFor="rec-domain">{t('form.domain')}</FieldLabel>
            <Input
              id="rec-domain"
              className="font-data"
              value={name}
              placeholder={t('form.domainPlaceholder')}
              spellCheck={false}
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>{t('form.domainHelp', { zone })}</FieldDescription>
          </Field>

          {/* ----------------------------------------------------------- type */}
          <Field>
            <FieldLabel htmlFor="rec-type">{t('form.type')}</FieldLabel>
            {isEdit ? (
              <div>
                <Badge variant="secondary">{t(`types.${type}.label`)}</Badge>
              </div>
            ) : (
              <>
                <Select value={type} onValueChange={(next) => changeType(next as RecordType)} disabled={pending}>
                  <SelectTrigger id="rec-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WRITABLE_RECORD_TYPES.map((rt) => (
                      <SelectItem key={rt} value={rt}>
                        {t(`types.${rt}.label`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t('form.typeHelp')}</FieldDescription>
              </>
            )}
          </Field>

          {/* --------------------------------------------- current (edit only) */}
          {isEdit && record ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">{t('form.currentValues')}</span>
              <RecordSummary record={record} />
              <p className="text-xs text-muted-foreground">{t('form.identityHint')}</p>
              {SINGLETON_TYPES.has(type) ? (
                <p className="text-xs text-muted-foreground">{t('form.soaSingleHint')}</p>
              ) : null}
            </div>
          ) : null}

          {/* --------------------------------------------------- rData fields */}
          <div className="flex flex-col gap-3">
            {isEdit ? (
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('form.newValues')}
              </span>
            ) : null}
            <RecordTypeFields
              type={type}
              values={values}
              onChange={setValue}
              errors={errors}
              disabled={pending}
              idPrefix="rec"
            />
          </div>

          {/* ------------------------------------------------- NS glue (edit) */}
          {isEdit && type === 'NS' ? (
            <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
              <span className="text-xs font-medium">{t('form.glueRecords')}</span>
              <p className="text-xs text-muted-foreground">{t('form.glueHint')}</p>
              {glue.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {glue.map((g, index) => (
                    <li key={`${g.name}-${g.type}-${index}`} className="flex items-center gap-2 text-xs">
                      <Badge variant="muted">{g.type}</Badge>
                      <span className="font-data truncate text-muted-foreground">{g.name}</span>
                      <RecordSummary record={g} className="min-w-0" />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
              {onAddGlue && record ? (
                <Button type="button" variant="outline" size="xs" className="w-fit" onClick={() => onAddGlue(record)} disabled={pending}>
                  <CirclePlus className="size-3.5" aria-hidden />
                  {t('form.addGlue')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* ------------------------------------------------------------ ttl */}
          <Field>
            <FieldLabel htmlFor="rec-ttl">{t('form.ttl')}</FieldLabel>
            <Input
              id="rec-ttl"
              className="font-data"
              value={ttlText}
              placeholder="3600"
              spellCheck={false}
              autoComplete="off"
              disabled={pending}
              aria-invalid={ttlError ? true : undefined}
              onChange={(event) => {
                setTtlText(event.target.value)
                setTtlError(undefined)
              }}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('form.ttlPreset')}</span>
              {TTL_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => setTtlText(String(preset))}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <FieldDescription>{t('form.ttlHelp', { default: SERVER_DEFAULT_TTL })}</FieldDescription>
            <FieldError>{ttlError}</FieldError>
          </Field>

          {/* ------------------------------------------------------ expiryTtl */}
          <Field>
            <FieldLabel htmlFor="rec-expiry">{t('form.expiryTtl')}</FieldLabel>
            <Input
              id="rec-expiry"
              className="font-data"
              value={expiryText}
              placeholder="0"
              spellCheck={false}
              autoComplete="off"
              disabled={pending}
              aria-invalid={expiryError ? true : undefined}
              onChange={(event) => {
                setExpiryText(event.target.value)
                setExpiryError(undefined)
              }}
            />
            <FieldDescription>{t('form.expiryTtlHelp')}</FieldDescription>
            <FieldError>{expiryError}</FieldError>
          </Field>

          {/* ------------------------------------------------------- comments */}
          <Field>
            <FieldLabel htmlFor="rec-comments">{t('form.comments')}</FieldLabel>
            <Textarea
              id="rec-comments"
              value={comments}
              spellCheck={false}
              disabled={pending}
              onChange={(event) => setComments(event.target.value)}
            />
            <FieldDescription>{t('form.commentsHelp')}</FieldDescription>
          </Field>

          {/* ------------------------------------------- overwrite / disabled */}
          {isEdit ? (
            <SwitchRow id="rec-disable" label={t('status.disabled')} checked={disableFlag} disabled={pending} onChange={setDisableFlag} />
          ) : (
            <>
              <SwitchRow
                id="rec-overwrite"
                label={t('form.overwrite')}
                help={t('form.overwriteHelp')}
                checked={overwrite}
                disabled={pending}
                onChange={setOverwrite}
              />
              <SwitchRow
                id="rec-create-disabled"
                label={t('form.disabledField')}
                checked={disableFlag}
                disabled={pending}
                onChange={setDisableFlag}
              />
            </>
          )}

          {/* --------------------------------------------------- raw (edit) */}
          {isEdit && record ? (
            <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="rounded-md border border-border">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="xs" className="w-full justify-start text-muted-foreground">
                  {t('form.rawData')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3">
                <p className="mb-2 text-xs text-muted-foreground">{t('form.rawHint')}</p>
                <pre className="font-data max-h-56 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">
                  {JSON.stringify(record.rData ?? {}, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {showRequired && Object.keys(errors).length > 0 ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t('form.requiredMissing')}
            </p>
          ) : null}

          {error ? <ErrorState error={error} compact /> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc('actions.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} loading={pending}>
            {pending ? t('form.submitting') : t('form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Label + Switch on one row, matching the zone options dialog's switch rows. */
function SwitchRow({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  help?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <FieldLabel htmlFor={id} className="text-sm font-normal">
          {label}
        </FieldLabel>
        {help ? <p className="mt-0.5 text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

/** The relative label to show in the owner input; `@` becomes blank. */
function labelOf(name: string, zone: string): string {
  const { label } = splitRecordName(name, zone)
  return label === '@' ? '' : label
}

/**
 * Turn the operator's owner input into an FQDN. Blank/`@` is the apex; a value
 * already inside the zone is kept verbatim; anything else is suffixed.
 */
function resolveDomain(input: string, zone: string): string {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed === '@') return zone
  const lower = trimmed.toLowerCase()
  if (lower === zone.toLowerCase() || lower.endsWith(`.${zone.toLowerCase()}`)) return trimmed
  return `${trimmed}.${zone}`
}

/** Blank means "server default" (0); otherwise parse `1h30m`-style or plain seconds. */
function resolveSeconds(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return parseTtl(trimmed)
}

/** Build the initial form bag for a record from its rData via the SPEC. */
function prefill(record: DnsRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of specFor(record.type)) {
    const raw = readRecordFieldValue(field, record.rData as Record<string, unknown>, 'form')
    if (field.kind === 'boolean') {
      out[field.add] = raw === true || raw === 'true'
    } else if (raw === undefined || raw === null) {
      out[field.add] = ''
    } else {
      out[field.add] = String(raw)
    }
  }
  return out
}
