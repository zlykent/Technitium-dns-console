'use client'

import { useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsSection,
  SettingsTextareaField,
} from '@/components/settings/settings-field'

/**
 * Listeners: DNS sockets, egress source addresses, and the timeouts/buffers
 * that shape them.
 *
 * **This panel straddles both scopes.** `dnsServerLocalEndPoints` and the two
 * source-address lists are node-local (`main.js:1640-1665`), while every
 * timeout and buffer below them is cluster-wide (`main.js:1707-1760`) — the
 * stock console shows them together and simply omits the out-of-scope half when
 * a node is selected. Here the omitted half is greyed out instead, because an
 * editable control whose value is discarded on save is indistinguishable from a
 * bug.
 *
 * An empty endpoint list is *not* a clear: the console substitutes the
 * well-known defaults (`main.js:1649-1652`), since a server with no listener
 * cannot be recovered from the console. `buildPatch` reproduces that.
 */

export interface SectionListenersProps {
  disabled: boolean
}

export function SectionListeners({ disabled }: SectionListenersProps) {
  const t = useTranslations('settings')

  return (
    <SettingsSection id="listeners" title={t('sections.listeners')}>
      <Alert variant="warning">
        <AlertDescription>{t('dangerHint')}</AlertDescription>
      </Alert>

      <SettingsFieldGrid columns={3}>
        <SettingsTextareaField
          name="dnsServerLocalEndPoints"
          help={t('listeners.dnsServerLocalEndPointsHelp')}
          rows={4}
          disabled={disabled}
          placeholder={'0.0.0.0:53\n[::]:53'}
        />
        <SettingsTextareaField
          name="dnsServerIPv4SourceAddresses"
          help={t('listeners.sourceAddressHelp')}
          rows={4}
          disabled={disabled}
          placeholder="0.0.0.0"
        />
        <SettingsTextareaField
          name="dnsServerIPv6SourceAddresses"
          help={t('listeners.sourceAddressHelp')}
          rows={4}
          disabled={disabled}
          placeholder="::"
        />
      </SettingsFieldGrid>

      <SettingsFieldGrid columns={3}>
        <SettingsNumberField name="clientTimeout" min={0} disabled={disabled} compact />
        <SettingsNumberField name="tcpSendTimeout" min={0} disabled={disabled} compact />
        <SettingsNumberField name="tcpReceiveTimeout" min={0} disabled={disabled} compact />
        <SettingsNumberField name="quicIdleTimeout" min={0} disabled={disabled} compact />
        <SettingsNumberField name="quicMaxInboundStreams" min={0} disabled={disabled} compact />
        <SettingsNumberField name="listenBacklog" min={0} disabled={disabled} compact />
        <SettingsNumberField name="udpSendBufferSizeKB" min={0} disabled={disabled} compact />
        <SettingsNumberField name="udpReceiveBufferSizeKB" min={0} disabled={disabled} compact />
        <SettingsNumberField name="maxConcurrentResolutionsPerCore" min={0} disabled={disabled} compact />
      </SettingsFieldGrid>
    </SettingsSection>
  )
}
