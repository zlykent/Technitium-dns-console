import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { DnsApiError } from '@/lib/api/errors'
import { hostPortOf, parseServerUrl } from '@/lib/url'

/**
 * Target resolution + SSRF guard.
 *
 * The browser tells the proxy which DNS server to talk to (the server switcher
 * stores profiles client-side), so the proxy must treat that value as untrusted.
 * Two defences are layered here:
 *
 *  1. **Address-class blocking.** Loopback, link-local (which is where the cloud
 *     metadata services live), multicast, reserved and unspecified addresses are
 *     refused. RFC1918 / ULA private space is *allowed* on purpose — that is
 *     where DNS servers normally are.
 *  2. **IP pinning.** The hostname is resolved once, every returned address is
 *     validated, and the winning address is handed back so the dispatcher can
 *     connect to exactly that IP. Without this, a hostile name could pass the
 *     check and then resolve to 169.254.169.254 on the second lookup.
 *
 * A target taken from operator-controlled environment config is trusted one
 * notch further: loopback is permitted (running the DNS server on the same host
 * is a legitimate setup). Cloud metadata is never permitted from any source.
 */

export interface ProxyTarget {
  /** Normalised origin, e.g. `http://127.0.0.1:5380`. */
  baseUrl: string
  origin: string
  hostname: string
  /** Address the dispatcher must connect to; already validated. */
  pinnedAddress: string
  family: 4 | 6
  /** True when the value came from env config rather than a request header. */
  fromEnv: boolean
}

/**
 * Never allowed, no matter where the target came from.
 *
 * `addAddress`/`addSubnet` default `type` to `'ipv4'`, so every IPv6 entry must
 * say so explicitly — omitting it throws `ERR_INVALID_ADDRESS` at module load.
 */
function buildAbsoluteBlockList(): BlockList {
  const list = new BlockList()
  // cloud instance metadata
  list.addAddress('169.254.169.254')
  list.addAddress('fd00:ec2::254', 'ipv6')
  // "this network" / unspecified
  list.addSubnet('0.0.0.0', 8, 'ipv4')
  list.addAddress('::', 'ipv6')
  // multicast + reserved + broadcast
  list.addSubnet('224.0.0.0', 4, 'ipv4')
  list.addSubnet('240.0.0.0', 4, 'ipv4')
  list.addAddress('255.255.255.255')
  list.addSubnet('ff00::', 8, 'ipv6')
  // deprecated IPv6 site-local
  list.addSubnet('fec0::', 10, 'ipv6')
  return list
}

/** Additional restrictions applied to request-supplied (untrusted) targets. */
function buildStrictBlockList(): BlockList {
  const list = new BlockList()
  // loopback
  list.addSubnet('127.0.0.0', 8, 'ipv4')
  list.addAddress('::1', 'ipv6')
  // link-local (also covers 169.254.169.254 and fe80::/10)
  list.addSubnet('169.254.0.0', 16, 'ipv4')
  list.addSubnet('fe80::', 10, 'ipv6')
  return list
}

const ABSOLUTE_BLOCK = buildAbsoluteBlockList()
const STRICT_BLOCK = buildStrictBlockList()

/**
 * `::ffff:169.254.169.254` and NAT64 `64:ff9b::a9fe:a9fe` smuggle an IPv4
 * address past IPv6 rules, so unwrap before checking.
 */
export function unwrapMappedAddress(address: string): { address: string; family: 4 | 6 } {
  const family = isIP(address)
  if (family === 4) return { address, family: 4 }

  const lower = address.toLowerCase()

  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return { address: mapped[1], family: 4 }

  // NAT64 well-known prefix 64:ff9b::/96
  if (lower.startsWith('64:ff9b:')) {
    const tail = lower.slice('64:ff9b:'.length).replace(/^0*:/, '')
    const parts = tail.split(':')
    if (parts.length === 2 && parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) {
      const bytes = parts.flatMap((p) => {
        const n = parseInt(p.padStart(4, '0'), 16)
        return [(n >> 8) & 0xff, n & 0xff]
      })
      return { address: bytes.join('.'), family: 4 }
    }
  }

  return { address, family: 6 }
}

export function isAddressBlocked(address: string, trusted: boolean): boolean {
  const { address: ip, family } = unwrapMappedAddress(address)
  const type = family === 4 ? 'ipv4' : 'ipv6'
  if (ABSOLUTE_BLOCK.check(ip, type)) return true
  if (!trusted && STRICT_BLOCK.check(ip, type)) return true
  return false
}

export interface ProxyConfig {
  /** Operator default target; also the trust anchor for loopback. */
  defaultTarget: string | undefined
  /** When non-empty, only these `host:port` values may be proxied. */
  allowedTargets: string[]
  allowLoopback: boolean
}

export function readProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  return {
    defaultTarget: env.TECHNITIUM_API_URL?.trim() || undefined,
    allowedTargets: (env.TECHNITIUM_ALLOWED_TARGETS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    allowLoopback: env.PROXY_ALLOW_LOOPBACK === 'true',
  }
}

/**
 * Turn operator- or client-supplied text into a URL, or say precisely why it is
 * not one. The failure reason is part of the contract: `no_target` is what the
 * UI translates into an actionable sentence, and "unsupported protocol" sends
 * someone to fix a typo while "not a valid address" sends them to check the
 * host.
 */
function normalise(raw: string): URL {
  const parsed = parseServerUrl(raw)
  if (parsed.ok) return parsed.url

  switch (parsed.reason) {
    case 'empty':
      throw new DnsApiError('no_target', 'No DNS server address was provided.')
    case 'protocol':
      throw new DnsApiError('no_target', `Unsupported protocol '${parsed.scheme}:'. Only http and https are allowed.`)
    case 'host':
      throw new DnsApiError('no_target', `'${raw}' has no host component.`)
    default:
      throw new DnsApiError('no_target', `'${raw}' is not a valid server address.`)
  }
}

/** Strip a trailing slash so `${baseUrl}/api/x` never produces `//api/x`. */
function trimOrigin(url: URL): string {
  return url.origin.replace(/\/+$/, '')
}

/**
 * Resolve and validate a proxy target.
 *
 * @param requested value from the `X-Dns-Target` request header (untrusted)
 * @param config    operator configuration from the environment
 * @throws DnsApiError with code `no_target` or `blocked_target`
 */
export async function resolveTarget(requested: string | null | undefined, config: ProxyConfig = readProxyConfig()): Promise<ProxyTarget> {
  const fromEnv = !requested || requested.trim() === ''
  const raw = fromEnv ? config.defaultTarget : requested
  if (!raw) {
    throw new DnsApiError(
      'no_target',
      'No DNS server selected and TECHNITIUM_API_URL is not configured. Add a server in the server switcher.',
    )
  }

  const url = normalise(raw)
  const baseUrl = trimOrigin(url)

  // explicit operator allowlist wins over the permissive guard
  if (config.allowedTargets.length > 0) {
    const hostPort = hostPortOf(url)
    const bare = url.hostname.toLowerCase()
    if (!config.allowedTargets.includes(hostPort) && !config.allowedTargets.includes(bare)) {
      throw new DnsApiError('blocked_target', `'${url.hostname}' is not in TECHNITIUM_ALLOWED_TARGETS.`, { target: baseUrl })
    }
  }

  const trusted = fromEnv || config.allowLoopback

  let pinnedAddress: string
  let family: 4 | 6

  if (isIP(url.hostname)) {
    const unwrapped = unwrapMappedAddress(url.hostname)
    if (isAddressBlocked(unwrapped.address, trusted)) {
      throw new DnsApiError('blocked_target', `Refusing to proxy to '${url.hostname}'.`, { target: baseUrl })
    }
    pinnedAddress = unwrapped.address
    family = unwrapped.family
  } else {
    let records
    try {
      records = await lookup(url.hostname, { all: true, verbatim: true })
    } catch (err) {
      throw new DnsApiError(
        'upstream_unreachable',
        `Could not resolve '${url.hostname}': ${err instanceof Error ? err.message : String(err)}`,
        { target: baseUrl },
      )
    }
    if (records.length === 0) {
      throw new DnsApiError('upstream_unreachable', `'${url.hostname}' did not resolve to any address.`, { target: baseUrl })
    }

    let chosen: { address: string; family: 4 | 6 } | undefined
    for (const record of records) {
      const unwrapped = unwrapMappedAddress(record.address)
      // Every address the name resolves to must be safe, otherwise a hostile
      // zone file could rotate between an allowed and a blocked answer.
      if (isAddressBlocked(unwrapped.address, trusted)) {
        throw new DnsApiError('blocked_target', `'${url.hostname}' resolves to a blocked address (${record.address}).`, {
          target: baseUrl,
        })
      }
      if (!chosen) chosen = unwrapped
    }
    if (!chosen) {
      throw new DnsApiError('upstream_unreachable', `'${url.hostname}' did not yield a usable address.`, { target: baseUrl })
    }
    pinnedAddress = chosen.address
    family = chosen.family
  }

  return { baseUrl, origin: url.origin, hostname: url.hostname, pinnedAddress, family, fromEnv }
}

/**
 * Build the absolute upstream URL for an endpoint path + query string.
 *
 * The hostname is deliberately preserved (not swapped for `pinnedAddress`) so
 * that the `Host` header and TLS SNI stay correct; the pinning is enforced at
 * the socket layer by the dispatcher created in `forward.ts`.
 */
export function buildUpstreamUrl(target: ProxyTarget, endpointPath: string, search: string): URL {
  const url = new URL(`${target.baseUrl}/api/${endpointPath}`)
  if (search) {
    const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    for (const [k, v] of incoming) url.searchParams.append(k, v)
  }
  return url
}
