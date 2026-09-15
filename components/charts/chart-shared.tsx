'use client'

import * as React from 'react'
import { formatCompact } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared chart plumbing.
 *
 * Every colour is a theme token, never the hex the upstream ships in
 * `backgroundColor` — those are Chart.js defaults that clash with the Signal
 * palette and do not adapt to dark mode. The upstream value is ignored on
 * purpose; what matters is the series *identity*, which we re-map here.
 */

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

/** Semantic colours for the response-code series, which carry meaning. */
export const SERIES_COLOR_HINTS: Record<string, string> = {
  Total: 'var(--chart-1)',
  'No Error': 'var(--chart-3)',
  'Server Failure': 'var(--chart-5)',
  'NX Domain': 'var(--chart-4)',
  Refused: 'var(--chart-6)',
  Authoritative: 'var(--chart-2)',
  Recursive: 'var(--chart-3)',
  Cached: 'var(--chart-2)',
  Blocked: 'var(--chart-5)',
  Dropped: 'var(--chart-4)',
  Clients: 'var(--chart-6)',
  NOERROR: 'var(--chart-3)',
  SERVFAIL: 'var(--chart-5)',
  NXDOMAIN: 'var(--chart-4)',
  REFUSED: 'var(--chart-6)',
  UDP: 'var(--chart-1)',
  TCP: 'var(--chart-2)',
  'DNS-over-TLS': 'var(--chart-3)',
  'DNS-over-HTTPS': 'var(--chart-4)',
  'DNS-over-QUIC': 'var(--chart-6)',
}

export function seriesColor(key: string, index: number): string {
  return SERIES_COLOR_HINTS[key] ?? CHART_COLORS[index % CHART_COLORS.length]
}

/** Recharts is not locale-aware; axis and tooltip numbers go through us. */
export function useChartLocale() {
  const locale = useLocaleCode()
  return React.useMemo(
    () => ({
      compact: (value: number) => formatCompact(value, locale),
      full: (value: number) => value.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
    }),
    [locale],
  )
}

export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
  fontFamily: 'var(--font-mono)',
} as const

/** Card wrapper so charts and stat cards share one silhouette. */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section data-slot="chart-card" className={cn('surface flex flex-col rounded-lg', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className={cn('p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function ChartSkeleton({ height = 240, className }: { height?: number; className?: string }) {
  return <Skeleton className={cn('w-full rounded-md', className)} style={{ height }} />
}

/**
 * Tooltip panel. Written by hand instead of using recharts' default, which
 * renders an inline-styled white box that ignores the theme entirely.
 */
export function ChartTooltipPanel({
  label,
  rows,
  footer,
}: {
  label?: string | number
  rows: { name: string; value: number; color: string }[]
  footer?: React.ReactNode
}) {
  return (
    <div className="surface-raised min-w-40 rounded-md border px-3 py-2 text-xs">
      {label !== undefined && label !== null && label !== '' && (
        <p className="font-data mb-1.5 text-[11px] text-muted-foreground">{String(label)}</p>
      )}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: row.color }} aria-hidden />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="font-data shrink-0 tabular-nums">{row.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 border-t border-border/60 pt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  )
}

export interface LegendItem {
  name: string
  color: string
  value?: number
  active?: boolean
}

/**
 * Clickable legend. Recharts' built-in one cannot toggle series, and on the
 * trend chart that is the whole point — eleven series at once is unreadable.
 */
export function ChartLegend({
  items,
  onToggle,
  className,
}: {
  items: LegendItem[]
  onToggle?: (name: string) => void
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1', className)}>
      {items.map((item) => {
        const dimmed = item.active === false
        const content = (
          <>
            <span
              className="size-2 shrink-0 rounded-sm transition-opacity"
              style={{ background: item.color, opacity: dimmed ? 0.3 : 1 }}
              aria-hidden
            />
            <span className={cn('truncate transition-opacity', dimmed && 'text-muted-foreground opacity-60')}>{item.name}</span>
            {item.value !== undefined && (
              <span className="font-data ml-auto shrink-0 text-muted-foreground tabular-nums">{item.value.toLocaleString()}</span>
            )}
          </>
        )
        return (
          <li key={item.name} className="min-w-0">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(item.name)}
                aria-pressed={!dimmed}
                className="flex w-full max-w-52 items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted/60"
              >
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-1 py-0.5 text-xs">{content}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
