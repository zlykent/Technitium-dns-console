import { DnsApiError, isDnsApiError, ERROR_HTTP_STATUS } from '@/lib/api/errors'
import { writeAudit } from '@/lib/proxy/audit'
import { serializeCookie, serializeDeletedCookie, tokenCookieName } from '@/lib/proxy/cookies'
import { forward } from '@/lib/proxy/forward'
import { resolveTarget } from '@/lib/proxy/target'
import { TARGET_HEADER } from '@/lib/proxy/kernel'

/**
 * Adopt a long-lived API token as the session credential.
 *
 * The password flow goes through `user/login`, where the kernel captures the
 * token into a cookie. An operator pasting an existing API token has no such
 * round trip, so this endpoint does the equivalent: verify the token against
 * `user/session/get`, and only then write the cookie.
 *
 * Verification-first matters — without it a typo'd token would produce a cookie
 * that fails on every subsequent page, which reads as "the server is broken"
 * rather than "you pasted the wrong thing".
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isSecure(request: Request): boolean {
  if (request.url.startsWith('https://')) return true
  return request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
}

function fail(err: unknown, status = 502): Response {
  const apiError = isDnsApiError(err)
    ? err
    : new DnsApiError('proxy_error', err instanceof Error ? err.message : 'Token verification failed.')
  return Response.json(apiError.toJSON(), { status: apiError.httpStatus || status })
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now()

  let token: string
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === 'string' ? body.token.trim() : ''
  } catch {
    return fail(new DnsApiError('proxy_error', 'Expected a JSON body of the form { "token": "…" }.', { endpoint: 'user/session/get' }), 400)
  }

  if (token.length < 16) {
    return fail(new DnsApiError('missing_token', 'An API token must be at least 16 characters.', { endpoint: 'user/session/get' }), 400)
  }

  let target
  try {
    target = await resolveTarget(request.headers.get(TARGET_HEADER))
  } catch (err) {
    return fail(err, ERROR_HTTP_STATUS.no_target)
  }

  const url = new URL(`${target.baseUrl}/api/user/session/get`)
  let response: Response
  try {
    const result = await forward({ target, url, method: 'GET', token, kind: 'json' })
    response = result.response
  } catch (err) {
    writeAudit({ endpoint: 'user/session/get', domain: 'user', method: 'POST', target: target.origin, httpStatus: 502, durationMs: Date.now() - started, code: isDnsApiError(err) ? err.code : 'proxy_error' })
    return fail(err)
  }

  type SessionEnvelope = { status?: string; response?: Record<string, unknown> }
  let parsed: SessionEnvelope | null = null
  try {
    parsed = (await response.json()) as SessionEnvelope
  } catch {
    parsed = null
  }

  if (!parsed || parsed.status !== 'ok' || !parsed.response) {
    const code = parsed?.status === 'invalid-token' ? 'invalid_token' : 'bad_upstream_response'
    writeAudit({ endpoint: 'user/session/get', domain: 'user', method: 'POST', target: target.origin, httpStatus: 401, durationMs: Date.now() - started, code })
    return fail(new DnsApiError(code, 'That API token was rejected by the DNS server.', { endpoint: 'user/session/get', target: target.baseUrl }), 401)
  }

  // Never echo the credential back: the browser stores it in an httpOnly cookie
  // and has no business reading it.
  const { token: _ignored, ...session } = parsed.response as Record<string, unknown>

  writeAudit({ endpoint: 'user/session/get', domain: 'user', method: 'POST', target: target.origin, httpStatus: 200, durationMs: Date.now() - started })

  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Dns-Target': target.origin })
  headers.append('Set-Cookie', serializeCookie(tokenCookieName(target.origin), token, { path: '/', secure: isSecure(request), sameSite: 'lax' }))

  return Response.json({ ...session, token: undefined }, { status: 200, headers })
}

/** Drop the stored credential for the selected server. */
export async function DELETE(request: Request): Promise<Response> {
  let target
  try {
    target = await resolveTarget(request.headers.get(TARGET_HEADER))
  } catch (err) {
    return fail(err, ERROR_HTTP_STATUS.no_target)
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', serializeDeletedCookie(tokenCookieName(target.origin), { path: '/', secure: isSecure(request), sameSite: 'lax' }))
  return Response.json({ ok: true }, { status: 200, headers })
}
