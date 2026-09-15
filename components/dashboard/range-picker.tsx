'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { CalendarRange, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { STAT_RANGES, type StatRange } from '@/lib/api/enums'

/**
 * Time window + auto-refresh controls shared by every stats surface.
 *
 * The window is deliberately *applied* rather than live: `dashboard/stats/get`
 * re-aggregates the whole range server-side, so binding it to every keystroke
 * in the custom date fields would hammer a single-threaded admin API.
 */

export interface StatsWindow {
  type: StatRange
  /**
   * ISO-8601 window edges, only meaningful when `type === 'custom'`. Named
   * after the wire parameters (`start` / `end`) — upstream rejects a custom
   * request that omits either.
   */
  start?: string
  end?: string
}

export const REFRESH_OPTIONS = [0, 10, 30, 60, 300] as const
export type RefreshSeconds = (typeof REFRESH_OPTIONS)[number]

/** `datetime-local` value -> ISO with seconds, or null when incomplete. */
function toIso(local: string): string | null {
  if (!local) return null
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toLocal(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function RangePicker({
  value: current,
  onApply,
  refresh,
  onRefreshChange,
  onRefreshNow,
  isFetching,
  lastUpdated,
  className,
}: {
  value: StatsWindow
  onApply: (next: StatsWindow) => void
  refresh: RefreshSeconds
  onRefreshChange: (seconds: RefreshSeconds) => void
  onRefreshNow: () => void
  isFetching: boolean
  lastUpdated: Date | null
  className?: string
}) {
  const t = useTranslations('dashboard')
  const [draft, setDraft] = React.useState({ start: toLocal(current.start), end: toLocal(current.end) })
  const [error, setError] = React.useState<string | null>(null)

  // Keep the draft in step when the applied window changes from outside (a
  // preset click, or a parent restoring a saved range). Reconciled during render
  // so the inputs never flash the previous window.
  const [synced, setSynced] = React.useState({ start: current.start, end: current.end })
  if (synced.start !== current.start || synced.end !== current.end) {
    setSynced({ start: current.start, end: current.end })
    setDraft({ start: toLocal(current.start), end: toLocal(current.end) })
  }

  const applyType = (type: StatRange) => {
    if (type !== 'custom') {
      setError(null)
      onApply({ type })
      return
    }
    // Entering custom mode with no dates yet: default to the last 24 hours so
    // the chart does not silently go empty.
    if (!draft.start && !draft.end) {
      const end = new Date()
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
      const next = { start: toLocal(start.toISOString()), end: toLocal(end.toISOString()) }
      setDraft(next)
      onApply({ type: 'custom', start: start.toISOString(), end: end.toISOString() })
      return
    }
    onApply({ type: 'custom', ...validate() })
  }

  const validate = (): { start?: string; end?: string } => {
    const start = toIso(draft.start)
    const end = toIso(draft.end)
    if (!start || !end) {
      setError(t('range.invalidRange'))
      return {}
    }
    if (start >= end) {
      setError(t('range.invalidRange'))
      return {}
    }
    setError(null)
    return { start, end }
  }

  const applyCustom = () => {
    const parsed = validate()
    if (!parsed.start || !parsed.end) return
    onApply({ type: 'custom', start: parsed.start, end: parsed.end })
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={current.type} onValueChange={(value) => applyType(value as StatRange)}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('range.label')}>
            <CalendarRange className="size-3.5 text-muted-foreground" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAT_RANGES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`range.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {current.type === 'custom' && (
          <>
            <div className="flex items-center gap-1.5">
              <Input
                type="datetime-local"
                value={draft.start}
                onChange={(event) => setDraft((prev) => ({ ...prev, start: event.target.value }))}
                aria-label={t('range.from')}
                className="font-data h-8 w-48 text-xs"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft((prev) => ({ ...prev, end: event.target.value }))}
                aria-label={t('range.to')}
                className="font-data h-8 w-48 text-xs"
              />
              <Button size="sm" onClick={applyCustom}>
                {t('range.apply')}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        )}

        <Select value={String(refresh)} onValueChange={(value) => onRefreshChange(Number(value) as RefreshSeconds)}>
          <SelectTrigger size="sm" className="w-32" aria-label={t('refresh.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REFRESH_OPTIONS.map((seconds) => (
              <SelectItem key={seconds} value={String(seconds)}>
                {seconds === 0 ? t('refresh.off') : t(refreshKey(seconds))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={onRefreshNow} disabled={isFetching}>
          {isFetching ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" aria-hidden />}
          {isFetching ? t('refresh.refreshing') : t('refresh.now')}
        </Button>

        {lastUpdated && (
          <span className="font-data text-xs text-muted-foreground">
            {t('refresh.lastUpdated', {
              time: lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            })}
          </span>
        )}
      </div>
    </div>
  )
}

function refreshKey(seconds: number): 'refresh.every10s' | 'refresh.every30s' | 'refresh.every1m' | 'refresh.every5m' {
  switch (seconds) {
    case 10:
      return 'refresh.every10s'
    case 60:
      return 'refresh.every1m'
    case 300:
      return 'refresh.every5m'
    default:
      return 'refresh.every30s'
  }
}
