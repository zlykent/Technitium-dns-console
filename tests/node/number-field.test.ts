import { describe, expect, it } from 'vitest'
import { loadMessages } from '@/lib/i18n/messages'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * The numeric-field contract shared by every dialog that sends a number to
 * Technitium (DNSSEC signing/NSEC3/TTL/private-key, and the cluster options).
 *
 * Three properties are worth pinning, and none of them are visible from the
 * module's own types:
 *
 *  1. The bounds come from *different* sources per caller and are easy to
 *     transpose: RFC 5155 keeps NSEC3 iterations/salt in a single octet (0..255),
 *     Technitium stores a TTL in a .NET `int` (1..2147483647), the cluster
 *     heartbeat/config intervals are documented ranges (10..300 and 30..3600),
 *     and the rollover period is plain operator sanity (0..3650 days). A min/max
 *     swap here would let an operator submit a value the server rejects, or
 *     reject a legal one.
 *  2. Every Technitium parameter travels in the query string, so the field holds
 *     a *string* and "empty" and "not a number" collapse into one failure. The
 *     schema must reject `-1`, `1.5`, `1e3`, hex and non-ASCII digits — anything
 *     `Number(...)` would silently coerce — while trimming surrounding spaces so
 *     the parsed value is safe to hand straight to `Number()` on submit.
 *  3. The copy is *not* in this module. `integerField` receives resolved strings
 *     via `NumberFieldMessages`; the dialogs build those from `common:form.*`. So
 *     the highest-value regression is the last block: it proves the exact keys
 *     the callers use still exist and still carry their `{min}` / `{max}`
 *     placeholders, and wires a realistic translator through the schema to show
 *     the bound reaching the real sentence.
 */

/**
 * The real bounds, named for their RFC / platform source. Tests below are
 * written against these so a transcription error surfaces as a failing case
 * rather than as a magic number nobody notices changed.
 */
const MAX_NSEC3_OCTET = 255 // RFC 5155: iterations & salt length are one octet
const MAX_TTL = 2147483647 // Technitium stores dnsKeyTtl in a .NET int
const MAX_ROLLOVER_DAYS = 3650 // operator sanity ceiling for a rollover period
const MAX_CLUSTER_CONFIG_INTERVAL = 3600 // admin/cluster/setOptions upper bound

/** A distinctive stand-in so each test can see exactly which check fired. */
const PROBE: NumberFieldMessages = {
  invalid: 'INVALID',
  tooSmall: (min) => `TOO_SMALL:${min}`,
  tooBig: (max) => `TOO_BIG:${max}`,
}

/** Every issue message a `safeParse` produced (empty when it succeeded). */
function issuesOf(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? [])
}

/** Narrow an unknown message tree one key at a time; never trust it as an object. */
function readMessage(node: unknown, path: readonly string[]): unknown {
  let current = node
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function message(locale: 'zh' | 'en', path: readonly string[]): string {
  const value = readMessage(loadMessages(locale), path)
  expect(typeof value, `${locale}:${path.join('.')} missing`).toBe('string')
  return value as string
}

describe('integerField — accepts and trims valid integers', () => {
  const nsec3 = integerField(0, MAX_NSEC3_OCTET, PROBE)

  it('accepts values inside the inclusive range', () => {
    for (const value of ['0', '1', '128', '254', '255']) {
      expect(nsec3.safeParse(value).success, `${value} should be valid`).toBe(true)
    }
  })

  it('trims surrounding whitespace and returns the trimmed string', () => {
    // The parsed value goes straight into Number(...) on submit, so it must be
    // the digits only — a leading/trailing space would make the coercion NaN.
    const result = nsec3.safeParse('  128  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('128')
  })

  it('keeps leading zeros as-is (the server parses the integer itself)', () => {
    const result = nsec3.safeParse('007')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('007')
  })
})

describe('integerField — rejects non-integers as INVALID', () => {
  const nsec3 = integerField(0, MAX_NSEC3_OCTET, PROBE)

  it('rejects empty, blank, signed, fractional and exponent forms', () => {
    // All of these are things Number(...) would coerce to a finite number; the
    // query-string contract demands the field hold a bare non-negative integer.
    for (const value of ['', '   ', '-1', '+5', '1.5', '1e3', '0x10', '12abc', 'abc']) {
      expect(issuesOf(nsec3.safeParse(value)), `${JSON.stringify(value)} should be INVALID`).toContain('INVALID')
    }
  })

  it('rejects non-ASCII digits', () => {
    // JS \d without the `u` flag matches ASCII 0-9 only, so Arabic-Indic digits
    // must not sneak through as a "number".
    expect(issuesOf(nsec3.safeParse('١٢٣'))).toContain('INVALID')
  })
})

describe('integerField — enforces both bounds with the correct value', () => {
  it('flags a value below min with TOO_SMALL carrying min', () => {
    const ttl = integerField(1, MAX_TTL, PROBE)
    // '0' passes the digit regex, so the only reason it fails is the min refine —
    // and the message must interpolate *min*, proving the bound is not swapped.
    expect(issuesOf(ttl.safeParse('0'))).toEqual(['TOO_SMALL:1'])
  })

  it('flags a value above max with TOO_BIG carrying max', () => {
    const nsec3 = integerField(0, MAX_NSEC3_OCTET, PROBE)
    expect(issuesOf(nsec3.safeParse('256'))).toEqual(['TOO_BIG:255'])
  })

  it('accepts the exact min and max boundaries (inclusive)', () => {
    expect(integerField(1, MAX_TTL, PROBE).safeParse('1').success).toBe(true)
    expect(integerField(1, MAX_TTL, PROBE).safeParse(String(MAX_TTL)).success).toBe(true)
    expect(integerField(0, MAX_NSEC3_OCTET, PROBE).safeParse('0').success).toBe(true)
    expect(integerField(0, MAX_NSEC3_OCTET, PROBE).safeParse(String(MAX_NSEC3_OCTET)).success).toBe(true)
  })

  it('rejects one past the .NET int TTL ceiling', () => {
    // 2147483648 overflows a signed 32-bit int; the server would wrap or reject.
    const ttl = integerField(1, MAX_TTL, PROBE)
    expect(issuesOf(ttl.safeParse('2147483648'))).toEqual(['TOO_BIG:2147483647'])
  })

  it('rejects a rollover period beyond the sanity ceiling', () => {
    const rollover = integerField(0, MAX_ROLLOVER_DAYS, PROBE)
    expect(rollover.safeParse('3650').success).toBe(true)
    expect(issuesOf(rollover.safeParse('3651'))).toEqual(['TOO_BIG:3650'])
  })

  it('enforces a non-zero minimum, which the cluster intervals need', () => {
    // `admin/cluster/setOptions` rejects 0 for all four intervals; a field built
    // with min 10 must say TOO_SMALL:10 rather than accept the empty-looking '0'.
    const interval = integerField(10, MAX_CLUSTER_CONFIG_INTERVAL, PROBE)
    expect(issuesOf(interval.safeParse('0'))).toEqual(['TOO_SMALL:10'])
    expect(issuesOf(interval.safeParse('9'))).toEqual(['TOO_SMALL:10'])
    expect(interval.safeParse('10').success).toBe(true)
    expect(issuesOf(interval.safeParse('3601'))).toEqual([`TOO_BIG:${MAX_CLUSTER_CONFIG_INTERVAL}`])
  })

  it('surfaces INVALID as the first issue when the digits are malformed', () => {
    // zod v4 collects every failed check rather than aborting, so a malformed
    // value also trips both bound refines (Number('abc') is NaN, which fails
    // both >= and <=). The operator sees one message per field — react-hook-form's
    // resolver surfaces the *first* issue — so the format error must be ordered
    // ahead of a misleading "too small".
    const nsec3 = integerField(0, MAX_NSEC3_OCTET, PROBE)
    expect(issuesOf(nsec3.safeParse('abc'))[0]).toBe('INVALID')
  })
})

describe('number-field copy contract — keys the dialogs wire in', () => {
  // `integerField` never sees a translation key; the dialogs resolve
  // `common:form.{invalidNumber,minValue,maxValue}` into `NumberFieldMessages`.
  // A rename in the bundle would leave the schema emitting `undefined` while
  // these unit tests, which pass their own strings, stayed green. This block
  // closes that gap.
  const locales = ['zh', 'en'] as const

  it.each(locales)('resolves common.form.invalidNumber in %s', (locale) => {
    expect(message(locale, ['common', 'form', 'invalidNumber']).length).toBeGreaterThan(0)
  })

  it.each(locales)('keeps the {min} / {max} placeholders on the bound messages in %s', (locale) => {
    // next-intl interpolates these; if the placeholder is dropped the operator
    // sees a sentence with no number, which reads as a copy bug.
    expect(message(locale, ['common', 'form', 'minValue']), `${locale}:minValue lacks {min}`).toContain('{min}')
    expect(message(locale, ['common', 'form', 'maxValue']), `${locale}:maxValue lacks {max}`).toContain('{max}')
  })

  it('emits the real zh copy, with the bound interpolated, from a realistic translator', () => {
    // Build NumberFieldMessages exactly the way the dialogs do, then prove the
    // bound reaches the actual sentence: '0' against a min-1 TTL must read
    // "不得小于 1", not a probe string.
    const minValue = message('zh', ['common', 'form', 'minValue'])
    const maxValue = message('zh', ['common', 'form', 'maxValue'])
    const invalid = message('zh', ['common', 'form', 'invalidNumber'])
    const real: NumberFieldMessages = {
      invalid,
      tooSmall: (min) => minValue.replace('{min}', String(min)),
      tooBig: (max) => maxValue.replace('{max}', String(max)),
    }
    const ttl = integerField(1, MAX_TTL, real)
    // '0' is a well-formed digit string, so it trips only the min bound.
    expect(issuesOf(ttl.safeParse('0'))).toEqual([minValue.replace('{min}', '1')])
    // 'abc' is malformed: the format error is the first issue the resolver shows.
    expect(issuesOf(ttl.safeParse('abc'))[0]).toBe(invalid)

    const nsec3 = integerField(0, MAX_NSEC3_OCTET, real)
    expect(issuesOf(nsec3.safeParse('999'))).toEqual([maxValue.replace('{max}', String(MAX_NSEC3_OCTET))])
  })
})
