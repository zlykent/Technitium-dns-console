import { describe, expect, it } from 'vitest'
import {
  normaliseOrigin,
  parseCookies,
  readTokenCookie,
  serializeCookie,
  serializeDeletedCookie,
  tokenCookieName,
  TOKEN_COOKIE_PREFIX,
} from '@/lib/proxy/cookies'

/**
 * The proxy stores one httpOnly token cookie *per server* so the switcher can hold
 * several DNS servers without them overwriting each other. Two properties are
 * security-critical and pinned here:
 *
 *  1. **Stability + isolation.** The same origin always maps to the same cookie
 *     name, and different origins never collide — otherwise a token meant for
 *     server A could be replayed against server B.
 *  2. **Deletion really deletes.** A cleared cookie must keep Path/SameSite (and
 *     Secure when applicable) or the browser treats it as a *different* cookie and
 *     leaves the live token in place after logout.
 */

const A = 'http://127.0.0.1:5380'
const B = 'http://10.0.0.9:5380'

describe('tokenCookieName', () => {
  it('is stable for the same origin', () => {
    expect(tokenCookieName(A)).toBe(tokenCookieName(A))
  })

  it('differs across origins', () => {
    expect(tokenCookieName(A)).not.toBe(tokenCookieName(B))
  })

  it('uses the documented prefix and a hex suffix', () => {
    const name = tokenCookieName(A)
    expect(name.startsWith(TOKEN_COOKIE_PREFIX)).toBe(true)
    expect(name).toMatch(/^tdns_t_[0-9a-f]{12}$/)
  })

  it('is a cookie-name-safe token (no separators, bounded length)', () => {
    const name = tokenCookieName(A)
    expect(name).toMatch(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
    expect(name.length).toBeLessThanOrEqual(32)
  })

  it('normalises trailing slash and host case to the same name', () => {
    expect(tokenCookieName('http://h:5380')).toBe(tokenCookieName('http://h:5380/'))
    expect(tokenCookieName('http://H:5380')).toBe(tokenCookieName('http://h:5380'))
  })
})

describe('normaliseOrigin', () => {
  it('lowercases and strips path/slash from a valid origin', () => {
    expect(normaliseOrigin('http://Host:5380/some/path')).toBe('http://host:5380')
  })

  it('falls back to trimming an unparseable value', () => {
    expect(normaliseOrigin('  Not A URL/  ')).toBe('not a url')
  })
})

describe('serializeCookie', () => {
  it('includes HttpOnly, Path and SameSite', () => {
    const c = serializeCookie('tdns_t_x', 'value')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Path=/')
    expect(c.toLowerCase()).toContain('samesite=lax')
  })

  it('adds Secure only when requested', () => {
    expect(serializeCookie('n', 'v', { secure: true })).toContain('Secure')
    expect(serializeCookie('n', 'v', { secure: false })).not.toContain('Secure')
    expect(serializeCookie('n', 'v')).not.toContain('Secure')
  })

  it('percent-encodes the value', () => {
    expect(serializeCookie('n', 'a b&c=d')).toContain('n=a%20b%26c%3Dd')
  })

  it('honours a custom path', () => {
    expect(serializeCookie('n', 'v', { path: '/api' })).toContain('Path=/api')
  })
})

describe('serializeDeletedCookie', () => {
  it('expires the cookie and keeps HttpOnly/Path/SameSite so the browser deletes it', () => {
    const c = serializeDeletedCookie('tdns_t_x', { path: '/', sameSite: 'lax' })
    expect(c).toContain('Max-Age=0')
    expect(c).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Path=/')
    expect(c.toLowerCase()).toContain('samesite=lax')
  })

  it('keeps Secure when the live cookie was Secure', () => {
    expect(serializeDeletedCookie('n', { secure: true, sameSite: 'lax' })).toContain('Secure')
    expect(serializeDeletedCookie('n', { sameSite: 'lax' })).not.toContain('Secure')
  })

  it('writes an empty value', () => {
    expect(serializeDeletedCookie('tdns_t_x')).toMatch(/^tdns_t_x=;/)
  })
})

describe('parseCookies', () => {
  it('parses a multi-cookie header and decodes values', () => {
    const jar = parseCookies('a=1; b=hello%20world; c="quoted"')
    expect(jar.get('a')).toBe('1')
    expect(jar.get('b')).toBe('hello world')
    expect(jar.get('c')).toBe('quoted')
  })

  it('returns an empty map for a missing header', () => {
    expect(parseCookies(null).size).toBe(0)
    expect(parseCookies(undefined).size).toBe(0)
  })

  it('does not throw on malformed segments', () => {
    expect(() => parseCookies('garbage; ==; ; =; a=%E0%A4%A')).not.toThrow()
  })
})

describe('readTokenCookie', () => {
  it('picks the cookie for the matching origin out of a crowded header', () => {
    const header = `theme=dark; ${tokenCookieName(A)}=tokA; ${tokenCookieName(B)}=tokB; sid=1`
    expect(readTokenCookie(header, A)).toBe('tokA')
    expect(readTokenCookie(header, B)).toBe('tokB')
  })

  it('returns undefined when the origin has no cookie', () => {
    const header = `${tokenCookieName(A)}=tokA`
    expect(readTokenCookie(header, B)).toBeUndefined()
  })

  it('returns undefined for a missing header', () => {
    expect(readTokenCookie(null, A)).toBeUndefined()
  })

  it('decodes a percent-encoded token value', () => {
    const header = `${tokenCookieName(A)}=${encodeURIComponent('tok en')}`
    expect(readTokenCookie(header, A)).toBe('tok en')
  })

  it('treats an empty token value as absent', () => {
    expect(readTokenCookie(`${tokenCookieName(A)}=`, A)).toBeUndefined()
  })

  it('never crosses origins that share the cookie prefix', () => {
    // Multi-server isolation: A's token must not be readable via B's origin.
    const header = `${tokenCookieName(A)}=secret-for-A`
    expect(readTokenCookie(header, B)).toBeUndefined()
    expect(tokenCookieName(A)).not.toBe(tokenCookieName(B))
  })
})
