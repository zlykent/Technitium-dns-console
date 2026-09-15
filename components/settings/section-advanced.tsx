'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { Download, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { copyText } from '@/components/app/copy-button'
import { SettingsSection } from '@/components/settings/settings-field'
import { diffFormValues, FIELD_LABEL_KEYS, type SettingsDiffEntry } from '@/components/settings/settings-fields'
import type { SettingsFormValues } from '@/components/settings/settings-schema'
import type { DnsSettings } from '@/lib/api/types/settings'

/**
 * Raw payload inspector and the local-vs-server diff.
 *
 * With 132 parameters on one page, the two questions an operator actually asks
 * after a confusing save are "what did the server really give me?" and "what am
 * I about to send?". Both are answered here rather than by more form controls.
 *
 * Non-obvious bits:
 *
 *  - **The diff compares *form* values, not wire values** (`diffFormValues`
 *    re-runs `toFormValues` on the server payload), so a QPM rule shows as
 *    `32/600/600` on both sides instead of one side being the flattened
 *    `32|600|600` the API uses. Comparing wire strings would flag every list
 *    field as changed.
 *  - **Labels are resolved through `FIELD_LABEL_KEYS`**, the same index search
 *    uses. A diff row can therefore never name a field the operator cannot find
 *    in the search box.
 *  - The raw JSON is hidden behind a toggle: it is ~190 lines and printing it
 *    eagerly would dominate the page for the one person in twenty who wants it.
 *
 * The live form values are watched *here* rather than handed down, so the whole
 * page does not re-render on every keystroke just to keep this table current.
 */

export interface SectionAdvancedProps {
  settings: DnsSettings
}

export function SectionAdvanced({ settings }: SectionAdvancedProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const { control } = useFormContext<SettingsFormValues>()
  const values = useWatch({ control })

  const [showRaw, setShowRaw] = React.useState(false)

  // `FIELD_LABEL_KEYS` is a plain `Record<string, string>`, so the translator has
  // to be widened the same way `FieldShell` does it.
  const tr = t as unknown as (key: string) => string

  const json = React.useMemo(() => JSON.stringify(settings, null, 2), [settings])
  // `useWatch` types its result as a deep-partial snapshot, but every field has a
  // concrete `defaultValue`, so the runtime object is always a full form value.
  const diff = React.useMemo<SettingsDiffEntry[]>(
    () => diffFormValues(settings, values as SettingsFormValues),
    [settings, values],
  )

  async function onCopy() {
    const ok = await copyText(json)
    if (ok) toast.success(tc('toast.copied'))
    else toast.error(tc('toast.failed'))
  }

  function onDownload() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'dns-settings.json'
    anchor.click()
    // Revoking synchronously would cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <SettingsSection id="advanced" title={t('advanced.title')} hideSave>
      <Alert variant="warning">
        <AlertDescription>{t('advanced.warning')}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t('advanced.diff')}</h3>
            <p className="text-xs text-muted-foreground">{t('unsavedChanges', { count: diff.length })}</p>
          </div>
        </div>

        {diff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('advanced.diffEmpty')}</p>
        ) : (
          <div className="surface-raised overflow-hidden rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('advanced.diffField')}</TableHead>
                  <TableHead>{t('advanced.diffFrom')}</TableHead>
                  <TableHead>{t('advanced.diffTo')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diff.map((entry) => (
                  <TableRow key={entry.field}>
                    <TableCell className="font-data text-xs">{labelFor(entry.field, tr)}</TableCell>
                    <TableCell className="font-data text-xs text-muted-foreground line-through">{entry.from || '—'}</TableCell>
                    <TableCell className="font-data text-xs">{entry.to || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t('advanced.rawJson')}</h3>
            <p className="text-xs text-muted-foreground">{t('advanced.rawJsonHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="xs" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
              {showRaw ? tc('actions.hideAdvanced') : tc('actions.showAdvanced')}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={() => void onCopy()}>
              {t('advanced.copyJson')}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={onDownload}>
              <Download className="size-3.5" aria-hidden />
              {t('advanced.downloadJson')}
            </Button>
          </div>
        </div>

        {showRaw && (
          <pre className="surface-raised rounded-md border border-border/60 p-3 font-data text-xs whitespace-pre-wrap">
            {json}
          </pre>
        )}
      </div>
    </SettingsSection>
  )
}

/** `FIELD_LABEL_KEYS` lookup with a raw-name fallback, mirroring `FieldShell`. */
function labelFor(field: string, t: (key: string) => string): string {
  const key = FIELD_LABEL_KEYS[field]
  if (!key) return field
  try {
    return t(key)
  } catch {
    return field
  }
}
