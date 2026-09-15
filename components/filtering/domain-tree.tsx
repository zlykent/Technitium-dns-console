'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ChevronRight,
  Database,
  FileText,
  FolderTree,
  LoaderCircle,
  MessageSquare,
  Trash,
} from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DataValue } from '@/components/app/copy-button'
import { EmptyState, ErrorState, NoResultsState } from '@/components/app/states'
import { listTree, type FilterScope } from '@/lib/api/domains/filtering'
import { queryKeys } from '@/lib/api/query-keys'
import { domainLabel, type TreeRecord } from '@/lib/api/types/filtering'
import { formatTtl } from '@/lib/format'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Lazy domain tree.
 *
 * The cache/allowed/blocked APIs return one level at a time: `{ domain, zones[],
 * records[] }`. This component renders that level and lets the operator expand
 * any child domain to fetch its own subtree on demand. Each expanded node is an
 * independent `useQuery` keyed by the domain string, so TanStack Query caches
 * every visited branch and a collapse/expand cycle is instant.
 *
 * Two non-obvious details:
 *
 *  - The root call uses `domain: ''` (empty string), which the server interprets
 *    as "list the top-level zones". Passing `undefined` would omit the parameter
 *    entirely and the server would still return the root, but the empty string
 *    keeps the query key stable and distinguishable from a missing param.
 *  - Records at a node are rendered in a compact `DataTable` with DNS-specific
 *    columns (name, type, TTL, rData, expiry, DNSSEC). The `rData` object is a
 *    flat union of every possible field; `formatRData` picks the relevant ones
 *    based on the record type so the cell stays readable instead of dumping JSON.
 */

export interface DomainTreeProps {
  scope: FilterScope
  /** The domain node to list. Empty string = root. */
  domain: string
  /** Called when the operator clicks a child domain to navigate into it. */
  onNavigate?: (domain: string) => void
  /** Called when the operator clicks the delete/evict action on a domain. */
  onDelete?: (domain: string) => void
  /** Whether the current user may delete entries. */
  canDelete?: boolean
  /** Currently selected domains, for bulk delete. Empty/undefined hides checkboxes. */
  selected?: ReadonlySet<string>
  /** Called when a row checkbox toggles. Omit to hide checkboxes entirely. */
  onToggleSelect?: (domain: string) => void
  /**
   * When false the chevron is hidden and clicking a domain drills into it via
   * `onNavigate` instead of expanding inline — this is the "flat list" view
   * mode. Tree mode (default) expands children in place.
   */
  expandable?: boolean
  /**
   * Initial expanded state for every node. The parent toggles this together
   * with a fresh React `key` to implement "expand all" / "collapse all".
   */
  defaultExpanded?: boolean
  /** Depth in the tree, used for indentation. Internal. */
  depth?: number
  className?: string
}

export function DomainTree({
  scope,
  domain,
  onNavigate,
  onDelete,
  canDelete = false,
  selected,
  onToggleSelect,
  expandable = true,
  defaultExpanded = false,
  depth = 0,
  className,
}: DomainTreeProps) {
  const t = useTranslations('filtering')
  const target = useTargetKey()

  const tree = useQuery({
    queryKey: queryKeyForScope(scope, target, domain),
    queryFn: () => listTree(scope, { domain }),
    staleTime: 30_000,
  })

  if (tree.isPending) {
    return (
      <div className={cn('flex flex-col gap-2', className)} role="status" aria-live="polite">
        <span className="sr-only">{t('tree.loadingChildren')}</span>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (tree.error) {
    return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} className={className} />
  }

  const data = tree.data
  if (!data) return null

  const hasZones = data.zones.length > 0
  const hasRecords = data.records.length > 0

  if (!hasZones && !hasRecords && depth === 0) {
    // `domain` is only non-empty because the operator searched or drilled in, so
    // an empty subtree is "no match here" — the scope-level empty state would
    // claim the whole list is unset, which the search box visibly contradicts.
    if (domain) {
      return <NoResultsState body={t('tree.noMatch', { domain })} className={className} />
    }
    return (
      <EmptyState
        title={t(`empty.${scope}`)}
        body={t(`empty.${scope}Hint`)}
        icon={scope === 'cache' ? Database : scope === 'allowed' ? FolderTree : FileText}
        className={className}
      />
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {hasZones && (
        <div className="flex flex-col gap-0.5">
          {data.zones.map((child) => (
            <DomainTreeNode
              key={child}
              scope={scope}
              domain={child}
              label={domainLabel(child)}
              depth={depth}
              onNavigate={onNavigate}
              onDelete={onDelete}
              canDelete={canDelete}
              selected={selected}
              onToggleSelect={onToggleSelect}
              expandable={expandable}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </div>
      )}

      {hasRecords && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <FileText className="size-3.5" aria-hidden />
            {t('tree.records')}
            <Badge variant="muted" className="text-[10px]">
              {data.records.length}
            </Badge>
          </h3>
          <RecordsTable records={data.records} />
        </div>
      )}

      {!hasZones && !hasRecords && depth > 0 && (
        <p className="text-muted-foreground py-2 text-xs">{t('tree.noRecords')}</p>
      )}
    </div>
  )
}

/** A single expandable node in the domain tree. */
function DomainTreeNode({
  scope,
  domain,
  label,
  depth,
  onNavigate,
  onDelete,
  canDelete,
  selected,
  onToggleSelect,
  expandable,
  defaultExpanded,
}: {
  scope: FilterScope
  domain: string
  label: string
  depth: number
  onNavigate?: (domain: string) => void
  onDelete?: (domain: string) => void
  canDelete: boolean
  selected?: ReadonlySet<string>
  onToggleSelect?: (domain: string) => void
  expandable: boolean
  defaultExpanded: boolean
}) {
  const t = useTranslations('filtering')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const [expanded, setExpanded] = React.useState(defaultExpanded && expandable)

  const children = useQuery({
    queryKey: queryKeyForScope(scope, target, domain),
    queryFn: () => listTree(scope, { domain }),
    enabled: expanded,
    staleTime: 30_000,
  })

  const toggle = () => setExpanded((prev) => !prev)

  return (
    <div className="min-w-0">
      <div
        className="group hover:bg-accent/50 flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {onToggleSelect && (
          <Checkbox
            checked={selected?.has(domain) ?? false}
            onCheckedChange={() => onToggleSelect(domain)}
            aria-label={tc('table.selectRow')}
            className="ml-1 shrink-0"
          />
        )}

        {expandable && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={expanded ? t('tree.collapseAll') : t('tree.loadChildren')}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-5 shrink-0 place-items-center rounded transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          >
            {children.isFetching && expanded ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ChevronRight
                className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                aria-hidden
              />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (expandable && !expanded) setExpanded(true)
            onNavigate?.(domain)
          }}
          className="font-data hover:text-primary focus-visible:ring-ring/50 min-w-0 flex-1 truncate rounded-sm text-left text-sm hover:underline focus-visible:ring-[3px] focus-visible:outline-none"
          title={domain}
        >
          {label}
        </button>

        {children.data && children.data.zones.length > 0 && (
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {t('tree.childCount', { count: children.data.zones.length })}
          </span>
        )}

        {canDelete && onDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onDelete(domain)}
            aria-label={t('delete.action')}
            className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="border-border/40 ml-4 border-l pl-0">
          {children.isPending ? (
            <div className="flex flex-col gap-1.5 py-2" role="status">
              <span className="sr-only">{t('tree.loadingChildren')}</span>
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-3/4" />
            </div>
          ) : children.error ? (
            <ErrorState error={children.error} onRetry={() => void children.refetch()} compact />
          ) : children.data ? (
            <DomainTree
              scope={scope}
              domain={domain}
              onNavigate={onNavigate}
              onDelete={onDelete}
              canDelete={canDelete}
              selected={selected}
              onToggleSelect={onToggleSelect}
              expandable={expandable}
              defaultExpanded={defaultExpanded}
              depth={depth + 1}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Compact records table for the records at a given tree node. */
function RecordsTable({ records }: { records: TreeRecord[] }) {
  const t = useTranslations('filtering')

  // Cache and allowed/blocked records carry different metadata (see
  // `TreeRecord`). Only mount the details column when at least one row actually
  // has something to put in it, so a plain cache answer is not padded with an
  // always-empty column and a wide authoritative one still surfaces everything.
  const hasDetails = React.useMemo(() => records.some(recordHasDetails), [records])

  const columns = React.useMemo(
    () => [
      textColumn<TreeRecord>({
        id: 'name',
        accessorKey: 'name',
        header: t('tree.recordColumns.name'),
        cell: (value, row) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <DataValue
              value={String(value)}
              copy={false}
              className="text-xs"
              title={row.nameIdn ?? String(value)}
            />
            {row.disabled ? (
              <Badge variant="muted" className="shrink-0 text-[10px]">
                {t('tree.recordFlags.disabled')}
              </Badge>
            ) : null}
          </span>
        ),
      }),
      textColumn<TreeRecord>({
        id: 'type',
        accessorKey: 'type',
        header: t('tree.recordColumns.type'),
        width: '70px',
        cell: (value) => (
          <Badge variant="secondary" className="font-data text-[10px]">
            {String(value)}
          </Badge>
        ),
      }),
      textColumn<TreeRecord>({
        id: 'ttl',
        accessorKey: 'ttl',
        header: t('tree.recordColumns.ttl'),
        width: '90px',
        align: 'right',
        cell: (_value, row) => {
          // A stale cache entry has run its TTL out; flag it in warm colour so
          // the operator knows the answer is being re-validated, not fresh.
          const stale = isStaleTtl(row.ttl)
          return (
            <span
              className={cn('font-data text-xs', stale ? 'text-warning' : 'text-muted-foreground')}
              title={stale ? t('tree.recordFlags.stale') : undefined}
            >
              {formatTreeTtl(row.ttl, row.ttlString)}
            </span>
          )
        },
      }),
      textColumn<TreeRecord>({
        id: 'rData',
        header: t('tree.recordColumns.data'),
        enableSorting: false,
        cell: (_value, row) => <DataValue value={formatRData(row)} copy className="text-xs" />,
      }),
      ...(hasDetails
        ? [
            textColumn<TreeRecord>({
              id: 'details',
              header: t('tree.recordColumns.details'),
              enableSorting: false,
              cell: (_value, row) => <RecordDetails record={row} />,
            }),
          ]
        : []),
      textColumn<TreeRecord>({
        id: 'dnssec',
        accessorKey: 'dnssecStatus',
        header: t('tree.recordColumns.dnssec'),
        width: '80px',
        enableSorting: false,
        cell: (value, row) => {
          // Cache answers that arrived with RRSIG/NSEC were DNSSEC-validated by
          // the resolver even though their own status reads `Unsigned`.
          if ((row.dnssecRecords?.length ?? 0) > 0) {
            return (
              <Badge variant="success" className="text-[10px]">
                {t('tree.recordFlags.validated')}
              </Badge>
            )
          }
          const status = String(value ?? '')
          if (!status || status === 'Disabled' || status === 'Unsigned') {
            return <span className="text-muted-foreground text-xs">—</span>
          }
          return (
            <Badge variant={status === 'Signed' ? 'success' : 'warning'} className="text-[10px]">
              {status}
            </Badge>
          )
        },
      }),
    ],
    [t, hasDetails],
  )

  return (
    <DataTable<TreeRecord>
      columns={columns}
      data={records}
      getRowId={(row, index) => `${row.name}-${row.type}-${index}`}
      density="compact"
      clientPagination={false}
      hideHeader={records.length <= 3}
      label={t('tree.records')}
    />
  )
}

/**
 * Everything about a record that is not name/type/ttl/answer, rendered as
 * compact present-only chips. Cache rows contribute EDNS Client Subnet, glue
 * and the stale flag; authoritative rows contribute expiry and comments. Cells
 * with nothing to say fall back to an em dash so the column never looks broken.
 */
function RecordDetails({ record }: { record: TreeRecord }) {
  const t = useTranslations('filtering')
  const chips: React.ReactNode[] = []

  if (isStaleTtl(record.ttl)) {
    chips.push(
      <Badge key="stale" variant="warning" className="text-[10px]">
        {t('tree.recordFlags.stale')}
      </Badge>,
    )
  }
  if (record.expiryTtlString) {
    chips.push(
      <span key="expiry" className="font-data text-muted-foreground text-[11px]">
        {t('tree.recordFlags.expiry')}: {record.expiryTtlString}
      </span>,
    )
  }
  if (record.eDnsClientSubnet) {
    chips.push(
      <span
        key="ecs"
        className="font-data text-muted-foreground text-[11px]"
        title={t('tree.recordFlags.ecs')}
      >
        ECS {record.eDnsClientSubnet}
      </span>,
    )
  }
  if (record.glueRecords && record.glueRecords.length > 0) {
    chips.push(
      <span
        key="glue"
        className="font-data text-muted-foreground text-[11px]"
        title={record.glueRecords.join(', ')}
      >
        {t('tree.recordFlags.glue')} ×{record.glueRecords.length}
      </span>,
    )
  }
  if (record.comments) {
    chips.push(
      <span
        key="comments"
        className="text-muted-foreground inline-flex min-w-0 items-center gap-1 text-[11px]"
        title={record.comments}
      >
        <MessageSquare className="size-3 shrink-0" aria-hidden />
        <span className="max-w-[12rem] truncate">{record.comments}</span>
      </span>,
    )
  }

  if (chips.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{chips}</span>
}

/** Whether a row has anything worth mounting the details column for. */
function recordHasDetails(record: TreeRecord): boolean {
  return Boolean(
    record.comments ||
    record.expiryTtlString ||
    record.eDnsClientSubnet ||
    (record.glueRecords?.length ?? 0) > 0 ||
    isStaleTtl(record.ttl),
  )
}

/**
 * A cache entry whose TTL has run out is serialised as the literal string
 * `"0 (0s)"` (upstream: `if (record.IsStale) WriteString("ttl", "0 (0s)")`).
 * Authoritative records use a numeric TTL, so only the string form can be stale.
 */
function isStaleTtl(ttl: number | string): boolean {
  return typeof ttl === 'string' && ttl.trimStart().startsWith('0 (')
}

/**
 * Cache entries carry a pre-rendered TTL *string* (`"300 (5m)"`) while
 * authoritative entries carry seconds plus a separate `ttlString`. `formatTtl`
 * would `Number()`-coerce the string form to `NaN` and render `—`, so pass the
 * string straight through and only format the numeric form.
 */
function formatTreeTtl(ttl: number | string, preRendered?: string | null): string {
  if (typeof ttl === 'string') return ttl.trim() || '—'
  return formatTtl(ttl, preRendered)
}

/**
 * Pick the human-readable representation out of the flat `rData` union.
 * Technitium populates only the fields relevant to the record type, so a
 * type-switch is the cheapest way to get a one-line summary.
 */
function formatRData(record: TreeRecord): string {
  const r = record.rData
  switch (record.type) {
    case 'A':
    case 'AAAA':
      return r.ipAddress ?? '—'
    case 'CNAME':
      return r.cname ?? r.nameServer ?? '—'
    case 'NS':
    case 'ANAME':
      return r.nameServer ?? r.aname ?? '—'
    case 'PTR':
      return r.ptrName ?? '—'
    case 'DNAME':
      return r.dname ?? '—'
    case 'MX':
      return `${r.preference ?? 0} ${r.exchange ?? ''}`
    case 'TXT':
      return r.text ?? (r.characterStrings ?? []).join(' ') ?? '—'
    case 'SOA':
      return `${r.primaryNameServer ?? ''} ${r.responsiblePerson ?? ''} ${r.serial ?? ''}`
    case 'SRV':
      return `${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${r.target ?? ''}`
    case 'CAA':
      return `${r.flags ?? 0} ${r.tag ?? ''} "${r.value ?? ''}"`
    case 'DS':
      return `${r.keyTag ?? ''} ${r.algorithm ?? ''} ${r.digestType ?? ''} ${r.digest ?? ''}`
    case 'SSHFP':
      return `${r.algorithm ?? ''} ${r.fingerprintType ?? ''} ${r.fingerprint ?? ''}`
    case 'TLSA':
      return `${r.certificateUsage ?? ''} ${r.selector ?? ''} ${r.matchingType ?? ''} ${r.certificateAssociationData ?? ''}`
    case 'SVCB':
    case 'HTTPS':
      return `${r.svcPriority ?? 0} ${r.svcTargetName ?? ''} ${r.svcParams ?? ''}`
    case 'URI':
      return `${r.priority ?? 0} ${r.weight ?? 0} "${r.uri ?? ''}"`
    case 'NAPTR':
      return `${r.order ?? 0} ${r.preference ?? 0} "${r.services ?? ''}" "${r.regexp ?? ''}" ${r.replacement ?? ''}`
    case 'RP':
      return `${r.mailbox ?? ''} ${r.txtDomain ?? ''}`
    case 'FWD':
      return `${r.protocol ?? ''} ${r.forwarder ?? ''}`
    case 'APP':
      return `${r.appName ?? ''} ${r.classPath ?? ''}`
    default:
      // Fall back to the first populated string value.
      for (const value of Object.values(r)) {
        if (typeof value === 'string' && value) return value
      }
      return '—'
  }
}

/** Build the TanStack Query key for a tree node, reusing the factory shape. */
export function queryKeyForScope(scope: FilterScope, target: string, domain: string) {
  switch (scope) {
    case 'cache':
      return queryKeys.cache(target, 0, domain)
    case 'allowed':
      return queryKeys.allowed(target, 0, domain)
    case 'blocked':
      return queryKeys.blocked(target, 0, domain)
  }
}
