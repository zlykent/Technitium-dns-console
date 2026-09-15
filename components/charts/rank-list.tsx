'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Leaderboard rows with a proportional bar.
 *
 * Hand-rolled rather than a recharts BarChart: ten rows of text plus a bar is
 * cheaper to render, selectable, and the numbers stay legible at any width.
 */

export interface RankRow {
  name: string
  value: number
  /** Optional marker rendered after the name (e.g. "rate limited"). */
  badge?: React.ReactNode
}

export function RankList({
  rows,
  emptyLabel,
  className,
  barClassName,
  nameClass,
}: {
  rows: RankRow[]
  emptyLabel?: string
  className?: string
  barClassName?: string
  /** Extra classes for the name cell; DNS names want `.font-data`. */
  nameClass?: string
}) {
  if (rows.length === 0) {
    return <div className={cn('grid place-items-center px-3 py-10 text-center text-xs text-muted-foreground', className)}>{emptyLabel}</div>
  }

  const max = Math.max(...rows.map((row) => row.value), 1)

  return (
    <ol className={cn('flex flex-col gap-0.5', className)}>
      {rows.map((row, index) => (
        <li key={row.name} className="group relative flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
          <span className="font-data w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{index + 1}</span>
          <span className={cn('min-w-0 flex-1 truncate text-sm', nameClass ?? 'font-data')} title={row.name}>
            {row.name}
          </span>
          {row.badge}
          <span className="font-data w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {row.value.toLocaleString()}
          </span>
          <span
            className={cn('absolute bottom-0 left-9 right-2 h-px origin-left bg-primary/45 transition-transform', barClassName)}
            style={{ transform: `scaleX(${row.value / max})` }}
            aria-hidden
          />
        </li>
      ))}
    </ol>
  )
}
