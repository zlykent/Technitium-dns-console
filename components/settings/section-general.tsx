'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsReadonlyField,
  SettingsSection,
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextareaField,
  SettingsTextField,
} from '@/components/settings/settings-field'
import { IPV6_MODES } from '@/lib/api/enums'
import type { DnsSettings } from '@/lib/api/types/settings'
import { formatDateTime } from '@/lib/format'
import type { Locale } from '@/lib/i18n/config'

/**
 * General panel: server identity plus the transport-wide knobs that the stock
 * console groups under its first tab.
 *
 * Two things are read-only here and the reason matters. `version` and
 * `uptimestamp` are pure facts about the running process — `settings/set` has no
 * parameter for either. `preferIPv6` looks like a setting but is *derived*: the
 * console's only input is the `ipv6Mode` radio trio (`main.js:1695`) and the
 * server computes the flag from it, so exposing a switch would create a control
 * that cannot be saved. `clusterInitialized` is the same story — it is written
 * by `admin/cluster/init`, not by settings.
 */

export interface SectionGeneralProps {
  disabled: boolean
  settings: DnsSettings
  locale: Locale
}

export function SectionGeneral({ disabled, settings, locale }: SectionGeneralProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')

  const ipv6Options = React.useMemo(
    () => IPV6_MODES.map((value) => ({ value, label: t(`general.ipv6Modes.${value}`) })),
    [t],
  )

  return (
    <SettingsSection id="general" title={t('sections.general')}>
      <SettingsFieldGrid columns={2}>
        <SettingsTextField name="dnsServerDomain" help={t('general.dnsServerDomainHelp')} required disabled={disabled} placeholder="dns-server" />
        <SettingsSelectField name="ipv6Mode" options={ipv6Options} help={t('general.ipv6ModeHelp')} disabled={disabled} />
        <SettingsNumberField name="udpPayloadSize" help={t('general.udpPayloadSizeHelp')} min={512} max={65535} disabled={disabled} compact />
        <SettingsTextareaField name="socketPoolExcludedPorts" help={t('general.socketPoolExcludedPortsHelp')} rows={3} disabled={disabled} placeholder={'53443'} />
      </SettingsFieldGrid>

      <div className="flex flex-col">
        <SettingsSwitchField name="dnssecValidation" help={t('general.dnssecValidationHelp')} disabled={disabled} />
        <SettingsSwitchField name="enableUdpSocketPool" help={t('general.enableUdpSocketPoolHelp')} disabled={disabled} />
      </div>

      <SettingsFieldGrid columns={2}>
        <SettingsReadonlyField name="version" value={settings.version} />
        <SettingsReadonlyField name="uptimestamp" value={formatDateTime(settings.uptimestamp, locale)} mono={false} />
        <SettingsReadonlyField
          name="clusterInitialized"
          value={settings.clusterInitialized ? tc('fields.yes') : tc('fields.no')}
          mono={false}
        />
        <SettingsReadonlyField name="preferIPv6" value={settings.preferIPv6 ? tc('fields.yes') : tc('fields.no')} mono={false} />
      </SettingsFieldGrid>
    </SettingsSection>
  )
}
