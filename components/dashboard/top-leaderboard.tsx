'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Gauge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChartCard, ChartSkeleton } from '@/components/charts/chart-shared'
import { RankList, type RankRow } from '@/components/charts/rank-list'
import { ErrorState } from '@/components/app/states'
import { getTopStats } from '@/lib/api/domains/dashboard'
import type { TopClient, TopDomain, TopStatsType } from '@/lib/api/types/dashboard'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'
import type { StatsWindow } from './range-picker'

/**
 * One of the three dashboards leaderboards.
 *
 * `dashboard/stats/get` already embeds the top ten, so at the default limit we
 * render those and issue nothing extra. Only when the operator widens the list
 * does `dashboard/stats/getTop` run.
 */

const LIMITS = [10, 25, 50, 100] as const
const DEFAULT_LIMIT = 10

export interface TopLeaderboardProps {
  statsType: TopStatsType
  title: string
  subtitle?: string
  emptyLabel: string
  /** Rows embedded in the `dashboard/stats/get` payload. */
  embedded: TopClient[] | TopDomain[] | undefined
  statsWindow: StatsWindow
  /** Only `TopClients` carries a rate-limit flag. */
  rateLimitedLabel?: string
  rateLimitedHint?: string
  className?: string
}

export function TopLeaderboard({
  statsType,
  title,
  subtitle,
  emptyLabel,
  embedded,
  statsWindow,
  rateLimitedLabel,
  rateLimitedHint,
  className,
}: TopLeaderboardProps) {
  const t = useTranslations('dashboard')
  const target = useTargetKey()
  const [limit, setLimit] = React.useState<number>(DEFAULT_LIMIT)

  const widened = limit !== DEFAULT_LIMIT

  const query = useQuery({
    queryKey: [...queryKeys.topStats(target, { ...statsWindow }, statsType), limit],
    queryFn: () =>
      getTopStats({
        type: statsWindow.type,
        start: statsWindow.start,
        end: statsWindow.end,
        statsType,
        limit,
        utc: true,
      }),
    enabled: widened,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const rows: RankRow[] = React.useMemo(() => {
    const source = widened ? (query.data?.[keyFor(statsType)] ?? []) : (embedded ?? [])
    return source.map((entry) => {
      const client = entry as TopClient
      return {
        name: entry.name,
        value: entry.hits,
        badge:
          rateLimitedLabel && client.rateLimited ? (
            <Badge variant="warning" title={rateLimitedHint}>
              <Gauge className="size-3" aria-hidden />
              {rateLimitedLabel}
            </Badge>
          ) : undefined,
      }
    })
  }, [widened, query.data, embedded, rateLimitedLabel, rateLimitedHint, statsType])

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      bodyClassName="p-2"
      actions={
        <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
          <SelectTrigger size="sm" className="h-7 w-20 text-xs" aria-label={t('charts.limit')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMITS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {widened && query.isPending ? (
        <ChartSkeleton height={rows.length * 30 || 200} className="mx-1" />
      ) : widened && query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} compact className="m-1" />
      ) : (
        <RankList rows={rows} emptyLabel={emptyLabel} className="px-1 py-1" />
      )}
    </ChartCard>
  )
}

function keyFor(statsType: TopStatsType): 'topClients' | 'topDomains' | 'topBlockedDomains' {
  switch (statsType) {
    case 'TopClients':
      return 'topClients'
    case 'TopDomains':
      return 'topDomains'
    default:
      return 'topBlockedDomains'
  }
}
