import { formatDistanceToNowStrict, format as formatDateFn, isValid, parseISO } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import type { Locale } from '@/lib/i18n/config'

/**
 * Presentation formatting for DNS data.
 *
 * Every function takes the active locale explicitly instead of reading it from
 * a hook: these run inside table cell renderers (hundreds of times per frame)
 * and inside server components, so they must stay pure and allocation-light.
 */

const DATE_LOCALES = { zh: zhCN, en: enUS } satisfies Record<Locale, typeof enUS>

/** Technitium sends `.NET` timestamps like `2026-09-11T08:30:00.1234567Z`. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // .NET emits 7 fractional digits; JS Date wants at most 3.
  const normalised = trimmed.replace(/(\.\d{3})\d+/, '$1')
  const parsed = parseISO(normalised)
  return isValid(parsed) ? parsed : null
}

/**
 * .NET's `DateTime.MinValue` — how Technitium spells "this has never happened":
 * an account that has never signed in, a record that has never been served. It
 * arrives as a *syntactically valid* ISO date, so `parseTimestamp` accepts it
 * and every relative formatter then reports "2027 years ago".
 *
 * `startsWith` on the date and the zeroed time, not equality: the stock console
 * compares this field against exactly two spellings, with and without the `Z`
 * designator (`.probe/console-js/zone.js:4180` and `:4187`), and the same
 * upstream serialises real timestamps with seven fractional digits. A prefix
 * covers the `Z`, the missing `Z` and any digit count in one rule.
 *
 * A missing value counts as never too, which is what a "last …" column wants:
 * the two are indistinguishable to an operator. What "never" then *looks* like
 * is the caller's choice — `common:time.never` where the absence is the fact
 * being reported, an em dash where upstream hides the line altogether.
 */
export function isNeverTimestamp(value: string | null | undefined): boolean {
  if (!value) return true
  const trimmed = value.trim()
  return trimmed === '' || trimmed.startsWith('0001-01-01T00:00:00')
}

export function formatDateTime(value: string | null | undefined, locale: Locale, withSeconds = true): string {
  const date = parseTimestamp(value)
  if (!date) return '—'
  return formatDateFn(date, withSeconds ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd HH:mm', { locale: DATE_LOCALES[locale] })
}

export function formatDateOnly(value: string | null | undefined, locale: Locale): string {
  const date = parseTimestamp(value)
  if (!date) return '—'
  return formatDateFn(date, 'yyyy-MM-dd', { locale: DATE_LOCALES[locale] })
}

export function formatTimeOnly(value: string | null | undefined, locale: Locale): string {
  const date = parseTimestamp(value)
  if (!date) return '—'
  return formatDateFn(date, 'HH:mm:ss', { locale: DATE_LOCALES[locale] })
}

/**
 * Axis ticks and tooltip headers for time-series charts. The raw upstream
 * labels are .NET ISO strings (`2026-09-12T11:01:00.0000000Z`) — unreadable as
 * axis ticks. The pattern follows the visible window: a sub-day window shows
 * clock time, a multi-day window adds the month and day, and a window sampled
 * coarser than once a day drops the always-midnight time part. `spanMs` /
 * `stepMs` come from the label array itself, so the caller stays declarative.
 * Unparseable labels pass through untouched rather than becoming an em dash:
 * on an axis, one odd tick is less damaging than a row of `—`.
 */
export function formatChartTime(value: string, locale: Locale, spanMs: number, stepMs: number): string {
  const date = parseTimestamp(value)
  if (!date) return value
  const DAY = 86_400_000
  const pattern =
    stepMs >= DAY ? (spanMs > 365 * DAY ? 'yyyy-MM' : 'MM-dd') : spanMs <= DAY ? 'HH:mm' : 'MM-dd HH:mm'
  return formatDateFn(date, pattern, { locale: DATE_LOCALES[locale] })
}

/**
 * Relative time for "last seen" columns. Returns a compact pair so the UI can
 * show the relative string with the absolute one as a tooltip.
 */
export function formatRelative(value: string | null | undefined, locale: Locale): string {
  const date = parseTimestamp(value)
  if (!date) return '—'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return formatDateFn(date, 'yyyy-MM-dd HH:mm', { locale: DATE_LOCALES[locale] })
  if (diffMs < 5_000) return locale === 'zh' ? '刚刚' : 'just now'
  try {
    return formatDistanceToNowStrict(date, { addSuffix: true, locale: DATE_LOCALES[locale] })
  } catch {
    return formatDateFn(date, 'yyyy-MM-dd HH:mm', { locale: DATE_LOCALES[locale] })
  }
}

/**
 * `uptimestamp` from `status` / login `info` is a .NET TimeSpan-ish string
 * (`3.04:12:33.5`) or an ISO date, depending on the endpoint. Handle both.
 */
export function formatUptime(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—'
  const trimmed = value.trim()

  const span = trimmed.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/)
  if (span) {
    const days = Number(span[1] ?? 0)
    const hours = Number(span[2])
    const minutes = Number(span[3])
    const seconds = Number(span[4] ?? 0)
    return formatDurationParts({ days, hours, minutes, seconds }, locale)
  }

  const date = parseTimestamp(trimmed)
  if (date) return formatDurationMs(Date.now() - date.getTime(), locale)

  return trimmed
}

export interface DurationParts {
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
}

export function formatDurationParts(parts: DurationParts, locale: Locale): string {
  const units: [number, [string, string]][] = [
    [parts.days ?? 0, ['天', 'd']],
    [parts.hours ?? 0, ['小时', 'h']],
    [parts.minutes ?? 0, ['分', 'm']],
    [parts.seconds ?? 0, ['秒', 's']],
  ]
  const shown = units.filter(([n]) => n > 0).slice(0, 3)
  if (shown.length === 0) return locale === 'zh' ? '0 秒' : '0s'
  return shown.map(([n, [zh, en]]) => `${n}${locale === 'zh' ? ` ${zh}` : en}`).join(locale === 'zh' ? ' ' : ' ')
}

export function formatDurationMs(ms: number, locale: Locale): string {
  const totalSeconds = Math.floor(ms / 1000)
  return formatDurationParts(
    {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
    },
    locale,
  )
}

export function formatDurationSeconds(seconds: number, locale: Locale): string {
  return formatDurationMs(seconds * 1000, locale)
}

// --------------------------------------------------------------------- bytes

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), BYTE_UNITS.length - 1)
  const scaled = value / 1024 ** exponent
  const shown = exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(digits)
  return `${shown} ${BYTE_UNITS[exponent]}`
}

// -------------------------------------------------------------------- numbers

export function formatNumber(value: number | null | undefined, locale: Locale): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

/** Large counts on dashboard cards: 12.4k / 3.1M keeps the card compact. */
export function formatCompact(value: number | null | undefined, locale: Locale): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  if (Math.abs(num) < 1000) return String(num)
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num)
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Round-trip time from the DNS client / query logs, in milliseconds. */
export function formatRtt(ms: number | null | undefined, locale: Locale): string {
  const value = Number(ms)
  if (!Number.isFinite(value)) return '—'
  if (value < 1) return `${value.toFixed(2)} ms`
  if (value < 1000) return `${value.toFixed(value < 10 ? 1 : 0)} ms`
  return locale === 'zh' ? `${(value / 1000).toFixed(2)} 秒` : `${(value / 1000).toFixed(2)} s`
}

// ------------------------------------------------------------------------ TTL

/**
 * TTL seconds -> `1h 30m`. Technitium also returns a pre-rendered `ttlString`;
 * prefer that when present so the UI matches the server's own rendering.
 */
export function formatTtl(seconds: number | null | undefined, preRendered?: string | null): string {
  if (preRendered && preRendered.trim()) return preRendered.trim()
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value === 0) return '0s'

  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (secs || parts.length === 0) parts.push(`${secs}s`)
  return parts.slice(0, 3).join(' ')
}

/** `1h 30m` / `90` -> seconds, for TTL inputs that accept both. */
export function parseTtl(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)

  const pattern = /(\d+)\s*([dhmsw])/g
  let total = 0
  let matched = false
  for (const m of text.matchAll(pattern)) {
    matched = true
    const n = Number(m[1])
    switch (m[2]) {
      case 'w':
        total += n * 604800
        break
      case 'd':
        total += n * 86400
        break
      case 'h':
        total += n * 3600
        break
      case 'm':
        total += n * 60
        break
      default:
        total += n
    }
  }
  return matched ? total : null
}

// ------------------------------------------------------------------------ DNS

/** Trim a trailing root dot for display; keep it internally. */
export function displayDomain(name: string | null | undefined): string {
  if (!name) return '—'
  const trimmed = name.trim()
  if (trimmed === '.') return '.'
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed
}

/** Shorten a long FQDN keeping the head and tail: `www.…​.example.com`. */
export function shortenDomain(name: string, max = 42): string {
  if (name.length <= max) return name
  const keep = Math.floor((max - 1) / 2)
  return `${name.slice(0, keep)}…${name.slice(-keep)}`
}

/** Split a record name into the label to emphasise and its zone. */
export function splitRecordName(name: string, zone: string): { label: string; zone: string } {
  const lower = name.toLowerCase()
  const zoneLower = zone.toLowerCase()
  if (lower === zoneLower || lower === `@${zoneLower}`) return { label: '@', zone }
  const suffix = `.${zoneLower}`
  if (lower.endsWith(suffix)) return { label: name.slice(0, name.length - suffix.length), zone }
  return { label: name, zone }
}

/** Mask a secret for display, keeping only enough to identify it. */
export function maskSecret(value: string | null | undefined, keep = 4): string {
  if (!value) return '—'
  if (value.length <= keep * 2) return '•'.repeat(value.length)
  return `${value.slice(0, keep)}${'•'.repeat(8)}${value.slice(-keep)}`
}

/**
 * Hex digests (DNSSEC DS records, token fingerprints) are unreadable as one
 * 64-char run. Group into 4-char blocks the way `dig` prints them.
 */
export function formatDigest(digest: string | null | undefined): string {
  if (!digest) return '—'
  return digest.replace(/(.{4})/g, '$1 ').trim()
}
