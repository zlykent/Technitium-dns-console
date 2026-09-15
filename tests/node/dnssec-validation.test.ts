import { describe, expect, it } from 'vitest'
import { PEM_PRIVATE_KEY_HEADER, pemField } from '@/components/dnssec/validation'
import { loadMessages } from '@/lib/i18n/messages'

/**
 * PEM validators for the DNSSEC dialogs.
 *
 * The numeric-field half of this file moved to `tests/node/number-field.test.ts`
 * along with `integerField` itself; what is left is the private-key block
 * detection, which really is DNSSEC-specific.
 *
 * Two properties are worth pinning here:
 *
 *  1. The header regex is deliberately permissive about the algorithm label but
 *     must still refuse a *public* key and a block whose first line was lost in
 *     copy/paste — those are the two ways an operator pastes the wrong thing,
 *     and both would otherwise travel to the server before failing.
 *  2. `pemField` treats blank as valid, because blank means "let the server
 *     generate the key". The dialogs that can *demand* a key do not use a
 *     stricter variant of this function; they add the issue from a `superRefine`
 *     keyed off `generationMode`, so the required-ness is a property of the
 *     dialog schema rather than of this module.
 *
 * The message text is not in the module either — the dialogs pass
 * `dnssec:sign.pemInvalid` in — so the last block proves that key still
 * resolves.
 */

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

describe('PEM_PRIVATE_KEY_HEADER — private-key block detection', () => {
  it('matches the algorithm labels the dialogs accept', () => {
    for (const header of [
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
    ]) {
      expect(PEM_PRIVATE_KEY_HEADER.test(header), `${header} should match`).toBe(true)
    }
  })

  it('matches when the header is the first line of a full block', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'
    expect(PEM_PRIVATE_KEY_HEADER.test(block)).toBe(true)
  })

  it('rejects a public key, a certificate and a header-less body', () => {
    // The whole point of the regex: a pasted *public* key, or a block whose first
    // line was lost in copy/paste, must be refused before it reaches the server.
    expect(PEM_PRIVATE_KEY_HEADER.test('-----BEGIN PUBLIC KEY-----')).toBe(false)
    expect(PEM_PRIVATE_KEY_HEADER.test('-----BEGIN CERTIFICATE-----')).toBe(false)
    expect(PEM_PRIVATE_KEY_HEADER.test('MIIEowIBAAKCAQEA...')).toBe(false)
    expect(PEM_PRIVATE_KEY_HEADER.test('')).toBe(false)
  })

  it('rejects a lowercase header (PEM is case-sensitive by convention)', () => {
    expect(PEM_PRIVATE_KEY_HEADER.test('-----begin rsa private key-----')).toBe(false)
  })
})

describe('pemField — optional (blank means "let the server generate")', () => {
  const field = pemField('BAD_PEM')

  it('accepts an empty and a whitespace-only value', () => {
    expect(field.safeParse('').success).toBe(true)
    expect(field.safeParse('   ').success).toBe(true)
  })

  it('accepts a well-formed private-key block', () => {
    const block = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...\n-----END EC PRIVATE KEY-----'
    expect(field.safeParse(block).success).toBe(true)
  })

  it('rejects a non-empty value that is not a private-key block', () => {
    const result = field.safeParse('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----')
    expect(result.success).toBe(false)
    expect(issuesOf(result)).toEqual(['BAD_PEM'])
  })
})

describe('PEM copy contract — the key the dialogs wire in', () => {
  // The validator takes a resolved string, so a rename in the dnssec bundle
  // would leave it emitting `undefined` while these unit tests, which pass
  // their own strings, stayed green.
  const locales = ['zh', 'en'] as const

  it.each(locales)('resolves dnssec.sign.pemInvalid in %s', (locale) => {
    expect(message(locale, ['dnssec', 'sign', 'pemInvalid']).length).toBeGreaterThan(0)
  })
})
