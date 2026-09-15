'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Pagination.
 *
 * A non-router pagination control because every list page in the console drives
 * TanStack Query state (page, pageSize) rather than URL search params. All
 * user-facing strings arrive via `labels` so the component stays locale-free
 * and chrome-agnostic.
 */

export interface PaginationLabels {
  /** e.g. "Showing {from}–{to} of {total}" — already interpolated by caller. */
  summary: string
  /** Label for the page-size select, e.g. "Rows per page". */
  pageSize: string
  /** aria-label for first-page button. */
  first: string
  /** aria-label for previous-page button. */
  previous: string
  /** aria-label for next-page button. */
  next: string
  /** aria-label for last-page button. */
  last: string
  /** aria-label for the page navigation region. */
  navigation?: string
}

export interface PaginationProps extends React.ComponentProps<'div'> {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  canChangePageSize?: boolean
  labels: PaginationLabels
}

/**
 * Compute a windowed list of page numbers (at most 7 slots) with ellipsis
 * markers for large page counts.
 */
function getPageWindow(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: (number | 'ellipsis')[] = []
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i)
    pages.push('ellipsis', total)
  } else if (current >= total - 3) {
    pages.push(1, 'ellipsis')
    for (let i = total - 4; i <= total; i++) pages.push(i)
  } else {
    pages.push(1, 'ellipsis')
    for (let i = current - 1; i <= current + 1; i++) pages.push(i)
    pages.push('ellipsis', total)
  }
  return pages
}

function Pagination({
  className,
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  canChangePageSize = false,
  labels,
  ...props
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const summaryText = labels.summary
    .replace('{from}', String(from))
    .replace('{to}', String(to))
    .replace('{total}', String(total))

  const windows = getPageWindow(page, pageCount)

  return (
    <div
      data-slot="pagination"
      className={cn('flex flex-wrap items-center justify-between gap-3 px-2 py-2', className)}
      {...props}
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{summaryText}</span>
        {canChangePageSize && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs">{labels.pageSize}</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-7 w-auto min-w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <nav
        aria-label={labels.navigation ?? 'Pagination'}
        className="flex items-center gap-1"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={labels.first}
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={labels.previous}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>

        {windows.map((item, idx) =>
          item === 'ellipsis' ? (
            <span key={`e-${idx}`} className="flex size-7 items-center justify-center text-muted-foreground" aria-hidden>
              <Ellipsis className="size-3.5" />
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={labels.next}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={labels.last}
          disabled={page >= pageCount}
          onClick={() => onPageChange(pageCount)}
        >
          <ChevronsRight className="size-3.5" />
        </Button>
      </nav>
    </div>
  )
}

export { Pagination }
