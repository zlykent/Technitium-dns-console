'use client'

import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useWatch, useFormContext } from 'react-hook-form'
import { PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsPasswordField,
  SettingsSection,
  SettingsSelectField,
  SettingsTextareaField,
  SettingsTextField,
} from '@/components/settings/settings-field'
import type { SettingsFormValues } from '@/components/settings/settings-schema'
import { describeError } from '@/lib/api/client'
import { checkForUpdate } from '@/lib/api/domains/user'
import { PROXY_TYPES } from '@/lib/api/enums'

/**
 * Upstream proxy used for forwarder queries that need it, the DNS app store and
 * block-list downloads. Cluster-scoped (`main.js:2118-2149`).
 *
 * **"Test connection" is a proxy for the saved configuration.** Technitium has
 * no proxy-test endpoint (`lib/api/registry.ts:184-190` lists the whole settings
 * surface and there is nothing else), so the button reuses `user/checkForUpdate`
 * — a read-only call that leaves the box through the *configured* proxy. It
 * therefore proves outbound connectivity for what is already saved, not for the
 * half-typed values in the form; `proxy.testHelp` says so in the UI.
 *
 * The type is lower-cased on the wire and a disabled proxy submits **only**
 * `proxyType` (`main.js:2121-2124`); sending the other five would resurrect
 * stale credentials. Both live in `buildPatch`, not here.
 */

export interface SectionProxyProps {
  disabled: boolean
}

export function SectionProxy({ disabled }: SectionProxyProps) {
  const t = useTranslations('settings')
  const { control } = useFormContext<SettingsFormValues>()
  const proxyType = useWatch({ control, name: 'proxyType' })

  const typeOptions = React.useMemo(
    () => PROXY_TYPES.map((value) => ({ value, label: t(`proxy.types.${value}`) })),
    [t],
  )

  const probe = useMutation({
    mutationFn: () => checkForUpdate(),
    onSuccess: () => toast.success(t('proxy.testSuccess')),
    onError: (error) => toast.error(describeError(error).message),
  })

  return (
    <SettingsSection
      id="proxy"
      title={t('proxy.title')}
      description={t('proxy.hint')}
      actions={
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || proxyType === 'None'}
          loading={probe.isPending}
          onClick={() => probe.mutate()}
        >
          {!probe.isPending && <PlugZap className="size-3.5" aria-hidden />}
          {probe.isPending ? t('proxy.testing') : t('proxy.testConnection')}
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">{t('proxy.testHelp')}</p>

      <SettingsFieldGrid columns={2}>
        <SettingsSelectField name="proxyType" options={typeOptions} disabled={disabled} />
        <SettingsFieldGrid columns={2}>
          <SettingsTextField name="proxyAddress" disabled={disabled} mono placeholder="proxy.example.com" />
          <SettingsNumberField name="proxyPort" min={0} max={65535} disabled={disabled} compact />
        </SettingsFieldGrid>
        <SettingsTextField name="proxyUsername" disabled={disabled} />
        <SettingsPasswordField name="proxyPassword" disabled={disabled} />
      </SettingsFieldGrid>

      <SettingsTextareaField
        name="proxyBypass"
        help={t('proxy.proxyBypassHelp')}
        rows={4}
        disabled={disabled}
        placeholder={'10.0.0.0/8\nlocalhost'}
      />
    </SettingsSection>
  )
}
