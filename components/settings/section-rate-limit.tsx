'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useController, useFormContext } from 'react-hook-form'
import { CirclePlus, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SettingsCompositeField,
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsSection,
  SettingsTextareaField,
  type SettingsPath,
} from '@/components/settings/settings-field'
import { FIELD_LABEL_KEYS } from '@/components/settings/settings-fields'
import type { SettingsFormValues } from '@/components/settings/settings-schema'
import { formatQpmPrefixLimits, parseQpmPrefixLimits } from '@/lib/api/domains/settings'
import { cn } from '@/lib/utils'

/**
 * Queries-per-minute rate limiting. Cluster-scoped (`main.js:2065-2082`).
 *
 * The two `qpmPrefixLimits*` values are the only settings that are *tables*
 * rather than scalars, and the wire format is the awkward one: the UI shows
 * `prefix/udp/tcp` per line, the server takes a single flat `|`-joined cell list
 * (`serializeTableData(table, 3)`). Editing them as a raw textarea would make
 * every operator hand-write that triple, so they get a real row editor here.
 *
 * Two non-obvious points:
 *
 *  - **The row state is local, the form value stays text.** `buildPatch` and the
 *    zod rules both work on the `prefix/udp/tcp` string, so the table is only a
 *    nicer skin over exactly the same value a textarea would hold. Serialising
 *    goes through `formatQpmPrefixLimits`, which means a blank cell becomes
 *    `NaN/600/600` and fails `isQpmRule` loudly — the alternative (defaulting a
 *    blank to `0`) would silently install a "0 queries per minute" rule, i.e. a
 *    total DNS outage for that prefix.
 *  - **`parseQpmPrefixLimits` drops unparsable lines**, so it is only used to
 *    hydrate on mount. Rows are never re-read from the form value afterwards,
 *    otherwise a half-typed row would vanish on the next keystroke.
 */

const ROW_GRID = 'grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-2'

interface RuleRow {
  id: string
  prefix: string
  udp: string
  tcp: string
}

/**
 * Row keys must survive deletion, so they cannot be the array index — an index
 * key would hand a deleted row's DOM node (and its focus) to its neighbour. The
 * counter is module-scoped rather than a ref because the id is consumed inside a
 * `useState` initialiser, which runs during render, and reading a ref there is
 * both a `react-hooks/refs` violation and unsafe under StrictMode double-render.
 * Ids are only React keys, so leaking them across instances is harmless.
 */
let rowCounter = 0

function nextRowId(): string {
  rowCounter += 1
  return `qpm-row-${rowCounter}`
}

/** Blank means `NaN`, not `0` — see the header note. */
function cellNumber(value: string): number {
  const text = value.trim()
  return text === '' ? Number.NaN : Number(text)
}

function isNumericCell(value: string): boolean {
  return /^\d+$/.test(value.trim())
}

interface QpmRuleTableProps {
  name: SettingsPath
  /** `32` for the IPv4 table, `128` for IPv6 — bounds the prefix cell. */
  maxPrefix: number
  help: string
  disabled: boolean
}

export function QpmRuleTable({ name, maxPrefix, help, disabled }: QpmRuleTableProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const { control } = useFormContext<SettingsFormValues>()
  const { field, fieldState } = useController({ control, name })

  const [rows, setRows] = React.useState<RuleRow[]>(() =>
    parseQpmPrefixLimits(String(field.value ?? '')).map((limit) => ({
      id: nextRowId(),
      prefix: String(limit.prefix),
      udp: String(limit.udpLimit),
      tcp: String(limit.tcpLimit),
    })),
  )

  // The group needs a real accessible name; `props.id` is a DOM id, not text.
  const labelKey = FIELD_LABEL_KEYS[name]
  const groupLabel = labelKey ? (t as unknown as (key: string) => string)(labelKey) : name

  function commit(next: RuleRow[]) {
    setRows(next)
    field.onChange(
      formatQpmPrefixLimits(
        next.map((row) => ({
          prefix: cellNumber(row.prefix),
          udpLimit: cellNumber(row.udp),
          tcpLimit: cellNumber(row.tcp),
        })),
      ),
    )
  }

  function editRow(id: string, key: 'prefix' | 'udp' | 'tcp', value: string) {
    commit(rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)))
  }

  function addRow() {
    commit([...rows, { id: nextRowId(), prefix: '', udp: '', tcp: '' }])
  }

  function removeRow(id: string) {
    commit(rows.filter((row) => row.id !== id))
  }

  return (
    <SettingsCompositeField name={name} help={help} disabled={disabled} error={fieldState.error?.message}>
      {(props) => (
        <div
          role="group"
          aria-label={groupLabel}
          aria-describedby={props['aria-describedby']}
          className={cn('surface-raised flex flex-col gap-2 rounded-md border border-border/60 p-3', props.disabled && 'opacity-60')}
        >
          <div className={ROW_GRID}>
            <span className="text-xs font-medium text-muted-foreground">{t('rateLimit.prefix')}</span>
            <span className="text-xs font-medium text-muted-foreground">{t('rateLimit.udpLimit')}</span>
            <span className="text-xs font-medium text-muted-foreground">{t('rateLimit.tcpLimit')}</span>
            <span className="sr-only">{tc('actions.remove')}</span>
          </div>

          {rows.length === 0 && <p className="py-1 text-xs text-muted-foreground">{t('rateLimit.empty')}</p>}

          {rows.map((row) => (
            <div key={row.id} className={ROW_GRID}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={maxPrefix}
                value={row.prefix}
                disabled={props.disabled}
                onChange={(event) => editRow(row.id, 'prefix', event.target.value)}
                aria-invalid={isNumericCell(row.prefix) ? undefined : true}
                autoComplete="off"
                className="h-8 font-data text-xs"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={row.udp}
                disabled={props.disabled}
                onChange={(event) => editRow(row.id, 'udp', event.target.value)}
                aria-invalid={isNumericCell(row.udp) ? undefined : true}
                autoComplete="off"
                className="h-8 font-data text-xs"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={row.tcp}
                disabled={props.disabled}
                onChange={(event) => editRow(row.id, 'tcp', event.target.value)}
                aria-invalid={isNumericCell(row.tcp) ? undefined : true}
                autoComplete="off"
                className="h-8 font-data text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={props.disabled}
                aria-label={tc('actions.remove')}
                title={tc('actions.remove')}
                onClick={() => removeRow(row.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash aria-hidden />
              </Button>
            </div>
          ))}

          <Button type="button" variant="outline" size="xs" disabled={props.disabled} onClick={addRow} className="self-start">
            <CirclePlus className="size-3.5" aria-hidden />
            {t('rateLimit.addRule')}
          </Button>
        </div>
      )}
    </SettingsCompositeField>
  )
}

export interface SectionRateLimitProps {
  disabled: boolean
}

export function SectionRateLimit({ disabled }: SectionRateLimitProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="rateLimit" title={t('rateLimit.title')} description={t('rateLimit.hint')}>
      <SettingsFieldGrid columns={2}>
        <QpmRuleTable name="qpmPrefixLimitsIPv4" maxPrefix={32} help={t('rateLimit.rulesHelp')} disabled={disabled} />
        <QpmRuleTable name="qpmPrefixLimitsIPv6" maxPrefix={128} help={t('rateLimit.rulesHelp')} disabled={disabled} />
      </SettingsFieldGrid>

      <SettingsFieldGrid columns={2}>
        <SettingsNumberField name="qpmLimitSampleMinutes" min={0} disabled={disabled} compact />
        <SettingsNumberField
          name="qpmLimitUdpTruncationPercentage"
          help={t('rateLimit.qpmLimitUdpTruncationHelp')}
          min={0}
          max={100}
          disabled={disabled}
          compact
        />
      </SettingsFieldGrid>

      <SettingsTextareaField
        name="qpmLimitBypassList"
        help={t('rateLimit.qpmLimitBypassListHelp')}
        rows={4}
        disabled={disabled}
        placeholder="example.com"
      />
    </SettingsSection>
  )
}
