/**
 * Error contract shared by the proxy route handler (server) and the API client
 * (browser). Technitium only ever returns four `status` values — `ok`,
 * `invalid-token`, `2fa-required` and `error` — so everything else below is a
 * condition the proxy itself detects.
 */

export const API_ERROR_CODES = [
  // proxy-side rejections
  'no_target',
  'blocked_target',
  'endpoint_not_found',
  'method_not_allowed',
  'missing_token',
  'proxy_error',
  // upstream conditions
  'invalid_token',
  'two_factor_required',
  'upstream_error',
  'bad_upstream_response',
  'upstream_unreachable',
  'upstream_timeout',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  /** Technitium's `innerErrorMessage`, when it chose to expose one. */
  innerMessage?: string
  /** Technitium's `stackTrace`, when `noStackTrace` is off upstream. */
  stackTrace?: string
  endpoint?: string
  target?: string
}

/** Status codes the proxy answers with, kept in one place so client and server agree. */
export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  no_target: 400,
  blocked_target: 403,
  endpoint_not_found: 404,
  method_not_allowed: 405,
  missing_token: 401,
  proxy_error: 500,
  invalid_token: 401,
  two_factor_required: 428,
  upstream_error: 400,
  bad_upstream_response: 502,
  upstream_unreachable: 502,
  upstream_timeout: 504,
}

/**
 * Thrown by the proxy kernel and by the browser client. Carrying the same shape
 * on both sides means UI code never has to special-case where a failure came
 * from.
 */
export class DnsApiError extends Error {
  readonly code: ApiErrorCode
  readonly httpStatus: number
  readonly innerMessage?: string
  readonly stackTrace?: string
  readonly endpoint?: string
  readonly target?: string

  constructor(code: ApiErrorCode, message: string, extra: Omit<ApiErrorBody, 'code' | 'message'> = {}) {
    super(message)
    this.name = 'DnsApiError'
    this.code = code
    this.httpStatus = ERROR_HTTP_STATUS[code]
    this.innerMessage = extra.innerMessage
    this.stackTrace = extra.stackTrace
    this.endpoint = extra.endpoint
    this.target = extra.target
  }

  /** True when the session is gone and the UI must send the user back to login. */
  get isAuthFailure(): boolean {
    return this.code === 'invalid_token' || this.code === 'missing_token'
  }

  toJSON(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.innerMessage !== undefined ? { innerMessage: this.innerMessage } : {}),
      ...(this.stackTrace !== undefined ? { stackTrace: this.stackTrace } : {}),
      ...(this.endpoint !== undefined ? { endpoint: this.endpoint } : {}),
      ...(this.target !== undefined ? { target: this.target } : {}),
    }
  }

  static from(body: unknown, fallbackStatus = 502): DnsApiError {
    if (body && typeof body === 'object') {
      const b = body as Partial<ApiErrorBody>
      if (typeof b.code === 'string' && (API_ERROR_CODES as readonly string[]).includes(b.code)) {
        return new DnsApiError(b.code as ApiErrorCode, b.message ?? 'Request failed.', {
          innerMessage: b.innerMessage,
          stackTrace: b.stackTrace,
          endpoint: b.endpoint,
          target: b.target,
        })
      }
    }
    const err = new DnsApiError('proxy_error', typeof body === 'string' && body ? body : 'Request failed.')
    // preserve the transport status when the body was not one of ours
    Object.defineProperty(err, 'httpStatus', { value: fallbackStatus })
    return err
  }
}

export function isDnsApiError(value: unknown): value is DnsApiError {
  return value instanceof DnsApiError || (typeof value === 'object' && value !== null && (value as { name?: string }).name === 'DnsApiError')
}

/** Convenience predicate for "401-ish" so query clients can trigger re-auth. */
export function isAuthError(value: unknown): boolean {
  return isDnsApiError(value) && value.isAuthFailure
}
