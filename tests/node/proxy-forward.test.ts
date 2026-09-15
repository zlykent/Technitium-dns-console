import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetch } from 'undici'
import { closeAllDispatchers, encodeForm, forward, timeoutFor, type ForwardOptions } from '@/lib/proxy/forward'
import { DnsApiError } from '@/lib/api/errors'
import type { ProxyTarget } from '@/lib/proxy/target'

/**
 * `forward` is the only module that touches a socket. It owns three contracts the
 * rest of the proxy relies on:
 *
 *  1. **Credential injection is the proxy's job.** It adds `Authorization: Bearer`
 *     from the httpOnly cookie and must NEVER forward a client-supplied `cookie`
 *     header — otherwise the browser could smuggle credentials to an arbitrary
 *     upstream.
 *  2. **Transport failures become typed errors.** Timeouts -> `upstream_timeout`,
 *     everything else -> `upstream_unreachable`, with the underlying socket detail
 *     preserved in `innerMessage`. An HTTP 4xx/5xx is NOT a transport failure: the
 *     raw response is handed back for `translateUpstream` to interpret.
 *  3. **Timeouts depend on response kind** — a JSON call fails fast, a file
 *     download is patient.
 *
 * undici is fully stubbed, so no real network traffic occurs.
 */

vi.mock('undici', () => {
  // A real class (not an arrow vi.fn) because forward.ts does `new Agent(...)`.
  class MockAgent {
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  return { fetch: vi.fn(), Agent: MockAgent }
})

const fetchMock = vi.mocked(fetch)

const target: ProxyTarget = {
  baseUrl: 'http://1.2.3.4:5380',
  origin: 'http://1.2.3.4:5380',
  hostname: '1.2.3.4',
  pinnedAddress: '1.2.3.4',
  family: 4,
  fromEnv: false,
}

interface ForwardInit {
  method: string
  headers: Record<string, string>
  body: unknown
}

function lastInit(): ForwardInit {
  const call = fetchMock.mock.calls.at(-1)
  return call?.[1] as unknown as ForwardInit
}

function options(overrides: Partial<ForwardOptions> = {}): ForwardOptions {
  return {
    target,
    url: new URL('http://1.2.3.4:5380/api/zones/list'),
    method: 'GET',
    kind: 'json',
    ...overrides,
  }
}

async function rejection(promise: Promise<unknown>): Promise<DnsApiError> {
  try {
    await promise
  } catch (err) {
    return err as DnsApiError
  }
  throw new Error('expected forward() to reject')
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('ok', { status: 200 }) as unknown as Awaited<ReturnType<typeof fetch>>)
})

afterEach(async () => {
  await closeAllDispatchers()
})

describe('encodeForm', () => {
  it('drops undefined and null values', () => {
    expect(encodeForm({ a: 1, b: undefined, c: null, d: 'x' }).body).toBe('a=1&d=x')
  })

  it('expands arrays into repeated keys, skipping nullish items', () => {
    expect(encodeForm({ tag: ['a', 'b', null, 'c'] }).body).toBe('tag=a&tag=b&tag=c')
  })

  it('serialises booleans as true/false', () => {
    expect(encodeForm({ on: true, off: false }).body).toBe('on=true&off=false')
  })

  it('serialises nested objects as JSON', () => {
    const { body } = encodeForm({ filter: { zone: 'a.com' } })
    expect(body).toBe(`filter=${encodeURIComponent('{"zone":"a.com"}')}`)
  })

  it('serialises numbers as strings', () => {
    expect(encodeForm({ ttl: 300 }).body).toBe('ttl=300')
  })

  it('reports the form content type', () => {
    expect(encodeForm({ a: 1 }).contentType).toBe('application/x-www-form-urlencoded; charset=utf-8')
  })

  it('percent-encodes special characters', () => {
    expect(encodeForm({ q: 'a b&c=d+e' }).body).toBe('q=a+b%26c%3Dd%2Be')
  })
})

describe('timeoutFor', () => {
  it('uses the documented defaults', () => {
    expect(timeoutFor('json')).toBe(30_000)
    expect(timeoutFor('file')).toBe(120_000)
    expect(timeoutFor('upload')).toBe(120_000)
  })

  it('gives file and upload the same, longer timeout than json', () => {
    expect(timeoutFor('file')).toBe(timeoutFor('upload'))
    expect(timeoutFor('file')).toBeGreaterThan(timeoutFor('json'))
  })

  it('reads the timeout constants from env at module load', async () => {
    // The constants are captured once when the module is first evaluated, so the
    // only way to observe the env override is to stub the vars, drop the module
    // registry, and re-import a fresh copy.
    vi.stubEnv('PROXY_TIMEOUT_JSON_MS', '1234')
    vi.stubEnv('PROXY_TIMEOUT_FILE_MS', '9999')
    vi.resetModules()
    const fresh = await import('@/lib/proxy/forward')
    expect(fresh.timeoutFor('json')).toBe(1234)
    expect(fresh.timeoutFor('file')).toBe(9999)
    expect(fresh.timeoutFor('upload')).toBe(9999)
    vi.unstubAllEnvs()
  })
})

describe('forward — header policy', () => {
  it('injects an Authorization header when a token is present', async () => {
    await forward(options({ token: 'abc123' }))
    expect(lastInit().headers.Authorization).toBe('Bearer abc123')
  })

  it('omits the Authorization header when no token is present', async () => {
    await forward(options())
    expect('Authorization' in lastInit().headers).toBe(false)
  })

  it('asks for JSON on json calls and anything on file calls', async () => {
    await forward(options({ kind: 'json' }))
    expect(lastInit().headers.Accept).toBe('application/json')
    await forward(options({ kind: 'file' }))
    expect(lastInit().headers.Accept).toBe('*/*')
  })

  it('merges caller-supplied headers', async () => {
    await forward(options({ headers: { 'accept-language': 'en-GB', 'x-requested-with': 'XHR' } }))
    const headers = lastInit().headers
    expect(headers['accept-language']).toBe('en-GB')
    expect(headers['x-requested-with']).toBe('XHR')
  })

  it('sets the content type when one is supplied', async () => {
    await forward(options({ method: 'POST', body: 'a=1', contentType: 'application/x-www-form-urlencoded; charset=utf-8' }))
    expect(lastInit().headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8')
  })

  it('never sends a cookie header upstream', async () => {
    await forward(options({ token: 'abc', headers: { 'accept-language': 'en' } }))
    const keys = Object.keys(lastInit().headers).map((k) => k.toLowerCase())
    expect(keys).not.toContain('cookie')
    expect(keys).not.toContain('set-cookie')
  })
})

describe('forward — body handling', () => {
  it('passes undefined (not null) when there is no body', async () => {
    await forward(options({ body: null }))
    expect(lastInit().body).toBeUndefined()
  })

  it('passes a provided body through verbatim', async () => {
    await forward(options({ method: 'POST', body: 'a=1' }))
    expect(lastInit().body).toBe('a=1')
  })
})

describe('forward — error mapping', () => {
  it('maps a TimeoutError DOMException to upstream_timeout', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    const err = await rejection(forward(options()))
    expect(err.code).toBe('upstream_timeout')
    expect(err.httpStatus).toBe(504)
  })

  it('maps an undici headers-timeout error to upstream_timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' }))
    const err = await rejection(forward(options()))
    expect(err.code).toBe('upstream_timeout')
  })

  it('maps an AbortError to upstream_timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const err = await rejection(forward(options()))
    expect(err.code).toBe('upstream_timeout')
  })

  it('maps a refused connection to upstream_unreachable and keeps the cause', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5380'), { code: 'ECONNREFUSED' })
    fetchMock.mockRejectedValueOnce(new Error('fetch failed', { cause }))
    const err = await rejection(forward(options()))
    expect(err.code).toBe('upstream_unreachable')
    expect(err.httpStatus).toBe(502)
    expect(err.innerMessage).toContain('ECONNREFUSED')
  })
})

describe('forward — http error statuses are not thrown', () => {
  it.each([400, 401, 404, 429, 500])('returns the raw response for HTTP %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status }) as unknown as Awaited<ReturnType<typeof fetch>>)
    const result = await forward(options())
    expect(result.response.status).toBe(status)
    expect(typeof result.durationMs).toBe('number')
  })
})
