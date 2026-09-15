'use client'

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react'
import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination, type PaginationLabels } from '@/components/ui/pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorState, LoadingState, NoResultsState } from '@/components/app/states'
import { cn } from '@/lib/utils'

/**
 * Data table.
 *
 * One table implementation drives every list in the console (zones, records,
 * cache, leases, logs, users, sessions…). It supports both pagination modes
 * because Technitium offers both: `zones/list` paginates server-side, while
 * `dhcp/leases/list` returns everything and must be paged in the browser.
 *
 * Sorting is client-side unless `server` is supplied, in which case the caller
 * owns the sort state (the upstream has no sort parameter, so pages that
 * paginate server-side sort the current page only — documented per page).
 */

export interface DataTableEmpty {
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}

export interface DataTableServerPagination {
  /** 1-based page. */
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  getRowId?: (row: T, index: number) => string
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: DataTableEmpty
  /** Rendered when a client-side filter/search matched nothing. */
  noResults?: DataTableEmpty
  /** Client-side global filter value. */
  globalFilter?: string
  /** Column ids the global filter searches. Defaults to every column. */
  globalFilterColumns?: string[]
  /**
   * Set when `data` is *already* the result of a filter the caller applied, so
   * zero rows means "nothing matched" rather than "nothing exists".
   *
   * Most tables here filter upstream of the DataTable: Zones sends the keyword
   * to `zones/list`, while Users, Groups, Sessions, Leases and Records filter a
   * fully-loaded array in a `useMemo`. Neither can use `globalFilter` — for the
   * server-side ones the filtering already happened, and for the `useMemo` ones
   * the match rules (subdomain trees, type predicates, "include disabled") are
   * richer than a substring test, so a second pass here would silently drop
   * rows the caller meant to show.
   *
   * Without this flag every one of them renders its "create the first one"
   * empty state over a search that simply had no hits, which invites the
   * operator to create a duplicate of the thing they were looking for.
   */
  filterActive?: boolean
  enableSorting?: boolean
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  enableRowSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** Bar rendered above the table when at least one row is selected. */
  selectionActions?: (selectedIds: string[]) => React.ReactNode
  onRowClick?: (row: T) => void
  /** Slot for filters, search boxes and bulk actions. */
  toolbar?: React.ReactNode
  server?: DataTableServerPagination
  /** Client-side pagination used when `server` is absent. */
  clientPagination?: { pageSize: number; onPageSizeChange?: (size: number) => void } | false
  density?: 'compact' | 'normal'
  /**
   * Scroll the body inside the card (sticky head, pagination below the scroll
   * region) instead of stretching the page. For views that pin themselves to
   * the viewport height — the query logs keep their filter bar and pagination
   * in view while the entries scroll.
   */
  scrollable?: boolean
  /** Hide the header row — for sub-tables inside an expanded row. */
  hideHeader?: boolean
  className?: string
  /** Right-aligned note under the table (totals, last refresh time…). */
  footerNote?: React.ReactNode
  /** aria-label for the table element. */
  label?: string
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading = false,
  error,
  onRetry,
  empty,
  noResults,
  globalFilter = '',
  globalFilterColumns,
  filterActive = false,
  enableSorting = true,
  sorting: controlledSorting,
  onSortingChange,
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  selectionActions,
  onRowClick,
  toolbar,
  server,
  clientPagination = { pageSize: 25 },
  density = 'normal',
  scrollable = false,
  hideHeader = false,
  className,
  footerNote,
  label,
}: DataTableProps<T>) {
  const tc = useTranslations('common')

  const [internalSorting, setInternalSorting] = React.useState<SortingState>([])
  const [internalVisibility, setInternalVisibility] = React.useState<VisibilityState>({})
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({})
  const [internalPage, setInternalPage] = React.useState(1)
  const [internalPageSize, setInternalPageSize] = React.useState(
    clientPagination ? clientPagination.pageSize : 25,
  )

  const sorting = controlledSorting ?? internalSorting
  const columnVisibility = controlledVisibility ?? internalVisibility
  const selection = rowSelection ?? internalSelection

  // Reset to page 1 whenever the filter changes, otherwise an operator can
  // filter down to 3 rows while sitting on page 7 and see an empty table.
  const [prevFilter, setPrevFilter] = React.useState(globalFilter)
  if (prevFilter !== globalFilter) {
    setPrevFilter(globalFilter)
    if (internalPage !== 1) setInternalPage(1)
  }

  const filteringColumns = React.useMemo(
    () => (globalFilterColumns ? new Set(globalFilterColumns) : null),
    [globalFilterColumns],
  )

  // `useReactTable` opts out of React Compiler optimisation. This project does
  // not enable `reactCompiler`, so the notice carries nothing actionable — it
  // would only hide real problems in this file behind a permanent warning.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection: selection, globalFilter },
    getRowId,
    enableSorting,
    enableRowSelection,
    manualPagination: Boolean(server),
    manualSorting: Boolean(server),
    onSortingChange: onSortingChange ?? setInternalSorting,
    onColumnVisibilityChange: onColumnVisibilityChange ?? setInternalVisibility,
    onRowSelectionChange: onRowSelectionChange ?? setInternalSelection,
    globalFilterFn: (row, columnId, filterValue: string) => {
      if (filteringColumns && !filteringColumns.has(columnId)) return true
      const value = row.getValue(columnId)
      if (value === null || value === undefined) return false
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase())
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getFilteredRowModel: server ? undefined : getFilteredRowModel(),
  })

  // Client-side pagination: slice the filtered rows ourselves.
  const rows = React.useMemo(() => {
    const all = table.getRowModel().rows
    if (server || clientPagination === false) return all
    const start = (internalPage - 1) * internalPageSize
    return all.slice(start, start + internalPageSize)
  }, [table, server, clientPagination, internalPage, internalPageSize])

  const total = server ? server.total : table.getFilteredRowModel().rows.length
  const pageCount = server ? server.totalPages : Math.max(1, Math.ceil(total / internalPageSize))
  const page = server ? server.page : internalPage
  const showPagination =
    (server ? server.totalPages > 1 : total > internalPageSize) || Boolean(server?.onPageSizeChange)

  const selectedIds = React.useMemo(() => Object.keys(selection).filter((key) => selection[key]), [selection])
  const filtered = (Boolean(globalFilter) || filterActive) && rows.length === 0 && !loading && !error

  const labels: PaginationLabels = {
    summary: String(tc.raw('table.showing')),
    pageSize: tc('table.rowsPerPage'),
    first: tc('pagination.first'),
    previous: tc('pagination.prev'),
    next: tc('pagination.next'),
    last: tc('pagination.last'),
  }

  const cellPad = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2'

  // A sticky head scrolls over the body, so its background must be opaque:
  // this is the `bg-muted/60`-over-`bg-card` composite the static tables show,
  // flattened into one colour so rows passing underneath never ghost through.
  // It sits on the cells rather than the `thead` because sticky on the head
  // element is still unevenly supported while sticky on `th` is universal; the
  // header row carries no bottom border (`TableHeader` zeroes it), so no part
  // of the border painting is left behind when the cells detach.
  const stickyHead = scrollable
    ? 'sticky top-0 z-10 bg-[color-mix(in_oklab,var(--color-muted)_60%,var(--color-card))]'
    : undefined

  // Chromium refuses to stick table cells inside a `border-collapse: collapse`
  // table, so a scrollable table switches to separated borders and paints the
  // row divider on the cells instead of the row (`TableRow`'s `border-b` is
  // simply inert there). Non-scrollable tables keep the collapsed model.
  const separatedBorders =
    scrollable &&
    'border-separate border-spacing-0 [&_tbody>tr>td]:border-b [&_tbody>tr>td]:border-border [&_tbody>tr:last-child>td]:border-b-0'

  // A table with a designated `flex` column drops `min-w-max` so that one
  // column may *wrap* when the container is narrower than the content: every
  // sibling renders `whitespace-nowrap` (see the head and cell classNames
  // below), so the deficit falls on the flex column alone instead of crushing
  // `.font-data` cells to one character per line, and a table whose min-content
  // still outruns the container overflows into the inner horizontal scroll
  // like any other.
  //
  // The flex column deliberately does NOT claim the leftover width on wide
  // screens, and neither does any other single column: a flex table splits the
  // width *evenly*, every column getting the same percentage share (see
  // `equalShare` below), floored at its content by auto layout so nothing
  // clips. Both earlier extremes failed here — a `width: 100%` absorber turned
  // the primary column into a ~1400px banner on a 2560px monitor, and content-
  // proportional sharing then parked two thirds of that monitor in whichever
  // column happened to carry the longest text. Non-flex tables stay content-
  // proportional: their columns hold DNS data of very different lengths, where
  // equal shares would waste space on the short ones.
  //
  // `hideHeader` tables keep `min-w-max`: wrapping is a page-list contract, and
  // a sub-table inside an expanded row should stay content-sized.
  const hasFlexColumn =
    !hideHeader &&
    table
      .getVisibleLeafColumns()
      .some((column) => (column.columnDef.meta as { flex?: boolean } | undefined)?.flex)

  // Percentages are safe here because a flex table drops `min-w-max`; under
  // `min-width: max-content` Chrome would resolve them against the intrinsic
  // width and explode (see `ColumnWidth`). Auto layout treats the share as a
  // preference, never a clip: a column whose nowrap content outruns its share
  // simply grows, and the others shrink towards — never below — their own.
  const equalShare = 100 / Math.max(1, table.getVisibleLeafColumns().length)

  return (
    <div
      data-slot="data-table"
      className={cn('flex min-w-0 flex-col', scrollable && 'min-h-0 flex-1', className)}
    >
      {toolbar && <div className="flex flex-wrap items-center gap-2 px-1 pb-3">{toolbar}</div>}

      {selectedIds.length > 0 && selectionActions && (
        <div className="border-primary/25 bg-primary/5 mb-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <span className="text-primary text-xs font-medium">
            {tc('table.selected', { count: selectedIds.length })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">{selectionActions(selectedIds)}</div>
        </div>
      )}

      <div
        className={cn(
          'surface min-w-0 overflow-hidden rounded-lg',
          scrollable && 'flex min-h-64 flex-1 flex-col',
        )}
      >
        <Table
          aria-label={label}
          className={cn(!hasFlexColumn && 'min-w-max', separatedBorders)}
          containerClassName={scrollable ? 'min-h-0 flex-1 overflow-y-auto' : undefined}
        >
          {!hideHeader && (
            <TableHeader className={cn(!scrollable && 'bg-muted/60')}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {enableRowSelection && (
                    <TableHead className={cn('w-9', cellPad, stickyHead)}>
                      <Checkbox
                        checked={
                          rows.length > 0 && rows.every((row) => row.getIsSelected())
                            ? true
                            : rows.some((row) => row.getIsSelected())
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(value) => {
                          for (const row of rows) row.toggleSelected(Boolean(value))
                        }}
                        aria-label={tc('table.selectAll')}
                      />
                    </TableHead>
                  )}
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as
                      | { align?: 'left' | 'right' | 'center'; width?: string; hug?: boolean; flex?: boolean }
                      | undefined
                    return (
                      <TableHead
                        key={header.id}
                        // Absolute widths win; otherwise a flex table hands
                        // every column the same percentage share so a sparse
                        // list reads as even columns instead of one wide
                        // banner plus a right-hand cluster.
                        style={
                          meta?.width
                            ? { width: meta.width }
                            : hasFlexColumn
                              ? { width: `${equalShare}%` }
                              : undefined
                        }
                        className={cn(
                          cellPad,
                          stickyHead,
                          // `nowrap` is what actually makes a hug column hug:
                          // under max-content sizing the column then measures
                          // exactly its content. A flex table extends the same
                          // nowrap to every sibling so that, when the table
                          // has to shrink, the deficit falls on the flex
                          // column alone instead of wrapping a badge or a
                          // `.font-data` value mid-cell.
                          (meta?.hug || (hasFlexColumn && !meta?.flex)) && 'whitespace-nowrap',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              'text-muted-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium tracking-wide uppercase transition-colors',
                              'hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                              header.column.getIsSorted() && 'text-foreground',
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getIsSorted() === 'asc' ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ArrowDown className="size-3" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                            )}
                            <span className="sr-only">{tc('table.sortBy')}</span>
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
          )}

          <TableBody>
            {!loading && !error && rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length + (enableRowSelection ? 1 : 0)} className="p-0">
                  {filtered ? (
                    <NoResultsState
                      title={noResults?.title}
                      body={noResults?.body}
                      action={noResults?.action}
                    />
                  ) : (
                    <EmptyState
                      title={empty?.title ?? tc('table.empty')}
                      body={empty?.body ?? tc('table.emptyHint')}
                      action={empty?.action}
                      icon={empty?.icon ?? Inbox}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}

            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {enableRowSelection && (
                  <TableCell className={cn(cellPad)} onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={row.getIsSelected()}
                      onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
                      disabled={!row.getCanSelect()}
                      aria-label={tc('table.selectRow')}
                    />
                  </TableCell>
                )}
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as
                    { align?: 'left' | 'right' | 'center'; hug?: boolean; flex?: boolean } | undefined
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        cellPad,
                        'align-middle text-sm',
                        // Same rule as the head cell: in a flex table every
                        // non-flex column stays on one line so the flex
                        // column is the only one that wraps.
                        (meta?.hug || (hasFlexColumn && !meta?.flex)) && 'whitespace-nowrap',
                        meta?.align === 'right' && 'text-right',
                        meta?.align === 'center' && 'text-center',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {loading && (
          <LoadingState
            rows={Math.min(6, Math.max(3, rows.length || 5))}
            className="border-border/60 border-t"
          />
        )}

        {error ? <ErrorState error={error} onRetry={onRetry} className="rounded-none border-0" /> : null}
      </div>

      {(showPagination || footerNote) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground min-w-0 text-xs">{footerNote}</div>
          {showPagination && (
            <Pagination
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={server ? server.pageSize : internalPageSize}
              onPageChange={server ? server.onPageChange : setInternalPage}
              onPageSizeChange={
                server
                  ? server.onPageSizeChange
                  : clientPagination === false
                    ? undefined
                    : (size) => {
                        setInternalPageSize(size)
                        setInternalPage(1)
                        clientPagination?.onPageSizeChange?.(size)
                      }
              }
              canChangePageSize={Boolean(server ? server.onPageSizeChange : clientPagination !== false)}
              labels={labels}
              className="ml-auto"
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A column's inline width, restricted to absolute lengths.
 *
 * Percentages are rejected *at compile time* rather than filtered at runtime,
 * because the failure mode is invisible in code review. A table without a flex
 * column carries `min-w-max` so a wide table scrolls instead of crushing its
 * columns; under `min-width: max-content`, Chrome computes a percentage
 * column's intrinsic contribution as `content width / percentage`. The classic
 * `width: 1%` "hug my content" trick therefore turned a 52px actions column
 * into a 5200px one and pushed every other column — including the row actions —
 * outside the viewport on Zones, Records, DHCP, Administration and System Logs.
 *
 * Use `hug: true` for that intent; it is safe under max-content sizing. To let
 * one column wrap instead of forcing a horizontal scroll when the container is
 * narrower than the content, use `flex: true` — it drops `min-w-max` for that
 * table, keeps every sibling nowrap and splits the width evenly between the
 * columns (see the `hasFlexColumn` note above). The equal-share percentages the
 * table writes on its own headers are internal; `meta.width` stays
 * absolute-only.
 */
export type ColumnWidth = `${number}px` | `${number}rem` | `${number}em` | `${number}ch`

/** Column meta typing so `meta: { align: 'right' }` is checked. */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: 'left' | 'right' | 'center'
    width?: ColumnWidth
    /** Size the column to its content instead of sharing out leftover space. */
    hug?: boolean
    /**
     * The column that wraps when the table must shrink below its content
     * width: the table drops `min-w-max` and every sibling renders nowrap, so
     * this column takes the deficit alone. On wide screens the table splits
     * its width evenly between all columns, each floored at its content. Mark
     * at most one column per table; it wins over `width` and `hug`.
     */
    flex?: boolean
  }
}

/** Shorthand for a plain text column — the majority of DNS table cells. */
export function textColumn<T>(options: {
  id?: string
  accessorKey?: string & keyof T
  header: React.ReactNode
  cell?: (value: unknown, row: T) => React.ReactNode
  align?: 'left' | 'right' | 'center'
  width?: ColumnWidth
  hug?: boolean
  flex?: boolean
  enableSorting?: boolean
}): ColumnDef<T, unknown> {
  const { id, accessorKey, header, cell, align, width, hug, flex, enableSorting: sortable } = options
  return {
    id: id ?? (accessorKey as string | undefined),
    ...(accessorKey ? { accessorKey: accessorKey as string } : {}),
    header,
    ...(sortable !== undefined ? { enableSorting: sortable } : {}),
    meta: { align, width, hug, flex },
    ...(cell
      ? {
          cell: ({ getValue, row }) => cell(getValue(), row.original),
        }
      : {}),
  } as ColumnDef<T, unknown>
}
