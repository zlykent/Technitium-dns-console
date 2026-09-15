'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import {
  SettingsFieldGrid,
  SettingsGroup,
  SettingsNumberField,
  SettingsSection,
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextareaField,
} from '@/components/settings/settings-field'
import { FORWARDER_PROTOCOLS, RECURSION_POLICIES } from '@/lib/api/enums'

/**
 * Recursion policy, the iterative resolver's own limits, and the forwarder
 * chain. All fifteen parameters are cluster-scoped (`main.js:1963-2006` and
 * `2151-2185`) — recursion behaviour is part of the replicated configuration,
 * so two nodes answering differently for the same client would be a bug.
 *
 * `forwarders` is one line per entry and accepts three spellings
 * (`isForwarder` in the schema): a bare IP, `host:port`, or a full `https://`
 * DoH URL. `forwarderProtocol` then says how a *bare* address is reached; a URL
 * carries its own transport, which is why the two controls coexist.
 *
 * The recursion-policy select and the ACL textarea are both always mounted:
 * hiding the ACL for every policy but `UseSpecifiedNetworkACL` would make the
 * field unsearchable, and the server happily stores an ACL that is not in force.
 */

export interface SectionRecursionProps {
  disabled: boolean
}

export function SectionRecursion({ disabled }: SectionRecursionProps) {
  const t = useTranslations('settings')

  const recursionOptions = React.useMemo(
    () => RECURSION_POLICIES.map((value) => ({ value, label: t(`recursion.policies.${value}`) })),
    [t],
  )
  const protocolOptions = React.useMemo(() => FORWARDER_PROTOCOLS.map((value) => ({ value, label: value })), [])

  return (
    <SettingsSection id="recursion" title={t('recursion.title')}>
      <SettingsGroup label={t('recursion.groupPolicy')}>
        <SettingsFieldGrid columns={2}>
          <SettingsSelectField name="recursion" options={recursionOptions} help={t('recursion.recursionHelp')} disabled={disabled} />
          <SettingsTextareaField
            name="recursionNetworkACL"
            help={t('recursion.recursionNetworkACLHelp')}
            rows={4}
            disabled={disabled}
            placeholder="192.168.0.0/16"
          />
        </SettingsFieldGrid>
        <div className="flex flex-col">
          <SettingsSwitchField name="randomizeName" help={t('recursion.randomizeNameHelp')} disabled={disabled} />
          <SettingsSwitchField name="qnameMinimization" help={t('recursion.qnameMinimizationHelp')} disabled={disabled} />
          <SettingsSwitchField name="locallyServedDnsZones" help={t('recursion.locallyServedDnsZonesHelp')} disabled={disabled} />
        </div>
      </SettingsGroup>

      <SettingsGroup label={t('recursion.groupResolver')}>
        <SettingsFieldGrid columns={2}>
          <SettingsNumberField name="resolverRetries" min={0} disabled={disabled} compact />
          <SettingsNumberField name="resolverTimeout" min={0} disabled={disabled} compact />
          <SettingsNumberField name="resolverConcurrency" min={0} disabled={disabled} compact />
          <SettingsNumberField name="resolverMaxStackCount" min={0} disabled={disabled} compact />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('recursion.groupForwarders')}>
        <SettingsFieldGrid columns={2}>
          <SettingsTextareaField
            name="forwarders"
            help={t('recursion.forwardersHelp')}
            rows={5}
            disabled={disabled}
            placeholder={'192.168.3.1\n223.5.5.5'}
          />
          <div className="flex flex-col gap-4">
            <SettingsSelectField name="forwarderProtocol" options={protocolOptions} disabled={disabled} />
            <SettingsSwitchField name="concurrentForwarding" help={t('recursion.concurrentForwardingHelp')} disabled={disabled} />
            <SettingsFieldGrid columns={3}>
              <SettingsNumberField name="forwarderRetries" min={0} disabled={disabled} compact />
              <SettingsNumberField name="forwarderTimeout" min={0} disabled={disabled} compact />
              <SettingsNumberField name="forwarderConcurrency" min={0} disabled={disabled} compact />
            </SettingsFieldGrid>
          </div>
        </SettingsFieldGrid>
      </SettingsGroup>
    </SettingsSection>
  )
}
