'use client'

import * as React from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { ChartLegend, ChartTooltipPanel, CHART_COLORS } from './chart-shared'
import { cn } from '@/lib/utils'

/**
 * Donut for the distribution charts (query type / response code / protocol).
 *
 * These payloads put the categories in `labels` and ship one unlabelled
 * dataset, so there is nothing to toggle — a legend with values and a centred
 * total reads better than eleven thin slices would.
 */

export interface DonutSlice {
  name: string
  value: number
  color: string
}

type DonutTooltipProps = Partial<TooltipContentProps<number, string>> & { total: number }

function DonutTooltip({ active, payload, total }: DonutTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  const value = Number(entry.value ?? 0)
  const share = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
  const name = String(entry.name ?? '')
  return (
    <ChartTooltipPanel
      label={name}
      rows={[{ name, value, color: entry.color ?? 'var(--chart-1)' }]}
      footer={<span className="font-data">{share}%</span>}
    />
  )
}

export function DonutChart({
  slices,
  height = 220,
  emptyLabel,
  className,
  totalLabel,
  showLegend = true,
}: {
  slices: DonutSlice[]
  height?: number
  emptyLabel?: string
  className?: string
  totalLabel?: string
  showLegend?: boolean
}) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const data = React.useMemo(() => slices.filter((slice) => slice.value > 0), [slices])
  const total = data.reduce((sum, slice) => sum + slice.value, 0)

  if (data.length === 0) {
    return (
      <div className={cn('grid place-items-center text-xs text-muted-foreground', className)} style={{ height }}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<DonutTooltip total={total} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={data.length > 1 ? 1.5 : 0}
              stroke="var(--card)"
              strokeWidth={1}
              isAnimationActive={false}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.name}
                  fill={slice.color}
                  opacity={activeIndex === null || activeIndex === index ? 1 : 0.45}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-data text-xl leading-none font-semibold tabular-nums">{total.toLocaleString()}</p>
            {totalLabel && <p className="mt-1 text-[11px] text-muted-foreground">{totalLabel}</p>}
          </div>
        </div>
      </div>

      {showLegend && (
        <ChartLegend
          items={data.map((slice) => ({ name: slice.name, color: slice.color, value: slice.value }))}
        />
      )}
    </div>
  )
}

/** Builds slices from a `labels` + single-dataset payload, largest first. */
export function toDonutSlices(labels: string[], values: number[], names?: Record<string, string>): DonutSlice[] {
  return labels
    .map((label, index) => ({ raw: label, value: Number(values[index] ?? 0) }))
    .sort((a, b) => b.value - a.value)
    .map((slice, index) => ({
      name: names?.[slice.raw] ?? slice.raw,
      value: slice.value,
      // Colours are assigned after sorting so the biggest slice always gets
      // the strongest hue, whatever order the upstream happened to use.
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
}
