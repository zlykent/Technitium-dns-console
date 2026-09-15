'use client'

import { useTranslations } from 'next-intl'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsSection,
  SettingsSwitchField,
  SettingsTextField,
} from '@/components/settings/settings-field'

/**
 * EDNS Client Subnet. All five are cluster-scoped (`main.js:2053-2064`) — ECS
 * is part of the resolver's identity, so it is replicated with the rest of the
 * DNS settings rather than kept per node.
 *
 * The related `enableEDnsClientSubnetSourceAddress` switch is *not* here: the
 * stock console keeps it with the DNS-over-X reverse-proxy block because it only
 * makes sense when a proxy is supplying the real client IP, and splitting it
 * away from that context would hide the dependency.
 *
 * The two override fields are a privacy/debug lever — setting one makes every
 * query advertise that address as the client subnet. They are plain text rather
 * than disabled-unless-enabled because the server stores them independently of
 * `eDnsClientSubnet` and would resurrect them the moment the switch flips back
 * on; showing the value is more honest than hiding it.
 */

export interface SectionEdnsProps {
  disabled: boolean
}

export function SectionEdns({ disabled }: SectionEdnsProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="edns" title={t('edns.title')}>
      <SettingsSwitchField name="eDnsClientSubnet" help={t('edns.eDnsClientSubnetHelp')} disabled={disabled} />

      <SettingsFieldGrid columns={2}>
        <SettingsNumberField name="eDnsClientSubnetIPv4PrefixLength" min={0} max={32} disabled={disabled} compact />
        <SettingsNumberField name="eDnsClientSubnetIPv6PrefixLength" min={0} max={128} disabled={disabled} compact />
      </SettingsFieldGrid>

      <SettingsFieldGrid columns={2}>
        <SettingsTextField name="eDnsClientSubnetIpv4Override" help={t('edns.overrideHelp')} mono disabled={disabled} placeholder="1.2.3.4" />
        <SettingsTextField name="eDnsClientSubnetIpv6Override" help={t('edns.overrideHelp')} mono disabled={disabled} placeholder="2001:db8::1" />
      </SettingsFieldGrid>
    </SettingsSection>
  )
}
