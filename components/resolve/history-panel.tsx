'use client'

import { useTranslations } from 'next-intl'
import { Clock, Play, Trash } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ResolveFormValues } from '@/components/resolve/resolve-form'
import { formatDateTime, formatRelative, formatRtt } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { cn } from '@/lib/utils'

/**
 * Session query history.
 *
 * A diagnostic tool is used iteratively — resolve, tweak the type, resolve again,
 * compare — so the last N queries are kept for one-click replay. Persisted in
 * `localStorage` so a page refresh does not lose the trail, but scoped to this
 * browser only (the i18n copy says exactly that).
 *
 * The list is an *external store* read through `useSyncExternalStore`, not a
 * `useState` seeded in a mount effect: `react-hooks/set-state-in-effect` (rightly)
 * rejects the latter as a cascading render, and `useSyncExternalStore` is the
 * sanctioned way to mirror a browser-only source. React renders the empty server
 * snapshot during SSR *and* hydration, then swaps in the stored list after commit,
 * so the first paint matches the server with no hydration warning. The caching /
 * notify details live in the store block below.
 *
 * Each entry stores the full `ResolveFormValues` snapshot, so replay restores the
 * server / protocol / DNSSEC / subnet too, not just the domain.
 */

const STORAGE_KEY = 'dnsClient.resolve.history.v1'

/** Stable empty reference so `getSnapshot` never hands back a fresh `[]`. */
const EMPTY: readonly HistoryEntry[] = []

export interface HistoryEntry {
  id: string
  /** ISO timestamp of when the query ran. */
  time: string
  domain: string
  type: string
  server: string
  rcode: string
  rttMs: number | null
  /** Form snapshot used to replay the query. */
  values: ResolveFormValues
}

// External store over `localStorage`.
//
// In-memory (`cachedEntries`) is authoritative and `localStorage` is a
// best-effort mirror, so a blocked or quota-exceeded storage API degrades to
// "history for this session only" instead of breaking the panel. `getSnapshot`
// must return a *stable* reference or `useSyncExternalStore` re-renders forever,
// hence the module-level cache that is only replaced on `commit`. The list is
// seeded lazily on the first client `getSnapshot` — which React calls after
// hydration, never during the server pass — so `localStorage` is only ever
// touched in the browser.

let cachedEntries: readonly HistoryEntry[] = EMPTY
let seeded = false
const listeners = new Set<() => void>()

function parseStored(raw: string | null): readonly HistoryEntry[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : EMPTY
  } catch {
    return EMPTY
  }
}

function seedOnce() {
  if (seeded || typeof window === 'undefined') return
  seeded = true
  try {
    cachedEntries = parseStored(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    cachedEntries = EMPTY
  }
}

function getSnapshot(): readonly HistoryEntry[] {
  seedOnce()
  return cachedEntries
}

function getServerSnapshot(): readonly HistoryEntry[] {
  return EMPTY
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

/** Commit a new list to memory + the best-effort mirror, then notify React. */
function commit(next: readonly HistoryEntry[]) {
  cachedEntries = next
  seeded = true
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Non-critical — keep the in-memory list for this session.
  }
  for (const listener of listeners) listener()
}

/** Owns the history list backed by the `localStorage` external store. */
export function useResolveHistory(limit = 25) {
  const entries = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const add = React.useCallback(
    (entry: HistoryEntry) => {
      commit([entry, ...getSnapshot()].slice(0, limit))
    },
    [limit],
  )

  const clear = React.useCallback(() => commit(EMPTY), [])

  return React.useMemo(() => ({ entries, add, clear }), [entries, add, clear])
}

export interface HistoryPanelProps {
  entries: readonly HistoryEntry[]
  onReplay: (entry: HistoryEntry) => void
  onClear: () => void
  className?: string
}

export function HistoryPanel({ entries, onReplay, onClear, className }: HistoryPanelProps) {
  const t = useTranslations('dnsClient')
  const locale = useLocaleCode()

  return (
    <section data-slot="history-panel" className={cn('surface flex min-h-0 flex-col rounded-lg', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t('history.title')}</span>
        </h2>
        {entries.length > 0 && (
          <Button variant="ghost" size="icon-xs" onClick={onClear} aria-label={t('history.clear')} title={t('history.clear')}>
            <Trash className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>

      <p className="px-3 pt-2 text-xs text-muted-foreground">{t('history.hint')}</p>

      {entries.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('history.empty')}</p>
      ) : (
        <ScrollArea className="max-h-[28rem] px-1.5 py-1.5">
          <ul className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="group flex items-start gap-2 rounded-md border border-border/50 px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-accent/40">
                  <button
                    type="button"
                    onClick={() => onReplay(entry)}
                    className="min-w-0 flex-1 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label={t('history.reuse')}
                    title={t('history.reuse')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-data truncate text-sm" aria-label={t('history.domain')}>
                        {entry.domain}
                      </span>
                      <Badge variant="outline" className="font-data shrink-0" aria-label={t('history.type')}>
                        {entry.type}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-data truncate" aria-label={t('history.server')}>
                        {entry.server}
                      </span>
                      <span className="font-data shrink-0" aria-label={t('history.rcode')}>
                        {entry.rcode}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-data" aria-label={t('history.rtt')}>
                        {entry.rttMs !== null ? formatRtt(entry.rttMs, locale) : '—'}
                      </span>
                      <span title={formatDateTime(entry.time, locale)} aria-label={t('history.time')}>
                        {formatRelative(entry.time, locale)}
                      </span>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onReplay(entry)}
                    aria-label={t('history.reuse')}
                    title={t('history.reuse')}
                  >
                    <Play className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </section>
  )
}
