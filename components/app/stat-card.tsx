'use client'

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Metric tile.
 *
 * The dashboard is a wall of these, so the visual hierarchy is deliberate:
 * label small and muted, value large and tabular (so digits do not jitter when
 * a live counter updates), optional delta and sparkline below. A left accent
 * bar carries the tone — that single 2px element is what keeps a dozen tiles
 * from reading as grey noise.
 */

export type StatTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const TONE_BAR: Record<StatTone, string> = {
  neutral: 'bg-border',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
}

const TONE_TEXT: Record<StatTone, string> = {
  neutral: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
}

export interface StatCardProps {
  label: React.ReactNode
  value: React.ReactNode
  /** Secondary line: unit, delta, or a timestamp. */
  hint?: React.ReactNode
  icon?: React.ReactNode
  tone?: StatTone
  /** Rendered bottom-right; a sparkline or a small action. */
  trailing?: React.ReactNode
  loading?: boolean
  onClick?: () => void
  className?: string
  /** Larger value type for hero metrics. */
  size?: 'sm' | 'md'
}

export function StatCard({ label, value, hint, icon, tone = 'neutral', trailing, loading = false, onClick, className, size = 'md' }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      data-slot="stat-card"
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'surface relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-lg p-4 text-left',
        onClick && 'cursor-pointer transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-0.5', TONE_BAR[tone])} />

      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className={cn('shrink-0', TONE_TEXT[tone], 'opacity-80')}>{icon}</span>}
      </div>

      {loading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : (
        <div className="flex items-end justify-between gap-2">
          <span
            className={cn(
              'truncate font-semibold tabular-nums tracking-tight',
              size === 'md' ? 'text-2xl' : 'text-lg',
              tone !== 'neutral' && TONE_TEXT[tone],
            )}
          >
            {value}
          </span>
          {trailing && <span className="shrink-0 pb-0.5">{trailing}</span>}
        </div>
      )}

      {hint && <div className="mt-0.5 min-w-0 truncate text-xs text-muted-foreground">{hint}</div>}
    </Comp>
  )
}

/** Responsive tile grid; callers pass the same number of cards every time. */
export function StatGrid({ children, columns = 4, className }: { children: React.ReactNode; columns?: 2 | 3 | 4 | 6; className?: string }) {
  const grid = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }[columns]
  return <div data-slot="stat-grid" className={cn('grid grid-cols-1 gap-3', grid, className)}>{children}</div>
}

/** Placeholder grid shown while metrics load. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <StatGrid>
      {Array.from({ length: count }, (_, index) => (
        <StatCard key={index} label={<Skeleton className="h-3 w-16" />} value="" loading />
      ))}
    </StatGrid>
  )
}
