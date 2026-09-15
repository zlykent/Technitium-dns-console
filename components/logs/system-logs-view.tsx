'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Download,
  EllipsisVertical,
  Eye,
  FileText,
  FolderOpen,
  RefreshCw,
  ScrollText,
  Settings,
  SquareArrowOutUpRight,
  Timer,
  Trash,
  TriangleAlert,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { SearchInput } from '@/components/app/search-input'
import { LogFilePreviewDialog } from '@/components/logs/log-file-preview-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiDownloadBlob, describeError } from '@/lib/api/client'
import { deleteAllLogFiles, deleteLogFile, downloadLogFile, listLogFiles } from '@/lib/api/domains/logs'
import { getSettings } from '@/lib/api/domains/settings'
import { queryKeys } from '@/lib/api/query-keys'
import type { LogFile } from '@/lib/api/types/logs'
import { useCan } from '@/lib/auth/session'
import { formatBytes, formatDateOnly } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * System logs (`/system-logs`) — the daily text files the server writes to
 * `logFolder`. Unrelated to `/logs` despite the shared endpoint prefix; the only
 * thing they have in common is the `Logs` permission section.
 *
 * Three upstream quirks shape this file:
 *
 *  - **`logs/list` returns no timestamp.** Each `LogFile` is just
 *    `{ fileName, size }`. The "last modified" column therefore derives its date
 *    from the *file name*, which Technitium generates as `yyyy-MM-dd`; a name
 *    that does not start with a date renders `—` rather than a guessed value.
 *  - **`size` is a pre-rendered string** (`2.45 MB`), but the console formats
 *    bytes through `formatBytes(number)`. `parseByteSize` turns the string back
 *    into a number so one file and the footer total share the same formatting;
 *    anything unparseable falls back to the server's own text.
 *  - **`logs/delete` takes `log`, `logs/download` takes `fileName`.** The SDK
 *    already models both, but mixing them up produces a confusing
 *    "Parameter 'log' missing." from upstream, so the call sites name the
 *    argument explicitly.
 *
 * "Open in new tab" cannot be a plain `window.open('/api/dns/logs/download…')`:
 * the proxy picks the server from the `X-Dns-Target` request header
 * (`lib/proxy/kernel.ts:89`), which a top-level navigation cannot set, so the
 * tab would silently open the *default* server's file. It fetches the bytes
 * through the client and opens a `blob:` URL instead.
 */

const REFRESH_OPTIONS = ['off', 'every30s', 'every1m', 'every5m'] as const
type RefreshOption = (typeof REFRESH_OPTIONS)[number]

const REFRESH_MS: Record<RefreshOption, number> = { off: 0, every30s: 30_000, every1m: 60_000, every5m: 300_000 }

const BYTE_FACTORS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
  pb: 1024 ** 5,
}

export function SystemLogsView() {
  const t = useTranslations('logs')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Logs')

  const [keyword, setKeyword] = React.useState('')
  const [refresh, setRefresh] = React.useState<RefreshOption>('off')
  const [previewFile, setPreviewFile] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<LogFile | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = React.useState(false)

  const files = useQuery({
    queryKey: queryKeys.logFiles(target),
    queryFn: () => listLogFiles(),
    enabled: can.canView,
    refetchInterval: REFRESH_MS[refresh] || false,
  })

  const settings = useQuery({
    queryKey: queryKeys.settings(target),
    queryFn: () => getSettings(),
    enabled: can.canView,
    staleTime: 60_000,
  })

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'logs') })
  }, [queryClient, target])

  const download = useMutation({
    mutationFn: (fileName: string) => downloadLogFile(fileName),
    onError,
  })

  const remove = useMutation({
    mutationFn: (log: string) => deleteLogFile(log),
    onSuccess: () => {
      setPendingDelete(null)
      toast.success(t('system.deleteSuccess'))
      invalidate()
    },
    onError,
  })

  const removeAll = useMutation({
    mutationFn: () => deleteAllLogFiles(),
    onSuccess: () => {
      setDeleteAllOpen(false)
      toast.success(t('system.deleteAllSuccess'))
      invalidate()
    },
    onError,
  })

  const openRaw = useMutation({
    mutationFn: async (fileName: string) => {
      const { blob } = await apiDownloadBlob('logs/download', { fileName })
      // Re-tag as text/plain: upstream serves `application/octet-stream`, which
      // a browser would download rather than render.
      const url = URL.createObjectURL(new Blob([await blob.text()], { type: 'text/plain; charset=utf-8' }))
      const opened = window.open(url, '_blank', 'noopener')
      // The new tab reads the URL on load; keep it alive long enough, then drop
      // it so a long session does not leak one blob per click.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return Boolean(opened)
    },
    onSuccess: (opened) => {
      if (!opened) toast.error(tc('toast.failed'))
    },
    onError,
  })

  const fileList = files.data
  // Memoised so the `?? []` fallback does not hand the totals `useMemo` below a
  // brand-new array on every render, which would defeat it entirely.
  const rows = React.useMemo(() => fileList?.logFiles ?? [], [fileList])
  const totalBytes = React.useMemo(
    () => rows.reduce((sum, file) => sum + (parseByteSize(file.size) ?? 0), 0),
    [rows],
  )

  const columns = React.useMemo(
    () => [
      textColumn<LogFile>({
        id: 'fileName',
        accessorKey: 'fileName',
        header: t('system.columns.fileName'),
        flex: true,
        cell: (value) => (
          <span className="font-data flex items-center gap-2 text-sm">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {String(value)}
          </span>
        ),
      }),
      textColumn<LogFile>({
        id: 'size',
        header: t('system.columns.size'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value, row) => <span className="font-data whitespace-nowrap text-xs text-muted-foreground">{displaySize(row.size)}</span>,
      }),
      textColumn<LogFile>({
        id: 'modified',
        header: t('system.columns.modified'),
        hug: true,
        enableSorting: false,
        cell: (_value, row) => {
          const date = dateFromFileName(row.fileName)
          return (
            <span className="font-data whitespace-nowrap text-xs text-muted-foreground">
              {date ? formatDateOnly(date, locale) : '—'}
            </span>
          )
        },
      }),
      textColumn<LogFile>({
        id: 'actions',
        header: t('system.columns.actions'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value, row) => (
          <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('system.preview')}
              title={t('system.preview')}
              onClick={() => setPreviewFile(row.fileName)}
            >
              <Eye className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={rowBusy(download, row.fileName) ? t('system.downloading') : t('system.download')}
              title={rowBusy(download, row.fileName) ? t('system.downloading') : t('system.download')}
              loading={rowBusy(download, row.fileName)}
              onClick={() => download.mutate(row.fileName)}
            >
              {!rowBusy(download, row.fileName) && <Download className="size-4" aria-hidden />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')}>
                  <EllipsisVertical className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => setPreviewFile(row.fileName)}>
                  <Eye aria-hidden />
                  {t('system.preview')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => download.mutate(row.fileName)}>
                  <Download aria-hidden />
                  {t('system.download')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={openRaw.isPending} onSelect={() => openRaw.mutate(row.fileName)}>
                  <SquareArrowOutUpRight aria-hidden />
                  {t('system.openRaw')}
                </DropdownMenuItem>
                {can.canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(row)}>
                      <Trash aria-hidden />
                      {t('system.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    // `can.canDelete` and the mutation identities are stable enough for a menu
    // that re-renders on every row anyway; listing them would rebuild the whole
    // column set (and drop the sort state) on each mutation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, locale, can.canDelete],
  )

  const loggingOff = settings.data ? settings.data.enableLogging === false : false

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <Timer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">{t('system.autoRefresh')}</span>
              <Select value={refresh} onValueChange={(next) => setRefresh(next as RefreshOption)}>
                <SelectTrigger size="sm" className="w-28" aria-label={t('system.autoRefresh')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFRESH_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`system.refresh.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={() => void files.refetch()} loading={files.isFetching} disabled={!can.canView}>
              {!files.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {tc('actions.refresh')}
            </Button>

            {can.canDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                disabled={!can.canView || rows.length === 0}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash className="size-3.5" aria-hidden />
                {t('system.deleteAll')}
              </Button>
            )}
          </>
        }
      />

      {loggingOff && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('system.loggingDisabled')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('system.loggingDisabledHint')}</span>
            {can.canModify && (
              <Button asChild variant="outline" size="xs">
                <Link href="/settings">
                  <Settings className="size-3" aria-hidden />
                  {t('system.enableLogging')}
                </Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <DataTable<LogFile>
        label={t('system.title')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.fileName}
        loading={files.isPending}
        error={files.error}
        onRetry={() => void files.refetch()}
        onRowClick={(row) => setPreviewFile(row.fileName)}
        globalFilter={keyword}
        globalFilterColumns={['fileName']}
        empty={{ title: t('system.empty'), body: t('system.emptyHint'), icon: ScrollText }}
        toolbar={<SearchInput value={keyword} onChange={setKeyword} id="system-logs-search" />}
        footerNote={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{t('system.totalFiles', { count: rows.length })}</span>
            <span aria-hidden>·</span>
            <span>{t('system.totalSize', { size: formatBytes(totalBytes) })}</span>
          </span>
        }
      />

      {settings.data && (
        <Section
          title={
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen className="size-3.5 text-muted-foreground" aria-hidden />
              {t('retention.title')}
            </span>
          }
          description={t('retention.hint')}
          actions={
            can.canModify ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/settings">
                  <Settings className="size-3.5" aria-hidden />
                  {t('retention.edit')}
                </Link>
              </Button>
            ) : undefined
          }
        >
          <DefinitionList
            items={[
              {
                label: t('system.logFolder'),
                value: <span className="font-data break-all text-xs">{settings.data.logFolder || '—'}</span>,
              },
              {
                label: t('retention.maxLogFileDays'),
                value: <span className="font-data">{settings.data.maxLogFileDays}</span>,
              },
              {
                label: t('retention.maxStatFileDays'),
                value: <span className="font-data">{settings.data.maxStatFileDays}</span>,
              },
            ]}
          />
        </Section>
      )}

      <LogFilePreviewDialog
        open={Boolean(previewFile)}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null)
        }}
        fileName={previewFile}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={tc('dialog.confirmDeleteTitle')}
        description={t('system.deleteConfirm', { file: pendingDelete?.fileName ?? '' })}
        confirmLabel={t('system.delete')}
        pending={remove.isPending}
        error={remove.error}
        // Swallowed on purpose: `ConfirmDialog` renders `error` inline, and
        // letting the rejection escape `void run()` would log an unhandled
        // promise rejection on top of the operator-visible message.
        onConfirm={async () => {
          try {
            await remove.mutateAsync(pendingDelete?.fileName ?? '')
          } catch {
            /* surfaced through the `error` prop */
          }
        }}
      />

      <ConfirmDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title={t('system.deleteAll')}
        description={t('system.deleteAllConfirm')}
        confirmLabel={t('system.deleteAll')}
        requireText={t('system.deleteAll')}
        pending={removeAll.isPending}
        error={removeAll.error}
        onConfirm={async () => {
          try {
            await removeAll.mutateAsync()
          } catch {
            /* surfaced through the `error` prop */
          }
        }}
      />
    </PageShell>
  )
}

/**
 * `2.45 MB` -> bytes. `null` when the server's rendering is not a plain
 * number + unit, so the caller can fall back to showing it verbatim instead of
 * printing `0 B` for a file that clearly is not empty.
 */
function parseByteSize(raw: string): number | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const factor = BYTE_FACTORS[(match[2] ?? 'b').toLowerCase()]
  return factor ? value * factor : null
}

function displaySize(raw: string): string {
  const bytes = parseByteSize(raw)
  if (bytes === null) return raw.trim() || '—'
  return formatBytes(bytes)
}

/** Technitium names log files by day; anything else has no derivable date. */
function dateFromFileName(fileName: string): string | null {
  const match = fileName.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

/**
 * Per-row pending check. The download mutation is shared by every row, so a
 * bare `isPending` would spin all of them at once; `variables` holds the file
 * name the in-flight call was started with.
 */
function rowBusy(mutation: { isPending: boolean; variables: string | undefined }, fileName: string): boolean {
  return mutation.isPending && mutation.variables === fileName
}
