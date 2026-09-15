import { describe, expect, it } from 'vitest'
import { translateUpstream, STATUS_TO_CODE } from '@/lib/proxy/errors'

/**
 * Technitium returns HTTP 200 for almost everything, including failures — the
 * real signal is the `status` field in the JSON body. `translateUpstream` is the
 * single place that turns the four protocol statuses (and the non-protocol cases:
 * an HTML error page, a captive portal, an HTTP 500 with no JSON) into either a
 * success marker or a `DnsApiError`. A mistake here either surfaces a hard failure
 * as success or hides a real one, so the precedence rules are pinned exactly.
 */

const EP = 'zones/list'
const TARGET = 'http://127.0.0.1:5380'

describe('STATUS_TO_CODE', () => {
  it('maps the three failure statuses to api error codes', () => {
    expect(STATUS_TO_CODE['invalid-token']).toBe('invalid_token')
    expect(STATUS_TO_CODE['2fa-required']).toBe('two_factor_required')
    expect(STATUS_TO_CODE['error']).toBe('upstream_error')
  })
})

describe('translateUpstream — protocol statuses', () => {
  it('maps invalid-token to invalid_token (401)', () => {
    const result = translateUpstream(200, { status: 'invalid-token' }, '', EP, TARGET)
    expect(result.error?.code).toBe('invalid_token')
    expect(result.error?.httpStatus).toBe(401)
    expect(result.upstreamStatus).toBe('invalid-token')
  })

  it('maps 2fa-required to two_factor_required (428)', () => {
    const result = translateUpstream(200, { status: '2fa-required' }, '', EP, TARGET)
    expect(result.error?.code).toBe('two_factor_required')
    expect(result.error?.httpStatus).toBe(428)
  })

  it('carries errorMessage, innerErrorMessage and stackTrace for an error status', () => {
    const body = { status: 'error', errorMessage: 'zone exists', innerErrorMessage: 'inner detail', stackTrace: 'at Foo()' }
    const result = translateUpstream(200, body, '', EP, TARGET)
    expect(result.error?.code).toBe('upstream_error')
    expect(result.error?.message).toBe('zone exists')
    expect(result.error?.innerMessage).toBe('inner detail')
    expect(result.error?.stackTrace).toBe('at Foo()')
  })

  it('passes a 2xx ok body straight through with no error', () => {
    const body = { status: 'ok', server: 's', response: { a: 1 } }
    const result = translateUpstream(200, body, JSON.stringify(body), EP, TARGET)
    expect(result.error).toBeUndefined()
    expect(result.body).toEqual(body)
    expect(result.upstreamStatus).toBe('ok')
  })

  it('flags an unknown status as bad_upstream_response', () => {
    const result = translateUpstream(200, { status: 'wat' }, '', EP, TARGET)
    expect(result.error?.code).toBe('bad_upstream_response')
    expect(result.error?.httpStatus).toBe(502)
  })

  it('flags ok-but-4xx as a contradictory bad_upstream_response', () => {
    const result = translateUpstream(500, { status: 'ok' }, '', EP, TARGET)
    expect(result.error?.code).toBe('bad_upstream_response')
  })
})

describe('translateUpstream — HTTP status combined with body', () => {
  it('uses the body message for a >=400 response with no status field', () => {
    const result = translateUpstream(404, { errorMessage: 'not found' }, '', EP, TARGET)
    expect(result.error?.code).toBe('upstream_error')
    expect(result.error?.message).toBe('not found')
  })

  it('treats a >=400 invalid-token body as invalid_token regardless of HTTP code', () => {
    const result = translateUpstream(401, { status: 'invalid-token' }, '', EP, TARGET)
    expect(result.error?.code).toBe('invalid_token')
  })

  it('passes a 2xx body with no status field through as opaque success', () => {
    const body = { version: '15.4' }
    const result = translateUpstream(200, body, JSON.stringify(body), EP, TARGET)
    expect(result.error).toBeUndefined()
    expect(result.body).toEqual(body)
  })
})

describe('translateUpstream — non-JSON bodies', () => {
  it('flags a 2xx non-JSON body as bad_upstream_response', () => {
    const result = translateUpstream(200, null, 'OK-but-not-json', EP, TARGET)
    expect(result.error?.code).toBe('bad_upstream_response')
    expect(result.error?.message).toContain('non-JSON')
  })

  it('degrades an HTML error page to upstream_error with a preview', () => {
    const html = '<html><body><h1>502 Bad Gateway</h1></body></html>'
    const result = translateUpstream(502, null, html, EP, TARGET)
    expect(result.error?.code).toBe('upstream_error')
    expect(result.error?.message).toContain('502 Bad Gateway')
    expect(result.error?.innerMessage).toContain('502 Bad Gateway')
  })

  it('uses the HTTP status text when an error page body is empty', () => {
    const result = translateUpstream(500, null, '', EP, TARGET)
    expect(result.error?.code).toBe('upstream_error')
    expect(result.error?.message).toContain('HTTP 500')
  })
})
