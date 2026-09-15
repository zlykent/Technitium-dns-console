import type { DnsClass, QueryLogProtocol, QueryResponseType, ResponseCode } from '@/lib/api/enums'

/**
 * Two unrelated things live under `api/logs`:
 *
 *  - **System logs** (`logs/list`, `logs/download`, `logs/delete`) — the daily
 *    text files the server writes to `logFolder`.
 *  - **Query logs** (`logs/query`, `logs/export`) — a database written by an
 *    installed *query logging DNS app*. Without such an app installed these two
 *    endpoints answer "DNS application was not found", which is why `name` and
 *    `classPath` come from `apps/list` rather than from `logs/list`.
 */

export interface LogFile {
  /** Technitium names files by date, e.g. `2026-09-11`. */
  fileName: string
  /** Pre-formatted by the server, e.g. `2.45 MB`. */
  size: string
}

export interface LogFileListResult {
  logFiles: LogFile[]
}

export interface QueryLogEntry {
  rowNumber: number
  timestamp: string
  clientIpAddress: string
  protocol: QueryLogProtocol | string
  qname: string
  qtype: string
  qclass: DnsClass | string
  rcode: ResponseCode | string
  responseType: QueryResponseType | string
  /** `null` when the entry had no answer section (e.g. NXDOMAIN). */
  answer: string | null
  /** Round-trip time, pre-formatted (`1.23 ms`). Optional: the logging apps
   *  omit it for entries they never timed (e.g. an authoritative answer
   *  served without a upstream round trip), so absence is normal data. */
  responseRtt?: string
}

export interface QueryLogResult {
  entries: QueryLogEntry[]
  pageNumber: number
  totalPages: number
  totalEntries: number
}

/**
 * Filter for `logs/query` and `logs/export`. Every field is optional except the
 * app identity; an empty string means "no filter" upstream.
 */
export interface QueryLogFilter {
  /** Installed query-logging app name, from `apps/list`. */
  name: string
  /** The app's `classPath`, e.g. `Technitium.DnsServer.Apps.QueryLogsApp`. */
  classPath: string
  pageNumber?: number
  entriesPerPage?: number
  descendingOrder?: boolean
  /** ISO-8601 local or UTC, matching the server's `useLocalTime` setting. */
  start?: string
  end?: string
  clientIpAddress?: string
  protocol?: QueryLogProtocol | ''
  responseType?: QueryResponseType | ''
  rcode?: ResponseCode | ''
  qname?: string
  qtype?: string
  qclass?: DnsClass | ''
  node?: string
}

/** Response codes colour-coded by the console; reused for our row tinting. */
export const RCODE_SEVERITY: Record<string, 'ok' | 'warning' | 'danger' | 'muted'> = {
  NoError: 'ok',
  NxDomain: 'muted',
  Refused: 'muted',
  ServerFailure: 'danger',
  FormatError: 'danger',
  NotImplemented: 'warning',
  NotAuth: 'warning',
  NotZone: 'warning',
  YXDomain: 'warning',
  YXRRSet: 'warning',
  NXRRSet: 'warning',
}

/** Blocked answers are NxDomain too, so severity depends on the response type. */
export function queryLogSeverity(entry: Pick<QueryLogEntry, 'rcode' | 'responseType'>): 'ok' | 'warning' | 'danger' | 'muted' | 'blocked' {
  const blocked = ['blocked', 'upstreamblocked', 'upstreamblockedcached']
  if (blocked.includes(entry.responseType.toLowerCase())) return 'blocked'
  return RCODE_SEVERITY[entry.rcode] ?? 'muted'
}
