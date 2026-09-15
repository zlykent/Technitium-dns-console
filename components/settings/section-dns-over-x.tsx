'use client'

import { useTranslations } from 'next-intl'
import {
  SettingsFieldGrid,
  SettingsGroup,
  SettingsNumberField,
  SettingsPasswordField,
  SettingsSection,
  SettingsSwitchField,
  SettingsTextareaField,
  SettingsTextField,
} from '@/components/settings/settings-field'

/**
 * Encrypted DNS transports: DoH, DoH(S), DoT, DoQ, HTTP/3 and the two proxy
 * listeners, all node-local (`main.js:1876-1948`).
 *
 * **Ports are validated per transport family, not globally.** A stock server
 * ships with `dnsOverTlsPort === dnsOverQuicPort === 853` (TCP vs UDP) and
 * `dnsOverUdpProxyPort === dnsOverTcpProxyPort === 538`; a single uniqueness
 * rule would reject the default configuration the operator has not touched. The
 * split lives in `settings-schema.ts` (`TCP_PORT_FIELDS` / `UDP_PORT_FIELDS`).
 *
 * `enableEDnsClientSubnetSourceAddress` sits in this panel because the stock
 * console renders it with the DoH real-IP header — it controls whether the ECS
 * option is populated from the connecting address rather than the resolver's.
 */

export interface SectionDnsOverXProps {
  disabled: boolean
}

export function SectionDnsOverX({ disabled }: SectionDnsOverXProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="dnsOverX" title={t('dnsOverX.title')} description={t('dnsOverX.hint')}>
      <SettingsGroup label={t('dnsOverX.groupTransports')}>
        <SettingsFieldGrid columns={2}>
          <div className="flex flex-col">
            <SettingsSwitchField name="enableDnsOverHttp" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverHttps" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverTls" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverQuic" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverHttp3" disabled={disabled} />
          </div>
          <div className="flex flex-col">
            <SettingsSwitchField name="enableDnsOverUdpProxy" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverTcpProxy" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverHttpHelpRedirect" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverHttpUnixSocket" disabled={disabled} />
            <SettingsSwitchField name="enableDnsOverHttpsUnixSocket" disabled={disabled} />
            <SettingsSwitchField name="enableEDnsClientSubnetSourceAddress" disabled={disabled} />
          </div>
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('dnsOverX.groupPorts')}>
        <SettingsFieldGrid columns={3}>
          <SettingsNumberField name="dnsOverHttpPort" min={0} max={65535} disabled={disabled} compact />
          <SettingsNumberField name="dnsOverHttpsPort" min={0} max={65535} disabled={disabled} compact />
          <SettingsNumberField name="dnsOverTlsPort" min={0} max={65535} disabled={disabled} compact />
          <SettingsNumberField name="dnsOverQuicPort" min={0} max={65535} disabled={disabled} compact />
          <SettingsNumberField name="dnsOverUdpProxyPort" min={0} max={65535} disabled={disabled} compact />
          <SettingsNumberField name="dnsOverTcpProxyPort" min={0} max={65535} disabled={disabled} compact />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('dnsOverX.groupSockets')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="dnsOverHttpUnixSocket" disabled={disabled} mono placeholder="/tmp/doh.socket" />
          <SettingsTextField name="dnsOverHttpsUnixSocket" disabled={disabled} mono placeholder="/tmp/dohs.socket" />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('dnsOverX.groupCertificate')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="dnsTlsCertificatePath" disabled={disabled} mono placeholder="/etc/technitium/dns/certificate.pfx" />
          <SettingsPasswordField name="dnsTlsCertificatePassword" disabled={disabled} />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('dnsOverX.groupHeaders')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="dnsOverHttpRealIpHeader" disabled={disabled} mono placeholder="X-Real-IP" />
          <SettingsTextareaField
            name="dnsReverseProxyNetworkACL"
            help={t('dnsOverX.dnsReverseProxyNetworkACLHelp')}
            rows={4}
            disabled={disabled}
            placeholder="127.0.0.0/8"
          />
        </SettingsFieldGrid>
      </SettingsGroup>
    </SettingsSection>
  )
}
