import { parseServerUrl } from '@/lib/url'
import { DnsApiError, isDnsApiError, type ApiErrorBody } from './errors'
import { ENDPOINTS, type ApiMethod, type EndpointId } from './registry'

/**
 * Browser-side API client.
 *
 * Every call goes through the Next.js proxy at `/api/dns/<endpoint>`; the browser
 * never talks to the DNS server directly (it cannot — the upstream sends no CORS
 * headers) and never sees a token (they live in httpOnly cookies keyed per
 * server). All this module has to do is build a URL, encode parameters the way
 * Technitium expects, and turn a non-2xx into a `DnsApiError`.
 */

export const PROXY_BASE = '/api/dns'

/** Header the proxy reads to pick which DNS server to talk to. */
export const TARGET_HEADER = 'X-Dns-Target'

let activeTarget: string | null = null

/**
 * Set by the server-switcher. `null` means "use the operator's
 * `TECHNITIUM_API_URL`", which is the normal single-server deployment.
 */
export function setActiveTarget(target: string | null): void {
  activeTarget = target && target.trim() ? normaliseTarget(target) : null
}

export function getActiveTarget(): string | null {
  return activeTarget
}

function normaliseTarget(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  const parsed = parseServerUrl(value)
  // On a parse failure the trimmed input is still sent: the proxy owns the
  // authoritative rejection (and the translated message), and swallowing the
  // value here would turn "bad address" into "no target configured".
  return parsed.ok ? parsed.origin : value.replace(/\/+$/, '')
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue | readonly QueryValue[] | File | undefined>

export interface RequestOptions {
  /** Query string parameters. Arrays are repeated (`key=a&key=b`). */
  params?: QueryParams
  /** Form-encoded body; only for endpoints the registry marks POST. */
  body?: QueryParams
  /** Multipart body; takes precedence over `body`. */
  formData?: FormData
  /**
   * Raw text body. `zones/import` in "paste a zone file" mode posts the text
   * with `Content-Type: text/plain`, which is neither of the two forms above.
   */
  text?: { value: string; contentType?: string }
  /** Override the verb when an endpoint accepts both. */
  method?: ApiMethod
  signal?: AbortSignal
  /** Escape hatch for endpoints whose shape is not modelled yet. */
  raw?: boolean
}

/**
 * Low-level call. Domain modules wrap this with concrete parameter and result
 * types, so application code never names an endpoint id directly.
 */
export async function apiRequest<T>(endpoint: EndpointId, options: RequestOptions = {}): Promise<T> {
  const def = ENDPOINTS[endpoint]
  if (!def) {
    throw new DnsApiError('endpoint_not_found', `'${endpoint}' is not a known API endpoint.`, { endpoint })
  }

  // `ENDPOINTS[endpoint]` is a union of every def, so `.methods` is a union of
  // readonly tuples whose `includes` parameter collapses to `never`. Widening
  // the receiver keeps the check honest without a blanket `any`.
  const allowed: readonly ApiMethod[] = def.methods
  const method = options.method ?? (allowed.includes('POST') && (options.body || options.formData || options.text) ? 'POST' : allowed[0])
  if (!allowed.includes(method)) {
    throw new DnsApiError('method_not_allowed', `'${endpoint}' does not accept ${method}.`, { endpoint })
  }

  const url = new URL(`${PROXY_BASE}/${endpoint}`, 'http://local')
  appendParams(url.searchParams, options.params)

  const headers = new Headers({ Accept: 'application/json' })
  if (activeTarget) headers.set(TARGET_HEADER, activeTarget)

  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
    // let the browser set the multipart boundary
  } else if (method === 'POST' && options.text) {
    body = options.text.value
    headers.set('Content-Type', options.text.contentType ?? 'text/plain; charset=utf-8')
  } else if (method === 'POST' && options.body) {
    const form = new URLSearchParams()
    appendParams(form, options.body)
    body = form.toString()
    headers.set('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
  }

  let response: Response
  try {
    response = await fetch(url.pathname + url.search, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new DnsApiError('proxy_error', 'The request to the local proxy failed.', {
      endpoint,
      innerMessage: err instanceof Error ? err.message : String(err),
    })
  }

  if (!response.ok) {
    throw await toApiError(response, endpoint)
  }

  if (options.raw) return (await response.text()) as T
  return (await response.json()) as T
}

/**
 * Download a file endpoint as a Blob and trigger a browser save.
 *
 * The stock console instead mints a single-use token and does
 * `window.open("api/...?token=...")`. Streaming through the proxy keeps the
 * credential out of the URL bar, browser history and any intermediary logs.
 */
export async function apiDownload(endpoint: EndpointId, params: QueryParams = {}, suggestedName?: string): Promise<void> {
  const def = ENDPOINTS[endpoint]
  if (!def) throw new DnsApiError('endpoint_not_found', `'${endpoint}' is not a known API endpoint.`, { endpoint })
  if (def.kind !== 'file') {
    throw new DnsApiError('proxy_error', `'${endpoint}' is not a download endpoint.`, { endpoint })
  }

  const url = new URL(`${PROXY_BASE}/${endpoint}`, 'http://local')
  appendParams(url.searchParams, params)

  const headers = new Headers({ Accept: '*/*' })
  if (activeTarget) headers.set(TARGET_HEADER, activeTarget)

  let response: Response
  try {
    response = await fetch(url.pathname + url.search, { method: 'GET', headers, credentials: 'same-origin', cache: 'no-store' })
  } catch (err) {
    throw new DnsApiError('proxy_error', 'The download request failed.', {
      endpoint,
      innerMessage: err instanceof Error ? err.message : String(err),
    })
  }

  if (!response.ok) throw await toApiError(response, endpoint)

  const blob = await response.blob()
  const filename = suggestedName ?? filenameFrom(response.headers.get('content-disposition')) ?? `${endpoint.replace(/\//g, '-')}.bin`
  saveBlob(blob, filename)
}

/** Return the bytes without triggering a save — used by the zone-file preview. */
export async function apiDownloadBlob(endpoint: EndpointId, params: QueryParams = {}): Promise<{ blob: Blob; filename: string }> {
  const url = new URL(`${PROXY_BASE}/${endpoint}`, 'http://local')
  appendParams(url.searchParams, params)

  const headers = new Headers({ Accept: '*/*' })
  if (activeTarget) headers.set(TARGET_HEADER, activeTarget)

  const response = await fetch(url.pathname + url.search, { method: 'GET', headers, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw await toApiError(response, endpoint)

  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get('content-disposition')) ?? `${endpoint.replace(/\//g, '-')}.bin`,
  }
}

/**
 * Pull the filename out of a `Content-Disposition` header. Handles both the
 * RFC 5987 `filename*=UTF-8''…` form and the plain `filename="…"` form, since
 * Technitium emits the latter with URL-encoded zone names.
 */
function filenameFrom(header: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*\s*=\s*([^;]+)/i)
  if (star) {
    const raw = star[1].trim().replace(/^[^']*''/, '').replace(/^["']|["']$/g, '')
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (!plain) return null
  try {
    return decodeURIComponent(plain[1].trim())
  } catch {
    return plain[1].trim()
  }
}

export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // revoke on the next tick so Safari has time to start the download
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

function appendParams(target: URLSearchParams | FormData, params: QueryParams | undefined): void {
  if (!params) return
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof File !== 'undefined' && value instanceof File) {
      if (target instanceof FormData) target.append(key, value, value.name)
      continue
    }
    if (Array.isArray(value)) {
      const list = value.filter((v): v is string | number | boolean => v !== undefined && v !== null)
      if (list.length === 0) continue
      // Technitium takes multi-value parameters as one comma-joined string
      target.append(key, list.map((v) => String(v)).join(','))
      continue
    }
    target.append(key, typeof value === 'boolean' ? String(value) : String(value))
  }
}

async function toApiError(response: Response, endpoint: string): Promise<DnsApiError> {
  let body: ApiErrorBody | undefined
  try {
    const text = await response.text()
    if (text) {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && 'code' in parsed) body = parsed as ApiErrorBody
    }
  } catch {
    body = undefined
  }

  if (body) {
    const err = DnsApiError.from(body, response.status)
    return err
  }
  return new DnsApiError('proxy_error', `The proxy answered HTTP ${response.status} for '${endpoint}'.`, { endpoint })
}

/** Narrowing helper for `catch` blocks in UI code. */
export function describeError(err: unknown): { code: string; message: string; isAuth: boolean } {
  if (isDnsApiError(err)) {
    return { code: err.code, message: err.innerMessage ? `${err.message} (${err.innerMessage})` : err.message, isAuth: err.isAuthFailure }
  }
  if (err instanceof Error) return { code: 'unknown', message: err.message, isAuth: false }
  return { code: 'unknown', message: String(err), isAuth: false }
}
