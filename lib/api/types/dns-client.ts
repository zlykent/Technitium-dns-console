import type { QueryRecordType, ResolverProtocol } from '@/lib/api/enums'

/**
 * `dnsClient/resolve` — the server acts as a resolver on your behalf.
 *
 * The response is a serialised DNS message and every key is **PascalCase**,
 * unlike the rest of the API. That is deliberate: it mirrors the wire format,
 * so the UI can render it as a packet inspector. Do not "fix" the casing.
 */

export interface ResolveParams {
  /** Name server to ask; an IP, a `host:port`, or a `https://` DoH URL. */
  server: string
  domain: string
  type: QueryRecordType
  protocol: ResolverProtocol
  /** Request DNSSEC validation (`dnssec` on the wire). */
  dnssec?: boolean
  eDnsClientSubnet?: string
  /** Also create records in the selected zone from the answer. */
  import?: boolean
  node?: string
}

export interface ResolveResult {
  result: DnsMessage
  /** Raw responses from each server consulted; empty for a single hop. */
  rawResponses: string[]
}

export interface DnsMessage {
  Metadata: DnsMessageMetadata
  EDNS?: EdnsInfo
  Identifier: number
  IsResponse: boolean
  OPCODE: string
  AuthoritativeAnswer: boolean
  Truncation: boolean
  RecursionDesired: boolean
  RecursionAvailable: boolean
  Z: number
  AuthenticData: boolean
  CheckingDisabled: boolean
  RCODE: string
  QDCOUNT: number
  ANCOUNT: number
  NSCOUNT: number
  ARCOUNT: number
  Question: DnsQuestion[]
  Answer: DnsMessageRecord[]
  Authority: DnsMessageRecord[]
  Additional: DnsMessageRecord[]
}

export interface DnsMessageMetadata {
  NameServer: string
  Protocol: string
  DatagramSize: string
  RoundTripTime: string
}

export interface EdnsInfo {
  UdpPayloadSize: number
  ExtendedRCODE: string
  Version: number
  Flags: string
  Options: EdnsOption[]
}

export interface EdnsOption {
  Code?: string
  Name?: string
  Data?: string
  [key: string]: unknown
}

export interface DnsQuestion {
  Name: string
  Type: string
  Class: string
}

export interface DnsMessageRecord {
  Name: string
  Type: string
  /** `Class` for normal records, but the OPT record puts its payload size here. */
  Class: string
  /** Pre-formatted: `92 (1m32s)`. */
  TTL: string
  RDLENGTH: string
  RDATA: Record<string, unknown>
  DnssecStatus: string
}

/**
 * Render any RDATA object as a single line. The keys vary per record type
 * (`IPAddress`, `DomainName`, `Text`, `Options`, ...) so rather than switch on
 * type we flatten whatever came back — which is also exactly what a packet
 * inspector should do with an unknown type.
 */
export function formatRData(rdata: Record<string, unknown> | undefined | null): string {
  if (!rdata) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(rdata)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      parts.push(`${key}: ${value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}`)
      continue
    }
    if (typeof value === 'object') {
      const nested = JSON.stringify(value)
      if (nested !== '{}' && nested !== '[]') parts.push(`${key}: ${nested}`)
      continue
    }
    parts.push(`${key}: ${String(value)}`)
  }
  return parts.join('  ')
}

/** Split `https://dns.example.com/dns-query` into the parts the API wants. */
export function parseServerInput(raw: string): { server: string; protocolHint?: ResolverProtocol } {
  const value = raw.trim()
  if (/^https:\/\//i.test(value)) return { server: value, protocolHint: 'HTTPS' }
  if (/^tls:\/\//i.test(value)) return { server: value.replace(/^tls:\/\//i, ''), protocolHint: 'TLS' }
  if (/^quic:\/\//i.test(value)) return { server: value.replace(/^quic:\/\//i, ''), protocolHint: 'QUIC' }
  return { server: value }
}
