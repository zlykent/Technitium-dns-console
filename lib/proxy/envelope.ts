import type { ApiEnvelope, EndpointId } from '@/lib/api/registry'

/**
 * Response envelope handling.
 *
 * Technitium answers almost every endpoint with
 *
 *     { "status": "ok", "server": "dns-server", "response": { ... } }
 *
 * but three endpoints (`status`, `user/login`, `user/session/get`) put their
 * fields at the top level. The registry records which is which; this module
 * applies it and — because a wrong guess would blank out an entire page —
 * self-heals when the declaration and the actual body disagree.
 */

export const UPSTREAM_OK = 'ok'
export const UPSTREAM_INVALID_TOKEN = 'invalid-token'
export const UPSTREAM_2FA = '2fa-required'
export const UPSTREAM_ERROR = 'error'

export type UpstreamStatus = typeof UPSTREAM_OK | typeof UPSTREAM_INVALID_TOKEN | typeof UPSTREAM_2FA | typeof UPSTREAM_ERROR

/**
 * Per-endpoint payload transformers — the hook reserved for cases where the raw
 * Technitium shape is actively hostile to the UI (e.g. records serialised as a
 * JSON string). Deliberately empty: transforms belong in the typed SDK layer
 * where they can be unit-tested against a real fixture, not hidden in the proxy.
 */
export const TRANSFORMS: Partial<Record<EndpointId, (payload: unknown) => unknown>> = {}

export interface UpstreamBody {
  status?: string
  server?: string
  response?: unknown
  /** present on `status: "error"` */
  errorMessage?: string
  innerErrorMessage?: string
  stackTrace?: string
  [key: string]: unknown
}

const ENVELOPE_KEYS = new Set(['status', 'server', 'response'])

export function isUpstreamBody(value: unknown): value is UpstreamBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when the body carries one of the four known Technitium status values. */
export function hasKnownStatus(body: UpstreamBody): boolean {
  return body.status === UPSTREAM_OK || body.status === UPSTREAM_INVALID_TOKEN || body.status === UPSTREAM_2FA || body.status === UPSTREAM_ERROR
}

export interface UnwrapResult {
  payload: unknown
  /** True when the declared envelope did not match the body and we adapted. */
  healed: boolean
}

/**
 * Strip the envelope from a successful body.
 *
 * - `wrapped` -> `body.response`
 * - `flat`    -> the top level, minus `status` / `server`
 *
 * Self-healing: if we were told `wrapped` but there is no `response` key, the
 * endpoint is flat in practice, so fall back rather than returning `undefined`
 * and breaking the page.
 */
export function unwrapEnvelope(body: unknown, declared: ApiEnvelope, endpoint: EndpointId): UnwrapResult {
  const transform = TRANSFORMS[endpoint]

  if (!isUpstreamBody(body)) {
    return { payload: transform ? transform(body) : body, healed: false }
  }

  if (declared === 'wrapped') {
    if ('response' in body) {
      const payload = body.response
      return { payload: transform ? transform(payload) : payload, healed: false }
    }
    // declared wrapped, actually flat
    const payload = stripEnvelopeKeys(body)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[proxy] '${endpoint}' is declared wrapped but returned no \`response\` key — treated as flat.`)
    }
    return { payload: transform ? transform(payload) : payload, healed: true }
  }

  // declared flat, but tolerate a wrapped body just in case
  if ('response' in body && Object.keys(body).every((k) => ENVELOPE_KEYS.has(k))) {
    const payload = body.response
    return { payload: transform ? transform(payload) : payload, healed: true }
  }

  const payload = stripEnvelopeKeys(body)
  return { payload: transform ? transform(payload) : payload, healed: false }
}

function stripEnvelopeKeys(body: UpstreamBody): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'status' || key === 'server') continue
    out[key] = value
  }
  return out
}

/** Technitium's error text lives in one of two keys depending on the version. */
export function readUpstreamMessage(body: UpstreamBody): string {
  return body.errorMessage ?? (typeof body.message === 'string' ? body.message : 'Upstream request failed.')
}
