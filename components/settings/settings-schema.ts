import { z } from 'zod'
import { parseLineList } from '@/lib/api/domains/settings'

/**
 * Zod schema for the whole `settings/get` document (132 keys on v15.4).
 *
 * Non-obvious decisions:
 *
 *  - **Every message is injected.** The schema is a factory taking a
 *    `SettingsSchemaMessages` bag so no validation text is ever a raw English
 *    literal — same shape as `components/dhcp/scope-form.tsx`. It is memoised on
 *    `tc`/`t` in the view, so a locale switch rebuilds it.
 *  - **Multi-line fields are validated line by line.** Technitium stores lists as
 *    comma-joined strings and the console renders them as `<textarea>`s, so the
 *    form value is the raw text. `parseLineList` (the SDK helper) defines what a
 *    "line" is, and validation reuses it so a line the parser drops can never
 *    reach the wire.
 *  - **Port conflicts are checked per transport family, not globally.** A live
 *    server legitimately runs `dnsOverTlsPort = dnsOverQuicPort = 853` (TCP vs
 *    UDP) and `dnsOverUdpProxyPort = dnsOverTcpProxyPort = 538`. A single global
 *    uniqueness rule would reject the shipped default configuration.
 *  - **Numbers use `valueAsNumber` semantics**: an emptied `<input type=number>`
 *    yields `NaN`, which `z.number()` rejects with `invalidNumber` rather than
 *    silently coercing to 0 and wiping a timeout.
 */

// ------------------------------------------------------------------ patterns

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** The full RFC-4291 form set, including IPv4-mapped and zone-id variants. */
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/

const DOMAIN_LABEL = /[a-zA-Z0-9_]([a-zA-Z0-9\-_]*[a-zA-Z0-9_])?/
const DOMAIN_RE = new RegExp(`^(\\*\\.)?(${DOMAIN_LABEL.source}\\.)*${DOMAIN_LABEL.source}\\.?$`)

/** Technitium ACL entries accept a leading `!` negation and an `:Allow`/`:Deny` verdict. */
const NETWORK_ACL_RE = new RegExp(`^!?(${IPV4_RE.source}|${IPV6_RE.source}|${DOMAIN_RE.source})(/\\d{1,3})?(:Allow|:Deny)?$`, 'i')

export function isIpv4(value: string): boolean {
  return IPV4_RE.test(value)
}

export function isIpv6(value: string): boolean {
  return IPV6_RE.test(value)
}

export function isIp(value: string): boolean {
  return isIpv4(value) || isIpv6(value)
}

export function isDomain(value: string): boolean {
  return DOMAIN_RE.test(value)
}

export function isNetworkAcl(value: string): boolean {
  return NETWORK_ACL_RE.test(value)
}

export function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** `IP:port`, with the IPv6 host optionally bracketed (`[::]:53`). */
export function isEndpoint(value: string): boolean {
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) return false
  const host = value.slice(0, index)
  const port = value.slice(index + 1)
  if (!/^\d{1,5}$/.test(port)) return false
  const portNumber = Number(port)
  if (portNumber < 0 || portNumber > 65535) return false
  return isIp(host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host)
}

/** A forwarder line is an IP, a `host:port` pair or a full DoH URL. */
export function isForwarder(value: string): boolean {
  if (isUrl(value)) return true
  if (isIp(value)) return true
  if (isDomain(value)) return true
  return isEndpoint(value)
}

/** QPM rule line: `<prefix length>/<udp limit>/<tcp limit>`. */
export function isQpmRule(value: string, maxPrefix: number): boolean {
  const parts = value.split('/')
  if (parts.length !== 3) return false
  const [prefix, udp, tcp] = parts.map((p) => p.trim())
  if (!/^\d+$/.test(prefix) || !/^\d+$/.test(udp) || !/^\d+$/.test(tcp)) return false
  return Number(prefix) >= 0 && Number(prefix) <= maxPrefix
}

// ------------------------------------------------------- port conflict groups

/**
 * TCP-family listeners. Two of these on the same port means the second bind
 * fails at startup, so it is a hard error rather than a warning.
 */
export const TCP_PORT_FIELDS = [
  'webServiceHttpPort',
  'webServiceTlsPort',
  'dnsOverHttpPort',
  'dnsOverHttpsPort',
  'dnsOverTlsPort',
  'dnsOverTcpProxyPort',
] as const

/** UDP-family listeners — checked separately for the reason in the header. */
export const UDP_PORT_FIELDS = ['dnsOverUdpProxyPort', 'dnsOverQuicPort'] as const

const PORT_GROUPS: readonly (readonly string[])[] = [TCP_PORT_FIELDS, UDP_PORT_FIELDS]

// -------------------------------------------------------------------- messages

export interface SettingsSchemaMessages {
  required: string
  invalidNumber: string
  invalidIp: string
  invalidDomain: string
  invalidUrl: string
  min: (value: number) => string
  max: (value: number) => string
  /** `listeners.invalidEndpoint` — carries the offending line via `{value}`. */
  invalidEndpoint: (value: string) => string
  /** `dnsOverX.portConflict` — `{other}` is the translated label of the rival field. */
  portConflict: (port: number, other: string) => string
  /** `proxy.requiresAddress`. */
  requiresAddress: string
  /** API parameter name -> translated label, for `{other}` above. */
  fieldLabel: (field: string) => string
}

const INT_MAX = 2147483647

export function buildSettingsSchema(m: SettingsSchemaMessages) {
  /** Integer in `[min, max]`; `NaN` (an emptied number input) fails with `invalidNumber`. */
  const n = (min = 0, max = INT_MAX) =>
    z.number({ error: m.invalidNumber }).int().min(min, m.min(min)).max(max, m.max(max))

  const port = () => n(0, 65535)

  /** Optional single-value field: blank means "unset" and is always accepted. */
  const optional = (test: (value: string) => boolean, message: string) =>
    z.string().refine((value) => value.trim() === '' || test(value.trim()), message)

  /** Multi-line field: every non-blank line must satisfy `test`. */
  const lines = (test: (line: string) => boolean, message: string | ((line: string) => string)) =>
    z.string().superRefine((value, ctx) => {
      for (const line of parseLineList(value)) {
        if (test(line)) continue
        ctx.addIssue({ code: 'custom', message: typeof message === 'function' ? message(line) : message })
        return
      }
    })

  const portLines = lines(
    (line) => /^\d{1,5}$/.test(line) && Number(line) >= 0 && Number(line) <= 65535,
    m.invalidNumber,
  )

  return z
    .object({
      // ---- general
      dnsServerDomain: z.string().refine((v) => v.trim().length > 0, m.required).refine((v) => isDomain(v.trim()), m.invalidDomain),
      ipv6Mode: z.enum(['Disabled', 'Enabled', 'Preferred']),
      enableUdpSocketPool: z.boolean(),
      socketPoolExcludedPorts: portLines,
      udpPayloadSize: n(512, 65535),
      dnssecValidation: z.boolean(),
      dnsServerEnableCheckForUpdate: z.boolean(),
      dnsAppsEnableAutomaticUpdate: z.boolean(),

      // ---- listeners
      dnsServerLocalEndPoints: lines(isEndpoint, m.invalidEndpoint),
      dnsServerIPv4SourceAddresses: lines(isIpv4, m.invalidIp),
      dnsServerIPv6SourceAddresses: lines(isIpv6, m.invalidIp),
      clientTimeout: n(),
      tcpSendTimeout: n(),
      tcpReceiveTimeout: n(),
      quicIdleTimeout: n(),
      quicMaxInboundStreams: n(),
      listenBacklog: n(),
      udpSendBufferSizeKB: n(),
      udpReceiveBufferSizeKB: n(),
      maxConcurrentResolutionsPerCore: n(),

      // ---- zone defaults
      defaultRecordTtl: n(),
      defaultNsRecordTtl: n(),
      defaultSoaRecordTtl: n(),
      defaultResponsiblePerson: optional((v) => {
        const at = v.lastIndexOf('@')
        return at > 0 ? isDomain(v.slice(at + 1)) : isDomain(v)
      }, m.invalidDomain),
      useSoaSerialDateScheme: z.boolean(),
      minSoaRefresh: n(),
      minSoaRetry: n(),
      zoneTransferAllowedNetworks: lines(isNetworkAcl, m.invalidIp),
      notifyAllowedNetworks: lines(isNetworkAcl, m.invalidIp),

      // ---- web service
      webServiceLocalAddresses: lines(isIp, m.invalidIp),
      webServiceHttpPort: port(),
      webServiceEnableTls: z.boolean(),
      webServiceTlsPort: port(),
      webServiceHttpToTlsRedirect: z.boolean(),
      webServiceUseSelfSignedTlsCertificate: z.boolean(),
      webServiceTlsCertificatePath: z.string(),
      webServiceTlsCertificatePassword: z.string(),
      webServiceEnableHttp3: z.boolean(),
      webServiceEnableHttpUnixSocket: z.boolean(),
      webServiceHttpUnixSocket: z.string(),
      webServiceEnableTlsUnixSocket: z.boolean(),
      webServiceTlsUnixSocket: z.string(),
      webServiceReverseProxyAddresses: lines(isNetworkAcl, m.invalidIp),
      webServiceRealIpHeader: z.string(),
      webServiceCspFrameAncestorsHeader: z.string(),

      // ---- DNS-over-X
      enableEDnsClientSubnetSourceAddress: z.boolean(),
      enableDnsOverUdpProxy: z.boolean(),
      enableDnsOverTcpProxy: z.boolean(),
      enableDnsOverHttp: z.boolean(),
      enableDnsOverHttpUnixSocket: z.boolean(),
      enableDnsOverHttpsUnixSocket: z.boolean(),
      enableDnsOverTls: z.boolean(),
      enableDnsOverHttps: z.boolean(),
      enableDnsOverHttp3: z.boolean(),
      enableDnsOverQuic: z.boolean(),
      enableDnsOverHttpHelpRedirect: z.boolean(),
      dnsOverUdpProxyPort: port(),
      dnsOverTcpProxyPort: port(),
      dnsOverHttpPort: port(),
      dnsOverHttpUnixSocket: z.string(),
      dnsOverHttpsUnixSocket: z.string(),
      dnsOverTlsPort: port(),
      dnsOverHttpsPort: port(),
      dnsOverQuicPort: port(),
      dnsReverseProxyNetworkACL: lines(isNetworkAcl, m.invalidIp),
      dnsOverHttpRealIpHeader: z.string(),
      dnsTlsCertificatePath: z.string(),
      dnsTlsCertificatePassword: z.string(),

      // ---- recursion / resolver
      recursion: z.enum(['Deny', 'Allow', 'AllowOnlyForPrivateNetworks', 'UseSpecifiedNetworkACL']),
      recursionNetworkACL: lines(isNetworkAcl, m.invalidIp),
      randomizeName: z.boolean(),
      qnameMinimization: z.boolean(),
      locallyServedDnsZones: z.boolean(),
      resolverRetries: n(),
      resolverTimeout: n(),
      resolverConcurrency: n(),
      resolverMaxStackCount: n(),
      forwarders: lines(isForwarder, m.invalidIp),
      forwarderProtocol: z.enum(['Udp', 'Tcp', 'Tls', 'Https', 'Quic']),
      concurrentForwarding: z.boolean(),
      forwarderRetries: n(),
      forwarderTimeout: n(),
      forwarderConcurrency: n(),

      // ---- proxy (flattened: `settings/get` nests it under `proxy`)
      proxyType: z.enum(['None', 'Http', 'Socks5']),
      proxyAddress: z.string(),
      proxyPort: port(),
      proxyUsername: z.string(),
      proxyPassword: z.string(),
      proxyBypass: lines((line) => isNetworkAcl(line) || isDomain(line), m.invalidDomain),

      // ---- cache
      saveCache: z.boolean(),
      serveStale: z.boolean(),
      serveStaleTtl: n(),
      serveStaleAnswerTtl: n(),
      serveStaleResetTtl: n(),
      serveStaleMaxWaitTime: n(),
      cacheMaximumEntries: n(),
      cacheMinimumRecordTtl: n(),
      cacheMaximumRecordTtl: n(),
      cacheNegativeRecordTtl: n(),
      cacheFailureRecordTtl: n(),
      cachePrefetchEligibility: n(),
      cachePrefetchTrigger: n(0, 100),
      cachePrefetchSampleIntervalInMinutes: n(),
      cachePrefetchSampleEligibilityHitsPerHour: n(),

      // ---- blocking
      enableBlocking: z.boolean(),
      allowTxtBlockingReport: z.boolean(),
      blockingBypassList: lines(isDomain, m.invalidDomain),
      blockingType: z.enum(['AnyAddress', 'NxDomain', 'CustomAddress']),
      blockingAnswerTtl: n(),
      customBlockingAddresses: lines(isIp, m.invalidIp),
      blockListUrls: lines(isUrl, m.invalidUrl),
      blockListUpdateIntervalHours: n(),

      // ---- rate limiting
      qpmPrefixLimitsIPv4: lines((line) => isQpmRule(line, 32), m.invalidNumber),
      qpmPrefixLimitsIPv6: lines((line) => isQpmRule(line, 128), m.invalidNumber),
      qpmLimitSampleMinutes: n(),
      qpmLimitUdpTruncationPercentage: n(0, 100),
      qpmLimitBypassList: lines((line) => isNetworkAcl(line) || isDomain(line), m.invalidDomain),

      // ---- EDNS client subnet
      eDnsClientSubnet: z.boolean(),
      eDnsClientSubnetIPv4PrefixLength: n(0, 32),
      eDnsClientSubnetIPv6PrefixLength: n(0, 128),
      eDnsClientSubnetIpv4Override: optional(isIpv4, m.invalidIp),
      eDnsClientSubnetIpv6Override: optional(isIpv6, m.invalidIp),

      // ---- logging + stats
      enableLogging: z.boolean(),
      loggingType: z.enum(['None', 'File', 'Console', 'FileAndConsole']),
      ignoreResolverLogs: z.boolean(),
      logQueries: z.boolean(),
      noStackTrace: z.boolean(),
      useLocalTime: z.boolean(),
      logFolder: z.string().refine((v) => v.trim().length > 0, m.required),
      maxLogFileDays: n(),
      enableInMemoryStats: z.boolean(),
      maxStatFileDays: n(),
    })
    .superRefine((values, ctx) => {
      // Two listeners on the same port within one transport family cannot both
      // bind; report against the *second* field so the error sits next to the
      // control the operator most likely just changed.
      for (const group of PORT_GROUPS) {
        const seen = new Map<number, string>()
        for (const field of group) {
          const value = values[field as keyof typeof values]
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
          const previous = seen.get(value)
          if (previous === undefined) {
            seen.set(value, field)
            continue
          }
          ctx.addIssue({ code: 'custom', path: [field], message: m.portConflict(value, m.fieldLabel(previous)) })
        }
      }

      // The stock console refuses to submit an enabled proxy without an address
      // (`main.js:2128`); same rule, but surfaced as a field error.
      if (values.proxyType !== 'None') {
        if (values.proxyAddress.trim() === '') {
          ctx.addIssue({ code: 'custom', path: ['proxyAddress'], message: m.requiresAddress })
        }
        if (values.proxyPort <= 0) {
          ctx.addIssue({ code: 'custom', path: ['proxyPort'], message: m.requiresAddress })
        }
      }
    })
}

export type SettingsFormValues = z.infer<ReturnType<typeof buildSettingsSchema>>
