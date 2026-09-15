'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { ExternalLink, SearchCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsSwitchField } from '@/components/settings/settings-field'
import { describeError } from '@/lib/api/client'
import { checkForUpdate } from '@/lib/api/domains/user'
import type { CheckForUpdateResult } from '@/lib/api/types/user'

/**
 * Automatic-update switches plus an on-demand version check. Both switches are
 * cluster-scoped (`main.js:1713-1714`), so they replicate with the rest of the
 * DNS settings.
 *
 * **`updates.updateChannel` has no backing field.** `settings/get` returns no
 * channel parameter and the stock console has no control for one — the channel is
 * implied by the version string the server is running. It is therefore derived
 * here from `version` (a `-beta`/`-rc`/`-alpha` suffix means the beta channel)
 * and rendered read-only. Listed as a degradation in the report.
 *
 * `user/checkForUpdate` is a *read*: it only asks technitium.com whether a newer
 * build exists and reports back. That makes it safe to expose as a button even
 * where every other action on this page is destructive.
 */

const DOWNLOAD_URL = 'https://technitium.com/dns/'

const PRERELEASE_PATTERN = /-(alpha|beta|rc)\b/i

export interface SectionUpdatesProps {
  disabled: boolean
  /** `settings.version` — the running build, e.g. `15.4` or `15.4-beta1`. */
  version: string
}

export function SectionUpdates({ disabled, version }: SectionUpdatesProps) {
  const t = useTranslations('settings')

  const [result, setResult] = React.useState<CheckForUpdateResult | null>(null)

  const channel = PRERELEASE_PATTERN.test(version) ? t('updates.channelBeta') : t('updates.channelStable')

  const check = useMutation({
    mutationFn: () => checkForUpdate(),
    onSuccess: (value) => {
      setResult(value)
      if (value.updateAvailable) toast.warning(t('updates.updateAvailable', { version: value.updateVersion }))
      else toast.success(t('updates.upToDate', { version: value.currentVersion }))
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  return (
    <SettingsSection
      id="updates"
      title={t('updates.title')}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            loading={check.isPending}
            onClick={() => check.mutate()}
          >
            {!check.isPending && <SearchCheck className="size-3.5" aria-hidden />}
            {check.isPending ? t('updates.checking') : t('updates.checkForUpdate')}
          </Button>
          <Button type="button" variant="outline" size="xs" asChild>
            <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" aria-hidden />
              {t('updates.downloadUpdate')}
            </a>
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <SettingsSwitchField name="dnsServerEnableCheckForUpdate" disabled={disabled} />
        <SettingsSwitchField name="dnsAppsEnableAutomaticUpdate" disabled={disabled} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Readout label={t('updates.currentVersion')} value={version} />
        <Readout label={t('updates.updateChannel')} value={channel} />
      </div>

      {result?.updateAvailable && (
        <Alert variant="warning">
          <AlertTitle>{t('updates.updateAvailable', { version: result.updateVersion })}</AlertTitle>
          <AlertDescription>{t('updates.currentVersion')}: {version}</AlertDescription>
        </Alert>
      )}

      {result && !result.updateAvailable && (
        <Alert variant="success">
          <AlertDescription>{t('updates.upToDate', { version: result.currentVersion })}</AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  )
}

/** Label + value pair for the two derived, non-editable facts. */
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant="secondary" className="font-data">
        {value}
      </Badge>
    </span>
  )
}
