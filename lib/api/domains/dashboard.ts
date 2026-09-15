import { apiRequest } from '../client'
import type { DashboardStats, StatsQuery, TopQuery, TopResult } from '../types/dashboard'

/**
 * Dashboard statistics.
 *
 * `type` selects a rolling window (`lastHour` … `lastYear`) or `custom`, in
 * which case `from`/`to` are ISO-8601 timestamps. `utc` controls whether the
 * chart labels and the custom window are interpreted as UTC or server-local —
 * the console always sends `utc=true` and formats labels client-side.
 */

export function getStats(query: StatsQuery = {}): Promise<DashboardStats> {
  return apiRequest<DashboardStats>('dashboard/stats/get', {
    params: { type: query.type ?? 'lastHour', utc: query.utc ?? true, start: query.start, end: query.end, node: query.node },
  })
}

export function getTopStats(query: TopQuery): Promise<TopResult> {
  return apiRequest<TopResult>('dashboard/stats/getTop', {
    params: {
      type: query.type ?? 'lastHour',
      start: query.start,
      end: query.end,
      statsType: query.statsType,
      limit: query.limit ?? 10,
      node: query.node,
    },
  })
}

/** Drops every stored statistic. Irreversible; gate it behind a confirm dialog. */
export function deleteAllStats(node?: string): Promise<null> {
  return apiRequest<null>('dashboard/stats/deleteAll', { params: { node } })
}
