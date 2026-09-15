import { describe, expect, it } from 'vitest'
import { hostPortOf, parseServerUrl } from '@/lib/url'

/**
 * Server-address parsing.
 *
 * One helper feeds three callers with different failure semantics — the proxy
 * throws a translated `DnsApiError`, the profile store returns `null`, the
 * browser client falls back to the raw string — so the reason codes have to be
 * exact or one of the three surfaces the wrong message.
 */

describe('parseServerUrl', () => {
  it('accepts a bare host:port and assumes http', () => {
    const parsed = parseServerUrl('127.0.0.1:5380')
    expect(parsed).toMatchObject({ ok: true, origin: 'http://127.0.0.1:5380' })
  })

  it('does not mistake a hostname for a scheme', () => {
    // The regression this guards: requiring only `word:` would read
    // `localhost:5380` as protocol "localhost" and reject the most common
    // address an operator types.
    for (const input of ['localhost:5380', 'dns01.lan:5380', 'a+b:1', 'MY-HOST:5380']) {
      expect(parseServerUrl(input).ok, input).toBe(true)
    }
  })

  it('preserves an explicit http or https scheme', () => {
    expect(parseServerUrl('http://10.0.0.1:5380')).toMatchObject({ ok: true, origin: 'http://10.0.0.1:5380' })
    expect(parseServerUrl('HTTPS://dns.example.com')).toMatchObject({ ok: true, origin: 'https://dns.example.com' })
  })

  it('reduces a URL with a path to its origin', () => {
    expect(parseServerUrl('http://127.0.0.1:5380/api/status')).toMatchObject({ ok: true, origin: 'http://127.0.0.1:5380' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseServerUrl('  http://10.0.0.1:5380  ')).toMatchObject({ ok: true, origin: 'http://10.0.0.1:5380' })
  })

  it('reports empty for blank, null and undefined', () => {
    for (const input of ['', '   ', null, undefined]) {
      expect(parseServerUrl(input)).toEqual({ ok: false, reason: 'empty' })
    }
  })

  it('names the offending scheme for any other protocol', () => {
    expect(parseServerUrl('ftp://router')).toEqual({ ok: false, reason: 'protocol', scheme: 'ftp' })
    expect(parseServerUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'protocol', scheme: 'file' })
    expect(parseServerUrl('ws://dns.lan:5380')).toEqual({ ok: false, reason: 'protocol', scheme: 'ws' })
  })

  it('reports invalid for text that cannot become a URL', () => {
    expect(parseServerUrl('http://')).toMatchObject({ ok: false })
    expect(parseServerUrl('http://exa mple.com')).toMatchObject({ ok: false, reason: 'invalid' })
    expect(parseServerUrl('http://host:notaport')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('exposes the parsed URL so callers can read hostname and port', () => {
    const parsed = parseServerUrl('https://dns.example.com:8443/x')
    if (!parsed.ok) throw new Error('expected a successful parse')
    expect(parsed.url.hostname).toBe('dns.example.com')
    expect(parsed.url.port).toBe('8443')
    expect(parsed.url.protocol).toBe('https:')
  })
})

describe('hostPortOf', () => {
  const url = (input: string) => {
    const parsed = parseServerUrl(input)
    if (!parsed.ok) throw new Error(`expected '${input}' to parse`)
    return parsed.url
  }

  it('fills in the default port for the scheme', () => {
    expect(hostPortOf(url('http://dns.lan'))).toBe('dns.lan:80')
    expect(hostPortOf(url('https://dns.lan'))).toBe('dns.lan:443')
  })

  it('keeps an explicit port', () => {
    expect(hostPortOf(url('http://127.0.0.1:5380'))).toBe('127.0.0.1:5380')
  })

  it('lowercases the host so allowlist entries match regardless of case', () => {
    expect(hostPortOf(url('http://DNS.Example.COM:5380'))).toBe('dns.example.com:5380')
  })
})
