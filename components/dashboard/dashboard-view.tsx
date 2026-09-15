'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  Ban,
  CircleCheck,
  CircleX,
  Database,
  FolderPlus,
  FolderTree,
  Gauge,
  ScrollText,
  Settings,
  ShieldBan,
  Terminal,
  Trash,
  TriangleAlert,
  Users,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, PageShell } from '@/components/app/page-shell'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { EmptyState, ErrorState } from '@/components/app/states'
import { ChartCard, ChartSkeleton } from '@/components/charts/chart-shared'
import { DonutChart, toDonutSlices } from '@/components/charts/donut-chart'
import { TrendChart } from '@/components/charts/trend-chart'
import { RangePicker, type RefreshSeconds, type StatsWindow } from '@/components/dashboard/range-picker'
import { TopLeaderboard } from '@/components/dashboard/top-leaderboard'
import { DefaultCredentialsWarning, ServerStatusCard } from '@/components/dashboard/server-status-card'
import { deleteAllStats, getStats } from '@/lib/api/domains/dashboard'
import { flushScope } from '@/lib/api/domains/filtering'
import { describeError } from '@/lib/api/client'
import type { StatsCounters } from '@/lib/api/types/dashboard'
import { queryKeys } from '@/lib/api/query-keys'
import { useCan } from '@/lib/auth/session'
import { formatNumber } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Dashboard.
 *
 * Everything here is derived from a single `dashboard/stats/get` call, so the
 * whole page refreshes as one unit — the counters, the trend and the embedded
 * leaderboards all describe the same window and must never disagree.
 */

const PRIMARY_CARDS: { key: keyof StatsCounters; icon: React.ReactNode; tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }[] = [
  { key: 'totalQueries', icon: <Activity className="size-4" aria-hidden />, tone: 'primary' },
  { key: 'totalNoError', icon: <CircleCheck className="size-4" aria-hidden />, tone: 'success' },
  { key: 'totalNxDomain', icon: <CircleX className="size-4" aria-hidden />, tone: 'warning' },
  { key: 'totalServerFailure', icon: <TriangleAlert className="size-4" aria-hidden />, tone: 'danger' },
  { key: 'totalBlocked', icon: <Ban className="size-4" aria-hidden />, tone: 'danger' },
  { key: 'totalCached', icon: <Database className="size-4" aria-hidden />, tone: 'info' },
  { key: 'totalClients', icon: <Users className="size-4" aria-hidden />, tone: 'neutral' },
  { key: 'zones', icon: <FolderTree className="size-4" aria-hidden />, tone: 'neutral' },
]

const SECONDARY_CARDS: { key: keyof StatsCounters; icon: React.ReactNode; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }[] = [
  { key: 'totalAuthoritative', icon: <ShieldBan className="size-4" aria-hidden />, tone: 'info' },
  { key: 'totalRecursive', icon: <Zap className="size-4" aria-hidden />, tone: 'info' },
  { key: 'totalRefused', icon: <Ban className="size-4" aria-hidden />, tone: 'warning' },
  { key: 'totalDropped', icon: <Trash className="size-4" aria-hidden />, tone: 'danger' },
  { key: 'cachedEntries', icon: <Database className="size-4" aria-hidden />, tone: 'neutral' },
  { key: 'allowedZones', icon: <CircleCheck className="size-4" aria-hidden />, tone: 'success' },
  { key: 'blockedZones', icon: <CircleX className="size-4" aria-hidden />, tone: 'danger' },
  { key: 'allowListZones', icon: <FolderTree className="size-4" aria-hidden />, tone: 'neutral' },
  { key: 'blockListZones', icon: <FolderTree className="size-4" aria-hidden />, tone: 'neutral' },
]

/** Upstream series label -> i18n key under `charts.main`. */
const MAIN_SERIES_KEYS: Record<string, string> = {
  Total: 'queries',
  'No Error': 'noError',
  'Server Failure': 'serverFailure',
  'NX Domain': 'nxDomain',
  Refused: 'refused',
  Authoritative: 'authoritative',
  Recursive: 'recursive',
  Cached: 'cached',
  Blocked: 'blocked',
  Dropped: 'dropped',
  Clients: 'clients',
}

/** Shown until the operator starts interacting — matches the console default. */
const DEFAULT_VISIBLE = ['Total', 'No Error', 'NX Domain', 'Server Failure', 'Blocked']

export function DashboardView() {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  // The cache flush lives here *and* on /cache, and it is the same destructive
  // operation both times — so the confirmation copy is borrowed from the
  // filtering namespace rather than duplicated, where a reworded one side would
  // silently drift from the other.
  const tf = useTranslations('filtering')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Dashboard')

  const [statsWindow, setStatsWindow] = React.useState<StatsWindow>({ type: 'lastHour' })
  const [refresh, setRefresh] = React.useState<RefreshSeconds>(30)
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)
  const [confirmWipe, setConfirmWipe] = React.useState(false)
  const [confirmFlush, setConfirmFlush] = React.useState(false)

  const stats = useQuery({
    queryKey: queryKeys.stats(target, { ...statsWindow }),
    queryFn: async () => {
      const result = await getStats({ type: statsWindow.type, start: statsWindow.start, end: statsWindow.end, utc: true })
      setLastUpdated(new Date())
      return result
    },
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
    // Refetching on tab focus doubles the load for no benefit when an explicit
    // auto-refresh interval is already running.
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })

  const wipe = useMutation({
    mutationFn: () => deleteAllStats(),
    onSuccess: () => {
      toast.success(tc('toast.deleted'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'dashboard') })
      setConfirmWipe(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const flushCache = useMutation({
    mutationFn: () => flushScope('cache'),
    onSuccess: () => {
      toast.success(tf('flush.success', { scope: tf('scopes.cache.title') }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'cache') })
      setConfirmFlush(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const counters = stats.data?.stats
  const main = stats.data?.mainChartData
  const names = React.useMemo(() => {
    const out: Record<string, string> = {}
    for (const [raw, key] of Object.entries(MAIN_SERIES_KEYS)) {
      out[raw] = t(`charts.main.${key}`)
    }
    return out
  }, [t])

  const quickActions = [
    { href: '/zones?new=1', label: t('quickActions.addZone'), icon: <FolderPlus className="size-4" aria-hidden /> },
    { href: '/zones', label: t('quickActions.addRecord'), icon: <FolderTree className="size-4" aria-hidden /> },
    { href: '/resolve', label: t('quickActions.resolve'), icon: <Terminal className="size-4" aria-hidden /> },
    { href: '/logs', label: t('quickActions.viewLogs'), icon: <ScrollText className="size-4" aria-hidden /> },
    { href: '/settings', label: t('quickActions.settings'), icon: <Settings className="size-4" aria-hidden /> },
  ]

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmFlush(true)} disabled={!can.canModify}>
              <Gauge className="size-3.5" aria-hidden />
              {t('quickActions.flushCache')}
            </Button>
            {can.canDelete && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmWipe(true)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash className="size-3.5" aria-hidden />
                {t('server.deleteStats')}
              </Button>
            )}
          </>
        }
        footer={
          <RangePicker
            value={statsWindow}
            onApply={setStatsWindow}
            refresh={refresh}
            onRefreshChange={setRefresh}
            onRefreshNow={() => void stats.refetch()}
            isFetching={stats.isFetching}
            lastUpdated={lastUpdated}
          />
        }
      />

      <DefaultCredentialsWarning />

      <nav aria-label={t('quickActions.title')} className="flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.href + action.label}
            href={action.href}
            className="surface inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:bg-accent/50"
          >
            {action.icon}
            {action.label}
          </Link>
        ))}
      </nav>

      {stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <StatGrid columns={4}>
            {PRIMARY_CARDS.map((card) => (
              <StatCard
                key={card.key}
                label={t(`cards.${card.key}.label`)}
                hint={t(`cards.${card.key}.hint`)}
                value={formatNumber(counters?.[card.key], locale)}
                icon={card.icon}
                tone={card.tone}
                loading={stats.isPending}
                size="md"
              />
            ))}
          </StatGrid>

          <ChartCard
            title={t('charts.main.title')}
            subtitle={t('charts.main.subtitle')}
            bodyClassName="p-3"
            actions={<span className="hidden text-[11px] text-muted-foreground sm:inline">{t('charts.main.seriesHint')}</span>}
          >
            {stats.isPending ? (
              <ChartSkeleton height={300} />
            ) : main ? (
              <TrendChart
                labels={main.labels}
                series={main.datasets}
                names={names}
                initialVisible={DEFAULT_VISIBLE}
                height={300}
                emptyLabel={t('charts.main.empty')}
              />
            ) : (
              <EmptyState title={t('empty.title')} body={t('empty.body')} icon={Activity} />
            )}
          </ChartCard>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard title={t('charts.queryResponse.title')} subtitle={t('charts.queryResponse.subtitle')}>
              {stats.isPending ? (
                <ChartSkeleton height={240} />
              ) : (
                <DonutChart
                  slices={toDonutSlices(
                    stats.data?.queryResponseChartData.labels ?? [],
                    stats.data?.queryResponseChartData.datasets[0]?.data ?? [],
                  )}
                  totalLabel={t('charts.total')}
                  emptyLabel={t('charts.queryResponse.empty')}
                />
              )}
            </ChartCard>

            <ChartCard title={t('charts.queryType.title')} subtitle={t('charts.queryType.subtitle')}>
              {stats.isPending ? (
                <ChartSkeleton height={240} />
              ) : (
                <DonutChart
                  slices={toDonutSlices(
                    stats.data?.queryTypeChartData.labels ?? [],
                    stats.data?.queryTypeChartData.datasets[0]?.data ?? [],
                  )}
                  totalLabel={t('charts.total')}
                  emptyLabel={t('charts.queryType.empty')}
                />
              )}
            </ChartCard>

            <ChartCard title={t('charts.protocolType.title')} subtitle={t('charts.protocolType.subtitle')}>
              {stats.isPending ? (
                <ChartSkeleton height={240} />
              ) : (
                <DonutChart
                  slices={toDonutSlices(
                    stats.data?.protocolTypeChartData.labels ?? [],
                    stats.data?.protocolTypeChartData.datasets[0]?.data ?? [],
                  )}
                  totalLabel={t('charts.total')}
                  emptyLabel={t('charts.protocolType.empty')}
                />
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <TopLeaderboard
              statsType="TopClients"
              title={t('tables.topClients.title')}
              subtitle={t('tables.topClients.subtitle')}
              emptyLabel={t('tables.topClients.empty')}
              embedded={stats.data?.topClients}
              statsWindow={statsWindow}
              rateLimitedLabel={t('tables.topClients.rateLimited')}
              rateLimitedHint={t('tables.topClients.rateLimitedHint')}
            />
            <TopLeaderboard
              statsType="TopDomains"
              title={t('tables.topDomains.title')}
              subtitle={t('tables.topDomains.subtitle')}
              emptyLabel={t('tables.topDomains.empty')}
              embedded={stats.data?.topDomains}
              statsWindow={statsWindow}
            />
            <TopLeaderboard
              statsType="TopBlockedDomains"
              title={t('tables.topBlockedDomains.title')}
              subtitle={t('tables.topBlockedDomains.subtitle')}
              emptyLabel={t('tables.topBlockedDomains.empty')}
              embedded={stats.data?.topBlockedDomains}
              statsWindow={statsWindow}
            />
          </div>

          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
            <StatGrid columns={3} className="xl:col-span-2">
              {SECONDARY_CARDS.map((card) => (
                <StatCard
                  key={card.key}
                  label={t(`cards.${card.key}.label`)}
                  hint={t(`cards.${card.key}.hint`)}
                  value={formatNumber(counters?.[card.key], locale)}
                  icon={card.icon}
                  tone={card.tone}
                  loading={stats.isPending}
                  size="sm"
                />
              ))}
            </StatGrid>

            <ServerStatusCard />
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmFlush}
        onOpenChange={setConfirmFlush}
        title={tf('flush.confirmTitle', { scope: tf('scopes.cache.title') })}
        description={tf('flush.confirmCache')}
        confirmLabel={flushCache.isPending ? tf('toolbar.flushing') : tf('toolbar.flush')}
        onConfirm={async () => {
          await flushCache.mutateAsync()
        }}
        pending={flushCache.isPending}
        error={flushCache.error ?? undefined}
      />

      <ConfirmDialog
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title={t('server.deleteStats')}
        description={t('server.deleteStatsHint')}
        tone="destructive"
        onConfirm={async () => {
          await wipe.mutateAsync()
        }}
        pending={wipe.isPending}
        error={wipe.error ?? undefined}
      />
    </PageShell>
  )
}
