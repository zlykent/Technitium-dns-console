'use client'

import { useTranslations } from 'next-intl'
import { Eye, EyeOff, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useFormContext, useController, type FieldPath } from 'react-hook-form'
import { Section } from '@/components/app/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  FIELD_LABEL_KEYS,
  RESTART_FIELDS,
  SECTION_FIELDS,
  type SectionId,
  type SettingsFieldName,
} from '@/components/settings/settings-fields'
import type { SettingsFormValues } from '@/components/settings/settings-schema'

/**
 * Shared field furniture for the settings page.
 *
 * 132 controls that all need the same label / help / error / restart-badge
 * treatment, plus a search filter that has to hide *individual fields* and
 * *whole sections*. Both are solved here so the sixteen section files stay
 * declarative. Non-obvious parts:
 *
 *  - **Filtering is context-driven, not prop-driven.** A field returns `null`
 *    when it does not match; a section returns `null` when none of its fields
 *    do. Doing it with props would mean every section re-implementing the same
 *    `some(matches)` reduction, and the section cannot know its children's
 *    names without an explicit `fields` list — which it passes anyway, because
 *    React children are opaque.
 *  - **Labels are looked up, not passed.** `FIELD_LABEL_KEYS` maps the API
 *    parameter name to a message key, so the label, the search index and the
 *    `{other}` slot of the port-conflict error can never disagree. A field with
 *    no entry degrades to its raw parameter name instead of throwing.
 *  - **Number inputs use `valueAsNumber`.** An emptied `<input type=number>`
 *    then yields `NaN` and fails `z.number()` with "invalid number", rather
 *    than silently becoming `0` — which for `webServiceHttpPort` would mean
 *    saving a server that no longer listens.
 *  - **The restart badge is derived, not declared per call site**, so adding a
 *    field to `RESTART_FIELDS` is the only change needed.
 */

/** Field name as react-hook-form wants it; every settings field is top level. */
export type SettingsPath = FieldPath<SettingsFormValues>

// ------------------------------------------------------------------- filtering

export interface SettingsFilterValue {
  query: string
  /** Trimmed, lower-cased `query` — empty means "show everything". */
  needle: string
  matches: (field: string) => boolean
}

const SettingsFilterContext = React.createContext<SettingsFilterValue>({
  query: '',
  needle: '',
  matches: () => true,
})

export function useSettingsFilter(): SettingsFilterValue {
  return React.useContext(SettingsFilterContext)
}

/**
 * next-intl's `t` is typed against the literal key union of the namespace, but
 * `FIELD_LABEL_KEYS` is a `Record<string, string>` (it has to be — it is also
 * the search index). Widening once here keeps every call site clean.
 */
type LooseTranslator = (key: string, values?: Record<string, unknown>) => string

/**
 * Builds the filter value. Exposed as a hook (rather than computed inside the
 * provider) because the view needs the very same predicate to decide which
 * panels — and therefore which nav entries — exist at all. Two independently
 * derived notions of "matches" would let the nav list a panel that is not
 * rendered, and `scrollToSection` would then silently do nothing.
 */
export function useSettingsFilterValue(query: string): SettingsFilterValue {
  const t = useTranslations('settings')

  return React.useMemo<SettingsFilterValue>(() => {
    const needle = query.trim().toLowerCase()
    const tr = t as unknown as LooseTranslator
    return {
      query,
      needle,
      matches(field) {
        if (needle === '') return true
        if (field.toLowerCase().includes(needle)) return true
        const key = FIELD_LABEL_KEYS[field]
        if (!key) return false
        // A missing key would throw in next-intl; the index is checked by hand
        // but a future field must not take the whole page down with it.
        try {
          return tr(key).toLowerCase().includes(needle)
        } catch {
          return false
        }
      },
    }
  }, [query, t])
}

export function SettingsFilterProvider({ value, children }: { value: SettingsFilterValue; children: React.ReactNode }) {
  return <SettingsFilterContext.Provider value={value}>{children}</SettingsFilterContext.Provider>
}

// --------------------------------------------------------------------- actions

export interface SettingsActionsValue {
  /** `false` when the operator lacks `Settings.canModify`. */
  disabled: boolean
  /** Section whose "save this section" mutation is in flight, if any. */
  savingSection: SectionId | null
  saveSection: (id: SectionId) => void
  /**
   * Whether a parameter is actually submitted for the current node selection.
   * Cluster-wide settings are inert when a single node is targeted, and
   * node-local ones are inert when `cluster` is — greyed out rather than
   * silently dropped, which is what the stock console does.
   */
  applies: (field: string) => boolean
}

const SettingsActionsContext = React.createContext<SettingsActionsValue | null>(null)

export function SettingsActionsProvider({ value, children }: { value: SettingsActionsValue; children: React.ReactNode }) {
  return <SettingsActionsContext.Provider value={value}>{children}</SettingsActionsContext.Provider>
}

export function useSettingsActions(): SettingsActionsValue | null {
  return React.useContext(SettingsActionsContext)
}

// ---------------------------------------------------------------- section search

/**
 * Fields a section is searchable by. `tsig` owns no react-hook-form field but
 * still has a label entry, so it gets one synthesised term.
 */
export function sectionFieldsFor(id: SectionId): readonly string[] {
  return id === 'tsig' ? ['tsigKeys'] : SECTION_FIELDS[id]
}

/**
 * Shared by `SettingsSection` and the view's "nothing matched" empty state, so
 * the two can never disagree about whether a panel should have been rendered.
 */
export function isSectionVisible(sectionLabel: string, fields: readonly string[], filter: SettingsFilterValue): boolean {
  if (filter.needle === '') return true
  if (sectionLabel.toLowerCase().includes(filter.needle)) return true
  return fields.some((field) => filter.matches(field))
}

/**
 * The single predicate both `SettingsSection` and the view's nav/empty-state use.
 * They must agree: a nav entry pointing at a panel that decided to hide itself
 * would make `scrollToSection` a silent no-op.
 */
export function isPanelVisible(
  translate: LooseTranslator,
  id: SectionId,
  title: string,
  filter: SettingsFilterValue,
): boolean {
  // The nav label is checked as well as the panel heading: searching "缓存" must
  // find the cache panel even though no parameter name contains the word.
  return (
    isSectionVisible(title, sectionFieldsFor(id), filter) ||
    translate(`sections.${id}`).toLowerCase().includes(filter.needle)
  )
}

// ----------------------------------------------------------------------- shell

/**
 * Props `FieldShell` hands to the control so `id`, `aria-invalid` and
 * `aria-describedby` always agree with the rendered label and error. A render
 * prop rather than `cloneElement`: React 19 types `ReactElement.props` as
 * `unknown`, so cloning cannot be done without a cast that hides real errors.
 */
export interface FieldControlProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  disabled?: boolean
}

interface FieldShellProps {
  /** API parameter name; also the label key lookup and the search term. */
  name: string
  /** Long help text under the label. */
  help?: string
  required?: boolean
  error?: string
  disabled?: boolean
  /** `row` puts the control at the trailing edge — the switch layout. */
  layout?: 'stack' | 'row'
  className?: string
  children: (props: FieldControlProps) => React.ReactNode
}

/** Label + optional restart badge + help + control + error, filter-aware. */
function FieldShell({ name, help, required, error, disabled, layout = 'stack', className, children }: FieldShellProps) {
  const { matches } = useSettingsFilter()
  const actions = useSettingsActions()
  const t = useTranslations('settings')

  if (!matches(name)) return null

  // A field the current node selection would not submit is inert, not merely
  // dimmed: leaving it editable invites the operator to "save" a change that
  // `buildPatch` will drop on the floor.
  const inert = actions ? !actions.applies(name) : false
  const labelKey = FIELD_LABEL_KEYS[name]
  const label = labelKey ? (t as unknown as LooseTranslator)(labelKey) : name
  const id = `settings-field-${name}`
  const errorId = `${id}-error`
  const helpId = help ? `${id}-help` : undefined
  const describedBy = [helpId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
  const restart = RESTART_FIELDS.has(name as SettingsFieldName)
  const effectiveDisabled = Boolean(disabled) || inert

  const labelNode = (
    <FieldLabel htmlFor={id} required={required} className="gap-1.5 text-sm">
      <span>{label}</span>
      {restart && (
        <Badge variant="warning" className="gap-1 px-1.5 py-0 text-[10px]">
          <RotateCcw className="size-2.5" aria-hidden />
          {t('restartBadge')}
        </Badge>
      )}
    </FieldLabel>
  )

  if (layout === 'row') {
    return (
      <FieldRow className={cn('border-b border-border/40 last:border-0', className)}>
        <div className="min-w-0 flex-1">
          {labelNode}
          {help && (
            <FieldDescription id={helpId} className="mt-0.5 text-xs">
              {help}
            </FieldDescription>
          )}
          <FieldError id={errorId}>{error}</FieldError>
        </div>
        <div className="shrink-0 pt-0.5">{children({ id, disabled: effectiveDisabled })}</div>
      </FieldRow>
    )
  }

  return (
    <Field className={className}>
      {labelNode}
      {help && (
        <FieldDescription id={helpId} className="text-xs">
          {help}
        </FieldDescription>
      )}
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        disabled: effectiveDisabled,
      })}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}

// --------------------------------------------------------------- text controls

interface TextControlProps {
  name: SettingsPath
  help?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  /** Monospace — for paths, headers, sockets and other technical values. */
  mono?: boolean
  className?: string
  inputClassName?: string
}

export function SettingsTextField({ name, help, required, disabled, placeholder, mono, className, inputClassName }: TextControlProps) {
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })

  return (
    <FieldShell name={name} help={help} required={required} disabled={disabled} error={fieldState.error?.message} className={className}>
      {(props) => (
        <Input
          {...props}
          value={String(field.value ?? '')}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(mono && 'font-data', inputClassName)}
        />
      )}
    </FieldShell>
  )
}

/**
 * Secret field with a reveal toggle. `settings/get` returns TLS certificate and
 * proxy passwords in clear text, so the default is masked and the operator opts
 * in — the opposite of a login form, where the value is never known.
 */
export function SettingsPasswordField({ name, help, disabled, placeholder, className }: TextControlProps) {
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })
  const t = useTranslations('settings')
  const [revealed, setRevealed] = React.useState(false)

  const toggleLabel = revealed ? t('hidePassword') : t('showPassword')

  return (
    <FieldShell name={name} help={help} disabled={disabled} error={fieldState.error?.message} className={className}>
      {(props) => (
        <div className="relative">
          <Input
            {...props}
            type={revealed ? 'text' : 'password'}
            value={String(field.value ?? '')}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
            ref={field.ref}
            placeholder={placeholder}
            autoComplete="new-password"
            className="font-data pr-9"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setRevealed((value) => !value)}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
          >
            {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
      )}
    </FieldShell>
  )
}

interface NumberControlProps {
  name: SettingsPath
  help?: string
  required?: boolean
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  /** Narrow the control — ports and TTLs do not need the full column. */
  compact?: boolean
}

export function SettingsNumberField({ name, help, required, disabled, min, max, step = 1, placeholder, className, compact }: NumberControlProps) {
  const { register, formState } = useFormContext<SettingsFormValues>()
  const error = formState.errors[name]?.message as string | undefined
  const registered = register(name, { valueAsNumber: true })

  return (
    <FieldShell name={name} help={help} required={required} disabled={disabled} error={error} className={className}>
      {(props) => (
        <Input
          {...registered}
          {...props}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          autoComplete="off"
          className={cn('font-data', compact && 'sm:max-w-40')}
        />
      )}
    </FieldShell>
  )
}

interface TextareaControlProps {
  name: SettingsPath
  help?: string
  disabled?: boolean
  placeholder?: string
  rows?: number
  className?: string
}

/**
 * Multi-line list control. The raw textarea text *is* the form value; splitting
 * happens in `buildPatch` via the SDK's `parseLineList`, so what the operator
 * sees is exactly what gets validated.
 */
export function SettingsTextareaField({ name, help, disabled, placeholder, rows = 4, className }: TextareaControlProps) {
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })

  return (
    <FieldShell name={name} help={help} disabled={disabled} error={fieldState.error?.message} className={className}>
      {(props) => (
        <Textarea
          {...props}
          value={String(field.value ?? '')}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
          rows={rows}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="font-data text-xs"
        />
      )}
    </FieldShell>
  )
}

// ------------------------------------------------------------- switch / select

interface SwitchControlProps {
  name: SettingsPath
  help?: string
  disabled?: boolean
  className?: string
}

export function SettingsSwitchField({ name, help, disabled, className }: SwitchControlProps) {
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell name={name} help={help} disabled={disabled} error={fieldState.error?.message} layout="row" className={className}>
      {(props) => <Switch {...props} checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
    </FieldShell>
  )
}

export interface SettingsSelectOption {
  value: string
  label: string
}

interface SelectControlProps {
  name: SettingsPath
  options: readonly SettingsSelectOption[]
  help?: string
  disabled?: boolean
  className?: string
}

/**
 * Enum control. Mounted with its final value already in place — see the note in
 * `components/zones/zone-options-view.tsx:150`: resetting a live Radix `Select`
 * to a value whose item is not rendered blanks it silently.
 */
export function SettingsSelectField({ name, options, help, disabled, className }: SelectControlProps) {
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell name={name} help={help} disabled={disabled} error={fieldState.error?.message} className={className}>
      {(props) => (
        <Select value={String(field.value ?? '')} onValueChange={field.onChange} disabled={disabled} name={field.name}>
          <SelectTrigger {...props} className="font-data">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  )
}

// ------------------------------------------------------------------ composite

/**
 * Label/help/error furniture around an arbitrary control — the escape hatch for
 * the two fields that are not a single input (the QPM rule tables). Filtering
 * and labelling still come from `FieldShell`, so a composite field stays
 * searchable like any other.
 */
export function SettingsCompositeField({
  name,
  help,
  disabled,
  error,
  className,
  children,
}: {
  name: string
  help?: string
  disabled?: boolean
  error?: string
  className?: string
  children: (props: FieldControlProps) => React.ReactNode
}) {
  return (
    <FieldShell name={name} help={help} disabled={disabled} error={error} className={className}>
      {children}
    </FieldShell>
  )
}

interface ReadonlyControlProps {
  name: string
  value: React.ReactNode
  help?: string
  mono?: boolean
  className?: string
}

/**
 * Value with no write side (`version`, `uptimestamp`, `clusterInitialized`,
 * `preferIPv6`). Still filterable and still labelled, so search finds it.
 */
export function SettingsReadonlyField({ name, value, help, mono = true, className }: ReadonlyControlProps) {
  return (
    <FieldShell name={name} help={help} className={className}>
      {() => (
        <div
          aria-label={typeof value === 'string' ? value : undefined}
          className={cn('surface-raised flex h-9 items-center rounded-md border border-border/60 px-3 text-sm', mono && 'font-data')}
        >
          {value}
        </div>
      )}
    </FieldShell>
  )
}

// ---------------------------------------------------------------------- layout

/** Responsive control grid; `null` children (filtered out) leave no gap. */
export function SettingsFieldGrid({ children, columns = 2, className }: { children: React.ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-x-6 gap-y-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

// --------------------------------------------------------------------- section

/**
 * Sub-heading inside a panel. Panels with 16+ controls (`webService`,
 * `dnsOverX`) need internal grouping to stay scannable, and the heading is
 * deliberately not a `Section`: nested `surface` cards read as separate pages.
 */
export function SettingsGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      {children}
    </div>
  )
}

export interface SettingsSectionProps {
  id: SectionId
  /** Heading; usually the section-specific `*.title` key when one exists. */
  title: string
  description?: React.ReactNode
  /** Extra buttons; the shared "save this section" button is appended. */
  actions?: React.ReactNode
  /** Inline warning rendered above the fields. */
  banner?: React.ReactNode
  /** Suppress the "save this section" button (action-only panels). */
  hideSave?: boolean
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

/**
 * One anchored panel. Hidden entirely when a search is active and nothing in it
 * matches, so the operator is never left scrolling through empty cards.
 */
export function SettingsSection({ id, title, description, actions, banner, hideSave = false, children, className, contentClassName }: SettingsSectionProps) {
  const t = useTranslations('settings')
  const filter = useSettingsFilter()

  // Field ownership comes from `sectionFieldsFor(id)`, not from props: React
  // children are opaque, and a hand-maintained list per panel would drift from
  // `SECTION_FIELDS` — which is what `buildPatch`, `form.trigger` and the nav all
  // read. One source of truth keeps them in step.
  const visible = React.useMemo(
    () => isPanelVisible(t as unknown as LooseTranslator, id, title, filter),
    [t, id, title, filter],
  )

  if (!visible) return null

  return (
    // `scroll-mt` clears the sticky save bar when the nav anchor jumps here.
    <div id={`settings-${id}`} data-settings-section={id} className="scroll-mt-28">
      <Section
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {!hideSave && <SectionSaveButton id={id} />}
          </>
        }
        className={className}
        contentClassName={cn('flex flex-col gap-4', contentClassName)}
      >
        {banner}
        {children}
      </Section>
    </div>
  )
}

/**
 * Per-panel save. Present on every panel that owns submittable parameters, so a
 * risky change (`webServiceHttpPort`) can be committed on its own instead of
 * dragging eleven unrelated edits along with it.
 */
export function SectionSaveButton({ id }: { id: SectionId }) {
  const t = useTranslations('settings')
  const actions = useSettingsActions()
  if (!actions) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={actions.disabled}
      loading={actions.savingSection === id}
      onClick={() => actions.saveSection(id)}
    >
      {actions.savingSection === id ? t('saving') : t('save')}
    </Button>
  )
}
