import { DnsApiError, isDnsApiError } from '@/lib/api/errors'
import { getEndpoint, isKnownEndpoint, type ApiDomain, type EndpointId } from '@/lib/api/registry'
import { writeAudit } from './audit'
import { readTokenCookie, serializeCookie, serializeDeletedCookie, tokenCookieName } from './cookies'
import { unwrapEnvelope } from './envelope'
import { translateUpstream } from './errors'
import { forward } from './forward'
import { buildUpstreamUrl, resolveTarget, type ProxyConfig } from './target'

/**
 * The proxy kernel.
 *
 * One catch-all route (`/api/dns/[...path]`) serves all 129 upstream endpoints.
 * The registry — not a pile of hand-written route files — decides what is
 * allowed, with which verb, whether a token is needed, and how the payload is
 * wrapped. That keeps the allowlist and the typed SDK provably in step: they
 * read the same object.
 *
 * Pipeline:
 *   1. target from `X-Dns-Target`, else `TECHNITIUM_API_URL`
 *   2. SSRF validation + DNS resolution
 *   3. pin the validated IP into the dispatcher (anti-rebinding)
 *   4. look up the per-server token cookie
 *   5. allowlist the path, allowlist the verb
 *   6. forward query + body verbatim, inject `Authorization: Bearer`
 *   7. timeout by response kind (json 30s / file 120s)
 *   8. translate Technitium's four `status` values into HTTP semantics
 *   9. strip the envelope (with self-healing) or stream a file through
 *  10. write a narrow audit line
 *
 * Written against the Web `Request`/`Response` API only, so it runs identically
 * in the Next route handler and under Vitest.
 */

export const TARGET_HEADER = 'x-dns-target'

/** Headers we are willing to pass through. Everything else is dropped. */
const FORWARDED_HEADERS = ['accept-language', 'x-requested-with'] as const

/** Endpoints whose success changes what the proxy must store in a cookie. */
const SETS_TOKEN: ReadonlySet<EndpointId> = new Set(['user/login'])
const CLEARS_TOKEN: ReadonlySet<EndpointId> = new Set(['user/logout', 'user/session/delete'])

/**
 * Payloads that echo the *current* session token back. The proxy consumes it for
 * the cookie and must not forward it — the whole point of httpOnly storage is
 * that no script in the page can read the credential.
 *
 * Deliberately excludes `user/createToken` and `admin/sessions/createToken`,
 * which mint a *new* long-lived API token that the operator has to copy down.
 */
const STRIPS_TOKEN: ReadonlySet<EndpointId> = new Set(['user/login', 'user/session/get'])

export interface HandleProxyOptions {
  /** Test seam: inject a pre-read config instead of touching `process.env`. */
  config?: ProxyConfig
}

export async function handleProxy(request: Request, rawPath: string[], options: HandleProxyOptions = {}): Promise<Response> {
  const started = Date.now()
  const endpointPath = normalisePath(rawPath)
  const method = request.method.toUpperCase()

  // Context threaded into every error path so the audit line is always complete.
  const ctx: ErrorContext = { endpoint: endpointPath || '(unknown)', domain: 'system', method, target: '-', started }

  if (!isKnownEndpoint(endpointPath)) {
    return errorResponse(
      new DnsApiError('endpoint_not_found', `Unknown API endpoint '/api/dns/${endpointPath}'.`, { endpoint: endpointPath }),
      ctx,
    )
  }
  const endpointId: EndpointId = endpointPath
  ctx.endpoint = endpointId

  const def = getEndpoint(endpointId)!
  ctx.domain = def.domain

  if (method !== 'GET' && method !== 'POST') {
    return errorResponse(new DnsApiError('method_not_allowed', `Only ${def.methods.join(' and ')} are supported.`, { endpoint: endpointId }), ctx)
  }
  if (!def.methods.includes(method)) {
    return errorResponse(
      new DnsApiError('method_not_allowed', `'${endpointId}' does not accept ${method}. Use ${def.methods.join(' or ')}.`, { endpoint: endpointId }),
      ctx,
    )
  }

  const requestedTarget = request.headers.get(TARGET_HEADER)
  const secure = isSecureRequest(request)

  let target
  try {
    target = await resolveTarget(requestedTarget, options.config)
  } catch (err) {
    return errorResponse(err, ctx)
  }
  ctx.target = target.origin

  const token = def.auth === 'token' ? readTokenCookie(request.headers.get('cookie'), target.origin) : undefined
  if (def.auth === 'token' && !token) {
    return errorResponse(new DnsApiError('missing_token', `Not signed in to ${target.origin}.`, { endpoint: endpointId, target: target.baseUrl }), ctx)
  }

  const url = buildUpstreamUrl(target, endpointId, request.url.includes('?') ? new URL(request.url).search : '')

  let body: BodyInit | null = null
  let contentType: string | undefined
  if (method === 'POST') {
    body = await request.arrayBuffer()
    contentType = request.headers.get('content-type') ?? 'application/x-www-form-urlencoded; charset=utf-8'
    if (body.byteLength === 0) {
      // Technitium rejects a POST with no Content-Type; send an empty form body.
      body = null
      contentType = undefined
    }
  }

  const passthrough: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) passthrough[name] = value
  }

  // Transport failures (timeout, refused connection, aborted body) surface as a
  // DnsApiError from `forward`; funnel them through the single error exit.
  let upstream: Response
  try {
    const result = await forward({
      target,
      url,
      method,
      body,
      contentType,
      token,
      kind: def.kind,
      headers: passthrough,
    })
    upstream = result.response
  } catch (err) {
    return errorResponse(err, ctx)
  }

  // ---- file downloads: stream straight through unless it is an error envelope
  const upstreamContentType = upstream.headers.get('content-type') ?? ''
  if (def.kind === 'file' && upstream.ok && !upstreamContentType.includes('application/json')) {
    writeAudit({
      endpoint: endpointId,
      domain: def.domain,
      method,
      target: target.origin,
      httpStatus: upstream.status,
      durationMs: Date.now() - started,
    })
    return streamFile(upstream, url)
  }

  // ---- JSON path
  let rawText: string
  try {
    rawText = await upstream.text()
  } catch (err) {
    return errorResponse(
      new DnsApiError('upstream_unreachable', 'The connection to the DNS server dropped while reading its response.', {
        endpoint: endpointId,
        target: target.baseUrl,
        innerMessage: err instanceof Error ? err.message : String(err),
      }),
      ctx,
    )
  }

  let parsed: unknown = null
  if (rawText) {
    try {
      parsed = JSON.parse(rawText)
    } catch {
      parsed = null
    }
  }

  const translated = translateUpstream(upstream.status, parsed, rawText, endpointId, target.baseUrl)

  if (translated.error) {
    const setCookies: string[] = []
    if (translated.error.code === 'invalid_token') {
      // the session died upstream; drop our copy so the UI stops retrying
      setCookies.push(serializeDeletedCookie(tokenCookieName(target.origin), { path: '/', secure, sameSite: 'lax' }))
    }
    return errorResponse(translated.error, ctx, setCookies)
  }

  const unwrapped = unwrapEnvelope(translated.body, def.envelope, endpointId)
  const payload = STRIPS_TOKEN.has(endpointId) ? omitToken(unwrapped.payload) : unwrapped.payload

  const setCookies: string[] = []
  if (SETS_TOKEN.has(endpointId)) {
    const newToken = extractToken(unwrapped.payload)
    if (newToken) {
      setCookies.push(serializeCookie(tokenCookieName(target.origin), newToken, { path: '/', secure, sameSite: 'lax' }))
    } else {
      // A login with 2FA enabled returns no token yet; tell the UI to prompt.
      return errorResponse(
        new DnsApiError('two_factor_required', 'Two-factor authentication is required for this account.', {
          endpoint: endpointId,
          target: target.baseUrl,
        }),
        ctx,
      )
    }
  }
  if (CLEARS_TOKEN.has(endpointId)) {
    setCookies.push(serializeDeletedCookie(tokenCookieName(target.origin), { path: '/', secure, sameSite: 'lax' }))
  }

  writeAudit({
    endpoint: endpointId,
    domain: def.domain,
    method,
    target: target.origin,
    httpStatus: 200,
    durationMs: Date.now() - started,
  })

  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Dns-Target': target.origin })
  // `append`, never a joined string: a cookie value may itself contain a comma.
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie)

  return new Response(JSON.stringify(payload ?? null), { status: 200, headers })
}

function normalisePath(rawPath: string[]): string {
  return rawPath
    .map((segment) => decodeURIComponent(segment))
    .filter(Boolean)
    .join('/')
    .replace(/^\/+|\/+$/g, '')
}

function isSecureRequest(request: Request): boolean {
  if (request.url.startsWith('https://')) return true
  const forwardedProto = request.headers.get('x-forwarded-proto')
  return forwardedProto?.split(',')[0].trim() === 'https'
}

/**
 * `user/login` returns the token at the top level (flat envelope). Guard the
 * shape because a wrong guess here would silently log the user out.
 */
function extractToken(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const candidate = (payload as { token?: unknown }).token
    if (typeof candidate === 'string' && candidate.length >= 16) return candidate
  }
  return undefined
}

/** Shallow-copy without the `token` key, leaving other payloads untouched. */
function omitToken(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!('token' in (payload as Record<string, unknown>))) return payload
  const { token: _token, ...rest } = payload as Record<string, unknown>
  return rest
}

/**
 * Stream a download through without buffering it in memory — backups and log
 * files can be hundreds of megabytes.
 */
function streamFile(upstream: Response, url: URL): Response {
  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  headers.set('Content-Type', contentType ?? 'application/octet-stream')
  const disposition = upstream.headers.get('content-disposition')
  if (disposition) headers.set('Content-Disposition', disposition)
  else headers.set('Content-Disposition', `attachment; filename="${deriveFilename(url)}"`)
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  headers.set('Cache-Control', 'no-store')
  // lets the browser client show progress on large downloads
  headers.set('X-Accel-Buffering', 'no')

  return new Response(upstream.body, { status: upstream.status, headers })
}

function deriveFilename(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? 'download'
  return `${last.replace(/[^A-Za-z0-9._-]/g, '_')}.bin`
}

interface ErrorContext {
  endpoint: string
  domain: ApiDomain
  method: string
  target: string
  started: number
}

/**
 * Single exit for every failure. Normalising here means one audit call site and
 * one response shape, so the browser client can parse errors uniformly.
 */
function errorResponse(err: unknown, ctx: ErrorContext, setCookies: string[] = []): Response {
  const apiError = isDnsApiError(err)
    ? err
    : new DnsApiError('proxy_error', err instanceof Error ? err.message : 'The proxy failed to handle this request.', {
        endpoint: ctx.endpoint,
        target: ctx.target,
      })

  writeAudit({
    endpoint: ctx.endpoint as EndpointId,
    domain: ctx.domain,
    method: ctx.method,
    target: ctx.target,
    httpStatus: apiError.httpStatus,
    durationMs: Date.now() - ctx.started,
    code: apiError.code,
  })

  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  if (apiError.code === 'method_not_allowed') headers.set('Allow', 'GET, POST')
  for (const cookie of setCookies) headers.append('Set-Cookie', cookie)

  return new Response(JSON.stringify(apiError.toJSON()), { status: apiError.httpStatus, headers })
}
