import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { DnsApiError } from '@/lib/api/errors'
import type { ApiKind } from '@/lib/api/registry'
import type { ProxyTarget } from './target'

/**
 * Upstream transport.
 *
 * Everything that touches the socket lives here so the rest of the proxy kernel
 * stays pure and unit-testable: given a target, an endpoint and a body, hand
 * back the raw upstream `Response` or throw a `DnsApiError`.
 *
 * Two things matter:
 *
 *  - **IP pinning.** `target.pinnedAddress` was validated by `resolveTarget`.
 *    We install a `connect.lookup` hook that answers with *only* that address,
 *    so a second DNS lookup cannot swap in an internal IP (DNS rebinding).
 *    The URL keeps the real hostname, which preserves the `Host` header and TLS
 *    SNI that Technitium's web service may check.
 *  - **Timeouts by response kind.** A JSON call that takes 30s is broken; a
 *    zone export or a backup download taking two minutes is normal.
 *
 * `fetch` must come from the `undici` package, not from the Node global. The
 * global belongs to Node's *bundled* undici, and handing it a dispatcher built
 * by a different copy fails with `UND_ERR_INVALID_ARG: invalid onRequestStart
 * method` — a version-skew trap that only shows up at runtime.
 */

const JSON_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_JSON_MS ?? 30_000)
const FILE_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_FILE_MS ?? 120_000)

/** Dispatchers are socket pools — reuse them, never build one per request. */
const dispatcherCache = new Map<string, Agent>()
const MAX_CACHED_DISPATCHERS = 16

function cacheKey(target: ProxyTarget, protocol: string): string {
  return `${protocol}|${target.pinnedAddress}|${target.family}`
}

/**
 * The `connect.lookup` hook that pins a connection to an already-validated IP.
 *
 * Undici calls it with Node's `dns.lookup` signature, which has two shapes
 * depending on whether `all` was requested; both are handled because we do not
 * control which one the undici version in use picks. Whatever it asks for, it
 * gets the single address `resolveTarget` already vetted — a second DNS answer
 * cannot swap in an internal IP.
 *
 * Exported because this callback *is* the DNS-rebinding defence, and it is
 * invisible to a test that mocks undici's `fetch`.
 */
export function pinnedLookup(address: string, family: 4 | 6) {
  type SingleCallback = (err: null, address: string, family: number) => void
  type AllCallback = (err: null, list: { address: string; family: number }[]) => void

  return (_hostname: string, options: unknown, callback: unknown): void => {
    if (typeof options === 'function') {
      // lookup(host, callback) form — no options object at all.
      ;(options as SingleCallback)(null, address, family)
      return
    }
    if ((options as { all?: boolean } | null)?.all) {
      ;(callback as AllCallback)(null, [{ address, family }])
      return
    }
    ;(callback as SingleCallback)(null, address, family)
  }
}

function getPinnedDispatcher(target: ProxyTarget, url: URL): Dispatcher {
  const key = cacheKey(target, url.protocol)
  const existing = dispatcherCache.get(key)
  if (existing) return existing

  const agent = new Agent({
    connect: { lookup: pinnedLookup(target.pinnedAddress, target.family) },
    // keep-alive helps the dashboard, which fires several calls per render
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000,
    connections: 16,
    // undici requires >= 1; 0 is rejected as an invalid option.
    pipelining: 1,
  })

  // crude LRU: drop the oldest when the cache grows past the limit
  if (dispatcherCache.size >= MAX_CACHED_DISPATCHERS) {
    const oldest = dispatcherCache.keys().next()
    if (!oldest.done) {
      const victim = dispatcherCache.get(oldest.value)
      dispatcherCache.delete(oldest.value)
      void victim?.close().catch(() => undefined)
    }
  }
  dispatcherCache.set(key, agent)
  return agent
}

/** Test/maintenance hook: close every pooled socket. */
export async function closeAllDispatchers(): Promise<void> {
  const agents = [...dispatcherCache.values()]
  dispatcherCache.clear()
  await Promise.allSettled(agents.map((a) => a.close()))
}

/**
 * undici ships its own `RequestInit`, whose `body` is nominally distinct from
 * the global `BodyInit` (the global one permits `ReadableStream<any>`). At
 * runtime the two are interchangeable, so the boundary needs exactly one cast —
 * typed off undici's own signature so it cannot drift if undici is upgraded.
 */
type UndiciBodyInit = NonNullable<Parameters<typeof undiciFetch>[1]>['body']

export function timeoutFor(kind: ApiKind): number {
  return kind === 'file' || kind === 'upload' ? FILE_TIMEOUT_MS : JSON_TIMEOUT_MS
}

export interface ForwardOptions {
  target: ProxyTarget
  url: URL
  method: 'GET' | 'POST'
  /** Pre-serialised body plus its content type. Omit for GET. */
  body?: BodyInit | null
  contentType?: string
  token?: string
  kind: ApiKind
  /** Extra headers forwarded verbatim (never credentials). */
  headers?: Record<string, string>
}

export interface ForwardResult {
  response: Response
  durationMs: number
}

/**
 * Perform the upstream call. Never throws for an HTTP error status — the caller
 * inspects `response`. Throws only for transport-level failures, mapped to
 * `upstream_unreachable` / `upstream_timeout`.
 */
export async function forward(options: ForwardOptions): Promise<ForwardResult> {
  const { target, url, method, body, contentType, token, kind, headers } = options

  const requestHeaders: Record<string, string> = {
    Accept: kind === 'json' ? 'application/json' : '*/*',
    'User-Agent': 'TechnitiumDnsWebConsole/1.0 (+next.js proxy)',
    ...(headers ?? {}),
  }
  if (contentType) requestHeaders['Content-Type'] = contentType
  if (token) requestHeaders.Authorization = `Bearer ${token}`

  const started = Date.now()
  let response: Response
  try {
    const upstream = await undiciFetch(url, {
      method,
      headers: requestHeaders,
      body: (body ?? undefined) as UndiciBodyInit,
      dispatcher: getPinnedDispatcher(target, url),
      signal: AbortSignal.timeout(timeoutFor(kind)),
      redirect: 'error',
      cache: 'no-store',
    })
    // undici's Response is structurally identical to the Web one; the kernel
    // only reads status/ok/headers/text()/body, all of which match.
    response = upstream as unknown as Response
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new DnsApiError('upstream_timeout', `The DNS server did not respond within ${timeoutFor(kind)}ms.`, {
        target: target.baseUrl,
        innerMessage: describe(err),
      })
    }
    throw new DnsApiError('upstream_unreachable', `Could not reach the DNS server at ${target.baseUrl}.`, {
      target: target.baseUrl,
      innerMessage: describe(err),
    })
  }

  return { response, durationMs: Date.now() - started }
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'TimeoutError') return true
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return true
    const cause = err.cause as NodeJS.ErrnoException | undefined
    if (cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || cause?.code === 'UND_ERR_BODY_TIMEOUT') return true
    if (err.name === 'AbortError' || cause?.name === 'TimeoutError') return true
  }
  return false
}

/**
 * `fetch` wraps every transport failure in a bare "fetch failed"; the useful
 * detail (`ECONNREFUSED`, `UND_ERR_INVALID_ARG`, …) is always on `.cause`.
 */
function describe(err: unknown): string {
  const parts: string[] = []
  let current: unknown = err
  let guard = 0
  while (current && guard++ < 5) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code
      parts.push(code ? `${code}: ${current.message}` : current.message)
      current = current.cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.length > 0 ? parts.join(' <- ') : String(err)
}

/**
 * Turn a JS object into an `application/x-www-form-urlencoded` body.
 *
 * Technitium's API is form-encoded, not JSON — this is the single most common
 * mistake when integrating with it. `undefined` values are dropped so callers
 * can pass a partial settings object without sending `key=undefined`.
 */
export function encodeForm(params: Record<string, unknown>): { body: string; contentType: string } {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        search.append(key, stringifyValue(item))
      }
      continue
    }
    search.append(key, stringifyValue(value))
  }
  return { body: search.toString(), contentType: 'application/x-www-form-urlencoded; charset=utf-8' }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
