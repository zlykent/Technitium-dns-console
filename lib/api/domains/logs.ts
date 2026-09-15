import { apiDownload, apiRequest } from '../client'
import type { LogFileListResult, QueryLogFilter, QueryLogResult } from '../types/logs'

/**
 * Two unrelated things live under `api/logs`:
 *
 *  - **System logs** — the daily text files the server writes to `logFolder`.
 *  - **Query logs** — a database owned by an installed *query logging DNS app*.
 *    `name` and `classPath` therefore come from `apps/list` (see `queryLogApps`),
 *    not from `logs/list`. Without such an app installed, `logs/query` answers
 *    "DNS application was not found".
 */

// ------------------------------------------------------------- system logs

export function listLogFiles(node?: string): Promise<LogFileListResult> {
  return apiRequest<LogFileListResult>('logs/list', { params: { node } })
}

/**
 * Stream a log file to the browser as a download.
 * `limit` tails the file to the last N lines — the console uses it for previews.
 */
export function downloadLogFile(fileName: string, options: { limit?: number; node?: string } = {}): Promise<void> {
  return apiDownload('logs/download', { fileName, limit: options.limit, node: options.node }, `${fileName}.log`)
}

/** Note the parameter is `log`, not `fileName` as on the download endpoint. */
export function deleteLogFile(log: string, node?: string): Promise<null> {
  return apiRequest<null>('logs/delete', { params: { log, node } })
}

export function deleteAllLogFiles(node?: string): Promise<null> {
  return apiRequest<null>('logs/deleteAll', { params: { node } })
}

// -------------------------------------------------------------- query logs

export function queryLogs(filter: QueryLogFilter): Promise<QueryLogResult> {
  return apiRequest<QueryLogResult>('logs/query', {
    params: {
      name: filter.name,
      classPath: filter.classPath,
      pageNumber: filter.pageNumber ?? 1,
      entriesPerPage: filter.entriesPerPage ?? 25,
      descendingOrder: filter.descendingOrder ?? true,
      start: filter.start ?? '',
      end: filter.end ?? '',
      clientIpAddress: filter.clientIpAddress ?? '',
      protocol: filter.protocol ?? '',
      responseType: filter.responseType ?? '',
      rcode: filter.rcode ?? '',
      qname: filter.qname ?? '',
      qtype: filter.qtype ?? '',
      qclass: filter.qclass ?? '',
      node: filter.node,
    },
  })
}

/** Same filter, minus paging, delivered as a file. */
export function exportQueryLogs(filter: Omit<QueryLogFilter, 'pageNumber' | 'entriesPerPage' | 'descendingOrder'>): Promise<void> {
  return apiDownload(
    'logs/export',
    {
      name: filter.name,
      classPath: filter.classPath,
      start: filter.start ?? '',
      end: filter.end ?? '',
      clientIpAddress: filter.clientIpAddress ?? '',
      protocol: filter.protocol ?? '',
      responseType: filter.responseType ?? '',
      rcode: filter.rcode ?? '',
      qname: filter.qname ?? '',
      qtype: filter.qtype ?? '',
      qclass: filter.qclass ?? '',
      node: filter.node,
    },
    'query-logs.csv',
  )
}
