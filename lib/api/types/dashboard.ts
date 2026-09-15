import type { StatRange } from '@/lib/api/enums'

/**
 * Dashboard statistics.
 *
 * `dashboard/stats/get` returns five chart payloads plus a counter block. Line
 * charts (`mainChartData`) carry one dataset per series with a `label`; pie
 * charts (`queryTypeChartData` and friends) put the categories in `labels` and
 * ship a single unlabelled dataset. Both shapes are modelled so the chart
 * components can branch on `datasets[0].label === undefined`.
 */

export interface StatsCounters {
  totalQueries: number
  totalNoError: number
  totalServerFailure: number
  totalNxDomain: number
  totalRefused: number
  totalAuthoritative: number
  totalRecursive: number
  totalCached: number
  totalBlocked: number
  totalDropped: number
  totalClients: number
  zones: number
  cachedEntries: number
  allowedZones: number
  blockedZones: number
  allowListZones: number
  blockListZones: number
}

export interface ChartDataset {
  /** Absent on pie charts. */
  label?: string | null
  data: number[]
  backgroundColor: string | string[]
  borderColor?: string | string[]
  borderWidth?: number | number[]
  fill?: boolean
}

export interface ChartData {
  /** date-fns format string, e.g. `HH:mm` or `DD/MM HH:00`. Absent on pie charts. */
  labelFormat?: string
  labels: string[]
  datasets: ChartDataset[]
}

export interface TopClient {
  name: string
  hits: number
  rateLimited: boolean
}

export interface TopDomain {
  name: string
  hits: number
}

export interface DashboardStats {
  stats: StatsCounters
  mainChartData: ChartData
  queryResponseChartData: ChartData
  queryTypeChartData: ChartData
  protocolTypeChartData: ChartData
  topClients: TopClient[]
  topDomains: TopDomain[]
  topBlockedDomains: TopDomain[]
}

export interface TopResult {
  topClients?: TopClient[]
  topDomains?: TopDomain[]
  topBlockedDomains?: TopDomain[]
}

export interface StatsQuery {
  /** `lastHour` | `lastDay` | … or `custom` with an explicit range. */
  type?: StatRange
  /**
   * ISO-8601 window edges, only used with `type=custom`. These are the wire
   * parameter names: upstream answers `Parameter 'start' missing.` when a
   * custom request omits either, and ignores them for preset types.
   */
  start?: string
  end?: string
  /** Interpret the window and labels as UTC rather than server-local time. */
  utc?: boolean
  /** Cluster node name; omit for the local server. */
  node?: string
}

/** Which leaderboard `dashboard/stats/getTop` should return. */
export const TOP_STATS_TYPES = ['TopClients', 'TopDomains', 'TopBlockedDomains'] as const
export type TopStatsType = (typeof TOP_STATS_TYPES)[number]

export interface TopQuery extends StatsQuery {
  statsType: TopStatsType
  /** How many rows; the console offers 5 / 10 / 20 / 50 / 100. */
  limit?: number
}

/** Series order in `mainChartData.datasets`, used to colour the legend. */
export const MAIN_CHART_SERIES = [
  'Total', 'No Error', 'Server Failure', 'NX Domain', 'Refused',
  'Authoritative', 'Recursive', 'Cached', 'Blocked', 'Dropped', 'Clients',
] as const
