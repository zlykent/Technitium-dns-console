'use client'

import * as React from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { AXIS_STYLE, ChartLegend, ChartTooltipPanel, seriesColor, useChartLocale } from './chart-shared'
import { formatChartTime, parseTimestamp } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { cn } from '@/lib/utils'

/**
 * Stacked-area trend chart for `mainChartData`.
 *
 * The upstream ships eleven series with Chart.js colours and English labels. We
 * keep the series *identity* (so colours stay stable across reloads) but take
 * the display names from i18n and the colours from the theme.
 */

export interface TrendSeriesInput {
  /** Upstream label, e.g. `Total`, `No Error`. Used as the stable identity. */
  label?: string | null
  data: number[]
}

export interface TrendChartProps {
  labels: string[]
  series: TrendSeriesInput[]
  /** Upstream label -> translated name. Unmapped labels fall back to the raw value. */
  names?: Record<string, string>
  /** Series shown on first paint; everything else starts hidden. */
  initialVisible?: string[]
  height?: number
  stacked?: boolean
  emptyLabel?: string
  className?: string
  showLegend?: boolean
}

interface Row {
  label: string
  [key: string]: string | number
}

/**
 * Recharts clones the `content` element and injects `active` / `payload` /
 * `label`, so those must be optional here — otherwise constructing the element
 * in JSX would require props the chart is about to supply anyway.
 */
type TrendTooltipProps = Partial<TooltipContentProps<number, string>> & {
  seriesNames: string[]
  seriesColors: string[]
}

function TrendTooltip({ active, payload, label, seriesNames, seriesColors }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.map((entry, index) => ({
    name: seriesNames[index] ?? String(entry.name ?? entry.dataKey ?? ''),
    value: Number(entry.value ?? 0),
    color: seriesColors[index] ?? 'var(--muted-foreground)',
  }))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return <ChartTooltipPanel label={label} rows={rows} footer={<span className="font-data">{total.toLocaleString()}</span>} />
}

export function TrendChart({
  labels,
  series,
  names = {},
  initialVisible,
  height = 260,
  stacked = false,
  emptyLabel,
  className,
  showLegend = true,
}: TrendChartProps) {
  const fmt = useChartLocale()
  const locale = useLocaleCode()

  // Upstream labels are raw .NET ISO timestamps; neither the axis nor the
  // tooltip can show `2026-09-12T11:01:00.0000000Z`. The pattern is derived
  // from the window's span and sampling step, so an hour-wide view reads
  // `19:52` and a month-wide view reads `09-12`.
  const displayLabels = React.useMemo(() => {
    const times = labels
      .map((label) => parseTimestamp(label)?.getTime())
      .filter((time): time is number => time !== undefined)
    const span = times.length < 2 ? 0 : Math.max(...times) - Math.min(...times)
    const step = times.length < 2 ? 0 : span / (times.length - 1)
    return labels.map((label) => formatChartTime(label, locale, span, step))
  }, [labels, locale])

  // Keys are positional so a label containing spaces or dots cannot break
  // recharts' dataKey path parsing.
  const meta = React.useMemo(
    () =>
      series.map((entry, index) => {
        const raw = entry.label ?? `series-${index}`
        return { key: `s${index}`, raw, label: names[raw] ?? raw, color: seriesColor(raw, index) }
      }),
    [series, names],
  )

  const defaults = React.useMemo(() => {
    if (!initialVisible) return meta.map((entry) => entry.raw)
    const set = new Set(initialVisible)
    const visible = meta.filter((entry) => set.has(entry.raw)).map((entry) => entry.raw)
    return visible.length > 0 ? visible : meta.slice(0, 1).map((entry) => entry.raw)
  }, [initialVisible, meta])

  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set())
  const [signature, setSignature] = React.useState(defaults.join('|'))

  // Re-seed the visibility when the caller changes which series it wants.
  if (signature !== defaults.join('|')) {
    setSignature(defaults.join('|'))
    setHidden(new Set(meta.map((entry) => entry.raw).filter((raw) => !defaults.includes(raw))))
  }

  const rows = React.useMemo<Row[]>(
    () =>
      displayLabels.map((label, index) => {
        const row: Row = { label }
        meta.forEach((entry, seriesIndex) => {
          row[entry.key] = Number(series[seriesIndex]?.data?.[index] ?? 0)
        })
        return row
      }),
    [displayLabels, meta, series],
  )

  const visibleMeta = meta.filter((entry) => !hidden.has(entry.raw))
  const hasData = rows.some((row) => meta.some((entry) => Number(row[entry.key]) > 0))

  const toggle = (raw: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(raw)) next.delete(raw)
      else if (next.size < meta.length - 1) next.add(raw) // never blank the chart
      return next
    })
  }

  const xTicks = React.useMemo(() => {
    if (displayLabels.length <= 8) return displayLabels
    const step = Math.ceil(displayLabels.length / 8)
    return displayLabels.filter((_, index) => index % step === 0 || index === displayLabels.length - 1)
  }, [displayLabels])

  if (!hasData) {
    return (
      <div className={cn('grid place-items-center text-xs text-muted-foreground', className)} style={{ height }}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <defs>
              {visibleMeta.map((entry) => (
                <linearGradient key={entry.key} id={`trend-${entry.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={entry.color} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={entry.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              ticks={xTicks}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={16}
            />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={52} tickFormatter={(value: number) => fmt.compact(value)} />
            <Tooltip
              cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.35, strokeWidth: 1 }}
              content={
                <TrendTooltip
                  seriesNames={visibleMeta.map((entry) => entry.label)}
                  seriesColors={visibleMeta.map((entry) => entry.color)}
                />
              }
            />
            {visibleMeta.map((entry) => (
              <Area
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stackId={stacked ? 'stack' : undefined}
                stroke={entry.color}
                strokeWidth={1.75}
                fill={`url(#trend-${entry.key})`}
                activeDot={{ r: 3, strokeWidth: 0 }}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {showLegend && (
        <ChartLegend
          items={meta.map((entry) => ({
            name: entry.label,
            color: entry.color,
            active: !hidden.has(entry.raw),
            value: rows.reduce((sum, row) => sum + Number(row[entry.key]), 0),
          }))}
          onToggle={meta.length > 1 ? toggle : undefined}
        />
      )}
    </div>
  )
}
