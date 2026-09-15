'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { CircleArrowUp, CircleCheck, FingerprintPattern, Server, TriangleAlert } from 'lucide-react'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { DataValue } from '@/components/app/copy-button'
import { getStatus } from '@/lib/api/domains/system'
import { checkForUpdate } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import { formatUptime } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useSession } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Server identity + liveness panel.
 *
 * `version` / `uptimestamp` / `dnsServerDomain` come from the session payload
 * that is already in memory, so this renders instantly. The update check is a
 * separate outbound request the server makes to technitium.com — that is why it
 * is opt-in (a button) rather than automatic: on an air-gapped LAN it would
 * otherwise fail on every dashboard load.
 */
export function ServerStatusCard({ className }: { className?: string }) {
  const t = useTranslations('dashboard')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const { session } = useSession()

  const info = session?.info
  const [checkedAt, setCheckedAt] = React.useState<number | null>(null)

  const update = useQuery({
    queryKey: [...queryKeys.session(target), 'update-check', checkedAt],
    queryFn: checkForUpdate,
    // Only runs when the operator asks; a null `checkedAt` keeps it parked.
    enabled: checkedAt !== null,
    retry: false,
    staleTime: 5 * 60_000,
  })

  return (
    <Section
      title={t('server.title')}
      className={className}
      contentClassName="p-4"
      actions={
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone={session ? 'success' : 'danger'} pulse={Boolean(session)} />
          {session?.username ?? '—'}
        </span>
      }
    >
      <DefinitionList
        className="sm:grid-cols-2"
        items={[
          { label: t('server.version'), value: <span className="font-data">{info?.version ?? '—'}</span> },
          { label: t('server.uptime'), value: <span className="font-data">{formatUptime(info?.uptimestamp, locale)}</span> },
          { label: t('server.domain'), value: <DataValue value={info?.dnsServerDomain ?? '—'} copyLabel={t('server.domain')} /> },
          {
            label: t('server.dnssecValidation'),
            value: (
              <Badge variant={info?.dnssecValidation ? 'success' : 'secondary'}>
                {info?.dnssecValidation ? t('server.enabled') : t('server.disabled')}
              </Badge>
            ),
          },
          {
            label: t('server.clusterInitialized'),
            value: (
              <Badge variant={info?.clusterInitialized ? 'info' : 'secondary'}>
                {info?.clusterInitialized ? t('server.enabled') : t('server.disabled')}
              </Badge>
            ),
          },
        ]}
      />

      <Separator className="my-4" />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setCheckedAt(Date.now())} loading={update.isFetching}>
          {update.isFetching ? null : <CircleArrowUp className="size-3.5" aria-hidden />}
          {update.isFetching ? t('server.checking') : t('server.checkUpdate')}
        </Button>

        {update.data && (
          <span className="flex items-center gap-1.5 text-xs">
            {update.data.updateAvailable ? (
              <>
                <TriangleAlert className="size-3.5 text-warning" aria-hidden />
                <span className="text-warning">{t('server.updateAvailable', { version: update.data.updateVersion })}</span>
              </>
            ) : (
              <>
                <CircleCheck className="size-3.5 text-success" aria-hidden />
                <span className="text-muted-foreground">{t('server.upToDate')}</span>
              </>
            )}
          </span>
        )}
        {update.error && <span className="text-xs text-muted-foreground">{String(update.error)}</span>}
      </div>

      {session?.isSsoUser && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <FingerprintPattern className="size-3.5" aria-hidden />
          {t('server.ssoEnabled')}
        </p>
      )}
    </Section>
  )
}

/** Shown in the page header while the session is still resolving. */
export function ServerStatusSkeleton() {
  const t = useTranslations('dashboard')
  return (
    <Section title={t('server.title')}>
      <div className="flex items-center gap-2">
        <Server className="size-4 animate-pulse text-muted-foreground" aria-hidden />
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </Section>
  )
}

/**
 * Banner nudging the operator off `admin/123456`. The API already computes
 * `hasDefaultCredentials` on `status`; the session does not carry it, so this
 * reads the flag the login screen stored instead of re-requesting.
 */
export function DefaultCredentialsWarning({ className }: { className?: string }) {
  const t = useTranslations('dashboard')
  const target = useTargetKey()

  const status = useQuery({
    queryKey: queryKeys.status(target),
    queryFn: getStatus,
    staleTime: 5 * 60_000,
  })

  if (!status.data?.hasDefaultCredentials) return null

  return (
    <div className={className}>
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-warning">{t('server.defaultCredentials')}</p>
          <p className="mt-0.5 text-xs text-warning/80">{t('server.defaultCredentialsHint')}</p>
        </div>
      </div>
    </div>
  )
}
