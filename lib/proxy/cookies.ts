import { createHash } from 'node:crypto'

/**
 * Per-server token cookies.
 *
 * The UI lets an operator keep several DNS servers and switch between them, so
 * a single cookie would be overwritten on every switch. Instead each server
 * gets its own cookie, named by a short hash of its origin:
 *
 *     tdns_t_1a2b3c4d  ->  token for http://127.0.0.1:5380
 *
 * The mapping is derived, not stored — the proxy stays stateless and only needs
 * the `X-Dns-Target` header to find the right cookie.
 *
 * Tokens are httpOnly: the browser client never sees them. Downloads therefore
 * go through the proxy as a streamed blob rather than the classic Technitium
 * `?token=` single-use-token URL, which would leak a credential into history,
 * server logs and the `Referer` header.
 */

export const TOKEN_COOKIE_PREFIX = 'tdns_t_'

/** Non-secret metadata cookie: which server the UI last had selected. */
export const ACTIVE_TARGET_COOKIE = 'tdns_active'

export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/**
 * Stable, non-reversible-per-origin identifier used as the cookie suffix.
 * Salted with the prefix so the value cannot be confused with any other hash
 * in the app, and truncated to keep cookie names short.
 */
export function tokenCookieName(origin: string): string {
  const hash = createHash('sha256').update(`${TOKEN_COOKIE_PREFIX}${normaliseOrigin(origin)}`).digest('hex')
  return `${TOKEN_COOKIE_PREFIX}${hash.slice(0, 12)}`
}

/**
 * `http://Host:5380/` and `http://host:5380/api` must map to the same cookie,
 * otherwise the same server would hold two tokens.
 */
export function normaliseOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    return url.origin.toLowerCase()
  } catch {
    return origin.trim().toLowerCase().replace(/\/+$/, '')
  }
}

export interface CookieOptions {
  /** Cookie path. Scoped to `/api` so it is never sent to static assets. */
  path?: string
  secure?: boolean
  sameSite?: 'lax' | 'strict'
  maxAge?: number
}

/**
 * RFC 6265bis spells the values `Strict` / `Lax`. Browsers match them
 * case-insensitively, but writing the canonical form keeps the header readable
 * in devtools and stops a future strict parser from tripping over it.
 */
function sameSiteAttribute(value: 'lax' | 'strict'): string {
  return `SameSite=${value === 'strict' ? 'Strict' : 'Lax'}`
}

/**
 * Serialise a `Set-Cookie` header value.
 *
 * Written by hand instead of pulling a dependency: Next's `cookies()` API cannot
 * be used inside a streaming route handler response, and the shape here is tiny.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  parts.push(`Max-Age=${options.maxAge ?? COOKIE_MAX_AGE_SECONDS}`)
  parts.push(sameSiteAttribute(options.sameSite ?? 'lax'))
  if (options.secure) parts.push('Secure')
  parts.push('HttpOnly')
  return parts.join('; ')
}

/** Expiry cookie — `Max-Age=0` plus an epoch `Expires` for older clients. */
export function serializeDeletedCookie(name: string, options: CookieOptions = {}): string {
  const parts = [`${name}=`, `Path=${options.path ?? '/'}`, 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT']
  parts.push(sameSiteAttribute(options.sameSite ?? 'lax'))
  if (options.secure) parts.push('Secure')
  parts.push('HttpOnly')
  return parts.join('; ')
}

/**
 * Read the incoming `Cookie` header without depending on Next's request context,
 * so the proxy kernel stays testable from plain Vitest.
 */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const jar = new Map<string, string>()
  if (!header) return jar
  for (const chunk of header.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq < 1) continue
    const name = chunk.slice(0, eq).trim()
    if (!name) continue
    let value = chunk.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1)
    try {
      value = decodeURIComponent(value)
    } catch {
      // keep the raw value; a malformed escape is better surfaced than dropped
    }
    if (!jar.has(name)) jar.set(name, value)
  }
  return jar
}

export function readTokenCookie(cookieHeader: string | null | undefined, origin: string): string | undefined {
  const token = parseCookies(cookieHeader).get(tokenCookieName(origin))
  return token && token.length > 0 ? token : undefined
}
