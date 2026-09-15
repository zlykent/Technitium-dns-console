import { TARGET_HEADER } from '@/lib/api/client'

/**
 * Reachability probe used by the server switcher.
 *
 * Switching servers must never be a blind flip: the proxy is the only path to
 * a DNS server, so the cheapest honest check is one anonymous call through
 * it. `status` needs no token (registry: `auth: 'none'`), which makes the
 * probe usable before login and for servers this browser has no session on.
 *
 * The probe carries its own timeout, far shorter than the proxy's JSON
 * timeout: a black-holed address should say "unreachable" in seconds, not
 * hang the switcher for half a minute.
 */

export interface ServerProbeResult {
  ok: boolean
  /**
   * Failure code: either a proxy code (`upstream_unreachable`,
   * `blocked_target`, `proxy_error`, …) or one of the probe's own
   * `probe_timeout` / `probe_cancelled`. The UI translates the known ones and
   * falls back to `message` for the rest.
   */
  code?: string
  /** Raw proxy message, kept for tooltips on codes the UI special-cases. */
  message?: string
}

const PROBE_TIMEOUT_MS = 8_000

/**
 * Ask one DNS server whether it answers, through the proxy.
 *
 * @param url    profile URL, or `null` for the env-configured default — which
 *               is addressed by omitting `X-Dns-Target` entirely, exactly like
 *               every other call the API client makes for it.
 * @param signal cancels the probe (menu closed, component unmounted). A
 *               cancelled probe resolves with `probe_cancelled` so callers can
 *               discard it silently instead of painting an error.
 */
export async function probeServer(url: string | null, signal?: AbortSignal): Promise<ServerProbeResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PROBE_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  const headers = new Headers({ Accept: 'application/json' })
  if (url) headers.set(TARGET_HEADER, url)

  try {
    const response = await fetch('/api/dns/status', {
      method: 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.ok) return { ok: true }
    return { ok: false, ...(await readErrorBody(response)) }
  } catch {
    // The proxy itself did not answer, or the probe was cut short.
    if (timedOut) return { ok: false, code: 'probe_timeout' }
    if (signal?.aborted) return { ok: false, code: 'probe_cancelled' }
    return { ok: false, code: 'proxy_error' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

async function readErrorBody(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object') {
      const { code, message } = body as { code?: unknown; message?: unknown }
      return {
        code: typeof code === 'string' ? code : undefined,
        message: typeof message === 'string' ? message : undefined,
      }
    }
  } catch {
    /* non-JSON body — the caller falls back to its own wording */
  }
  return {}
}

/** The `nav.serverSwitcher` keys `probeReason` can ask for. */
export type ProbeReasonKey = 'probeTimeout' | 'probeBlocked' | 'probeUnreachable'

/**
 * Turn a failed probe into operator wording. The known proxy codes get
 * translated sentences; anything else keeps the raw proxy message, which is
 * still more actionable than a bare "no".
 *
 * The translator is injected so this module stays free of next-intl: callers
 * pass `(key) => t(`serverSwitcher.${key}`)`.
 */
export function probeReason(res: ServerProbeResult, translate: (key: ProbeReasonKey) => string): string {
  switch (res.code) {
    case 'probe_timeout':
      return translate('probeTimeout')
    case 'blocked_target':
      return translate('probeBlocked')
    case 'upstream_unreachable':
    case 'proxy_error':
      return translate('probeUnreachable')
    default:
      return res.message || translate('probeUnreachable')
  }
}
