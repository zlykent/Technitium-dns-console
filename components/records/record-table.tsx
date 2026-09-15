'use client'

import { useTranslations } from 'next-intl'
import {
  CircleCheck,
  CircleStop,
  ChevronDown,
  EllipsisVertical,
  Pencil,
  Trash,
} from 'lucide-react'
import * as React from 'react'
import type { ColumnDef, OnChangeFn, RowSelectionState } from '@tanstack/react-table'
import { DataTable, textColumn } from '@/components/app/data-table'
import { RecordSummary } from '@/components/records/record-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RECORD_TYPES, type RecordType } from '@/lib/api/enums'
import type { DnsRecord } from '@/lib/api/types/zones'
import { formatDateTime, formatRelative, formatTtl, isNeverTimestamp } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { cn } from '@/lib/utils'

/**
 * Record table for a single zone.
 *
 * Two display modes over the same column set:
 *
 *  - **flat** — one `DataTable` with client pagination and (permission-gated)
 *    row selection for bulk enable/disable/delete.
 *  - **grouped** — rows bucketed by owner name into collapsible sections, each
 *    section its own headerless-paginated `DataTable`. Selection is deliberately
 *    off here: a per-group table cannot share one selection map without the
 *    "select all" checkbox lying about scope, and grouped view is for reading a
 *    subtree, not batch editing.
 *
 * Filtering (search / type / disabled / owner name) is done by the parent
 * before rows arrive, so this component never touches `DataTable`'s own
 * `globalFilter` — which also means the empty state is always `empty`, never
 * `noResults`.
 *
 * `RecordRow` is a flat view-model, not the raw `DnsRecord`: it carries the
 * pre-split display label, the sort accessors (`type`, `ttl`) and the glue
 * metadata (`depth`, `isGlue`) so cells stay cheap and columns stay sortable.
 * Glue rows are read-only — Technitium manages them through their parent NS
 * record, so per-row actions are suppressed.
 */

/** Every record type that has a `types.*` label — guards `t()` from throwing. */
const KNOWN_TYPES = new Set<string>(RECORD_TYPES)

export interface RecordRow {
  id: string
  record: DnsRecord
  /** Owner label relative to the zone (`www`, or `@` for the apex). */
  label: string
  /** Sort accessor mirrors `record.type`. */
  type: RecordType
  /** Sort accessor mirrors `record.ttl`. */
  ttl: number
  /** Indent level: glue records sit one step under their NS parent. */
  depth: number
  /** True for glue rows expanded beneath an NS record. */
  isGlue: boolean
}

export interface RecordTableProps {
  rows: RecordRow[]
  zone: string
  grouped: boolean
  loading: boolean
  error: unknown
  onRetry?: () => void
  canModify: boolean
  canDelete: boolean
  /** Row id whose mutation is in flight, to disable just that action menu. */
  busyId?: string | null
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  selectionActions?: (ids: string[]) => React.ReactNode
  onEdit: (record: DnsRecord) => void
  onToggleState: (record: DnsRecord) => void
  onDelete: (record: DnsRecord) => void
  emptyTitle: string
  emptyBody?: string
  emptyAction?: React.ReactNode
  /**
   * True when the caller's search / type / domain / disabled filters are in
   * play, so an empty table means "no match" rather than "no records". Forwarded
   * straight to the DataTable — see `DataTableProps.filterActive`.
   */
  filterActive?: boolean
  label: string
}

export function RecordTable({
  rows,
  zone,
  grouped,
  loading,
  error,
  onRetry,
  canModify,
  canDelete,
  busyId,
  rowSelection,
  onRowSelectionChange,
  selectionActions,
  onEdit,
  onToggleState,
  onDelete,
  emptyTitle,
  emptyBody,
  emptyAction,
  filterActive = false,
  label,
}: RecordTableProps) {
  const t = useTranslations('records')
  const tc = useTranslations('common')
  const locale = useLocaleCode()

  const canBulk = canModify || canDelete

  const columns = React.useMemo(
    () => [
      textColumn<RecordRow>({
        id: 'name',
        accessorKey: 'label',
        header: t('columns.name'),
        cell: (_value, row) => (
          <span className={cn('flex min-w-0 items-center gap-1.5', row.depth > 0 && 'pl-4')}>
            <span className="font-data truncate text-sm" title={row.record.name}>
              {row.label || '@'}
            </span>
          </span>
        ),
      }),
      textColumn<RecordRow>({
        id: 'type',
        accessorKey: 'type',
        header: t('columns.type'),
        cell: (_value, row) => (
          <Badge variant={typeVariant(row.type)}>{typeLabel(row.type, t)}</Badge>
        ),
      }),
      textColumn<RecordRow>({
        id: 'ttl',
        accessorKey: 'ttl',
        header: t('columns.ttl'),
        align: 'right',
        cell: (_value, row) => (
          <span className="font-data text-xs">{formatTtl(row.record.ttl, row.record.ttlString)}</span>
        ),
      }),
      textColumn<RecordRow>({
        id: 'data',
        header: t('columns.data'),
        enableSorting: false,
        cell: (_value, row) => <RecordSummary record={row.record} copyLabel={tc('toast.copied')} />,
      }),
      textColumn<RecordRow>({
        id: 'expiryTtl',
        header: t('columns.expiryTtl'),
        align: 'right',
        enableSorting: false,
        cell: (_value, row) => {
          const expiry = row.record.expiryTtl
          const text = expiry && expiry > 0 ? formatTtl(expiry, row.record.expiryTtlString) : '—'
          return <span className="font-data text-xs text-muted-foreground">{text}</span>
        },
      }),
      textColumn<RecordRow>({
        id: 'disabled',
        header: t('columns.disabled'),
        enableSorting: false,
        cell: (_value, row) =>
          row.record.disabled ? (
            <Badge variant="muted">{t('status.disabled')}</Badge>
          ) : (
            <Badge variant="success">{t('status.active')}</Badge>
          ),
      }),
      textColumn<RecordRow>({
        id: 'dnssec',
        header: t('columns.dnssec'),
        enableSorting: false,
        cell: (_value, row) => {
          const status = row.record.dnssecStatus
          const variant = status === 'Signed' ? 'success' : status === 'PendingSigning' ? 'warning' : 'muted'
          const text =
            status === 'Signed'
              ? t('status.signed')
              : status === 'PendingSigning'
                ? t('status.pendingSigning')
                : t('status.unsigned')
          return <Badge variant={variant}>{text}</Badge>
        },
      }),
      textColumn<RecordRow>({
        id: 'lastModified',
        header: t('columns.lastModified'),
        enableSorting: false,
        cell: (_value, row) => {
          const modified = row.record.lastModified
          // Upstream guards this field against the same sentinel it guards
          // `lastUsedOn` with, and drops the whole "Last Modified" line when it
          // matches (`.probe/console-js/zone.js:4187`) — a record can carry a
          // `DateTime.MinValue` here, and rendering it as a relative time reads
          // "2027 years ago". Hiding it upstream corresponds to an em dash in a
          // table cell that cannot collapse.
          if (isNeverTimestamp(modified)) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <span className="text-xs text-muted-foreground" title={formatDateTime(modified, locale)}>
              {formatRelative(modified, locale)}
            </span>
          )
        },
      }),
      textColumn<RecordRow>({
        id: 'lastUsedOn',
        header: t('columns.lastUsedOn'),
        enableSorting: false,
        cell: (_value, row) => {
          const used = row.record.lastUsedOn
          // `isNeverTimestamp` rather than a local `startsWith('0001')`: the
          // sentinel is a property of the upstream's .NET serialisation, not of
          // this column, and a second looser spelling of it here would keep
          // matching year-1 dates the shared helper has since learned to reject.
          if (isNeverTimestamp(used)) {
            return <span className="text-xs text-muted-foreground">{t('status.neverUsed')}</span>
          }
          return (
            <span className="text-xs text-muted-foreground" title={formatDateTime(used, locale)}>
              {formatRelative(used, locale)}
            </span>
          )
        },
      }),
      textColumn<RecordRow>({
        id: 'comments',
        header: t('columns.comments'),
        enableSorting: false,
        cell: (_value, row) =>
          row.record.comments ? (
            <span className="line-clamp-1 max-w-56 truncate text-xs text-muted-foreground" title={row.record.comments}>
              {row.record.comments}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      textColumn<RecordRow>({
        id: 'actions',
        header: t('columns.actions'),
        align: 'right',
        hug: true,
        enableSorting: false,
        cell: (_value, row) =>
          row.isGlue ? null : (
            <RecordRowActions
              record={row.record}
              canModify={canModify}
              canDelete={canDelete}
              busy={busyId === row.id}
              onEdit={onEdit}
              onToggleState={onToggleState}
              onDelete={onDelete}
            />
          ),
      }),
    ],
    [t, tc, locale, canModify, canDelete, busyId, onEdit, onToggleState, onDelete],
  )

  const empty = { title: emptyTitle, body: emptyBody, action: emptyAction }

  if (grouped) {
    return (
      <GroupedRows
        rows={rows}
        columns={columns}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={empty}
        filterActive={filterActive}
        label={label}
        zone={zone}
      />
    )
  }

  return (
    <DataTable<RecordRow>
      label={label}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      enableRowSelection={canBulk}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      selectionActions={canBulk ? selectionActions : undefined}
      empty={empty}
      filterActive={filterActive}
      clientPagination={{ pageSize: 50 }}
      density="compact"
    />
  )
}

interface GroupedRowsProps {
  rows: RecordRow[]
  columns: ColumnDef<RecordRow, unknown>[]
  loading: boolean
  error: unknown
  onRetry?: () => void
  empty: { title: string; body?: string; action?: React.ReactNode }
  filterActive: boolean
  label: string
  zone: string
}

function GroupedRows({ rows, columns, loading, error, onRetry, empty, filterActive, label, zone }: GroupedRowsProps) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  const groups = React.useMemo(() => {
    const map = new Map<string, RecordRow[]>()
    for (const row of rows) {
      const key = row.record.name
      const bucket = map.get(key)
      if (bucket) bucket.push(row)
      else map.set(key, [row])
    }
    return [...map.entries()]
  }, [rows])

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (!loading && !error && groups.length === 0) {
    return (
      <div className="surface rounded-lg">
        <DataTable<RecordRow>
          label={label}
          columns={columns}
          data={[]}
          loading={false}
          empty={empty}
          filterActive={filterActive}
          clientPagination={false}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <DataTable<RecordRow> label={label} columns={columns} data={[]} loading clientPagination={false} />
      ) : null}
      {error ? (
        <DataTable<RecordRow> label={label} columns={columns} data={[]} error={error} onRetry={onRetry} clientPagination={false} />
      ) : null}
      {!loading && !error
        ? groups.map(([name, groupRows]) => {
            const open = !collapsed.has(name)
            const relative = name.toLowerCase() === zone.toLowerCase() ? '@' : name
            return (
              <Collapsible key={name} open={open} onOpenChange={() => toggle(name)} className="surface rounded-lg">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                  >
                    <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden />
                    <span className="font-data truncate text-sm font-medium" title={name}>
                      {relative}
                    </span>
                    <Badge variant="muted" className="ml-auto shrink-0">
                      {groupRows.length}
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <DataTable<RecordRow>
                    label={name}
                    columns={columns}
                    data={groupRows}
                    getRowId={(row) => row.id}
                    hideHeader
                    clientPagination={false}
                    density="compact"
                    empty={empty}
                  />
                </CollapsibleContent>
              </Collapsible>
            )
          })
        : null}
    </div>
  )
}

interface RecordRowActionsProps {
  record: DnsRecord
  canModify: boolean
  canDelete: boolean
  busy?: boolean
  onEdit: (record: DnsRecord) => void
  onToggleState: (record: DnsRecord) => void
  onDelete: (record: DnsRecord) => void
}

function RecordRowActions({ record, canModify, canDelete, busy = false, onEdit, onToggleState, onDelete }: RecordRowActionsProps) {
  const tc = useTranslations('common')

  if (!canModify && !canDelete) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={tc('actions.more')}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {canModify ? (
          <>
            <DropdownMenuItem onSelect={() => onEdit(record)}>
              <Pencil aria-hidden />
              {tc('actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleState(record)}>
              {record.disabled ? <CircleCheck aria-hidden /> : <CircleStop aria-hidden />}
              {record.disabled ? tc('actions.enable') : tc('actions.disable')}
            </DropdownMenuItem>
          </>
        ) : null}
        {canDelete ? (
          <>
            {canModify ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(record)}>
              <Trash aria-hidden />
              {tc('actions.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Badge tone per record type — a stable colour language across the module. */
function typeVariant(type: RecordType): 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'muted' {
  switch (type) {
    case 'A':
    case 'AAAA':
      return 'default'
    case 'NS':
    case 'SOA':
    case 'CNAME':
    case 'DNAME':
    case 'ANAME':
      return 'info'
    case 'MX':
    case 'TXT':
    case 'RP':
    case 'SRV':
    case 'NAPTR':
    case 'URI':
      return 'secondary'
    case 'DS':
    case 'SSHFP':
    case 'TLSA':
    case 'CAA':
      return 'success'
    case 'SVCB':
    case 'HTTPS':
    case 'FWD':
    case 'APP':
      return 'warning'
    default:
      return 'muted'
  }
}

/** Record type label, falling back to the raw wire value for exotic types. */
function typeLabel(type: RecordType, t: (key: string) => string): string {
  return KNOWN_TYPES.has(type) ? t(`types.${type}.label`) : type
}
