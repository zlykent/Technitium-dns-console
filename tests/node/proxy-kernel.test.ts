import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleProxy, TARGET_HEADER } from '@/lib/proxy/kernel'
import { forward } from '@/lib/proxy/forward'
import { writeAudit } from '@/lib/proxy/audit'
import { tokenCookieName } from '@/lib/proxy/cookies'
import { DnsApiError } from '@/lib/api/errors'
import type { ProxyConfig } from '@/lib/proxy/target'

/**
 * End-to-end coverage of the proxy pipeline. `forward` and `writeAudit` are the
 * only collaborators stubbed, so the *real* target resolver, envelope unwrapper,
 * error translator and cookie code all run — this is the integration test for the
 * whole `/api/dns/[...path]` route.
 *
 * `options.config` is always injected so no test reads `process.env`, and the
 * default target is a private IP literal so no DNS lookup occurs.
 *
 * The behaviours guarded here are the ones that would silently break security or
 * a whole page: the path/verb allowlist, the SSRF block, token-cookie lifecycle
 * (set on login, stripped from payloads, cleared on logout / invalid-token),
 * file streaming, header passthrough policy, and the audit line on every path.
 */

vi.mock('@/lib/proxy/forward', () => ({ forward: vi.fn() }))
vi.mock('@/lib/proxy/audit', () => ({ writeAudit: vi.fn() }))

const forwardMock = vi.mocked(forward)
const auditMock = vi.mocked(writeAudit)

const ORIGIN = 'http://127.0.0.1:5380'
const CONFIG: ProxyConfig = { defaultTarget: ORIGIN, allowedTargets: [], allowLoopback: false }
const COOKIE = tokenCookieName(ORIGIN)
const TOKEN = 'session-token-0123456789abcdef'

function call(pathWithQuery: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/dns/${pathWithQuery}`, init)
  const segments = pathWithQuery.split('?')[0].split('/').filter(Boolean)
  return handleProxy(request, segments, { config: CONFIG })
}

function authed(headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `${COOKIE}=${TOKEN}`, ...headers }
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function resolveWith(response: Response): void {
  forwardMock.mockResolvedValue({ response, durationMs: 3 })
}

function forwardArg(): Parameters<typeof forward>[0] {
  return forwardMock.mock.calls.at(-1)?.[0] as Parameters<typeof forward>[0]
}

beforeEach(() => {
  forwardMock.mockReset()
  auditMock.mockReset()
})

describe('routing guards', () => {
  it('rejects an unknown endpoint with 404 and never forwards', async () => {
    const res = await call('does/not/exist')
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('endpoint_not_found')
    expect(forwardMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'endpoint_not_found', httpStatus: 404 }))
  })

  it('rejects a verb the endpoint does not accept with 405 + Allow', async () => {
    const res = await call('zones/list', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, POST')
    expect((await res.json()).code).toBe('method_not_allowed')
    expect(forwardMock).not.toHaveBeenCalled()
  })

  it.each(['PUT', 'DELETE'])('rejects non-GET/POST method %s with 405', async (method) => {
    const res = await call('zones/list', { method })
    expect(res.status).toBe(405)
    expect((await res.json()).code).toBe('method_not_allowed')
    expect(forwardMock).not.toHaveBeenCalled()
  })

  it('requires a token cookie and answers 401 when absent', async () => {
    const res = await call('zones/list')
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('missing_token')
    expect(forwardMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'missing_token', httpStatus: 401 }))
  })
})

describe('SSRF guard', () => {
  it('blocks a request-supplied cloud-metadata target and never forwards', async () => {
    const res = await call('status', { headers: { [TARGET_HEADER]: 'http://169.254.169.254/' } })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked_target')
    expect(forwardMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked_target' }))
  })
})

describe('successful JSON round-trip', () => {
  it('strips the envelope, sets cache/header policy and forwards the query + token', async () => {
    resolveWith(json({ status: 'ok', server: 's', response: { a: 1 } }))
    const res = await call('zones/list?x=1', { headers: authed() })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Dns-Target')).toBe(ORIGIN)
    expect(await res.json()).toEqual({ a: 1 })

    const arg = forwardArg()
    expect(arg.url.searchParams.get('x')).toBe('1')
    expect(arg.token).toBe(TOKEN)
    expect(arg.kind).toBe('json')
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'zones/list', domain: 'zones', method: 'GET', target: ORIGIN, httpStatus: 200 }),
    )
  })

  it('funnels a transport error from forward into the single error exit', async () => {
    forwardMock.mockRejectedValue(new DnsApiError('upstream_unreachable', 'down', { target: ORIGIN }))
    const res = await call('zones/list', { headers: authed() })
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('upstream_unreachable')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'upstream_unreachable', httpStatus: 502 }))
  })
})

describe('token cookie lifecycle', () => {
  it('user/login: sets an httpOnly cookie and strips the token from the body', async () => {
    const newToken = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    resolveWith(json({ status: 'ok', server: 's', token: newToken, displayName: 'admin', info: { x: 1 } }))
    const res = await call('user/login', { method: 'POST', body: 'user=admin&pass=p', headers: { 'content-type': 'application/x-www-form-urlencoded' } })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('token')
    expect(JSON.parse(text)).toEqual({ displayName: 'admin', info: { x: 1 } })

    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain(newToken)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).not.toContain('Secure')
  })

  it('user/login: returns two_factor_required when upstream gives no token', async () => {
    resolveWith(json({ status: 'ok', server: 's', displayName: 'admin' }))
    const res = await call('user/login', { method: 'POST', body: 'user=admin' })
    expect(res.status).toBe(428)
    expect((await res.json()).code).toBe('two_factor_required')
    expect(forwardMock).toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'two_factor_required' }))
  })

  it('user/session/get: strips the echoed session token from the body', async () => {
    resolveWith(json({ status: 'ok', server: 's', token: TOKEN, displayName: 'admin' }))
    const res = await call('user/session/get', { headers: authed() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(TOKEN)
    expect(JSON.parse(text)).toEqual({ displayName: 'admin' })
  })

  it('user/createToken: keeps the freshly minted long-lived token in the body', async () => {
    const longToken = 'long-lived-api-token-0123456789abcdef'
    resolveWith(json({ status: 'ok', server: 's', response: { token: longToken, name: 'mykey' } }))
    const res = await call('user/createToken', { method: 'POST', body: 'name=mykey', headers: authed() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(longToken)
    expect(JSON.parse(text)).toEqual({ token: longToken, name: 'mykey' })
  })

  it('user/logout: clears the cookie', async () => {
    resolveWith(json({ status: 'ok', server: 's', response: null }))
    const res = await call('user/logout', { headers: authed() })
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('Max-Age=0')
    expect(cookies[0]).toContain('HttpOnly')
  })

  it('user/session/delete: clears the cookie', async () => {
    resolveWith(json({ status: 'ok', server: 's', response: null }))
    const res = await call('user/session/delete', { headers: authed() })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()[0]).toContain('Max-Age=0')
  })

  it('upstream invalid-token: answers 401 and clears the cookie so the UI stops retrying', async () => {
    resolveWith(json({ status: 'invalid-token' }))
    const res = await call('zones/list', { headers: authed() })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('invalid_token')
    expect(res.headers.getSetCookie()[0]).toContain('Max-Age=0')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_token', httpStatus: 401 }))
  })
})

describe('secure cookie flag', () => {
  it('marks the login cookie Secure for an https request', async () => {
    resolveWith(json({ status: 'ok', token: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', displayName: 'admin' }))
    const request = new Request('https://localhost:3000/api/dns/user/login', { method: 'POST', body: 'u=1' })
    const res = await handleProxy(request, ['user', 'login'], { config: CONFIG })
    expect(res.headers.getSetCookie()[0]).toContain('Secure')
  })

  it('marks the login cookie Secure when x-forwarded-proto is https', async () => {
    resolveWith(json({ status: 'ok', token: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', displayName: 'admin' }))
    const request = new Request('http://localhost:3000/api/dns/user/login', {
      method: 'POST',
      body: 'u=1',
      headers: { 'x-forwarded-proto': 'https' },
    })
    const res = await handleProxy(request, ['user', 'login'], { config: CONFIG })
    expect(res.headers.getSetCookie()[0]).toContain('Secure')
  })
})

describe('file downloads', () => {
  it('streams a non-JSON file body through and preserves Content-Disposition', async () => {
    resolveWith(
      new Response('BINARYDATA', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="zone.txt"' },
      }),
    )
    const res = await call('zones/export', { headers: authed() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="zone.txt"')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('BINARYDATA')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'zones/export', httpStatus: 200 }))
  })

  it('derives a filename when the upstream omits Content-Disposition', async () => {
    resolveWith(new Response('DATA', { status: 200, headers: { 'content-type': 'application/octet-stream' } }))
    const res = await call('zones/export', { headers: authed() })
    expect(res.headers.get('Content-Disposition')).toContain('export.bin')
  })

  it('routes a JSON error from a file endpoint down the error path, not as a download', async () => {
    resolveWith(json({ status: 'error', errorMessage: 'export failed' }))
    const res = await call('zones/export', { headers: authed() })
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('upstream_error')
    expect(body.message).toBe('export failed')
  })
})

describe('body and header forwarding policy', () => {
  it('sends body null and no content type for an empty POST', async () => {
    resolveWith(json({ status: 'ok', server: 's', response: { ok: true } }))
    await call('zones/records/add', { method: 'POST', headers: authed() })
    const arg = forwardArg()
    expect(arg.body).toBeNull()
    expect(arg.contentType).toBeUndefined()
  })

  it('passes through allowlisted headers and drops credentials', async () => {
    resolveWith(json({ status: 'ok', server: 's', version: '15.4' }))
    await call('status', {
      headers: { 'accept-language': 'en-US', 'x-requested-with': 'XHR', cookie: 'evil=1', authorization: 'Bearer evil' },
    })
    const arg = forwardArg()
    expect(arg.headers).toEqual({ 'accept-language': 'en-US', 'x-requested-with': 'XHR' })
    expect(arg.token).toBeUndefined()
  })
})
