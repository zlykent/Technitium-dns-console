import { describe, expect, it } from 'vitest'
import {
  API_ERROR_CODES,
  DnsApiError,
  ERROR_HTTP_STATUS,
  isAuthError,
  isDnsApiError,
  type ApiErrorCode,
} from '@/lib/api/errors'

/**
 * The error contract shared by the proxy and the browser client.
 *
 * Two things break badly and silently if this drifts:
 *
 *  1. `code -> httpStatus`. The query client and the topbar decide whether to
 *     throw the user back to `/login` from `isAuthFailure`, and the proxy writes
 *     the status line from this table. A code missing from the table yields
 *     `httpStatus === undefined`, which no HTTP layer accepts; a code mapped to
 *     the wrong class turns "upstream is down" into "your session expired" and
 *     logs an operator out of a working server.
 *  2. `toJSON()`. This is the wire format between proxy and client, so the key
 *     set is a security surface as much as a shape: it must carry enough to
 *     translate the failure, and nothing that was not already meant for the
 *     browser.
 *
 * The duck-typing branch of `isDnsApiError` is deliberate — errors crossing a
 * realm boundary (vm contexts, worker boundaries, a duplicated `node_modules`)
 * lose `instanceof` but keep `name`, and treating them as unknown would strip
 * the translated message from every toast in the app.
 */

/** code -> status, written out so a change to the table is a visible diff. */
const EXPECTED_STATUS: [ApiErrorCode, number][] = [
  // proxy-side rejections
  ['no_target', 400],
  ['blocked_target', 403],
  ['endpoint_not_found', 404],
  ['method_not_allowed', 405],
  ['missing_token', 401],
  ['proxy_error', 500],
  // upstream conditions
  ['invalid_token', 401],
  ['two_factor_required', 428],
  ['upstream_error', 400],
  ['bad_upstream_response', 502],
  ['upstream_unreachable', 502],
  ['upstream_timeout', 504],
]

describe('API_ERROR_CODES', () => {
  it('holds exactly the twelve documented codes', () => {
    expect(API_ERROR_CODES).toEqual([
      'no_target',
      'blocked_target',
      'endpoint_not_found',
      'method_not_allowed',
      'missing_token',
      'proxy_error',
      'invalid_token',
      'two_factor_required',
      'upstream_error',
      'bad_upstream_response',
      'upstream_unreachable',
      'upstream_timeout',
    ])
  })

  it('has no duplicate code', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length)
  })
})

describe('ERROR_HTTP_STATUS', () => {
  it.each(EXPECTED_STATUS)('maps %s to HTTP %i', (code, status) => {
    expect(ERROR_HTTP_STATUS[code]).toBe(status)
  })

  it('maps every declared code, so no lookup can yield undefined', () => {
    // An unmapped code would put `undefined` on the wire and into `Response`.
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...API_ERROR_CODES].sort())
    for (const code of API_ERROR_CODES) {
      expect(Number.isInteger(ERROR_HTTP_STATUS[code]), `${code} has no numeric status`).toBe(true)
    }
  })

  it('gives every code a status the instance picks up at construction', () => {
    for (const [code, status] of EXPECTED_STATUS) {
      expect(new DnsApiError(code, 'message').httpStatus, code).toBe(status)
    }
  })

  it('reserves 401 for exactly the two session-loss codes', () => {
    // The client redirects to /login on 401; a second code here would log users
    // out for a condition re-authentication cannot fix.
    const unauthorized = API_ERROR_CODES.filter((code) => ERROR_HTTP_STATUS[code] === 401)
    expect(unauthorized).toEqual(['missing_token', 'invalid_token'])
  })

  it('marks the two session-loss codes as auth failures and nothing else', () => {
    for (const code of API_ERROR_CODES) {
      const expected = code === 'invalid_token' || code === 'missing_token'
      expect(new DnsApiError(code, 'message').isAuthFailure, code).toBe(expected)
    }
  })

  it('classifies upstream transport failures as gateway errors', () => {
    expect(ERROR_HTTP_STATUS.bad_upstream_response).toBe(502)
    expect(ERROR_HTTP_STATUS.upstream_unreachable).toBe(502)
    expect(ERROR_HTTP_STATUS.upstream_timeout).toBe(504)
  })
})

describe('DnsApiError', () => {
  it('is a real Error with a stable name', () => {
    const err = new DnsApiError('no_target', 'No DNS server is configured.')
    expect(err).toBeInstanceOf(DnsApiError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('DnsApiError')
    expect(err.message).toBe('No DNS server is configured.')
    expect(String(err)).toBe('DnsApiError: No DNS server is configured.')
    expect(typeof err.stack).toBe('string')
  })

  it('carries the diagnostic details it was given', () => {
    const err = new DnsApiError('upstream_error', 'Zone not found.', {
      innerMessage: 'DnsApiException',
      stackTrace: 'at Technitium.Dns.Server.Zones',
      endpoint: 'zones/delete',
      target: 'http://10.0.0.5:5380',
    })
    expect(err.code).toBe('upstream_error')
    expect(err.httpStatus).toBe(400)
    expect(err.innerMessage).toBe('DnsApiException')
    expect(err.stackTrace).toBe('at Technitium.Dns.Server.Zones')
    expect(err.endpoint).toBe('zones/delete')
    expect(err.target).toBe('http://10.0.0.5:5380')
  })

  it('leaves every optional detail undefined when omitted', () => {
    const err = new DnsApiError('proxy_error', 'boom')
    expect(err.innerMessage).toBeUndefined()
    expect(err.stackTrace).toBeUndefined()
    expect(err.endpoint).toBeUndefined()
    expect(err.target).toBeUndefined()
  })
})

describe('DnsApiError.toJSON', () => {
  it('emits code and message only when there is nothing else to say', () => {
    const err = new DnsApiError('no_target', 'No DNS server is configured.')
    expect(err.toJSON()).toEqual({ code: 'no_target', message: 'No DNS server is configured.' })
    expect(Object.keys(err.toJSON())).toEqual(['code', 'message'])
  })

  it('emits a stable key order and no undefined-valued keys', () => {
    const err = new DnsApiError('upstream_timeout', 'Timed out.', {
      innerMessage: 'socket hang up',
      stackTrace: 'at X',
      endpoint: 'zones/list',
      target: 'http://10.0.0.5:5380',
    })
    expect(Object.keys(err.toJSON())).toEqual(['code', 'message', 'innerMessage', 'stackTrace', 'endpoint', 'target'])
    expect(err.toJSON()).toEqual({
      code: 'upstream_timeout',
      message: 'Timed out.',
      innerMessage: 'socket hang up',
      stackTrace: 'at X',
      endpoint: 'zones/list',
      target: 'http://10.0.0.5:5380',
    })
  })

  it('omits a detail that was not set instead of writing null', () => {
    const json = new DnsApiError('blocked_target', 'Not allowed.', { endpoint: 'zones/list' }).toJSON()
    expect(Object.keys(json)).toEqual(['code', 'message', 'endpoint'])
    expect(json).not.toHaveProperty('innerMessage')
    expect(json).not.toHaveProperty('stackTrace')
    expect(json).not.toHaveProperty('target')
  })

  it('never serialises transport metadata, the error name or a stack', () => {
    const err = new DnsApiError('invalid_token', 'Token expired.', { stackTrace: 'at X' })
    const wire = JSON.parse(JSON.stringify(err)) as Record<string, unknown>
    // `httpStatus` is derived from `code` on the far side; shipping it would let
    // a caller trust a status the code table disagrees with.
    expect(wire).not.toHaveProperty('httpStatus')
    expect(wire).not.toHaveProperty('name')
    expect(wire).not.toHaveProperty('stack')
    expect(wire).not.toHaveProperty('isAuthFailure')
    expect(Object.keys(wire).sort()).toEqual(['code', 'message', 'stackTrace'])
  })

  it('never serialises a property bolted onto the instance', () => {
    const err = new DnsApiError('missing_token', 'No token.') as DnsApiError & Record<string, unknown>
    err.token = 'super-secret'
    err.cookie = 'tdns.token=abc'
    const wire = JSON.stringify(err)
    expect(wire).not.toContain('super-secret')
    expect(wire).not.toContain('tdns.token')
    expect(JSON.parse(wire)).toEqual({ code: 'missing_token', message: 'No token.' })
  })
})

describe('DnsApiError.from', () => {
  it('rebuilds a known code and keeps every detail', () => {
    const err = DnsApiError.from({
      code: 'upstream_error',
      message: 'Zone already exists.',
      innerMessage: 'DnsApiException',
      stackTrace: 'at Y',
      endpoint: 'zones/create',
      target: 'http://10.0.0.5:5380',
    })
    expect(err).toBeInstanceOf(DnsApiError)
    expect(err.code).toBe('upstream_error')
    expect(err.message).toBe('Zone already exists.')
    expect(err.innerMessage).toBe('DnsApiException')
    expect(err.stackTrace).toBe('at Y')
    expect(err.endpoint).toBe('zones/create')
    expect(err.target).toBe('http://10.0.0.5:5380')
  })

  it('derives the status from the code, not from the transport', () => {
    // The proxy answers 500 for a body that says `upstream_timeout`; the code
    // table wins so a retry layer sees one consistent number.
    expect(DnsApiError.from({ code: 'upstream_timeout', message: 'slow' }, 500).httpStatus).toBe(504)
    expect(DnsApiError.from({ code: 'invalid_token', message: 'gone' }, 200).httpStatus).toBe(401)
  })

  it('falls back to proxy_error and keeps the transport status for an unknown code', () => {
    const err = DnsApiError.from({ code: 'something_new', message: 'ignored' }, 503)
    expect(err.code).toBe('proxy_error')
    expect(err.httpStatus).toBe(503)
    // An unrecognised code means the body is not ours, so its text is not trusted.
    expect(err.message).toBe('Request failed.')
    expect(err.innerMessage).toBeUndefined()
  })

  it('uses the default gateway status when no fallback is supplied', () => {
    expect(DnsApiError.from({ code: 'nope' }).httpStatus).toBe(502)
    expect(DnsApiError.from(null).httpStatus).toBe(502)
  })

  it('accepts a plain string body as the message', () => {
    const err = DnsApiError.from('upstream said no', 502)
    expect(err.code).toBe('proxy_error')
    expect(err.message).toBe('upstream said no')
    expect(err.httpStatus).toBe(502)
  })

  it('degrades to a generic message for empty and non-object bodies', () => {
    for (const body of [null, undefined, '', 42, [], {}, { message: 'no code here' }]) {
      const err = DnsApiError.from(body, 500)
      expect(err.code, JSON.stringify(body) ?? String(body)).toBe('proxy_error')
      expect(err.message).toBe('Request failed.')
      expect(err.httpStatus).toBe(500)
    }
  })

  it('defaults the message when a known code arrives without one', () => {
    const err = DnsApiError.from({ code: 'two_factor_required' })
    expect(err.code).toBe('two_factor_required')
    expect(err.httpStatus).toBe(428)
    expect(err.message).toBe('Request failed.')
  })

  it('survives a round trip through the wire format', () => {
    const original = new DnsApiError('bad_upstream_response', 'Not JSON.', { endpoint: 'status' })
    const rebuilt = DnsApiError.from(JSON.parse(JSON.stringify(original)), 502)
    expect(rebuilt.toJSON()).toEqual(original.toJSON())
    expect(rebuilt.httpStatus).toBe(original.httpStatus)
  })
})

describe('isDnsApiError', () => {
  it('recognises a constructed instance', () => {
    expect(isDnsApiError(new DnsApiError('no_target', 'x'))).toBe(true)
  })

  it('recognises an object on the prototype but never constructed', () => {
    // The cross-realm shape: `instanceof` still holds because the prototype
    // object is shared, even though no constructor ran.
    const bare = Object.create(DnsApiError.prototype) as DnsApiError
    expect(isDnsApiError(bare)).toBe(true)
    expect(bare.isAuthFailure).toBe(false)
  })

  it('recognises a duck-typed error from another realm', () => {
    expect(isDnsApiError({ name: 'DnsApiError', code: 'invalid_token', message: 'gone' })).toBe(true)
    expect(isDnsApiError({ name: 'DnsApiError' })).toBe(true)
  })

  it('rejects ordinary errors', () => {
    expect(isDnsApiError(new Error('plain'))).toBe(false)
    expect(isDnsApiError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isDnsApiError(new DOMException('aborted', 'AbortError'))).toBe(false)
  })

  it('rejects non-errors and look-alikes', () => {
    for (const value of [null, undefined, 'DnsApiError', 42, true, {}, [], { name: 'Error' }, { code: 'no_target' }]) {
      expect(isDnsApiError(value), String(value)).toBe(false)
    }
  })
})

describe('isAuthError', () => {
  it('is true only for the two session-loss codes', () => {
    expect(isAuthError(new DnsApiError('invalid_token', 'gone'))).toBe(true)
    expect(isAuthError(new DnsApiError('missing_token', 'none'))).toBe(true)
  })

  it('is false for every other code', () => {
    for (const code of API_ERROR_CODES) {
      if (code === 'invalid_token' || code === 'missing_token') continue
      expect(isAuthError(new DnsApiError(code, 'x')), code).toBe(false)
    }
  })

  it('is false for non-errors', () => {
    expect(isAuthError(new Error('invalid_token'))).toBe(false)
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError('invalid_token')).toBe(false)
    expect(isAuthError({})).toBe(false)
  })

  it('is falsy for a duck-typed error that has no isAuthFailure getter', () => {
    // `name` alone is enough to translate a message, so `isDnsApiError` accepts
    // the object — but `value.isAuthFailure` is then `undefined` and the `&&`
    // hands that straight back. The signature promises `boolean`. Harmless for
    // every call site (they all branch on truthiness) but the declared type is
    // a lie; asserted as-is so the wart stays visible instead of looking fixed.
    expect(isAuthError({ name: 'DnsApiError' })).toBeUndefined()
    expect(isAuthError({ name: 'DnsApiError', code: 'invalid_token' })).toBeUndefined()
    expect(Boolean(isAuthError({ name: 'DnsApiError' }))).toBe(false)
  })
})
