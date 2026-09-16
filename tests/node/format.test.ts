import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  displayDomain,
  formatBytes,
  formatChartTime,
  formatCompact,
  formatDateTime,
  formatDateOnly,
  formatDigest,
  formatDurationMs,
  formatDurationParts,
  formatDurationSeconds,
  formatNumber,
  formatPercent,
  formatRelative,
  formatRtt,
  formatTimeOnly,
  formatTtl,
  formatUptime,
  isNeverTimestamp,
  maskSecret,
  parseTimestamp,
  parseTtl,
  shortenDomain,
  splitRecordName,
} from '@/lib/format'
import type { Locale } from '@/lib/i18n/config'

/**
 * Every string a table cell, a card or a tooltip shows.
 *
 * These functions are pure and run hundreds of times per render, so they cannot
 * ask the caller anything: they take the locale explicitly and must produce the
 * same output on a laptop in Shanghai and on a CI runner in UTC. That is why the
 * timezone is pinned at the top of this file — `date-fns` renders in the host's
 * local zone, and an unpinned test passes locally and fails on the runner (or
 * the other way round), which is exactly how a "the timestamps are all off by
 * eight hours" bug reaches production.
 *
 * The project ships zh and en locales, so both are asserted everywhere even where
 * the output is identical: `formatDateTime` uses an explicit `yyyy-MM-dd`
 * pattern and therefore *must* agree across locales, while `formatRelative` and
 * `formatCompact` must *not*. Pinning both directions keeps a locale from being
 * dropped off a call site unnoticed.
 *
 * `maskSecret` is the one function here with a security property: a short secret
 * that is only partly masked is not masked at all, so the "fully obscured below
 * 2*keep characters" rule is asserted for every length up to the threshold.
 */

const ORIGINAL_TZ = process.env.TZ
vi.stubEnv('TZ', 'UTC')

/** Fixed "now" so relative and uptime output cannot drift with the wall clock. */
const NOW = Date.parse('2026-01-01T12:00:00.000Z')

const LOCALES: Locale[] = ['zh', 'en']

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString()
}

afterAll(() => {
  vi.unstubAllEnvs()
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseTimestamp', () => {
  it('truncates the seven fractional digits .NET emits', () => {
    const parsed = parseTimestamp('2026-01-01T12:00:00.1234567Z')
    expect(parsed).toBeInstanceOf(Date)
    expect(parsed?.toISOString()).toBe('2026-01-01T12:00:00.123Z')
    expect(parsed?.getMilliseconds()).toBe(123)
  })

  it('accepts the fractional-digit counts the upstream actually sends', () => {
    expect(parseTimestamp('2026-01-01T12:00:00.1Z')?.toISOString()).toBe('2026-01-01T12:00:00.100Z')
    expect(parseTimestamp('2026-01-01T12:00:00.12Z')?.toISOString()).toBe('2026-01-01T12:00:00.120Z')
    expect(parseTimestamp('2026-01-01T12:00:00.123Z')?.toISOString()).toBe('2026-01-01T12:00:00.123Z')
    expect(parseTimestamp('2026-01-01T12:00:00.1234567Z')?.toISOString()).toBe('2026-01-01T12:00:00.123Z')
  })

  it('reads a timestamp with no designator as local time', () => {
    // Technitium omits the `Z` on some endpoints; with TZ pinned to UTC the
    // instant is unambiguous, and this is the behaviour the UI relies on.
    expect(parseTimestamp('2026-01-01T12:00:00')?.toISOString()).toBe('2026-01-01T12:00:00.000Z')
    expect(parseTimestamp('2026-01-01T12:00:00.1234567')?.toISOString()).toBe('2026-01-01T12:00:00.123Z')
  })

  it('honours an explicit UTC offset', () => {
    expect(parseTimestamp('2026-01-01T20:00:00+08:00')?.toISOString()).toBe('2026-01-01T12:00:00.000Z')
    expect(parseTimestamp('2026-01-01T07:00:00-05:00')?.toISOString()).toBe('2026-01-01T12:00:00.000Z')
  })

  it('accepts a date-only value and a bare time-less midnight', () => {
    expect(parseTimestamp('2026-01-01')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseTimestamp('  2026-01-01T12:00:00Z  ')?.toISOString()).toBe('2026-01-01T12:00:00.000Z')
  })

  it('returns null for empty, blank and absent input', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('   ')).toBeNull()
  })

  it('returns null for a string that is not a timestamp', () => {
    for (const value of ['not a date', 'never', '12:00:00', '2026-13-01T00:00:00Z', '0000-00-00']) {
      expect(parseTimestamp(value), value).toBeNull()
    }
  })
})

describe('isNeverTimestamp', () => {
  /**
   * .NET's `DateTime.MinValue`, the value Technitium sends for "has never
   * happened". The reason this helper exists at all is asserted first: the
   * sentinel is a *valid* ISO date, so `parseTimestamp` accepts it and every
   * relative formatter downstream would report a two-millennium-old interval.
   * If that ever stops being true the helper is dead weight and this test
   * should say so.
   */
  it('recognises a sentinel that parseTimestamp would happily accept', () => {
    const sentinel = '0001-01-01T00:00:00'
    expect(parseTimestamp(sentinel)).toBeInstanceOf(Date)
    expect(isNeverTimestamp(sentinel)).toBe(true)
  })

  it('matches both spellings the stock console compares against', () => {
    // `.probe/console-js/zone.js:4180` tests the bare form and `:4187` tests
    // the `Z` form, so upstream itself treats these two as the same value.
    expect(isNeverTimestamp('0001-01-01T00:00:00')).toBe(true)
    expect(isNeverTimestamp('0001-01-01T00:00:00Z')).toBe(true)
  })

  it('matches the sentinel with any fractional-digit count', () => {
    for (const value of [
      '0001-01-01T00:00:00.0Z',
      '0001-01-01T00:00:00.000Z',
      '0001-01-01T00:00:00.0000000',
      '0001-01-01T00:00:00.0000000Z',
    ]) {
      expect(isNeverTimestamp(value), value).toBe(true)
    }
  })

  it('trims surrounding whitespace before matching', () => {
    expect(isNeverTimestamp('  0001-01-01T00:00:00  ')).toBe(true)
  })

  it('treats an absent value as never', () => {
    expect(isNeverTimestamp(null)).toBe(true)
    expect(isNeverTimestamp(undefined)).toBe(true)
    expect(isNeverTimestamp('')).toBe(true)
    expect(isNeverTimestamp('   ')).toBe(true)
  })

  it('does not swallow a real timestamp', () => {
    for (const value of [
      '2026-09-11T15:31:04.0716181Z',
      '2026-01-01T12:00:00Z',
      '1970-01-01T00:00:00Z',
      // Year 1 but not the sentinel: only the exact midnight form means
      // "never", so an off-by-a-second year-1 date stays a date. No real
      // upstream response produces one; this pins the boundary of the rule.
      '0001-01-01T00:00:01',
      '0001-01-02T00:00:00',
    ]) {
      expect(isNeverTimestamp(value), value).toBe(false)
    }
  })
})

describe('formatDateTime / formatDateOnly / formatTimeOnly', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  it('renders an absolute timestamp identically in both locales', () => {
    // The pattern is spelled out (`yyyy-MM-dd HH:mm:ss`) rather than taken from
    // the locale, so a Chinese and an English console show the same instant the
    // same way. Asserting the equality is the point: a switch to `formatStyle`
    // would silently diverge.
    for (const locale of LOCALES) {
      expect(formatDateTime('2026-01-01T12:00:00.1234567Z', locale), locale).toBe('2026-01-01 12:00:00')
    }
  })

  it('drops the seconds when asked', () => {
    expect(formatDateTime('2026-01-01T12:00:00Z', 'zh', false)).toBe('2026-01-01 12:00')
    expect(formatDateTime('2026-01-01T12:00:00Z', 'en', false)).toBe('2026-01-01 12:00')
  })

  it('renders in the pinned zone, not the host zone', () => {
    // A server in UTC+8 answering at 20:00 local must read 12:00 here; if this
    // ever depends on the machine the test suite is lying.
    expect(formatDateTime('2026-01-01T20:00:00+08:00', 'zh')).toBe('2026-01-01 12:00:00')
    expect(formatTimeOnly('2026-01-01T20:00:00+08:00', 'zh')).toBe('12:00:00')
  })

  it('formats the date and the time halves on their own', () => {
    for (const locale of LOCALES) {
      expect(formatDateOnly('2026-01-01T12:00:00Z', locale), locale).toBe('2026-01-01')
      expect(formatTimeOnly('2026-01-01T12:00:00Z', locale), locale).toBe('12:00:00')
    }
  })

  it('pads single-digit months, days and hours', () => {
    expect(formatDateTime('2026-03-05T04:05:06Z', 'zh')).toBe('2026-03-05 04:05:06')
    expect(formatDateOnly('2026-03-05T04:05:06Z', 'en')).toBe('2026-03-05')
    expect(formatTimeOnly('2026-03-05T04:05:06Z', 'en')).toBe('04:05:06')
  })

  it('falls back to an em dash for a value it cannot read', () => {
    for (const locale of LOCALES) {
      expect(formatDateTime(null, locale), locale).toBe('—')
      expect(formatDateTime(undefined, locale)).toBe('—')
      expect(formatDateTime('not a date', locale)).toBe('—')
      expect(formatDateOnly('', locale)).toBe('—')
      expect(formatTimeOnly(null, locale)).toBe('—')
    }
  })
})

describe('formatChartTime', () => {
  const DAY = 86_400_000
  const HOUR = 3_600_000

  it('shows clock time inside a sub-day window', () => {
    for (const locale of LOCALES) {
      expect(formatChartTime('2026-01-01T12:00:00.0000000Z', locale, HOUR, 60_000), locale).toBe('12:00')
      // Exactly one day still reads as a clock: the points are hours apart.
      expect(formatChartTime('2026-01-01T12:00:00Z', locale, DAY, HOUR), locale).toBe('12:00')
    }
  })

  it('adds the date once the window spans days', () => {
    for (const locale of LOCALES) {
      expect(formatChartTime('2026-01-01T12:00:00Z', locale, 3 * DAY, HOUR), locale).toBe('01-01 12:00')
    }
  })

  it('drops the midnight time when sampling is coarser than a day', () => {
    for (const locale of LOCALES) {
      expect(formatChartTime('2026-01-01T00:00:00Z', locale, 7 * DAY, DAY), locale).toBe('01-01')
    }
  })

  it('widens to year-month for windows over a year', () => {
    for (const locale of LOCALES) {
      expect(formatChartTime('2026-01-01T00:00:00Z', locale, 400 * DAY, DAY), locale).toBe('2026-01')
    }
  })

  it('passes an unparseable label through instead of dashing it', () => {
    // One odd tick is less damaging than a whole axis of em dashes.
    expect(formatChartTime('not a date', 'zh', DAY, HOUR)).toBe('not a date')
  })
})

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  it('says "just now" for anything under five seconds', () => {
    expect(formatRelative(iso(0), 'zh')).toBe('刚刚')
    expect(formatRelative(iso(0), 'en')).toBe('just now')
    expect(formatRelative(iso(1_000), 'zh')).toBe('刚刚')
    expect(formatRelative(iso(4_999), 'en')).toBe('just now')
  })

  it('switches to a distance at exactly five seconds', () => {
    expect(formatRelative(iso(5_000), 'zh')).toBe('5 秒前')
    expect(formatRelative(iso(5_000), 'en')).toBe('5 seconds ago')
  })

  it('renders seconds, minutes, hours, days and months', () => {
    const cases: [number, string, string][] = [
      [30_000, '30 秒前', '30 seconds ago'],
      [90_000, '2 分钟前', '2 minutes ago'],
      [3 * 3_600_000, '3 小时前', '3 hours ago'],
      [2 * 86_400_000, '2 天前', '2 days ago'],
      [40 * 86_400_000, '1 个月前', '1 month ago'],
    ]
    for (const [ms, zh, en] of cases) {
      expect(formatRelative(iso(ms), 'zh'), `${ms}ms zh`).toBe(zh)
      expect(formatRelative(iso(ms), 'en'), `${ms}ms en`).toBe(en)
    }
  })

  it('differs between the two locales, proving the locale reaches date-fns', () => {
    expect(formatRelative(iso(90_000), 'zh')).not.toBe(formatRelative(iso(90_000), 'en'))
  })

  it('shows an absolute time for a clock that is ahead of ours', () => {
    // A server whose clock runs fast must not render "-1 minutes ago".
    expect(formatRelative(iso(-3_600_000), 'zh')).toBe('2026-01-01 13:00')
    expect(formatRelative(iso(-3_600_000), 'en')).toBe('2026-01-01 13:00')
  })

  it('falls back to an em dash for a missing or unreadable value', () => {
    for (const locale of LOCALES) {
      expect(formatRelative(null, locale), locale).toBe('—')
      expect(formatRelative(undefined, locale)).toBe('—')
      expect(formatRelative('', locale)).toBe('—')
      expect(formatRelative('never', locale)).toBe('—')
    }
  })
})

describe('formatUptime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  it('reads a .NET TimeSpan with days, hours, minutes, seconds and a fraction', () => {
    expect(formatUptime('3.04:12:33.5', 'zh')).toBe('3 天 4 小时 12 分')
    expect(formatUptime('3.04:12:33.5', 'en')).toBe('3d 4h 12m')
  })

  it('reads a TimeSpan without days and without seconds', () => {
    expect(formatUptime('04:12', 'zh')).toBe('4 小时 12 分')
    expect(formatUptime('04:12', 'en')).toBe('4h 12m')
    expect(formatUptime('00:00:59', 'zh')).toBe('59 秒')
    expect(formatUptime('00:00:59', 'en')).toBe('59s')
  })

  it('renders a whole day and a zero uptime', () => {
    expect(formatUptime('1.00:00:00', 'zh')).toBe('1 天')
    expect(formatUptime('1.00:00:00', 'en')).toBe('1d')
    expect(formatUptime('00:00:00', 'zh')).toBe('0 秒')
    expect(formatUptime('00:00:00', 'en')).toBe('0s')
  })

  it('falls back to an elapsed duration for an ISO start time', () => {
    expect(formatUptime('2026-01-01T11:00:00Z', 'zh')).toBe('1 小时')
    expect(formatUptime('2026-01-01T11:00:00Z', 'en')).toBe('1h')
    expect(formatUptime('2025-12-31T12:00:00Z', 'en')).toBe('1d')
  })

  it('clamps a start time in the future to zero instead of going negative', () => {
    expect(formatUptime('2026-01-01T13:00:00Z', 'zh')).toBe('0 秒')
    expect(formatUptime('2026-01-01T13:00:00Z', 'en')).toBe('0s')
  })

  it('passes an unrecognised string through so the UI shows what the server said', () => {
    expect(formatUptime('since Tuesday', 'zh')).toBe('since Tuesday')
    expect(formatUptime('  since Tuesday  ', 'en')).toBe('since Tuesday')
  })

  it('returns an em dash when there is no value', () => {
    for (const locale of LOCALES) {
      expect(formatUptime(null, locale), locale).toBe('—')
      expect(formatUptime(undefined, locale)).toBe('—')
      expect(formatUptime('', locale)).toBe('—')
    }
  })
})

describe('formatDurationParts', () => {
  it('shows at most the three largest non-zero units', () => {
    expect(formatDurationParts({ days: 1, hours: 2, minutes: 3, seconds: 4 }, 'zh')).toBe('1 天 2 小时 3 分')
    expect(formatDurationParts({ days: 1, hours: 2, minutes: 3, seconds: 4 }, 'en')).toBe('1d 2h 3m')
  })

  it('skips zero units instead of padding with them', () => {
    expect(formatDurationParts({ days: 1, seconds: 2 }, 'zh')).toBe('1 天 2 秒')
    expect(formatDurationParts({ days: 1, seconds: 2 }, 'en')).toBe('1d 2s')
    expect(formatDurationParts({ hours: 0, minutes: 0, seconds: 5 }, 'en')).toBe('5s')
  })

  it('renders a zero duration as zero seconds, not as an empty string', () => {
    expect(formatDurationParts({}, 'zh')).toBe('0 秒')
    expect(formatDurationParts({}, 'en')).toBe('0s')
    expect(formatDurationParts({ seconds: 0 }, 'zh')).toBe('0 秒')
    expect(formatDurationParts({ days: 0, hours: 0, minutes: 0, seconds: 0 }, 'en')).toBe('0s')
  })

  it('ignores negative parts', () => {
    expect(formatDurationParts({ days: -1, hours: -5 }, 'zh')).toBe('0 秒')
    expect(formatDurationParts({ days: -1, minutes: 30 }, 'en')).toBe('30m')
  })

  it('handles a large day count without a year unit', () => {
    expect(formatDurationParts({ days: 365 }, 'zh')).toBe('365 天')
    expect(formatDurationParts({ days: 365 }, 'en')).toBe('365d')
  })

  it('differs between the two locales', () => {
    expect(formatDurationParts({ minutes: 1, seconds: 30 }, 'zh')).toBe('1 分 30 秒')
    expect(formatDurationParts({ minutes: 1, seconds: 30 }, 'en')).toBe('1m 30s')
  })
})

describe('formatDurationMs / formatDurationSeconds', () => {
  it('maps the boundaries between seconds, minutes, hours and days', () => {
    const cases: [number, string, string][] = [
      [0, '0 秒', '0s'],
      [999, '0 秒', '0s'],
      [1_000, '1 秒', '1s'],
      [59_000, '59 秒', '59s'],
      [60_000, '1 分', '1m'],
      [3_599_000, '59 分 59 秒', '59m 59s'],
      [3_600_000, '1 小时', '1h'],
      [86_399_000, '23 小时 59 分 59 秒', '23h 59m 59s'],
      [86_400_000, '1 天', '1d'],
    ]
    for (const [ms, zh, en] of cases) {
      expect(formatDurationMs(ms, 'zh'), `${ms}ms zh`).toBe(zh)
      expect(formatDurationMs(ms, 'en'), `${ms}ms en`).toBe(en)
    }
  })

  it('truncates rather than rounds', () => {
    expect(formatDurationMs(1_999, 'en')).toBe('1s')
    expect(formatDurationMs(119_999, 'en')).toBe('1m 59s')
  })

  it('drops the seconds once four units are in play', () => {
    // `slice(0, 3)` costs a second of precision on long durations; pinned so the
    // loss is a decision on the record rather than a surprise in a diff.
    expect(formatDurationMs(90_061_000, 'zh')).toBe('1 天 1 小时 1 分')
    expect(formatDurationMs(90_061_000, 'en')).toBe('1d 1h 1m')
  })

  it('clamps a negative duration to zero', () => {
    expect(formatDurationMs(-1, 'zh')).toBe('0 秒')
    expect(formatDurationMs(-86_400_000, 'en')).toBe('0s')
    expect(formatDurationSeconds(-5, 'en')).toBe('0s')
  })

  it('handles a very large duration', () => {
    expect(formatDurationSeconds(315_360_000, 'zh')).toBe('3650 天')
    expect(formatDurationSeconds(315_360_000, 'en')).toBe('3650d')
  })

  it('accepts seconds and truncates a fractional one', () => {
    expect(formatDurationSeconds(0, 'en')).toBe('0s')
    expect(formatDurationSeconds(90, 'zh')).toBe('1 分 30 秒')
    expect(formatDurationSeconds(3_600, 'en')).toBe('1h')
    expect(formatDurationSeconds(1.5, 'en')).toBe('1s')
  })
})

describe('formatBytes', () => {
  it('renders zero, sub-kilobyte and exact powers of 1024', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
    expect(formatBytes(1024 ** 5)).toBe('1.0 PB')
  })

  it('keeps one decimal by default and never decimals on whole bytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1572864)).toBe('1.5 MB')
    // Bytes are integers; `1023.7 B` would be noise in a table column.
    expect(formatBytes(1023.7)).toBe('1024 B')
    expect(formatBytes(512.4)).toBe('512 B')
  })

  it('honours an explicit precision', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB')
    expect(formatBytes(1536, 0)).toBe('2 KB')
    expect(formatBytes(1536, 3)).toBe('1.500 KB')
  })

  it('stops at petabytes instead of running off the unit table', () => {
    expect(formatBytes(1e18)).toBe('888.2 PB')
    expect(formatBytes(2 * 1024 ** 5)).toBe('2.0 PB')
    expect(formatBytes(1024 ** 6)).toBe('1024.0 PB')
  })

  it('renders a negative, null or non-finite size as zero', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(-1024)).toBe('0 B')
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('formatNumber', () => {
  it('groups thousands the same way in both locales', () => {
    // zh-CN and en-US share the comma group separator, so a difference here
    // would mean someone switched to a locale-specific pattern.
    for (const locale of LOCALES) {
      expect(formatNumber(1234567, locale), locale).toBe('1,234,567')
      expect(formatNumber(0, locale)).toBe('0')
      expect(formatNumber(-1234, locale)).toBe('-1,234')
      expect(formatNumber(999, locale)).toBe('999')
      expect(formatNumber(1000, locale)).toBe('1,000')
    }
  })

  it('rounds a fraction to three digits', () => {
    expect(formatNumber(1234.5678, 'zh')).toBe('1,234.568')
    expect(formatNumber(1234.5678, 'en')).toBe('1,234.568')
    expect(formatNumber(0.5, 'en')).toBe('0.5')
  })

  it('renders a non-finite value as an em dash', () => {
    for (const locale of LOCALES) {
      expect(formatNumber(undefined, locale), locale).toBe('—')
      expect(formatNumber(Number.NaN, locale)).toBe('—')
      expect(formatNumber(Number.POSITIVE_INFINITY, locale)).toBe('—')
    }
  })

  it('renders null as zero, which is not the same as undefined', () => {
    // `Number(null)` is 0 and 0 is finite, so an absent count reads as "no
    // queries" rather than "unknown". Documented because the two are easy to
    // conflate at a call site.
    expect(formatNumber(null, 'zh')).toBe('0')
    expect(formatNumber(null, 'en')).toBe('0')
    expect(formatNumber(undefined, 'en')).toBe('—')
  })
})

describe('formatCompact', () => {
  it('leaves small counts alone', () => {
    for (const locale of LOCALES) {
      expect(formatCompact(0, locale), locale).toBe('0')
      expect(formatCompact(1, locale)).toBe('1')
      expect(formatCompact(999, locale)).toBe('999')
      expect(formatCompact(-999, locale)).toBe('-999')
      expect(formatCompact(0.5, locale)).toBe('0.5')
    }
  })

  it('uses 万 and 亿 for Chinese and K, M, B for English', () => {
    const cases: [number, string, string][] = [
      [1000, '1000', '1K'],
      [1200, '1200', '1.2K'],
      [10_000, '1万', '10K'],
      [12_400, '1.2万', '12.4K'],
      [100_000, '10万', '100K'],
      [999_999, '100万', '1M'],
      [3_100_000, '310万', '3.1M'],
      [123_456_789, '1.2亿', '123.5M'],
      [1_000_000_000, '10亿', '1B'],
      [-1500, '-1500', '-1.5K'],
    ]
    for (const [value, zh, en] of cases) {
      expect(formatCompact(value, 'zh'), `${value} zh`).toBe(zh)
      expect(formatCompact(value, 'en'), `${value} en`).toBe(en)
    }
  })

  it('renders a non-finite value as an em dash, and null as zero', () => {
    for (const locale of LOCALES) {
      expect(formatCompact(undefined, locale), locale).toBe('—')
      expect(formatCompact(Number.NaN, locale)).toBe('—')
      expect(formatCompact(null, locale)).toBe('0')
    }
  })
})

describe('formatPercent', () => {
  it('keeps one decimal by default', () => {
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(0.5)).toBe('0.5%')
    expect(formatPercent(100)).toBe('100.0%')
    expect(formatPercent(12.3456)).toBe('12.3%')
  })

  it('does not clamp a percentage above one hundred', () => {
    // Cache hit ratios and growth figures both exceed 100% in practice.
    expect(formatPercent(150)).toBe('150.0%')
    expect(formatPercent(1234.5)).toBe('1234.5%')
  })

  it('renders a negative percentage', () => {
    expect(formatPercent(-5)).toBe('-5.0%')
    expect(formatPercent(-0.04)).toBe('-0.0%')
  })

  it('honours an explicit precision', () => {
    expect(formatPercent(12.3456, 2)).toBe('12.35%')
    expect(formatPercent(50, 0)).toBe('50%')
    expect(formatPercent(100 / 3, 3)).toBe('33.333%')
  })

  it('renders a non-finite value as an em dash', () => {
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—')
    // The signature takes `number`, so a nullish value arrives as NaN once the
    // caller has already coerced it; assert the coercion path too.
    expect(formatPercent(Number(null))).toBe('0.0%')
    expect(formatPercent(Number(undefined))).toBe('—')
  })
})

describe('formatRtt', () => {
  it('shows two decimals below a millisecond', () => {
    for (const locale of LOCALES) {
      expect(formatRtt(0, locale), locale).toBe('0.00 ms')
      expect(formatRtt(0.456, locale)).toBe('0.46 ms')
      expect(formatRtt(0.999, locale)).toBe('1.00 ms')
    }
  })

  it('shows one decimal under ten milliseconds and none above', () => {
    for (const locale of LOCALES) {
      expect(formatRtt(1, locale), locale).toBe('1.0 ms')
      expect(formatRtt(9.876, locale)).toBe('9.9 ms')
      expect(formatRtt(10, locale)).toBe('10 ms')
      expect(formatRtt(234.4, locale)).toBe('234 ms')
      expect(formatRtt(999, locale)).toBe('999 ms')
    }
  })

  it('switches to seconds at one thousand milliseconds', () => {
    expect(formatRtt(1000, 'zh')).toBe('1.00 秒')
    expect(formatRtt(1000, 'en')).toBe('1.00 s')
    expect(formatRtt(1500, 'zh')).toBe('1.50 秒')
    expect(formatRtt(1500, 'en')).toBe('1.50 s')
  })

  it('renders a resolver timeout in seconds, not in four-digit milliseconds', () => {
    expect(formatRtt(5000, 'zh')).toBe('5.00 秒')
    expect(formatRtt(30_000, 'en')).toBe('30.00 s')
  })

  it('renders a non-finite value as an em dash', () => {
    for (const locale of LOCALES) {
      expect(formatRtt(undefined, locale), locale).toBe('—')
      expect(formatRtt(Number.NaN, locale)).toBe('—')
    }
  })

  it('renders null as a zero measurement, not as unknown', () => {
    // `Number(null)` is 0 and 0 is finite: a query that never got an answer must
    // be sent as `undefined`, not `null`, or it reads as an instant reply.
    expect(formatRtt(null, 'zh')).toBe('0.00 ms')
    expect(formatRtt(null, 'en')).toBe('0.00 ms')
  })

  it('keeps a negative value in milliseconds', () => {
    expect(formatRtt(-1, 'en')).toBe('-1.00 ms')
  })
})

describe('formatTtl / parseTtl', () => {
  it('prefers the string the server already rendered', () => {
    expect(formatTtl(3600, '1h')).toBe('1h')
    expect(formatTtl(null, '2h 30m')).toBe('2h 30m')
    expect(formatTtl(90, '  1m 30s  ')).toBe('1m 30s')
  })

  it('ignores a blank pre-rendered string', () => {
    expect(formatTtl(3600, '   ')).toBe('1h')
    expect(formatTtl(3600, '')).toBe('1h')
    expect(formatTtl(3600, null)).toBe('1h')
  })

  it('renders the unit boundaries', () => {
    const cases: [number, string][] = [
      [0, '0s'],
      [1, '1s'],
      [59, '59s'],
      [60, '1m'],
      [61, '1m 1s'],
      [90, '1m 30s'],
      [3599, '59m 59s'],
      [3600, '1h'],
      [3661, '1h 1m 1s'],
      [86399, '23h 59m 59s'],
      [86400, '1d'],
      [90000, '1d 1h'],
    ]
    for (const [seconds, expected] of cases) {
      expect(formatTtl(seconds), `${seconds}s`).toBe(expected)
    }
  })

  it('drops the seconds once four units are in play', () => {
    // `slice(0, 3)` again: `1d 1h 1m 1s` renders as `1d 1h 1m`, so the value no
    // longer round-trips through `parseTtl`. Pinned deliberately.
    expect(formatTtl(90061)).toBe('1d 1h 1m')
    expect(parseTtl(formatTtl(90061))).toBe(90060)
  })

  it('renders a negative or unreadable TTL as an em dash', () => {
    expect(formatTtl(-1)).toBe('—')
    expect(formatTtl(-3600)).toBe('—')
    expect(formatTtl(Number.NaN)).toBe('—')
    expect(formatTtl(undefined)).toBe('—')
  })

  it('renders null as zero because Number(null) is zero', () => {
    expect(formatTtl(null)).toBe('0s')
  })

  it('keeps a fractional second', () => {
    expect(formatTtl(1.5)).toBe('1.5s')
    expect(formatTtl(90.5)).toBe('1m 30.5s')
  })

  it('parses a bare number of seconds', () => {
    expect(parseTtl('3600')).toBe(3600)
    expect(parseTtl('0')).toBe(0)
    expect(parseTtl('  90  ')).toBe(90)
  })

  it('parses unit suffixes, case-insensitively and with or without spaces', () => {
    expect(parseTtl('1h')).toBe(3600)
    expect(parseTtl('1H')).toBe(3600)
    expect(parseTtl('1h30m')).toBe(5400)
    expect(parseTtl('1h 30m')).toBe(5400)
    expect(parseTtl('1m 30s')).toBe(90)
    expect(parseTtl('1d')).toBe(86400)
    expect(parseTtl('1w')).toBe(604800)
    expect(parseTtl('1d 2h 3m 4s')).toBe(93784)
  })

  it('returns null for an empty or unparseable input', () => {
    expect(parseTtl('')).toBeNull()
    expect(parseTtl('   ')).toBeNull()
    expect(parseTtl('abc')).toBeNull()
    expect(parseTtl('1x')).toBeNull()
    expect(parseTtl('-5')).toBeNull()
    expect(parseTtl('h')).toBeNull()
  })

  it('silently drops a trailing bare number', () => {
    // `1h 30` reads as one hour, not as 1h30s: the operator's intent is lost.
    // Recorded rather than fixed, since changing it would also change `1h 30m`.
    expect(parseTtl('1h 30')).toBe(3600)
  })

  it('reads a decimal suffix from the wrong end', () => {
    // `1.5h` matches the `5h` at the end and ignores the `1.` — five hours, not
    // ninety minutes. Pinned so the trap is visible; the form rejects decimals.
    expect(parseTtl('1.5h')).toBe(18000)
  })

  it('round-trips every TTL that renders in three units or fewer', () => {
    for (const seconds of [0, 1, 59, 60, 61, 90, 3599, 3600, 3661, 86399, 86400, 90000, 604800]) {
      expect(parseTtl(formatTtl(seconds)), `${seconds}s`).toBe(seconds)
    }
  })
})

describe('displayDomain', () => {
  it('strips a trailing root dot for display', () => {
    expect(displayDomain('example.com.')).toBe('example.com')
    expect(displayDomain('www.example.com.')).toBe('www.example.com')
  })

  it('leaves a name without a dot alone', () => {
    expect(displayDomain('example.com')).toBe('example.com')
    expect(displayDomain('localhost')).toBe('localhost')
  })

  it('keeps the root itself as a dot', () => {
    // The root zone has no other readable name; blanking it would hide the zone.
    expect(displayDomain('.')).toBe('.')
  })

  it('strips only one dot', () => {
    expect(displayDomain('example.com..')).toBe('example.com.')
  })

  it('trims whitespace around the name', () => {
    expect(displayDomain('  example.com.  ')).toBe('example.com')
  })

  it('renders a missing name as an em dash', () => {
    expect(displayDomain(null)).toBe('—')
    expect(displayDomain(undefined)).toBe('—')
    expect(displayDomain('')).toBe('—')
    // A whitespace-only name is truthy, so it trims to an empty string rather
    // than to the placeholder. Callers pass real names or null.
    expect(displayDomain('   ')).toBe('')
  })

  it('passes the apex placeholder through', () => {
    expect(displayDomain('@')).toBe('@')
  })
})

describe('shortenDomain', () => {
  it('returns a short name unchanged', () => {
    expect(shortenDomain('example.com')).toBe('example.com')
    expect(shortenDomain('a'.repeat(42))).toBe('a'.repeat(42))
  })

  it('keeps the head and the tail of a long name', () => {
    const name = 'very-long-label.another-long-label.sub.example.com'
    const out = shortenDomain(name)
    expect(out.length).toBe(41)
    expect(out).toBe(`${name.slice(0, 20)}…${name.slice(-20)}`)
    expect(out.startsWith('very-long-label.anot')).toBe(true)
    expect(out.endsWith('g-label.sub.example.com'.slice(-20))).toBe(true)
  })

  it('shortens by exactly one character past the limit', () => {
    const name = 'a'.repeat(43)
    const out = shortenDomain(name)
    expect(out).toBe(`${'a'.repeat(20)}…${'a'.repeat(20)}`)
    expect(out.length).toBe(41)
  })

  it('honours a custom maximum', () => {
    expect(shortenDomain('abcdefghij', 5)).toBe('ab…ij')
    expect(shortenDomain('abcd', 5)).toBe('abcd')
    expect(shortenDomain('abcdefghij', 10)).toBe('abcdefghij')
  })

  it('grows the name when the maximum leaves no room for either end', () => {
    // `keep` floors to 0 below a maximum of 3, and `slice(-0)` is `slice(0)`, so
    // the whole name comes back *after* the ellipsis. Pinned as a known wart:
    // every call site passes the default 42, and a limit under 3 is meaningless
    // for a domain name anyway. Reported rather than fixed.
    expect(shortenDomain('abcdef', 1)).toBe('…abcdef')
    expect(shortenDomain('abcdef', 2)).toBe('…abcdef')
    expect(shortenDomain('abcdef', 3)).toBe('a…f')
  })

  it('handles a full-length 253-character name', () => {
    const label = 'a'.repeat(63)
    const name = `${label}.${label}.${label}.${label}`.slice(0, 253)
    const out = shortenDomain(name)
    expect(out.length).toBe(41)
    expect(out.includes('…')).toBe(true)
    expect(name.startsWith(out.slice(0, 20))).toBe(true)
  })
})

describe('splitRecordName', () => {
  it('marks the zone apex with an at sign', () => {
    expect(splitRecordName('example.com', 'example.com')).toEqual({ label: '@', zone: 'example.com' })
    expect(splitRecordName('@example.com', 'example.com')).toEqual({ label: '@', zone: 'example.com' })
  })

  it('splits a single label and a multi-label name', () => {
    expect(splitRecordName('www.example.com', 'example.com')).toEqual({ label: 'www', zone: 'example.com' })
    expect(splitRecordName('a.b.c.example.com', 'example.com')).toEqual({ label: 'a.b.c', zone: 'example.com' })
    expect(splitRecordName('_dmarc.example.com', 'example.com')).toEqual({ label: '_dmarc', zone: 'example.com' })
  })

  it('matches the zone case-insensitively but keeps the operator casing in the label', () => {
    expect(splitRecordName('WWW.Example.COM', 'example.com')).toEqual({ label: 'WWW', zone: 'example.com' })
    expect(splitRecordName('EXAMPLE.COM', 'example.com')).toEqual({ label: '@', zone: 'example.com' })
  })

  it('returns the zone exactly as it was given', () => {
    expect(splitRecordName('www.example.com.', 'example.com.')).toEqual({ label: 'www', zone: 'example.com.' })
  })

  it('leaves a name outside the zone alone', () => {
    expect(splitRecordName('other.com', 'example.com')).toEqual({ label: 'other.com', zone: 'example.com' })
    expect(splitRecordName('notexample.com', 'example.com')).toEqual({ label: 'notexample.com', zone: 'example.com' })
  })

  it('does not strip a trailing root dot from the name', () => {
    // A fully qualified name from the wire keeps its dot, so the apex is not
    // recognised and the whole FQDN is emphasised instead. Recorded, not fixed.
    expect(splitRecordName('example.com.', 'example.com')).toEqual({ label: 'example.com.', zone: 'example.com' })
    expect(splitRecordName('www.example.com.', 'example.com')).toEqual({ label: 'www.example.com.', zone: 'example.com' })
  })

  it('handles an empty name and a bare at sign', () => {
    expect(splitRecordName('', 'example.com')).toEqual({ label: '', zone: 'example.com' })
    expect(splitRecordName('@', 'example.com')).toEqual({ label: '@', zone: 'example.com' })
  })
})

describe('maskSecret', () => {
  it('fully masks anything at or below twice the kept length', () => {
    // A secret short enough to be half-revealed is a secret revealed: with the
    // default keep=4, eight characters is the threshold, so every length up to
    // it must come back as bullets only.
    for (let length = 1; length <= 8; length += 1) {
      const secret = 'abcdefgh'.slice(0, length)
      const masked = maskSecret(secret)
      expect(masked, `length ${length}`).toBe('•'.repeat(length))
      expect(masked.length, `length ${length}`).toBe(length)
      for (const char of secret) {
        expect(masked.includes(char), `length ${length} leaked '${char}'`).toBe(false)
      }
    }
  })

  it('keeps four characters at each end of a longer secret', () => {
    const secret = 'abcdefghij'
    const masked = maskSecret(secret)
    expect(masked).toBe('abcd••••••••ghij')
    expect(masked.length).toBe(16)
    expect(masked.includes('ef')).toBe(false)
    expect(masked.includes(secret)).toBe(false)
  })

  it('masks a realistic API token down to an unguessable stub', () => {
    const token = 'tdns_9f3a1c7b5e2d4860a1b2c3d4e5f60718'
    const masked = maskSecret(token)
    expect(masked).toBe('tdns••••••••0718')
    expect(masked).not.toContain('9f3a1c7b5e2d4860')
    expect(masked.length).toBeLessThan(token.length)
  })

  it('honours a custom kept length', () => {
    expect(maskSecret('abcdefghij', 2)).toBe('ab••••••••ij')
    expect(maskSecret('abcdefghij', 1)).toBe('a••••••••j')
    expect(maskSecret('abc', 2)).toBe('•••')
    expect(maskSecret('abcd', 2)).toBe('••••')
    expect(maskSecret('abcde', 2)).toBe('ab••••••••de')
  })

  it('always emits eight bullets in the middle, whatever the secret length', () => {
    // A mask whose width tracks the secret leaks its length; a fixed run does not.
    expect(maskSecret('a'.repeat(9)).length).toBe(16)
    expect(maskSecret('a'.repeat(64)).length).toBe(16)
    expect(maskSecret('a'.repeat(9))).toBe(maskSecret('a'.repeat(64)))
  })

  it('renders a missing secret as an em dash', () => {
    expect(maskSecret(null)).toBe('—')
    expect(maskSecret(undefined)).toBe('—')
    expect(maskSecret('')).toBe('—')
  })
})

describe('formatDigest', () => {
  it('groups a digest into four-character blocks', () => {
    expect(formatDigest('AABBCCDD')).toBe('AABB CCDD')
    expect(formatDigest('AABBCCDDEE')).toBe('AABB CCDD EE')
    expect(formatDigest('ABC')).toBe('ABC')
  })

  it('keeps every character and adds only separators', () => {
    const digest = 'E2D3C9167F4B9A0C5D6E7F8091A2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4'
    const out = formatDigest(digest)
    expect(out.length).toBe(digest.length + 15)
    expect(out.replace(/ /g, '')).toBe(digest)
    expect(out.split(' ')).toHaveLength(16)
    for (const block of out.split(' ')) expect(block).toHaveLength(4)
  })

  it('does not truncate or wrap, however long the digest is', () => {
    const digest = 'A'.repeat(256)
    const out = formatDigest(digest)
    expect(out.replace(/ /g, '').length).toBe(256)
    expect(out.includes('\n')).toBe(false)
  })

  it('renders a missing digest as an em dash', () => {
    expect(formatDigest(null)).toBe('—')
    expect(formatDigest(undefined)).toBe('—')
    expect(formatDigest('')).toBe('—')
  })

  it('does not change case', () => {
    expect(formatDigest('aabbccdd')).toBe('aabb ccdd')
  })
})
