'use client'

import { useTranslations } from 'next-intl'
import { CalendarRange, ChevronDown, ListFilter, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { Section } from '@/components/app/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DNS_CLASSES,
  QUERY_LOG_PROTOCOLS,
  QUERY_RECORD_TYPES,
  QUERY_RESPONSE_TYPES,
  RESPONSE_CODES,
  type DnsClass,
  type QueryLogProtocol,
  type QueryResponseType,
  type ResponseCode,
} from '@/lib/api/enums'
import { createPersistentStore, usePersistentStore } from '@/lib/hooks/use-persistent-state'
import { cn } from '@/lib/utils'

/**
 * Filter bar for the query-log table.
 *
 * Two things here are easy to get wrong:
 *
 *  - **Nothing is applied on keystroke.** `logs/query` re-scans the app's whole
 *    database server-side, and Technitium's admin API is single-threaded on a
 *    LAN box, so the bar edits a *draft* and only `onApply` publishes it. That
 *    is also why the fields are plain inputs rather than the debounced search
 *    box used by server-paginated *list* endpoints.
 *  - **`logs/query` has no `utc` parameter** (unlike `dashboard/stats/get`), so
 *    `start`/`end` are interpreted against the server's own clock. We therefore
 *    send the naive local timestamp a `datetime-local` control produces and
 *    deliberately do *not* call `toISOString()` — a `Z` suffix would shift the
 *    window by the offset between browser and server.
 *  - The field grid folds into the card head through a `Collapsible` whose
 *    state persists, so an operator who works with the filters folded keeps
 *    them folded across reloads. The active-count badge stays in the head, so
 *    a folded bar never hides that a filter is still on.
 *
 * Radix `Select` rejects an empty `value`, so every "any" option carries the
 * `ANY` sentinel and is mapped back to `''` (which is what the API reads as
 * "no filter") on apply.
 */

/** Sentinel for the "any" entry — Radix `Select` forbids an empty value. */
const ANY = '__any__'

/** Same convention as the sidebar: one flat `localStorage` key per fold. */
const COLLAPSE_KEY = 'tdns.logs.queryFilterCollapsed'

const collapseStore = createPersistentStore<boolean>({
  key: COLLAPSE_KEY,
  parse: (raw) => raw === '1',
  serialize: (collapsed) => (collapsed ? '1' : '0'),
})

export const LOG_RANGES = ['all', 'hour', 'day', 'week', 'custom'] as const
export type LogRange = (typeof LOG_RANGES)[number]

/** Width of each quick range, in milliseconds. */
const RANGE_SPAN: Record<'hour' | 'day' | 'week', number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
}

export interface QueryLogFilterState {
  /** Installed query-logging app, from `apps/list` — the API requires both. */
  name: string
  classPath: string
  /** Quick preset the start/end pair was derived from. */
  range: LogRange
  /** `datetime-local` values; empty means unbounded. */
  start: string
  end: string
  clientIpAddress: string
  protocol: QueryLogProtocol | ''
  responseType: QueryResponseType | ''
  qname: string
  /** Free-form upstream, but the console offers the known record types. */
  qtype: string
  qclass: DnsClass | ''
  rcode: ResponseCode | ''
  descendingOrder: boolean
}

export function createQueryLogFilter(overrides: Partial<QueryLogFilterState> = {}): QueryLogFilterState {
  return {
    name: '',
    classPath: '',
    range: 'all',
    start: '',
    end: '',
    clientIpAddress: '',
    protocol: '',
    responseType: '',
    qname: '',
    qtype: '',
    qclass: '',
    rcode: '',
    descendingOrder: true,
    ...overrides,
  }
}

/**
 * `datetime-local` gives `yyyy-MM-ddTHH:mm`; the server's `DateTime.TryParse`
 * is happier with explicit seconds, and a bare minute precision would make
 * "last 1 hour" silently include the whole current minute.
 */
export function toQueryTimestamp(localInput: string): string {
  const trimmed = localInput.trim()
  if (!trimmed) return ''
  return trimmed.length === 16 ? `${trimmed}:00` : trimmed
}

/** How many fields diverge from "no filter" — drives the active-count badge. */
export function countActiveFilters(state: QueryLogFilterState): number {
  const fields: (string | boolean)[] = [
    Boolean(state.start),
    Boolean(state.end),
    Boolean(state.clientIpAddress.trim()),
    Boolean(state.qname.trim()),
    Boolean(state.qtype),
    Boolean(state.qclass),
    Boolean(state.protocol),
    Boolean(state.responseType),
    Boolean(state.rcode),
  ]
  return fields.filter(Boolean).length
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function rangeToInputs(range: LogRange): { start: string; end: string } {
  if (range === 'all' || range === 'custom') return { start: '', end: '' }
  const end = new Date()
  return { start: toLocalInput(new Date(end.getTime() - RANGE_SPAN[range])), end: toLocalInput(end) }
}

function rangeLabelKey(range: LogRange): string {
  switch (range) {
    case 'hour':
      return 'query.filters.rangeHour'
    case 'day':
      return 'query.filters.rangeDay'
    case 'week':
      return 'query.filters.rangeWeek'
    case 'custom':
      return 'query.filters.rangeCustom'
    default:
      return 'query.filters.rangeAll'
  }
}

export interface QueryLogsFilterProps {
  /** Query-log capable apps from `apps/list`; empty renders the source as fixed. */
  apps: readonly { name: string; classPath: string }[]
  value: QueryLogFilterState
  onApply: (next: QueryLogFilterState) => void
  /** Disables Apply/Reset while the app list is still loading. */
  busy?: boolean
  className?: string
}

export function QueryLogsFilter({ apps, value, onApply, busy = false, className }: QueryLogsFilterProps) {
  const t = useTranslations('logs')
  const responseLabel = useResponseLabel()
  const [draft, setDraft] = React.useState<QueryLogFilterState>(value)
  const [collapsed, setCollapsed] = usePersistentStore(collapseStore)
  const [mirrored, setMirrored] = React.useState({ name: value.name, classPath: value.classPath })

  // The view fills the app identity in once `apps/list` resolves. Mirror only
  // that pair, in the render phase: syncing the whole object would wipe an
  // in-progress edit every time a background refetch produced a new `value`
  // reference, and deferring it to an effect would paint one frame of an empty
  // source `Select` before correcting itself.
  if (mirrored.name !== value.name || mirrored.classPath !== value.classPath) {
    setMirrored({ name: value.name, classPath: value.classPath })
    setDraft((prev) => ({ ...prev, name: value.name, classPath: value.classPath }))
  }

  const patch = (next: Partial<QueryLogFilterState>) => setDraft((prev) => ({ ...prev, ...next }))

  const applyRange = (range: LogRange) => {
    if (range === 'custom') {
      // Entering custom mode with nothing typed yet would silently mean "all
      // time", which reads as the picker doing nothing — seed the last 24 h.
      if (!draft.start && !draft.end) {
        patch({ range, ...rangeToInputs('day') })
        return
      }
      patch({ range })
      return
    }
    patch({ range, ...rangeToInputs(range) })
  }

  const active = countActiveFilters(draft)
  const rangeInvalid = Boolean(draft.start) && Boolean(draft.end) && draft.start >= draft.end

  const reset = () => {
    setDraft(createQueryLogFilter({ name: value.name, classPath: value.classPath }))
    onApply(createQueryLogFilter({ name: value.name, classPath: value.classPath }))
  }

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <Section
        className={className}
        contentClassName="p-0"
        title={
          <span className="inline-flex items-center gap-1.5">
            <ListFilter className="text-muted-foreground size-3.5" aria-hidden />
            {t('query.filters.title')}
          </span>
        }
        actions={
          <>
            {active > 0 && <Badge variant="info">{t('query.filters.active', { count: active })}</Badge>}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ChevronDown
                  className={cn('size-3.5 transition-transform', !collapsed && 'rotate-180')}
                  aria-hidden
                />
                {collapsed ? t('query.filters.expand') : t('query.filters.collapse')}
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy || active === 0}>
              <RotateCcw className="size-3.5" aria-hidden />
              {t('query.filters.reset')}
            </Button>
            <Button size="sm" onClick={() => onApply(draft)} disabled={busy || rangeInvalid}>
              {t('query.filters.apply')}
            </Button>
          </>
        }
      >
        <CollapsibleContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* The source select is keyed by `classPath`, the one field that is
            unique per entry: a single app may expose several query-log classes
            that all share the same `name`. */}
            <Field className="lg:col-span-2">
              <FieldLabel htmlFor="query-logs-source">{t('query.sourceLabel')}</FieldLabel>
              <Select
                value={draft.classPath || ANY}
                onValueChange={(next) => {
                  const app = apps.find((candidate) => candidate.classPath === next)
                  if (app) patch({ name: app.name, classPath: app.classPath })
                }}
                disabled={apps.length === 0}
              >
                <SelectTrigger id="query-logs-source" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((app) => (
                    <SelectItem key={app.classPath} value={app.classPath}>
                      <span className="font-data">{app.name}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-data text-muted-foreground truncate text-xs">
                        {app.classPath}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription className="text-xs">{t('query.sourceHelp')}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-range">{t('query.filters.rangeLabel')}</FieldLabel>
              <Select value={draft.range} onValueChange={(next) => applyRange(next as LogRange)}>
                <SelectTrigger id="query-logs-range" size="sm">
                  <CalendarRange className="text-muted-foreground size-3.5" aria-hidden />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      {t(rangeLabelKey(range))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-order">{t('query.filters.orderLabel')}</FieldLabel>
              <Select
                value={draft.descendingOrder ? 'desc' : 'asc'}
                onValueChange={(next) => patch({ descendingOrder: next === 'desc' })}
              >
                <SelectTrigger id="query-logs-order" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">{t('query.filters.descending')}</SelectItem>
                  <SelectItem value="asc">{t('query.filters.ascending')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-start">{t('query.filters.start')}</FieldLabel>
              <Input
                id="query-logs-start"
                type="datetime-local"
                value={draft.start}
                onChange={(event) => patch({ range: 'custom', start: event.target.value })}
                aria-invalid={rangeInvalid || undefined}
                className="font-data h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-end">{t('query.filters.end')}</FieldLabel>
              <Input
                id="query-logs-end"
                type="datetime-local"
                value={draft.end}
                onChange={(event) => patch({ range: 'custom', end: event.target.value })}
                aria-invalid={rangeInvalid || undefined}
                aria-describedby={rangeInvalid ? 'query-logs-range-error' : undefined}
                className="font-data h-8 text-xs"
              />
              <FieldError id="query-logs-range-error">
                {rangeInvalid ? t('query.filters.rangeInvalid') : null}
              </FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-client">{t('query.filters.clientIpAddress')}</FieldLabel>
              <Input
                id="query-logs-client"
                value={draft.clientIpAddress}
                onChange={(event) => patch({ clientIpAddress: event.target.value })}
                placeholder={t('query.filters.clientPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="font-data h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="query-logs-qname">{t('query.filters.qname')}</FieldLabel>
              <Input
                id="query-logs-qname"
                value={draft.qname}
                onChange={(event) => patch({ qname: event.target.value })}
                placeholder={t('query.filters.qnamePlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="font-data h-8 text-xs"
              />
            </Field>

            <EnumField
              id="query-logs-protocol"
              label={t('query.filters.protocol')}
              value={draft.protocol}
              onChange={(next) => patch({ protocol: next as QueryLogProtocol | '' })}
              options={QUERY_LOG_PROTOCOLS}
            />
            <EnumField
              id="query-logs-response-type"
              label={t('query.filters.responseType')}
              value={draft.responseType}
              onChange={(next) => patch({ responseType: next as QueryResponseType | '' })}
              options={QUERY_RESPONSE_TYPES}
              renderOption={responseLabel}
            />
            <EnumField
              id="query-logs-rcode"
              label={t('query.filters.rcode')}
              value={draft.rcode}
              onChange={(next) => patch({ rcode: next as ResponseCode | '' })}
              options={RESPONSE_CODES}
              renderOption={responseLabel}
            />
            <EnumField
              id="query-logs-qtype"
              label={t('query.filters.qtype')}
              value={draft.qtype}
              onChange={(next) => patch({ qtype: next })}
              options={QUERY_RECORD_TYPES}
            />
            <EnumField
              id="query-logs-qclass"
              label={t('query.filters.qclass')}
              value={draft.qclass}
              onChange={(next) => patch({ qclass: next as DnsClass | '' })}
              options={DNS_CLASSES}
            />
          </div>
        </CollapsibleContent>
      </Section>
    </Collapsible>
  )
}

/**
 * `NoError` / `NxDomain` / `Blocked` … all have copy in `query.responseTypes`,
 * one map covering response codes *and* response types. The bundle translates the
 * nine codes an operator actually filters on; the rarer ones (`YXRRSet`,
 * `NotZone`, `UpstreamBlockedCached`) fall back to the raw upstream string rather
 * than leaking a message key into the UI.
 *
 * Exported because the table cells and the detail dialog must label a code
 * exactly the way the filter bar does, or the same `NxDomain` reads differently
 * in two places on one screen.
 */
export function useResponseLabel() {
  const t = useTranslations('logs')
  return React.useCallback(
    (value: string): string => {
      if (!value) return value
      const known = [
        'NoError',
        'ServerFailure',
        'NxDomain',
        'Refused',
        'Blocked',
        'Cached',
        'Authoritative',
        'Recursive',
        'Dropped',
      ]
      return known.includes(value) ? t(`query.responseTypes.${value}`) : value
    },
    [t],
  )
}

/** One labelled `Select` with an "any" entry — the five enumerations all share it. */
function EnumField({
  id,
  label,
  value,
  onChange,
  options,
  renderOption,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  renderOption?: (value: string) => string
}) {
  const tc = useTranslations('common')
  const labelFor = renderOption ?? ((raw: string) => raw)

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value || ANY} onValueChange={(next) => onChange(next === ANY ? '' : next)}>
        <SelectTrigger id={id} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{tc('fields.all')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labelFor(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
