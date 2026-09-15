'use client'

import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
 * The console's own HTTP endpoint — the one panel that can lock the operator
 * out of the console.
 *
 * Everything here is node-local (`main.js:1834-1873`): each cluster node serves
 * its own web service on its own addresses, so fanning a port change out to
 * `cluster` would be both meaningless and dangerous. The banner says so.
 *
 * Two guards are deliberately *not* in the UI. An empty `webServiceLocalAddresses`
 * falls back to `0.0.0.0,[::]` and a non-positive `webServiceHttpPort` falls back
 * to 5380 inside `buildPatch`, exactly as `main.js:1837-1845` does — rejecting
 * them client-side would strand an operator who is trying to *fix* a bad value.
 *
 * All controls stay mounted regardless of `webServiceEnableTls` /
 * `webServiceEnableHttpUnixSocket`. Hiding them would make the fields
 * unsearchable and would let a stale certificate path silently persist, which is
 * worse than a slightly longer panel.
 */

export interface SectionWebServiceProps {
  disabled: boolean
}

export function SectionWebService({ disabled }: SectionWebServiceProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="webService" title={t('webService.title')}>
      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t('webService.dangerBanner')}</AlertTitle>
        <AlertDescription>{t('dangerHint')}</AlertDescription>
      </Alert>

      <SettingsGroup label={t('webService.groupListeners')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextareaField
            name="webServiceLocalAddresses"
            help={t('webService.webServiceLocalAddressesHelp')}
            rows={3}
            disabled={disabled}
            placeholder="[::]"
          />
          <SettingsFieldGrid columns={2}>
            <SettingsNumberField name="webServiceHttpPort" min={0} max={65535} disabled={disabled} compact />
            <SettingsNumberField name="webServiceTlsPort" min={0} max={65535} disabled={disabled} compact />
          </SettingsFieldGrid>
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('webService.groupTls')}>
        <div className="flex flex-col">
          <SettingsSwitchField name="webServiceEnableTls" disabled={disabled} />
          <SettingsSwitchField name="webServiceHttpToTlsRedirect" disabled={disabled} />
          <SettingsSwitchField
            name="webServiceUseSelfSignedTlsCertificate"
            help={t('webService.webServiceUseSelfSignedTlsHelp')}
            disabled={disabled}
          />
          <SettingsSwitchField name="webServiceEnableHttp3" disabled={disabled} />
        </div>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="webServiceTlsCertificatePath" disabled={disabled} mono placeholder="/etc/technitium/dns/certificate.pfx" />
          <SettingsPasswordField name="webServiceTlsCertificatePassword" disabled={disabled} />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('webService.groupSockets')}>
        <div className="flex flex-col">
          <SettingsSwitchField name="webServiceEnableHttpUnixSocket" disabled={disabled} />
          <SettingsSwitchField name="webServiceEnableTlsUnixSocket" disabled={disabled} />
        </div>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="webServiceHttpUnixSocket" disabled={disabled} mono placeholder="/tmp/dns-web.socket" />
          <SettingsTextField name="webServiceTlsUnixSocket" disabled={disabled} mono placeholder="/tmp/dns-web-tls.socket" />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('webService.groupHeaders')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="webServiceRealIpHeader" help={t('webService.webServiceRealIpHeaderHelp')} disabled={disabled} mono placeholder="X-Real-IP" />
          <SettingsTextField name="webServiceCspFrameAncestorsHeader" help={t('webService.webServiceCspFrameAncestorsHelp')} disabled={disabled} mono placeholder="'none'" />
        </SettingsFieldGrid>
        <SettingsTextareaField
          name="webServiceReverseProxyAddresses"
          help={t('webService.webServiceReverseProxyHelp')}
          rows={4}
          disabled={disabled}
          placeholder={'127.0.0.0/8\n10.0.0.0/8'}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
