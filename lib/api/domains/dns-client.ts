import { apiRequest } from '../client'
import type { ResolveParams, ResolveResult } from '../types/dns-client'

/**
 * DNS client — the server resolves a name on your behalf.
 *
 * A single endpoint, but the parameter combination is wide enough to be worth a
 * typed wrapper, and the built-in/bundled public-resolver list that the stock
 * console fetches from `/json/dnsclient-server-list-*.json` is inlined here so
 * the picker works without another round-trip (those files are not part of the
 * `api/` surface the proxy allowlists).
 */

export function resolve(params: ResolveParams): Promise<ResolveResult> {
  const { server, domain, type, protocol, dnssec, eDnsClientSubnet, import: importRecords, node } = params
  return apiRequest<ResolveResult>('dnsClient/resolve', {
    params: { server, domain, type, protocol, dnssec: dnssec ?? false, eDnsClientSubnet: eDnsClientSubnet ?? '', import: importRecords ? true : undefined, node },
  })
}

export interface PublicResolver {
  name: string
  address: string
  /** Protocol to preselect when this entry is chosen. */
  protocol?: ResolveParams['protocol']
}

/** A short, curated set of well-known public resolvers for the server picker. */
export const PUBLIC_RESOLVERS: readonly PublicResolver[] = [
  { name: 'This Server', address: 'this-server' },
  { name: 'Cloudflare', address: '1.1.1.1' },
  { name: 'Cloudflare (IPv6)', address: '2606:4700:4700::1111' },
  { name: 'Google', address: '8.8.8.8' },
  { name: 'Google (IPv6)', address: '2001:4860:4860::8888' },
  { name: 'Quad9 (secure)', address: '9.9.9.9' },
  { name: 'OpenDNS', address: '208.67.222.222' },
  { name: 'AliDNS', address: '223.5.5.5' },
  { name: 'AliDNS (IPv6)', address: '2400:3200::1' },
  { name: 'DNSPod', address: '119.29.29.29' },
  { name: 'Cloudflare DoH', address: 'https://cloudflare-dns.com/dns-query', protocol: 'HTTPS' },
  { name: 'Google DoH', address: 'https://dns.google/dns-query', protocol: 'HTTPS' },
  { name: 'Quad9 DoH', address: 'https://dns.quad9.net/dns-query', protocol: 'HTTPS' },
  { name: 'AliDNS DoH', address: 'https://dns.alidns.com/dns-query', protocol: 'HTTPS' },
] as const

/** `this-server` asks the local instance to recurse, which is the console default. */
export const DEFAULT_RESOLVER = 'this-server'
