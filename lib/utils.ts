/**
 * Class-name merging, delegated to the `cn` package — shadcn-ui's compiled
 * drop-in replacement for `twMerge(clsx(...))`, so there is no hand-rolled
 * conflict table to keep in sync with Tailwind. Re-exported from here because
 * every component imports its class helpers from `@/lib/utils`; the package
 * stays a single, swappable point of dependency.
 *
 * Semantics callers rely on: falsy/array/object inputs flatten clsx-style, and
 * a later class evicts an earlier one in the same utility group under the same
 * variants (`cn('h-9', 'h-8')` → `'h-8'`), which is what lets
 * `cn(buttonVariants(), className)` be overridden by a caller.
 */
export { cn, type ClassValue } from 'cn'

/**
 * Technitium returns some numbers as strings and some as numbers depending on
 * the endpoint version. Coerce defensively rather than crashing a table.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'yes' || v === 'on'
  }
  return Boolean(value)
}

/** Stable key for list rendering when the API gives no id. */
export function rowKey(...parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u0000')
}

/**
 * Case-insensitive substring match used by every table filter. DNS names are
 * case-insensitive by definition, so filtering must be too.
 */
export function matches(haystack: unknown, needle: string): boolean {
  if (!needle) return true
  const n = needle.trim().toLowerCase()
  if (!n) return true
  if (haystack === null || haystack === undefined) return false
  return String(haystack).toLowerCase().includes(n)
}

/** Multi-field variant: true when any of the given values match. */
export function matchesAny(needle: string, ...values: unknown[]): boolean {
  return values.some((v) => matches(v, needle))
}

export function truncate(value: string, max = 48): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Sleep helper for debounced polling and tests. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** Copy to clipboard with a fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Group an array by a key selector, preserving first-seen order. */
export function groupBy<T, K extends string>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  return map
}

/**
 * Technitium expects comma-joined multi-value parameters. Empty list must be
 * omitted entirely, not sent as an empty string.
 */
export function joinList(values: readonly (string | number | boolean)[] | undefined | null): string | undefined {
  const list = (values ?? []).map((v) => String(v).trim()).filter(Boolean)
  return list.length > 0 ? list.join(',') : undefined
}

/** Inverse of `joinList` — split a comma or newline separated field. */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
