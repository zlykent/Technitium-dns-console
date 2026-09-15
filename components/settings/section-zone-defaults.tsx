'use client'

import { useTranslations } from 'next-intl'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsSection,
  SettingsSwitchField,
  SettingsTextareaField,
  SettingsTextField,
} from '@/components/settings/settings-field'

/**
 * Defaults applied to every zone created afterwards.
 *
 * These are *templates*, not live values — changing `defaultRecordTtl` does not
 * touch existing records, which is why the panel sits next to the zone creation
 * dialog rather than inside it. All nine parameters are cluster-scoped
 * (`main.js:1667-1692`) because zones replicate across the cluster and a
 * per-node default would produce divergent SOA records.
 *
 * `defaultResponsiblePerson` is written into the SOA RNAME field and accepts
 * either `hostmaster@example.com` or the already-escaped
 * `hostmaster.example.com.`; validation therefore checks only the part after
 * the last `@`, and blank is legal (the server derives it from
 * `dnsServerDomain`).
 */

export interface SectionZoneDefaultsProps {
  disabled: boolean
}

export function SectionZoneDefaults({ disabled }: SectionZoneDefaultsProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="zoneDefaults" title={t('zoneDefaults.title')}>
      <SettingsFieldGrid columns={3}>
        <SettingsNumberField name="defaultRecordTtl" min={0} disabled={disabled} compact />
        <SettingsNumberField name="defaultNsRecordTtl" min={0} disabled={disabled} compact />
        <SettingsNumberField name="defaultSoaRecordTtl" min={0} disabled={disabled} compact />
        <SettingsNumberField name="minSoaRefresh" min={0} disabled={disabled} compact />
        <SettingsNumberField name="minSoaRetry" min={0} disabled={disabled} compact />
      </SettingsFieldGrid>

      <SettingsTextField name="defaultResponsiblePerson" help={t('zoneDefaults.defaultResponsiblePersonHelp')} disabled={disabled} mono placeholder="hostmaster@example.com" />

      <SettingsSwitchField name="useSoaSerialDateScheme" help={t('zoneDefaults.useSoaSerialDateSchemeHelp')} disabled={disabled} />

      <SettingsFieldGrid columns={2}>
        <SettingsTextareaField name="zoneTransferAllowedNetworks" help={t('zoneDefaults.networkHelp')} rows={4} disabled={disabled} placeholder="10.0.0.0/8" />
        <SettingsTextareaField name="notifyAllowedNetworks" help={t('zoneDefaults.networkHelp')} rows={4} disabled={disabled} placeholder="10.0.0.0/8" />
      </SettingsFieldGrid>
    </SettingsSection>
  )
}
