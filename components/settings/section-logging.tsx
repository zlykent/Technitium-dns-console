'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import * as React from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  SettingsFieldGrid,
  SettingsGroup,
  SettingsNumberField,
  SettingsSection,
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextField,
} from '@/components/settings/settings-field'
import type { SettingsFormValues } from '@/components/settings/settings-schema'
import { LOGGING_TYPES } from '@/lib/api/enums'
import { useCan } from '@/lib/auth/session'

/**
 * Logging and statistics. All ten are node-local (`main.js:2186-2200`): each
 * node writes its own files, so there is nothing to replicate.
 *
 * **`enableLogging` has no write side.** `settings/get` returns it but
 * `settings/set` never receives it — the server derives it from `loggingType`
 * (`main.js:2189` sends `loggingType` only). The switch is nonetheless real UI
 * because "logging on" and "logging to a file" are two different questions to
 * an operator; `buildPatch` collapses them (`loggingType = enableLogging ? (type
 * === 'None' ? 'File' : type) : 'None'`), and `FIELD_TO_PARAM` marks the switch
 * as non-submittable so a per-section save cannot emit a parameter the server
 * would reject. The consequence, which is the reason the select stays mounted
 * rather than hidden: flipping the switch back on must restore whatever type was
 * configured, not silently reset it.
 *
 * Everything downstream of the switch is disabled while logging is off, exactly
 * as the stock console does (`main.js:1614-1618` disables `ignoreResolverLogs`,
 * `noStackTrace`, `logQueries`, `useLocalTime` and the folder path). Disabled
 * rather than unmounted, so the fields stay searchable and keep their values.
 */

export interface SectionLoggingProps {
  disabled: boolean
}

export function SectionLogging({ disabled }: SectionLoggingProps) {
  const t = useTranslations('settings')
  const canViewLogs = useCan('Logs').canView
  const { control } = useFormContext<SettingsFormValues>()
  const enableLogging = useWatch({ control, name: 'enableLogging' })
  const enableInMemoryStats = useWatch({ control, name: 'enableInMemoryStats' })

  const typeOptions = React.useMemo(
    () => LOGGING_TYPES.map((value) => ({ value, label: t(`logging.types.${value}`) })),
    [t],
  )

  return (
    <SettingsSection
      id="logging"
      title={t('logging.title')}
      actions={
        canViewLogs ? (
          <Button type="button" variant="outline" size="xs" asChild>
            <Link href="/system-logs">
              <ScrollText className="size-3.5" aria-hidden />
              {t('logging.viewLogs')}
            </Link>
          </Button>
        ) : undefined
      }
    >
      <SettingsGroup label={t('logging.groupLogging')}>
        <SettingsSwitchField name="enableLogging" disabled={disabled} />
        <SettingsFieldGrid columns={2}>
          <SettingsSelectField
            name="loggingType"
            options={typeOptions}
            disabled={disabled || !enableLogging}
          />
          <SettingsTextField
            name="logFolder"
            mono
            disabled={disabled || !enableLogging}
            placeholder="/etc/dns/logs"
          />
          <SettingsNumberField name="maxLogFileDays" min={0} disabled={disabled} compact />
        </SettingsFieldGrid>

        <div className="flex flex-col">
          <SettingsSwitchField name="useLocalTime" help={t('logging.useLocalTimeHelp')} disabled={disabled || !enableLogging} />
          <SettingsSwitchField name="ignoreResolverLogs" help={t('logging.ignoreResolverLogsHelp')} disabled={disabled || !enableLogging} />
          <SettingsSwitchField name="logQueries" help={t('logging.logQueriesHelp')} disabled={disabled || !enableLogging} />
          <SettingsSwitchField name="noStackTrace" disabled={disabled || !enableLogging} />
        </div>
      </SettingsGroup>

      <SettingsGroup label={t('logging.groupStats')}>
        <SettingsSwitchField name="enableInMemoryStats" help={t('logging.enableInMemoryStatsHelp')} disabled={disabled} />
        <SettingsNumberField
          name="maxStatFileDays"
          min={0}
          disabled={disabled || !enableInMemoryStats}
          compact
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
