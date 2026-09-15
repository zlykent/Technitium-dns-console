'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ArrowRightLeft,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldBan,
  ShieldCheck,
  ShieldQuestionMark,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataValue } from '@/components/app/copy-button'
import { DefinitionList, PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { StatCard, StatGrid, StatGridSkeleton, type StatTone } from '@/components/app/stat-card'
import { ErrorState } from '@/components/app/states'
import { DnsKeyTtlDialog } from '@/components/dnssec/dnskey-ttl-dialog'
import { DsRecordsPanel } from '@/components/dnssec/ds-records-panel'
import { Nsec3Dialog, type Nsec3DialogMode } from '@/components/dnssec/nsec3-dialog'
import { PrivateKeysPanel } from '@/components/dnssec/private-keys-panel'
import { SignZoneDialog } from '@/components/dnssec/sign-zone-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ZoneTabs } from '@/components/zones/zone-tabs'
import { describeError } from '@/lib/api/client'
import { getDnssecProperties, unsignZone } from '@/lib/api/domains/dnssec'
import { queryKeys } from '@/lib/api/query-keys'
import type { DnssecProperties } from '@/lib/api/types/dnssec'
import { useCan } from '@/lib/auth/session'
import { formatNumber, formatTtl } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * DNSSEC console for a single zone — signing, key lifecycle and DS publication.
 *
 * `zones/dnssec/properties/get` is the only read here; every other endpoint on
 * this page mutates even though Technitium registers them all as GETs. That has
 * two consequences worth spelling out:
 *
 *  - **Invalidation must reach three subtrees.** The DNSSEC keys live under
 *    `[target,'dnssec',…]`, *not* under `[target,'zones',…]`, so
 *    `domain(target,'zones')` alone would leave this page showing a stale
 *    status — and the zone list / record browser cache `dnssecStatus` too, so
 *    the zones subtree must be dropped as well. `invalidateAll` below is the
 *    single place that knows this; the child panels call it back rather than
 *    re-deriving the key list.
 *  - **`viewDsRecords` fails on an unsigned zone** with a plain `upstream_error`
 *    ("The zone must be signed with DNSSEC."), not an empty list. `DsRecordsPanel`
 *    turns that specific message into guidance instead of an error card, and this
 *    view also gates the query so the failing call is not even issued.
 *
 * `DnssecProperties` carries no `algorithm` field, so the overview derives the
 * signing algorithm(s) from the private keys — an unsigned zone legitimately has
 * none and renders an em dash rather than a guess.
 */

/** `dnssecStatus` -> `status.*` label key. Exhaustive so a new wire value fails to compile. */
const STATUS_LABEL_KEY: Record<DnssecProperties['dnssecStatus'], string> = {
  Unsigned: 'status.Unsigned',
  Signed: 'status.Signed',
  PendingSigning: 'status.PendingSigning',
  Disabled: 'status.Disabled',
}

/** `dnssecStatus` -> `status.*Hint` body copy. */
const STATUS_HINT_KEY: Record<DnssecProperties['dnssecStatus'], string> = {
  Unsigned: 'status.unsignedHint',
  Signed: 'status.signedHint',
  PendingSigning: 'status.pendingHint',
  Disabled: 'status.disabledHint',
}

export interface DnssecViewProps {
  zone: string
}

export function DnssecView({ zone }: DnssecViewProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')
  const tz = useTranslations('zones')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Zones')

  const [signOpen, setSignOpen] = React.useState(false)
  const [ttlOpen, setTtlOpen] = React.useState(false)
  const [nsec3Mode, setNsec3Mode] = React.useState<Nsec3DialogMode | null>(null)
  const [unsignOpen, setUnsignOpen] = React.useState(false)

  const properties = useQuery({
    queryKey: queryKeys.dnssecProperties(target, zone),
    queryFn: () => getDnssecProperties(zone),
    enabled: can.canView,
  })

  const data = properties.data

  const invalidateAll = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dnssecProperties(target, zone) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.dnssecDs(target, zone) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
  }, [queryClient, target, zone])

  const unsign = useMutation({
    mutationFn: () => unsignZone(zone),
    onSuccess: () => {
      toast.success(t('unsign.success', { zone }))
      invalidateAll()
      setUnsignOpen(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const status = data?.dnssecStatus ?? 'Unsigned'
  const isSigned = status === 'Signed' || status === 'PendingSigning'
  // Memoised so `algorithms` below (and the table's identity) do not churn on
  // every render: `data?.x ?? []` allocates a fresh array each time.
  const keys = React.useMemo(() => data?.dnssecPrivateKeys ?? [], [data])
  const kskCount = keys.filter((key) => key.keyType === 'KeySigningKey').length
  const zskCount = keys.filter((key) => key.keyType === 'ZoneSigningKey').length
  const algorithms = React.useMemo(() => [...new Set(keys.map((key) => key.algorithm))], [keys])

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: tz('detail.backToList'), href: '/zones' },
          { label: zone, href: `/zones/${encodeURIComponent(zone)}` },
          { label: t('title') },
        ]}
        title={<span className="font-data">{zone}</span>}
        description={t('subtitle', { zone })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void properties.refetch()} loading={properties.isFetching} disabled={!can.canView}>
              {!properties.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {tc('actions.refresh')}
            </Button>
            {can.canModify && !isSigned && (
              <Button size="sm" onClick={() => setSignOpen(true)}>
                <ShieldCheck className="size-3.5" aria-hidden />
                {t('sign.action')}
              </Button>
            )}
            {can.canDelete && isSigned && (
              <Button variant="outline" size="sm" onClick={() => setUnsignOpen(true)}>
                <ShieldBan className="size-3.5" aria-hidden />
                {t('unsign.action')}
              </Button>
            )}
          </>
        }
      />

      <ZoneTabs zone={zone} current="dnssec" />

      {properties.isPending ? (
        <DnssecSkeleton />
      ) : properties.error ? (
        <ErrorState error={properties.error} onRetry={() => void properties.refetch()} />
      ) : data ? (
        <div className="flex min-w-0 flex-col gap-6">
          {data.disabled && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertDescription>{t('overview.zoneDisabled')}</AlertDescription>
            </Alert>
          )}

          <Section
            title={t('overview.title')}
            actions={
              can.canModify && isSigned ? (
                <Button variant="ghost" size="sm" onClick={() => setTtlOpen(true)}>
                  <Pencil className="size-3.5" aria-hidden />
                  {t('dnsKeyTtl.action')}
                </Button>
              ) : undefined
            }
          >
            <StatGrid columns={4}>
              <StatCard
                label={t('status.label')}
                value={t(STATUS_LABEL_KEY[status])}
                tone={statusTone(status)}
                size="sm"
                icon={<StatusIcon status={status} />}
              />
              <StatCard
                label={t('overview.dnsKeyTtl')}
                value={formatTtl(data.dnsKeyTtl)}
                hint={`${formatNumber(data.dnsKeyTtl, locale)} ${tc('units.seconds')}`}
                size="sm"
              />
              <StatCard label={t('overview.kskCount')} value={formatNumber(kskCount, locale)} tone="primary" size="sm" />
              <StatCard label={t('overview.zskCount')} value={formatNumber(zskCount, locale)} tone="info" size="sm" />
            </StatGrid>

            <p className="mt-3 text-xs text-muted-foreground">{t(STATUS_HINT_KEY[status])}</p>

            <DefinitionList
              className="mt-4"
              items={[
                {
                  label: t('overview.algorithm'),
                  value: algorithms.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {algorithms.map((algorithm) => (
                        <Badge key={algorithm} variant="outline">
                          {algorithm}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: t('overview.nxProof'),
                  value: data.nxProof ? <Badge variant="outline">{data.nxProof}</Badge> : '—',
                },
                {
                  label: t('overview.nsec3Iterations'),
                  value:
                    data.nsec3Iterations === undefined ? (
                      '—'
                    ) : (
                      <span className="font-data tabular-nums">{formatNumber(data.nsec3Iterations, locale)}</span>
                    ),
                },
                { label: t('overview.nsec3Salt'), value: <DataValue value={data.nsec3Salt} /> },
              ]}
            />
          </Section>

          <Nsec3Section
            nxProof={data.nxProof}
            editable={can.canModify && isSigned}
            onAction={setNsec3Mode}
          />

          <PrivateKeysPanel
            zone={zone}
            zoneType={data.type}
            keys={keys}
            canModify={can.canModify}
            canDelete={can.canDelete}
            onChanged={invalidateAll}
          />

          <DsRecordsPanel
            zone={zone}
            dnsKeyTtl={data.dnsKeyTtl}
            signed={isSigned}
            canModify={can.canModify}
            onSign={() => setSignOpen(true)}
          />
        </div>
      ) : null}

      <SignZoneDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        zone={zone}
        zoneType={data?.type ?? 'Primary'}
        defaultDnsKeyTtl={data?.dnsKeyTtl ?? 86400}
        onSigned={invalidateAll}
      />

      <DnsKeyTtlDialog open={ttlOpen} onOpenChange={setTtlOpen} zone={zone} ttl={data?.dnsKeyTtl ?? 86400} onSaved={invalidateAll} />

      <Nsec3Dialog
        open={nsec3Mode !== null}
        onOpenChange={(next) => {
          if (!next) setNsec3Mode(null)
        }}
        mode={nsec3Mode ?? 'params'}
        zone={zone}
        nsec3Salt={data?.nsec3Salt}
        nsec3Iterations={data?.nsec3Iterations}
        onSaved={invalidateAll}
      />

      <ConfirmDialog
        open={unsignOpen}
        onOpenChange={(next) => {
          setUnsignOpen(next)
          if (!next) unsign.reset()
        }}
        title={t('unsign.title')}
        description={t('unsign.confirm', { zone })}
        confirmLabel={unsign.isPending ? t('unsign.unsigning') : t('unsign.action')}
        tone="destructive"
        requireText={zone}
        pending={unsign.isPending}
        error={unsign.error}
        onConfirm={async () => {
          await unsign.mutateAsync()
        }}
      >
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('unsign.warning')}</AlertDescription>
        </Alert>
      </ConfirmDialog>
    </PageShell>
  )
}

export interface Nsec3SectionProps {
  nxProof?: DnssecProperties['nxProof']
  /** False while the zone is unsigned or the operator lacks `Zones.canModify`. */
  editable: boolean
  onAction: (mode: Nsec3DialogMode) => void
}

/**
 * Non-existence proof summary plus the three NSEC/NSEC3 transitions.
 *
 * Split out so `dnssec-view.tsx` stays about wiring: the branch here is only
 * "which of the three mutations is even meaningful right now" — converting to
 * NSEC3 twice in a row is a no-op upstream but reads like a mistake.
 */
function Nsec3Section({ nxProof, editable, onAction }: Nsec3SectionProps) {
  const t = useTranslations('dnssec')
  const isNsec3 = nxProof === 'NSEC3'

  return (
    <Section title={t('nsec3.title')} description={t('nsec3.subtitle')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('nsec3.current')}</span>
          <Badge variant={isNsec3 ? 'info' : 'outline'}>{nxProof ?? '—'}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">{isNsec3 ? t('nsec3.nsec3Hint') : t('nsec3.nsecHint')}</p>

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {isNsec3 ? (
              <>
                <Button variant="outline" size="sm" onClick={() => onAction('toNsec')}>
                  <ArrowRightLeft className="size-3.5" aria-hidden />
                  {t('nsec3.convertToNsec')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => onAction('params')}>
                  <SlidersHorizontal className="size-3.5" aria-hidden />
                  {t('nsec3.updateParams')}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => onAction('toNsec3')}>
                <ArrowRightLeft className="size-3.5" aria-hidden />
                {t('nsec3.convertToNsec3')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}

/** Placeholder shown on first paint of the whole page. */
function DnssecSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <StatGridSkeleton count={4} />
      <Section title={<Skeleton className="h-4 w-24" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </Section>
      <Section title={<Skeleton className="h-4 w-32" />}>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </Section>
    </div>
  )
}

/** Accent colour for the signing-status tile. */
function statusTone(status: DnssecProperties['dnssecStatus']): StatTone {
  switch (status) {
    case 'Signed':
      return 'success'
    case 'PendingSigning':
      return 'warning'
    case 'Disabled':
      return 'danger'
    default:
      return 'neutral'
  }
}

function StatusIcon({ status }: { status: DnssecProperties['dnssecStatus'] }) {
  const className = 'size-4'
  if (status === 'Signed') return <ShieldCheck className={className} aria-hidden />
  if (status === 'PendingSigning') return <LoaderCircle className={cn(className, 'animate-spin')} aria-hidden />
  return <ShieldQuestionMark className={className} aria-hidden />
}
