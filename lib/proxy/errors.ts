import { DnsApiError, type ApiErrorCode } from '@/lib/api/errors'
import { hasKnownStatus, isUpstreamBody, readUpstreamMessage, UPSTREAM_2FA, UPSTREAM_ERROR, UPSTREAM_INVALID_TOKEN, UPSTREAM_OK } from './envelope'

/**
 * Translate an upstream Technitium response into either a success marker or a
 * `DnsApiError`.
 *
 * Technitium returns **HTTP 200 for almost everything**, including failures; the
 * real signal is the `status` field in the JSON body. It has exactly four
 * values, and anything else means the server is not speaking the protocol we
 * expect (a captive portal, a reverse-proxy error page, a version mismatch).
 */

export const STATUS_TO_CODE: Record<string, ApiErrorCode> = {
  [UPSTREAM_INVALID_TOKEN]: 'invalid_token',
  [UPSTREAM_2FA]: 'two_factor_required',
  [UPSTREAM_ERROR]: 'upstream_error',
}

export interface TranslateResult {
  /** Present when the call succeeded. */
  body?: unknown
  /** Present when the call must be surfaced as an error. */
  error?: DnsApiError
  /** Raw status string from the envelope, when there was one. */
  upstreamStatus?: string
}

/**
 * @param status  upstream HTTP status
 * @param body    parsed JSON body, or `null` when it was not JSON
 * @param rawText the original body text, used for non-JSON diagnostics
 */
export function translateUpstream(status: number, body: unknown, rawText: string, endpoint: string, target: string): TranslateResult {
  if (!isUpstreamBody(body)) {
    // Not JSON at all. Technitium only does this for genuine HTTP-level faults
    // (404 on an unknown path, 500 from Kestrel) or when something else is
    // listening on that port.
    if (status >= 200 && status < 300) {
      return {
        error: new DnsApiError('bad_upstream_response', `Expected JSON from '${endpoint}' but got a ${rawText.length}-byte non-JSON body.`, {
          endpoint,
          target,
          innerMessage: preview(rawText),
        }),
      }
    }
    return {
      error: new DnsApiError('upstream_error', rawText.trim() ? preview(rawText) : `The DNS server returned HTTP ${status}.`, {
        endpoint,
        target,
        innerMessage: preview(rawText),
      }),
    }
  }

  const upstreamStatus = typeof body.status === 'string' ? body.status : undefined

  // A body with no recognisable status is only acceptable when the endpoint is
  // one of the flat ones, and even those carry `status`. Treat it as opaque
  // success rather than failing — being wrong here costs a whole page.
  if (upstreamStatus === undefined) {
    if (status >= 400) {
      return {
        error: new DnsApiError('upstream_error', readUpstreamMessage(body), { endpoint, target, innerMessage: readInner(body), stackTrace: readStack(body) }),
      }
    }
    return { body, upstreamStatus }
  }

  if (!hasKnownStatus(body)) {
    return {
      error: new DnsApiError('bad_upstream_response', `Unknown upstream status '${upstreamStatus}' from '${endpoint}'.`, {
        endpoint,
        target,
        innerMessage: readInner(body) ?? readUpstreamMessage(body),
      }),
    }
  }

  if (upstreamStatus === UPSTREAM_OK) {
    if (status >= 400) {
      return {
        error: new DnsApiError('bad_upstream_response', `Upstream said ok but answered HTTP ${status}.`, { endpoint, target }),
      }
    }
    return { body, upstreamStatus }
  }

  const code = STATUS_TO_CODE[upstreamStatus] ?? 'bad_upstream_response'
  const message =
    upstreamStatus === UPSTREAM_2FA
      ? 'Two-factor authentication is required for this account.'
      : upstreamStatus === UPSTREAM_INVALID_TOKEN
        ? 'The session token was rejected by the DNS server. Sign in again.'
        : readUpstreamMessage(body)

  return {
    upstreamStatus,
    error: new DnsApiError(code, message, {
      endpoint,
      target,
      innerMessage: readInner(body),
      stackTrace: readStack(body),
    }),
  }
}

function readInner(body: Record<string, unknown>): string | undefined {
  const value = body.innerErrorMessage
  return typeof value === 'string' && value ? value : undefined
}

function readStack(body: Record<string, unknown>): string | undefined {
  const value = body.stackTrace
  return typeof value === 'string' && value ? value : undefined
}

function preview(text: string, limit = 300): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}
