'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Ban, CircleCheck, Copy, Download, RefreshCw, RotateCw, ScrollText } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { copyText, DataValue } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, PageHeader, PageShell } from '@/components/app/page-shell'
import { isMissingLoggingAppError, NoLoggingAppState } from '@/components/logs/no-logging-app-state'
import {
  countActiveFilters,
  createQueryLogFilter,
  QueryLogsFilter,
  toQueryTimestamp,
  useResponseLabel,
  type QueryLogFilterState,
} from '@/components/logs/query-logs-filter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { describeError } from '@/lib/api/client'
import { listApps } from '@/lib/api/domains/apps'
import { DEFAULT_RESOLVER, resolve } from '@/lib/api/domains/dns-client'
import { addDomain, type EditableScope } from '@/lib/api/domains/filtering'
import { exportQueryLogs, queryLogs } from '@/lib/api/domains/logs'
import { QUERY_RECORD_TYPES, type QueryRecordType } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import { queryLogApps } from '@/lib/api/types/apps'
import { formatRData } from '@/lib/api/types/dns-client'
import {
  queryLogSeverity,
  type QueryLogEntry,
  type QueryLogFilter,
  type QueryLogResult,
} from '@/lib/api/types/logs'
import { useCan } from '@/lib/auth/session'
import { displayDomain, formatDateTime, formatRtt } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Query logs (`/logs`).
 *
 * The single most important thing about this page is that **the data is not the
 * server's**. Query logs live in a database owned by an installed *query logging
 * DNS app*, so `logs/query` needs both `name` and `classPath` taken from
 * `apps/list`. A server with no such app answers `DNS application was not found`
 * — which is a setup condition, not a fault, and is rendered by
 * `NoLoggingAppState` rather than the red `ErrorState`. `isMissingLoggingAppError`
 * catches the same message arriving late (the app was removed in another tab
 * between the two requests) and downgrades it too.
 *
 * Other non-obvious details:
 *
 *  - `logs/query` paginates server-side, so every filter is a request parameter
 *    and part of the query key; the browser only ever holds one page. Sorting is
 *    therefore disabled at the table level — upstream offers exactly one knob
 *    (`descendingOrder`) and it lives in the filter bar, not in a column header
 *    that would silently sort the current page only.
 *  - `responseRtt` arrives pre-rendered (`1.23 ms`) but the tone badge needs the
 *    number, so it is parsed back and re-formatted through `formatRtt`; when the
 *    upstream string is not numeric we show it verbatim rather than `—`.
 *  - `logs/export` deliberately ignores paging, so the export button is enabled
 *    even when the current page is empty — a narrow filter can still match rows.
 *  - The page pins itself to the viewport (`h-full` shell + `scrollable` table):
 *    the filter card folds through a persisted `Collapsible` and the entries
 *    scroll inside the card between a sticky head and the pagination, instead
 *    of stretching the page scroll behind the topbar.
 */

/** Returned when the query is disabled; keeps `queryFn` total without a cast. */
const EMPTY_RESULT: QueryLogResult = { entries: [], pageNumber: 1, totalPages: 1, totalEntries: 0 }

/** Round-trip-time buckets. LAN recursion is single digits; >300 ms means upstream. */
const RTT_FAST_MS = 50
const RTT_SLOW_MS = 300

const RTT_TONE_CLASS = {
  fast: 'text-muted-foreground',
  normal: 'text-foreground',
  slow: 'text-warning',
} as const

type Criteria = Omit<QueryLogFilter, 'pageNumber' | 'entriesPerPage' | 'descendingOrder'>

export function QueryLogsView() {
  const t = useTranslations('logs')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const responseLabel = useResponseLabel()
  const can = useCan('Logs')

  const [filter, setFilter] = React.useState<QueryLogFilterState>(() => createQueryLogFilter())
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [detail, setDetail] = React.useState<QueryLogEntry | null>(null)

  const apps = useQuery({
    queryKey: queryKeys.apps(target),
    queryFn: () => listApps(),
    enabled: can.canView,
    staleTime: 60_000,
  })

  const logApps = React.useMemo(() => queryLogApps(apps.data?.apps ?? []), [apps.data])

  /** The applied source, or the first available one when nothing is applied yet. */
  const activeApp = React.useMemo(
    () => logApps.find((app) => app.classPath === filter.classPath) ?? logApps[0] ?? null,
    [logApps, filter.classPath],
  )

  const [appliedApp, setAppliedApp] = React.useState<{ name: string; classPath: string } | null>(null)

  // Publish the resolved identity back into the filter so the source `Select`
  // shows a selection instead of an empty trigger. This runs in the render phase
  // on purpose: `criteria` below is derived from `filter` in the same pass, so
  // deferring the write to an effect would fire one `logs/query` with a blank
  // `name`/`classPath` and earn a "DNS application was not found" for it.
  if (activeApp && (appliedApp?.name !== activeApp.name || appliedApp?.classPath !== activeApp.classPath)) {
    setAppliedApp({ name: activeApp.name, classPath: activeApp.classPath })
    setFilter((prev) => ({ ...prev, name: activeApp.name, classPath: activeApp.classPath }))
  }

  const criteria = React.useMemo<Criteria | null>(() => {
    if (!activeApp) return null
    return {
      name: activeApp.name,
      classPath: activeApp.classPath,
      start: toQueryTimestamp(filter.start),
      end: toQueryTimestamp(filter.end),
      clientIpAddress: filter.clientIpAddress.trim(),
      protocol: filter.protocol,
      responseType: filter.responseType,
      rcode: filter.rcode,
      qname: filter.qname.trim(),
      qtype: filter.qtype,
      qclass: filter.qclass,
    }
  }, [activeApp, filter])

  const request = React.useMemo<QueryLogFilter | null>(
    () =>
      criteria
        ? { ...criteria, pageNumber: page, entriesPerPage: pageSize, descendingOrder: filter.descendingOrder }
        : null,
    [criteria, page, pageSize, filter.descendingOrder],
  )

  const entries = useQuery({
    queryKey: queryKeys.logEntries(target, { ...(request ?? {}) }),
    queryFn: () => (request ? queryLogs(request) : Promise.resolve(EMPTY_RESULT)),
    // No app, no request — firing anyway would only earn a
    // "DNS application was not found" that we would then have to hide.
    enabled: can.canView && request !== null,
    placeholderData: keepPreviousData,
  })

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const exportCsv = useMutation({
    mutationFn: (params: Criteria) => exportQueryLogs(params),
    onSuccess: () => toast.success(t('query.exportSuccess')),
    onError,
  })

  const applyFilter = React.useCallback((next: QueryLogFilterState) => {
    setFilter(next)
    setPage(1)
  }, [])

  const appMissing = isMissingLoggingAppError(entries.error)
  const needsApp = (apps.isSuccess && logApps.length === 0) || appMissing
  const rows = entries.data?.entries ?? []
  const total = entries.data?.totalEntries ?? 0

  const columns = React.useMemo(
    () => [
      textColumn<QueryLogEntry>({
        id: 'rowNumber',
        accessorKey: 'rowNumber',
        header: t('query.columns.rowNumber'),
        align: 'right',
        hug: true,
        cell: (value) => <span className="font-data text-muted-foreground text-xs">{String(value)}</span>,
      }),
      textColumn<QueryLogEntry>({
        id: 'timestamp',
        accessorKey: 'timestamp',
        header: t('query.columns.timestamp'),
        cell: (value) => (
          <span className="font-data text-xs whitespace-nowrap">
            {formatDateTime(value as string, locale)}
          </span>
        ),
      }),
      textColumn<QueryLogEntry>({
        id: 'clientIpAddress',
        accessorKey: 'clientIpAddress',
        header: t('query.columns.clientIpAddress'),
        cell: (value) => (
          <DataValue value={String(value)} copyLabel={tc('toast.copied')} className="max-w-40" />
        ),
      }),
      textColumn<QueryLogEntry>({
        id: 'protocol',
        accessorKey: 'protocol',
        header: t('query.columns.protocol'),
        cell: (value) => <span className="text-muted-foreground text-xs">{String(value)}</span>,
      }),
      textColumn<QueryLogEntry>({
        id: 'qname',
        accessorKey: 'qname',
        header: t('query.columns.qname'),
        cell: (value) => (
          <span className="font-data block max-w-72 truncate text-sm" title={String(value)}>
            {displayDomain(String(value))}
          </span>
        ),
      }),
      textColumn<QueryLogEntry>({
        id: 'qtype',
        accessorKey: 'qtype',
        header: t('query.columns.qtype'),
        cell: (value) => <span className="font-data text-xs">{String(value)}</span>,
      }),
      textColumn<QueryLogEntry>({
        id: 'qclass',
        accessorKey: 'qclass',
        header: t('query.columns.qclass'),
        cell: (value) => <span className="font-data text-muted-foreground text-xs">{String(value)}</span>,
      }),
      textColumn<QueryLogEntry>({
        id: 'responseType',
        accessorKey: 'responseType',
        header: t('query.columns.responseType'),
        cell: (value, row) => (
          <Badge variant={severityVariant(queryLogSeverity(row))}>{responseLabel(String(value))}</Badge>
        ),
      }),
      textColumn<QueryLogEntry>({
        id: 'rcode',
        accessorKey: 'rcode',
        header: t('query.columns.rcode'),
        cell: (value, row) => (
          <Badge variant={severityVariant(queryLogSeverity(row))}>{responseLabel(String(value))}</Badge>
        ),
      }),
      textColumn<QueryLogEntry>({
        id: 'answer',
        accessorKey: 'answer',
        header: t('query.columns.answer'),
        cell: (value) =>
          value ? (
            <span
              className="font-data text-muted-foreground block max-w-56 truncate text-xs"
              title={String(value)}
            >
              {String(value)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      textColumn<QueryLogEntry>({
        id: 'responseRtt',
        accessorKey: 'responseRtt',
        header: t('query.columns.responseRtt'),
        align: 'right',
        hug: true,
        cell: (value) => <RttCell raw={String(value ?? '')} locale={locale} />,
      }),
    ],
    [t, tc, locale, responseLabel],
  )

  return (
    <PageShell className="h-full">
      <PageHeader
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void apps.refetch()
                void entries.refetch()
              }}
              loading={apps.isFetching || entries.isFetching}
              disabled={!can.canView}
            >
              {!apps.isFetching && !entries.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {tc('actions.refresh')}
            </Button>
            {/* `logs/export` ignores paging, so a narrow filter that empties the
                current page can still produce a full CSV. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => criteria && exportCsv.mutate(criteria)}
              loading={exportCsv.isPending}
              disabled={!can.canView || !criteria || needsApp}
              title={t('query.exportHint')}
            >
              {!exportCsv.isPending && <Download className="size-3.5" aria-hidden />}
              {exportCsv.isPending ? t('query.exporting') : t('query.export')}
            </Button>
          </>
        }
      />

      {needsApp ? (
        <NoLoggingAppState error={apps.error ?? undefined} onRetry={() => void apps.refetch()} />
      ) : (
        <>
          <QueryLogsFilter apps={logApps} value={filter} onApply={applyFilter} busy={apps.isPending} />

          <DataTable<QueryLogEntry>
            label={t('query.title')}
            columns={columns}
            data={rows}
            getRowId={(row, index) => `${row.rowNumber}-${index}`}
            loading={entries.isPending}
            error={appMissing ? undefined : entries.error}
            onRetry={() => void entries.refetch()}
            onRowClick={setDetail}
            density="compact"
            scrollable
            enableSorting={false}
            // A query that came back empty under an operator-set filter is "no
            // match", not "logging has never recorded anything" — the two need
            // different copy, and only the first invites widening the range.
            filterActive={countActiveFilters(filter) > 0}
            empty={{ title: t('query.empty'), body: t('query.emptyHint'), icon: ScrollText }}
            server={{
              page: entries.data?.pageNumber ?? page,
              pageSize,
              total,
              totalPages: entries.data?.totalPages ?? 1,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
            }}
            footerNote={t('query.totalEntries', { count: total })}
          />
        </>
      )}

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('query.detail.title')}</DialogTitle>
            {detail && (
              <DialogDescription className="font-data break-all">
                {displayDomain(detail.qname)}
              </DialogDescription>
            )}
          </DialogHeader>
          {detail && <QueryLogDetail entry={detail} responseLabel={responseLabel} locale={locale} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

/**
 * Body + footer of the detail dialog.
 *
 * Kept inside this file (not exported) so the module list stays exactly the one
 * the route needs, and because everything it renders is a re-presentation of a
 * row the table already holds — there is no second fetch behind it, except the
 * explicit "resolve again".
 *
 * "Resolve again" calls `dnsClient/resolve` against *this* server rather than
 * linking to `/resolve`: the operator is asking "would this still fail now?",
 * and answering that in place keeps the log row they were reading on screen.
 */
function QueryLogDetail({
  entry,
  responseLabel,
  locale,
}: {
  entry: QueryLogEntry
  responseLabel: (value: string) => string
  locale: ReturnType<typeof useLocaleCode>
}) {
  const t = useTranslations('logs')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const canDnsClient = useCan('DnsClient')
  const canAllowed = useCan('Allowed')
  const canBlocked = useCan('Blocked')

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const qtype = asQueryRecordType(entry.qtype)

  const again = useMutation({
    mutationFn: (type: QueryRecordType) =>
      resolve({ server: DEFAULT_RESOLVER, domain: entry.qname, type, protocol: 'UDP' }),
    onError,
  })

  const list = useMutation({
    mutationFn: ({ scope, domain }: { scope: EditableScope; domain: string }) => addDomain(scope, domain),
    onSuccess: (_result, vars) => {
      toast.success(
        vars.scope === 'blocked'
          ? t('query.detail.addedToBlocked', { domain: vars.domain })
          : t('query.detail.addedToAllowed', { domain: vars.domain }),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, vars.scope) })
    },
    onError,
  })

  // A new row must not inherit the previous row's resolve result.
  const resetAgain = again.reset
  React.useEffect(() => {
    resetAgain()
  }, [entry, resetAgain])

  const summary = [
    `${formatDateTime(entry.timestamp, locale)}`,
    entry.clientIpAddress,
    entry.protocol,
    `${entry.qname} ${entry.qtype} ${entry.qclass}`,
    `${entry.responseType}/${entry.rcode}`,
    entry.responseRtt,
    entry.answer ? `answer: ${entry.answer}` : '',
  ]
    .filter(Boolean)
    .join('  |  ')

  const onCopy = async () => {
    const ok = await copyText(summary)
    if (ok) toast.success(tc('toast.copied'))
    else toast.error(tc('toast.failed'))
  }

  const answers = again.data?.result.Answer ?? []

  return (
    <>
      <DefinitionList
        items={[
          {
            label: t('query.columns.timestamp'),
            value: <span className="font-data">{formatDateTime(entry.timestamp, locale)}</span>,
          },
          {
            label: t('query.columns.clientIpAddress'),
            value: <DataValue value={entry.clientIpAddress} copyLabel={tc('toast.copied')} />,
          },
          { label: t('query.columns.protocol'), value: entry.protocol || '—' },
          { label: t('query.columns.qtype'), value: <span className="font-data">{entry.qtype || '—'}</span> },
          {
            label: t('query.columns.qclass'),
            value: <span className="font-data">{entry.qclass || '—'}</span>,
          },
          {
            label: t('query.columns.responseType'),
            value: (
              <Badge variant={severityVariant(queryLogSeverity(entry))}>
                {responseLabel(entry.responseType)}
              </Badge>
            ),
          },
          {
            label: t('query.columns.rcode'),
            value: (
              <Badge variant={severityVariant(queryLogSeverity(entry))}>{responseLabel(entry.rcode)}</Badge>
            ),
          },
          {
            label: t('query.columns.responseRtt'),
            value: <RttCell raw={entry.responseRtt} locale={locale} />,
          },
        ]}
      />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground text-xs font-medium">{t('query.columns.answer')}</h3>
        {entry.answer ? (
          <pre className="font-data bg-muted/50 max-h-40 overflow-auto rounded-md p-2 text-xs break-all whitespace-pre-wrap">
            {entry.answer}
          </pre>
        ) : (
          <p className="text-muted-foreground text-sm">{t('query.detail.answerEmpty')}</p>
        )}
      </section>

      {again.data && (
        <section className="border-border/60 flex flex-col gap-1.5 rounded-md border p-3">
          <h3 className="text-muted-foreground text-xs font-medium">
            {t('query.detail.resolveAgain')} · {t('query.columns.rcode')}{' '}
            <span className="font-data text-foreground">{again.data.result.RCODE}</span>
          </h3>
          {answers.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {answers.map((record, index) => (
                <li key={`${record.Name}-${index}`} className="font-data text-xs break-all">
                  {record.Name} {record.Type} {record.TTL} {formatRData(record.RDATA)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">{t('query.detail.answerEmpty')}</p>
          )}
        </section>
      )}

      {again.isError && <p className="text-destructive text-xs">{describeError(again.error).message}</p>}

      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onCopy()}>
            <Copy className="size-3.5" aria-hidden />
            {t('query.detail.copyQuery')}
          </Button>

          {canDnsClient.canView && (
            <Button
              variant="outline"
              size="sm"
              // Only the known record types are resolvable; a log can contain
              // anything the client asked for, including types we do not model.
              disabled={!qtype}
              loading={again.isPending}
              onClick={() => qtype && again.mutate(qtype)}
            >
              {!again.isPending && <RotateCw className="size-3.5" aria-hidden />}
              {t('query.detail.resolveAgain')}
            </Button>
          )}

          {canBlocked.canModify && (
            <Button
              variant="outline"
              size="sm"
              disabled={!entry.qname || list.isPending}
              onClick={() => list.mutate({ scope: 'blocked', domain: entry.qname })}
            >
              <Ban className="size-3.5" aria-hidden />
              {t('query.detail.addToBlocked')}
            </Button>
          )}

          {canAllowed.canModify && (
            <Button
              variant="outline"
              size="sm"
              disabled={!entry.qname || list.isPending}
              onClick={() => list.mutate({ scope: 'allowed', domain: entry.qname })}
            >
              <CircleCheck className="size-3.5" aria-hidden />
              {t('query.detail.addToAllowed')}
            </Button>
          )}

          {list.isPending && <Spinner className="text-muted-foreground size-3.5" />}
        </div>

        <DialogClose asChild>
          <Button variant="ghost" size="sm">
            {tc('actions.close')}
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  )
}

/**
 * RTT cell. The API pre-renders the value, so parse it back for the tone and
 * re-format through `formatRtt` for consistency with the rest of the console;
 * an unparseable string is shown as the server sent it. `raw` is optional
 * because entries the logging app never timed arrive with no `responseRtt`
 * at all — the detail dialog renders those too, and they read as an em dash.
 */
function RttCell({ raw, locale }: { raw?: string; locale: ReturnType<typeof useLocaleCode> }) {
  const t = useTranslations('logs')
  const text = raw ?? ''
  const ms = parseRtt(text)
  if (ms === null) {
    return <span className="font-data text-muted-foreground text-xs">{text || '—'}</span>
  }
  const tone = ms < RTT_FAST_MS ? 'fast' : ms < RTT_SLOW_MS ? 'normal' : 'slow'
  return (
    <span
      className={cn('font-data text-xs whitespace-nowrap', RTT_TONE_CLASS[tone])}
      title={t(`query.rtt.${tone}`)}
    >
      {formatRtt(ms, locale)}
      <span className="sr-only"> ({t(`query.rtt.${tone}`)})</span>
    </span>
  )
}

/** `1.23 ms` / `2 s` / `450 us` -> milliseconds. `null` when not numeric. */
function parseRtt(raw: string): number | null {
  const match = raw.trim().match(/^(-?[\d.]+)\s*(ms|s|sec|secs|second|seconds|µs|us)?$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = (match[2] ?? 'ms').toLowerCase()
  if (unit === 'µs' || unit === 'us') return value / 1000
  if (unit !== 'ms') return value * 1000
  return value
}

function severityVariant(
  severity: ReturnType<typeof queryLogSeverity>,
): 'success' | 'warning' | 'destructive' | 'info' | 'muted' {
  switch (severity) {
    case 'ok':
      return 'success'
    case 'warning':
      return 'warning'
    case 'danger':
      return 'destructive'
    case 'blocked':
      return 'info'
    default:
      return 'muted'
  }
}

/** Narrow a log's free-form qtype to one the resolver accepts. */
function asQueryRecordType(value: string): QueryRecordType | null {
  return (QUERY_RECORD_TYPES as readonly string[]).includes(value) ? (value as QueryRecordType) : null
}
