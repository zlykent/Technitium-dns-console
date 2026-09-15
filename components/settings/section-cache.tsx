'use client'

import { useTranslations } from 'next-intl'
import { useWatch, useFormContext } from 'react-hook-form'
import {
  SettingsFieldGrid,
  SettingsGroup,
  SettingsNumberField,
  SettingsSection,
  SettingsSwitchField,
} from '@/components/settings/settings-field'
import type { SettingsFormValues } from '@/components/settings/settings-schema'

/**
 * Cache sizing, prefetch and serve-stale. All fifteen are node-local
 * (`main.js:2009-2082`): each node owns its own memory-resident cache, so there
 * is nothing to replicate.
 *
 * The four `serveStale*` numbers are disabled while `serveStale` is off. Unlike
 * hiding them, this keeps the fields searchable and keeps their values in form
 * state, so re-enabling the feature does not resurrect a stale zero — and
 * `buildPatch` still submits every one of them, which is what the stock console
 * does. The prefetch group gets no such gating: it has no feature switch (the
 * server treats `cachePrefetchEligibility` of `0` as "off"), so there is nothing
 * to key the disabled state off without inventing a rule the API does not have.
 */

export interface SectionCacheProps {
  disabled: boolean
}

export function SectionCache({ disabled }: SectionCacheProps) {
  const t = useTranslations('settings')
  const { control } = useFormContext<SettingsFormValues>()
  const serveStale = useWatch({ control, name: 'serveStale' })

  return (
    <SettingsSection id="cache" title={t('cache.title')}>
      <SettingsGroup label={t('cache.groupCache')}>
        <SettingsSwitchField name="saveCache" help={t('cache.saveCacheHelp')} disabled={disabled} />
        <SettingsFieldGrid columns={3}>
          <SettingsNumberField name="cacheMaximumEntries" help={t('cache.cacheMaximumEntriesHelp')} min={0} disabled={disabled} compact />
          <SettingsNumberField name="cacheMinimumRecordTtl" min={0} disabled={disabled} compact />
          <SettingsNumberField name="cacheMaximumRecordTtl" min={0} disabled={disabled} compact />
          <SettingsNumberField name="cacheNegativeRecordTtl" min={0} disabled={disabled} compact />
          <SettingsNumberField name="cacheFailureRecordTtl" min={0} disabled={disabled} compact />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('cache.groupPrefetch')}>
        <p className="text-xs text-muted-foreground">{t('cache.prefetchHelp')}</p>
        <SettingsFieldGrid columns={2}>
          <SettingsNumberField name="cachePrefetchEligibility" min={0} disabled={disabled} compact />
          <SettingsNumberField name="cachePrefetchTrigger" min={0} max={100} disabled={disabled} compact />
          <SettingsNumberField name="cachePrefetchSampleIntervalInMinutes" min={0} disabled={disabled} compact />
          <SettingsNumberField name="cachePrefetchSampleEligibilityHitsPerHour" min={0} disabled={disabled} compact />
        </SettingsFieldGrid>
      </SettingsGroup>

      <SettingsGroup label={t('cache.groupServeStale')}>
        <SettingsSwitchField name="serveStale" help={t('cache.serveStaleHelp')} disabled={disabled} />
        <SettingsFieldGrid columns={2}>
          <SettingsNumberField name="serveStaleTtl" min={0} disabled={disabled || !serveStale} compact />
          <SettingsNumberField name="serveStaleAnswerTtl" min={0} disabled={disabled || !serveStale} compact />
          <SettingsNumberField name="serveStaleResetTtl" min={0} disabled={disabled || !serveStale} compact />
          <SettingsNumberField name="serveStaleMaxWaitTime" min={0} disabled={disabled || !serveStale} compact />
        </SettingsFieldGrid>
      </SettingsGroup>
    </SettingsSection>
  )
}
