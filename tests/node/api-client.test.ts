import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROXY_BASE,
  TARGET_HEADER,
  apiDownload,
  apiDownloadBlob,
  apiRequest,
  describeError,
  getActiveTarget,
  saveBlob,
  setActiveTarget,
} from '@/lib/api/client'
import { DnsApiError } from '@/lib/api/errors'
import type { EndpointId } from '@/lib/api/registry'

/**
 * The browser half of the transport.
 *
 * Everything here is a contract a caller cannot see: the exact URL the proxy is
 * asked for, how Technitium's quirky parameter encoding is reproduced, which
 * verb is chosen, and — above all — that a credential never appears in a URL.
 * The stock console downloads by opening `api/…?token=…`, which lands the token
 * in browser history, in every intermediary access log and in any `Referer`
 * that leaks off the page; this client streams through the proxy instead, and
 * the download tests assert the query string stays clean so the shortcut can
 * never be reintroduced as an "optimisation".
 *
 * `fetch` is stubbed as a global rather than the module being mocked: the module
 * under test owns URL building, header policy and error translation, and mocking
 * any of that away would leave nothing to test.
 */

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called')
  return { url: String(call[0]), init: call[1] ?? {} }
}

function lastHeaders(): Headers {
  return new Headers(lastCall().init.headers as HeadersInit)
}

function lastSearchParams(): URLSearchParams {
  return new URL(lastCall().url, 'http://local').searchParams
}

function lastBodyText(): string {
  const body = lastCall().init.body
  if (typeof body !== 'string') throw new Error(`expected a string body, got ${typeof body}`)
  return body
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setActiveTarget(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('transport constants', () => {
  it('routes every call through the proxy prefix', () => {
    expect(PROXY_BASE).toBe('/api/dns')
  })

  it('names the target header the proxy reads', () => {
    expect(TARGET_HEADER).toBe('X-Dns-Target')
    expect(TARGET_HEADER.toLowerCase()).toBe('x-dns-target')
  })
})

describe('apiRequest URL construction', () => {
  it('asks for a relative proxy path, never an absolute upstream URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ zones: [] }))
    await expect(apiRequest<{ zones: string[] }>('zones/list')).resolves.toEqual({ zones: [] })
    const { url } = lastCall()
    expect(url).toBe('/api/dns/zones/list')
    expect(url.startsWith('/')).toBe(true)
    expect(url).not.toContain('http')
  })

  it('keeps the slashes of a nested endpoint id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/records/get', { params: { zone: 'example.com' } })
    expect(lastCall().url).toBe('/api/dns/zones/records/get?zone=example.com')
  })

  it('sends same-origin credentials and never a cached answer', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('status')
    const { init } = lastCall()
    // The token lives in an httpOnly cookie; dropping `same-origin` would send
    // the request unauthenticated, and a cached 200 would hide a dead server.
    expect(init.credentials).toBe('same-origin')
    expect(init.cache).toBe('no-store')
    expect(lastHeaders().get('Accept')).toBe('application/json')
  })

  it('appends query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { params: { zone: 'example.com', pageNumber: 2 } })
    expect(lastSearchParams().get('zone')).toBe('example.com')
    expect(lastSearchParams().get('pageNumber')).toBe('2')
  })
})

describe('apiRequest parameter encoding', () => {
  it('joins an array into one comma-separated value', async () => {
    // NOTE: the `RequestOptions.params` doc comment promises repeated keys
    // (`key=a&key=b`); the implementation comma-joins, which is what Technitium
    // parses. The implementation is authoritative — see the report.
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { params: { zone: ['a.example', 'b.example'] } })
    expect(lastSearchParams().getAll('zone')).toEqual(['a.example,b.example'])
    expect(lastCall().url).toBe('/api/dns/zones/list?zone=a.example%2Cb.example')
  })

  it('drops nulls and undefined from an array and skips an empty one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { params: { a: [null, 'x', undefined, 3, true], b: [], c: [null] } })
    expect(lastSearchParams().getAll('a')).toEqual(['x,3,true'])
    expect(lastSearchParams().has('b')).toBe(false)
    expect(lastSearchParams().has('c')).toBe(false)
  })

  it('omits undefined and null parameters entirely', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { params: { zone: undefined, keyword: null, kept: 'yes' } })
    expect(lastCall().url).toBe('/api/dns/zones/list?kept=yes')
    expect(lastSearchParams().has('zone')).toBe(false)
    expect(lastSearchParams().has('keyword')).toBe(false)
  })

  it('stringifies booleans and numbers the way the API spells them', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { params: { includeDnsSec: true, disabled: false, ttl: 3600, zero: 0 } })
    expect(lastSearchParams().get('includeDnsSec')).toBe('true')
    expect(lastSearchParams().get('disabled')).toBe('false')
    expect(lastSearchParams().get('ttl')).toBe('3600')
    // `0` is a meaningful value (page 0, TTL 0) and must not be dropped.
    expect(lastSearchParams().get('zero')).toBe('0')
  })

  it('percent-encodes non-ASCII, spaces and query separators', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const params = { cn: '中文区域', spaced: 'a b', amp: 'a&b', eq: 'x=y', plus: 'a+b', slash: 'a/b' }
    await apiRequest('logs/query', { params })
    const search = lastSearchParams()
    expect(search.get('cn')).toBe('中文区域')
    expect(search.get('spaced')).toBe('a b')
    expect(search.get('amp')).toBe('a&b')
    expect(search.get('eq')).toBe('x=y')
    expect(search.get('plus')).toBe('a+b')
    expect(search.get('slash')).toBe('a/b')

    const url = lastCall().url
    const raw = url.slice(url.indexOf('?') + 1)
    // URLSearchParams uses the form-encoder: space becomes `+`, and a literal
    // `+` in a value must survive as `%2B` or the server reads a space.
    expect(raw).toContain('spaced=a+b')
    expect(raw).toContain('plus=a%2Bb')
    expect(raw).toContain('amp=a%26b')
    expect(raw).toContain('eq=x%3Dy')
    expect(raw).toContain('cn=%E4%B8%AD%E6%96%87%E5%8C%BA%E5%9F%9F')
    expect(raw).not.toContain('a&b')
  })

  it('drops a File from the query string instead of stringifying it', async () => {
    // A `File` only has a meaning inside a multipart body; `[object File]` in a
    // query string would be sent to the server as a literal value.
    fetchMock.mockResolvedValue(jsonResponse({}))
    const file = new File(['$ORIGIN example.com.'], 'zone.txt', { type: 'text/plain' })
    await apiRequest('zones/import', { params: { file, zone: 'example.com' } })
    expect(lastSearchParams().has('file')).toBe(false)
    expect(lastCall().url).not.toContain('object')
    expect(lastSearchParams().get('zone')).toBe('example.com')
  })

  it('drops a File from a form-encoded body for the same reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const file = new File(['x'], 'a.bin')
    await apiRequest('admin/users/set', { body: { file, username: 'admin' } })
    expect(lastBodyText()).toBe('username=admin')
  })
})

describe('setActiveTarget', () => {
  it('sends no target header for the operator-configured default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    setActiveTarget(null)
    expect(getActiveTarget()).toBeNull()
    await apiRequest('status')
    expect(lastHeaders().has(TARGET_HEADER)).toBe(false)
  })

  it('sends the normalised origin once a server is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    setActiveTarget('http://10.0.0.5:5380')
    expect(getActiveTarget()).toBe('http://10.0.0.5:5380')
    await apiRequest('status')
    expect(lastHeaders().get(TARGET_HEADER)).toBe('http://10.0.0.5:5380')
  })

  it('normalises a bare host:port, a path and mixed case down to an origin', () => {
    setActiveTarget('10.0.0.5:5380')
    expect(getActiveTarget()).toBe('http://10.0.0.5:5380')
    setActiveTarget('HTTPS://DNS.Example.COM:8443/api/status')
    expect(getActiveTarget()).toBe('https://dns.example.com:8443')
    setActiveTarget('http://10.0.0.5:5380///')
    expect(getActiveTarget()).toBe('http://10.0.0.5:5380')
    setActiveTarget('   http://10.0.0.9:5380   ')
    expect(getActiveTarget()).toBe('http://10.0.0.9:5380')
  })

  it('passes an unparseable value through so the proxy can reject it with a translation', () => {
    // Swallowing it here would turn "bad address" into "no target configured".
    setActiveTarget('ftp://router')
    expect(getActiveTarget()).toBe('ftp://router')
    setActiveTarget('not a url')
    expect(getActiveTarget()).toBe('not a url')
    // A scheme with no host is not parseable, so it takes the strip-trailing-
    // slashes path too — the value is still non-null, so the header is sent and
    // the proxy answers `blocked_target` instead of the client pretending there
    // is no server configured.
    setActiveTarget('http://')
    expect(getActiveTarget()).toBe('http:')
  })

  it('treats blank input as "no target" rather than as an address', () => {
    setActiveTarget('http://10.0.0.5:5380')
    setActiveTarget('')
    expect(getActiveTarget()).toBeNull()
    setActiveTarget('http://10.0.0.5:5380')
    setActiveTarget('   ')
    expect(getActiveTarget()).toBeNull()
  })

  it('clears the header again when the operator switches back to the default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    setActiveTarget('http://10.0.0.5:5380')
    setActiveTarget(null)
    await apiRequest('status')
    expect(lastHeaders().has(TARGET_HEADER)).toBe(false)
  })

  it('applies the header to downloads too', async () => {
    fetchMock.mockResolvedValue(new Response('bytes', { status: 200 }))
    setActiveTarget('http://10.0.0.5:5380')
    await apiDownloadBlob('zones/export', { zone: 'example.com' })
    expect(lastHeaders().get(TARGET_HEADER)).toBe('http://10.0.0.5:5380')
  })
})

describe('apiRequest verb and body selection', () => {
  it('defaults to the first verb the endpoint declares', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list')
    expect(lastCall().init.method).toBe('GET')
    expect(lastCall().init.body).toBeUndefined()
  })

  it('defaults to POST for an endpoint that lists POST first', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('settings/set')
    expect(lastCall().init.method).toBe('POST')
  })

  it('upgrades to POST and form-encodes a body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('admin/users/set', { body: { username: 'admin', enabled: true } })
    expect(lastCall().init.method).toBe('POST')
    expect(lastHeaders().get('Content-Type')).toBe('application/x-www-form-urlencoded; charset=utf-8')
    expect(lastBodyText()).toBe('username=admin&enabled=true')
  })

  it('keeps GET and drops the body for an endpoint that only accepts GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/list', { body: { zone: 'example.com' } })
    expect(lastCall().init.method).toBe('GET')
    expect(lastCall().init.body).toBeUndefined()
    expect(lastHeaders().has('Content-Type')).toBe(false)
  })

  it('ignores a body when the caller forces GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('admin/users/set', { method: 'GET', body: { username: 'admin' } })
    expect(lastCall().init.method).toBe('GET')
    expect(lastCall().init.body).toBeUndefined()
  })

  it('passes a FormData body through untouched and lets the browser set the boundary', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const form = new FormData()
    form.set('zone', 'example.com')
    form.set('file', new File(['$ORIGIN'], 'zone.txt', { type: 'text/plain' }))
    await apiRequest('zones/create', { formData: form })
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().init.body).toBe(form)
    // A hand-written Content-Type would omit the multipart boundary and the
    // upstream would fail to parse the upload.
    expect(lastHeaders().has('Content-Type')).toBe(false)
  })

  it('posts raw text as text/plain', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const zoneFile = '$ORIGIN example.com.\n@ 3600 IN SOA ns1 admin 1 3600 600 86400 3600\n'
    await apiRequest('zones/import', { text: { value: zoneFile } })
    expect(lastCall().init.method).toBe('POST')
    expect(lastHeaders().get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(lastBodyText()).toBe(zoneFile)
  })

  it('honours an explicit content type for a raw text body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiRequest('zones/import', { text: { value: 'a,b,c', contentType: 'text/csv' } })
    expect(lastHeaders().get('Content-Type')).toBe('text/csv')
    expect(lastBodyText()).toBe('a,b,c')
  })

  it('prefers formData over both body and text', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const form = new FormData()
    form.set('zone', 'example.com')
    await apiRequest('zones/import', { formData: form, body: { zone: 'ignored' }, text: { value: 'ignored' } })
    expect(lastCall().init.body).toBe(form)
    expect(lastHeaders().has('Content-Type')).toBe(false)
  })

  it('rejects a verb the endpoint does not accept before calling fetch', async () => {
    const error = await apiRequest('user/login', { method: 'GET' }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(DnsApiError)
    expect((error as DnsApiError).code).toBe('method_not_allowed')
    expect((error as DnsApiError).httpStatus).toBe(405)
    expect((error as DnsApiError).endpoint).toBe('user/login')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an endpoint id outside the registry before calling fetch', async () => {
    const error = await apiRequest('not/an/endpoint' as EndpointId).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(DnsApiError)
    expect((error as DnsApiError).code).toBe('endpoint_not_found')
    expect((error as DnsApiError).httpStatus).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('apiRequest response handling', () => {
  it('returns the parsed JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ zones: ['example.com'] }))
    await expect(apiRequest<{ zones: string[] }>('zones/list')).resolves.toEqual({ zones: ['example.com'] })
  })

  it('returns the response text when raw is requested', async () => {
    // `raw` yields the *body as text*, not the Response object: the zone-file
    // preview wants the text and nothing else.
    const zoneFile = '$ORIGIN example.com.\n@ 3600 IN A 10.0.0.1\n'
    fetchMock.mockResolvedValue(new Response(zoneFile, { status: 200, headers: { 'content-type': 'text/plain' } }))
    await expect(apiRequest<string>('zones/export', { raw: true, params: { zone: 'example.com' } })).resolves.toBe(zoneFile)
  })

  it('forwards an abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const controller = new AbortController()
    await apiRequest('zones/list', { signal: controller.signal })
    expect(lastCall().init.signal).toBe(controller.signal)
  })

  it('turns a JSON error body into a DnsApiError carrying code, status and details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'upstream_error', message: 'Zone does not exist.', innerMessage: 'DnsApiException' }, { status: 400 }),
    )
    const error = await apiRequest('zones/delete', { params: { zone: 'nope.example' } }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(DnsApiError)
    const apiError = error as DnsApiError
    expect(apiError.code).toBe('upstream_error')
    expect(apiError.httpStatus).toBe(400)
    expect(apiError.message).toBe('Zone does not exist.')
    expect(apiError.innerMessage).toBe('DnsApiException')
    expect(apiError.isAuthFailure).toBe(false)
  })

  it('flags a 401 body as an auth failure so the UI can re-authenticate', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'invalid_token', message: 'Token is invalid.' }, { status: 401 }))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('invalid_token')
    expect(error.httpStatus).toBe(401)
    expect(error.isAuthFailure).toBe(true)
    expect(describeError(error).isAuth).toBe(true)
  })

  it('degrades to proxy_error when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error).toBeInstanceOf(DnsApiError)
    expect(error.code).toBe('proxy_error')
    expect(error.message).toBe("The proxy answered HTTP 502 for 'zones/list'.")
    // The transport status survives only in the message: `proxy_error` is a 500
    // by contract, so a caller cannot mistake a dead upstream for a dead proxy.
    expect(error.httpStatus).toBe(500)
  })

  it('degrades to proxy_error when the body is empty', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('proxy_error')
    expect(error.message).toBe("The proxy answered HTTP 500 for 'zones/list'.")
  })

  it('keeps the transport status when the body carries an unknown code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'brand_new_code', message: 'from the future' }, { status: 503 }))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('proxy_error')
    expect(error.httpStatus).toBe(503)
    expect(error.message).toBe('Request failed.')
  })

  it('treats a JSON body without a code field as no body at all', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'no code here' }, { status: 502 }))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('proxy_error')
    expect(error.message).toBe("The proxy answered HTTP 502 for 'zones/list'.")
  })

  it('wraps a network failure and keeps the original message as innerMessage', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error).toBeInstanceOf(DnsApiError)
    expect(error.code).toBe('proxy_error')
    expect(error.httpStatus).toBe(500)
    expect(error.innerMessage).toBe('Failed to fetch')
    expect(error.endpoint).toBe('zones/list')
  })

  it('rethrows an abort untouched so callers can distinguish a cancel from a failure', async () => {
    const abort = new DOMException('This operation was aborted', 'AbortError')
    fetchMock.mockRejectedValue(abort)
    await expect(apiRequest('zones/list')).rejects.toBe(abort)
  })

  it('wraps a non-Error rejection with its string form', async () => {
    fetchMock.mockRejectedValue('socket closed')
    const error = (await apiRequest('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('proxy_error')
    expect(error.innerMessage).toBe('socket closed')
  })
})

describe('describeError', () => {
  it('passes a DnsApiError through with its code and auth flag', () => {
    const err = new DnsApiError('blocked_target', 'That server is not allowed.', { endpoint: 'zones/list' })
    expect(describeError(err)).toEqual({ code: 'blocked_target', message: 'That server is not allowed.', isAuth: false })
  })

  it('appends the upstream inner message when there is one', () => {
    const err = new DnsApiError('upstream_error', 'Zone not found.', { innerMessage: 'DnsApiException: nope' })
    expect(describeError(err).message).toBe('Zone not found. (DnsApiException: nope)')
  })

  it('reports the auth flag for a session-loss code', () => {
    expect(describeError(new DnsApiError('invalid_token', 'gone')).isAuth).toBe(true)
    expect(describeError(new DnsApiError('missing_token', 'none')).isAuth).toBe(true)
    expect(describeError(new DnsApiError('upstream_timeout', 'slow')).isAuth).toBe(false)
  })

  it('falls back to "unknown" for an ordinary Error', () => {
    expect(describeError(new Error('render blew up'))).toEqual({ code: 'unknown', message: 'render blew up', isAuth: false })
  })

  it('falls back to "unknown" for a network TypeError raised outside apiRequest', () => {
    // Only `apiRequest` knows enough to call this `proxy_error`; a TypeError that
    // reaches a catch block directly (an image load, a manual fetch) has no code.
    const described = describeError(new TypeError('Failed to fetch'))
    expect(described).toEqual({ code: 'unknown', message: 'Failed to fetch', isAuth: false })
  })

  it('never throws, whatever it is handed', () => {
    expect(describeError(null)).toEqual({ code: 'unknown', message: 'null', isAuth: false })
    expect(describeError(undefined)).toEqual({ code: 'unknown', message: 'undefined', isAuth: false })
    expect(describeError('boom')).toEqual({ code: 'unknown', message: 'boom', isAuth: false })
    expect(describeError(42)).toEqual({ code: 'unknown', message: '42', isAuth: false })
    expect(describeError({ code: 'invalid_token' })).toEqual({ code: 'unknown', message: '[object Object]', isAuth: false })
  })

  it('reads a duck-typed error from another realm without throwing', () => {
    const described = describeError({ name: 'DnsApiError', code: 'upstream_timeout', message: 'slow', isAuthFailure: false })
    expect(described.code).toBe('upstream_timeout')
    expect(described.message).toBe('slow')
    expect(described.isAuth).toBe(false)
  })
})

describe('saveBlob', () => {
  interface FakeAnchor {
    href: string
    download: string
    rel: string
    click: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }

  function stubDocument(): { anchor: FakeAnchor; appendChild: ReturnType<typeof vi.fn> } {
    const anchor: FakeAnchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } })
    return { anchor, appendChild }
  }

  it('drives a hidden download anchor and releases the object URL', () => {
    vi.useFakeTimers()
    const { anchor, appendChild } = stubDocument()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/mock')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const blob = new Blob(['$ORIGIN example.com.'], { type: 'text/plain' })

    saveBlob(blob, 'example.com.zone')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(anchor.href).toBe('blob:http://localhost/mock')
    expect(anchor.download).toBe('example.com.zone')
    // `rel=noopener` keeps the download from getting a window.opener handle.
    expect(anchor.rel).toBe('noopener')
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledTimes(1)
    // The anchor must leave the DOM again or every export adds a node.
    expect(anchor.remove).toHaveBeenCalledTimes(1)

    // Not revoking leaks a blob URL for the lifetime of the tab; the delay exists
    // so Safari has time to start the download first.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock')
  })
})

describe('apiDownload', () => {
  interface FakeAnchor {
    href: string
    download: string
    rel: string
    click: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }

  /** Stub the DOM pieces `saveBlob` needs and hand back the anchor it fills in. */
  function stubDocument(): FakeAnchor {
    const anchor: FakeAnchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return anchor
  }

  it('never puts a credential in the URL', async () => {
    // Security contract: the stock console opens `api/zones/export?token=…`,
    // which persists the token in history, server logs and any Referer.
    const anchor = stubDocument()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(new Response('zone bytes', { status: 200 }))
    await apiDownload('zones/export', { zone: 'example.com', includeDnsSec: true })

    const { url, init } = lastCall()
    expect(url).toBe('/api/dns/zones/export?zone=example.com&includeDnsSec=true')
    expect(url.toLowerCase()).not.toContain('token')
    expect(url.toLowerCase()).not.toContain('authorization')
    expect(url.toLowerCase()).not.toContain('password')
    expect(init.credentials).toBe('same-origin')
    expect(lastHeaders().get(TARGET_HEADER)).toBeNull()
    expect(lastHeaders().get('Accept')).toBe('*/*')
    expect(anchor.download).toBe('zones-export.bin')
    vi.advanceTimersByTime(1000)
  })

  it('takes the filename from an RFC 5987 Content-Disposition', async () => {
    const anchor = stubDocument()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      new Response('zone bytes', {
        status: 200,
        headers: { 'content-disposition': "attachment; filename*=UTF-8''ex%C3%A4mple.com.zone" },
      }),
    )
    await apiDownload('zones/export', { zone: 'exämple.com' })
    expect(anchor.download).toBe('exämple.com.zone')
    vi.advanceTimersByTime(1000)
  })

  it('prefers a suggested name over the header', async () => {
    const anchor = stubDocument()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      new Response('backup', { status: 200, headers: { 'content-disposition': 'attachment; filename="server.zip"' } }),
    )
    await apiDownload('settings/backup', {}, 'backup-2026-01-01.zip')
    expect(anchor.download).toBe('backup-2026-01-01.zip')
    vi.advanceTimersByTime(1000)
  })

  it('falls back to a derived filename when nothing is advertised', async () => {
    const anchor = stubDocument()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(new Response('logs', { status: 200 }))
    await apiDownload('logs/download')
    expect(anchor.download).toBe('logs-download.bin')
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(anchor.remove).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
  })

  it('refuses an endpoint that is not a download', async () => {
    const error = (await apiDownload('zones/list').catch((err: unknown) => err)) as DnsApiError
    expect(error).toBeInstanceOf(DnsApiError)
    expect(error.code).toBe('proxy_error')
    expect(error.message).toBe("'zones/list' is not a download endpoint.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unknown endpoint', async () => {
    const error = (await apiDownload('nope/nope' as EndpointId).catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('endpoint_not_found')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('translates a failed download into a DnsApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'invalid_token', message: 'Token is invalid.' }, { status: 401 }))
    const error = (await apiDownload('zones/export').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('invalid_token')
    expect(error.httpStatus).toBe(401)
    expect(error.isAuthFailure).toBe(true)
  })

  it('wraps a network failure during download', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = (await apiDownload('zones/export').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('proxy_error')
    expect(error.message).toBe('The download request failed.')
    expect(error.innerMessage).toBe('Failed to fetch')
  })
})

describe('apiDownloadBlob', () => {
  it('returns the bytes and a filename without touching the DOM', async () => {
    fetchMock.mockResolvedValue(
      new Response('$ORIGIN example.com.', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="example.com.zone"' },
      }),
    )
    const { blob, filename } = await apiDownloadBlob('zones/export', { zone: 'example.com' })
    expect(filename).toBe('example.com.zone')
    expect(await blob.text()).toBe('$ORIGIN example.com.')
    expect(lastCall().url).toBe('/api/dns/zones/export?zone=example.com')
    expect(lastCall().url.toLowerCase()).not.toContain('token')
  })

  it('decodes a percent-encoded plain filename', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-disposition': 'attachment; filename="ex%C3%A4mple.zone"' } }),
    )
    await expect(apiDownloadBlob('zones/export')).resolves.toMatchObject({ filename: 'exämple.zone' })
  })

  it('falls back to a derived filename', async () => {
    fetchMock.mockResolvedValue(new Response('x', { status: 200 }))
    await expect(apiDownloadBlob('allowed/export')).resolves.toMatchObject({ filename: 'allowed-export.bin' })
  })

  it('keeps a filename that cannot be percent-decoded', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-disposition': 'attachment; filename="bad%zz.zone"' } }),
    )
    await expect(apiDownloadBlob('zones/export')).resolves.toMatchObject({ filename: 'bad%zz.zone' })
  })

  it('translates a failed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'upstream_unreachable', message: 'No route.' }, { status: 502 }))
    const error = (await apiDownloadBlob('zones/export').catch((err: unknown) => err)) as DnsApiError
    expect(error.code).toBe('upstream_unreachable')
    expect(error.httpStatus).toBe(502)
  })

  it('does not check the endpoint kind, unlike apiDownload', async () => {
    // Documented asymmetry: the preview dialog streams whatever endpoint it is
    // given, so the caller — not this function — has to pick a file endpoint.
    fetchMock.mockResolvedValue(jsonResponse({ zones: [] }))
    await apiDownloadBlob('zones/list')
    expect(lastCall().url).toBe('/api/dns/zones/list')
  })

  it('leaves a transport failure as a raw rejection, unlike apiDownload', async () => {
    // apiDownload catches fetch errors and wraps them; this one does not, so the
    // caller sees the browser's own TypeError. Asserted so the difference is a
    // deliberate contract rather than an accident someone silently "fixes".
    const failure = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValue(failure)
    await expect(apiDownloadBlob('zones/export')).rejects.toBe(failure)
  })
})
