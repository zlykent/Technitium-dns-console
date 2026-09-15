import type { BlockingType, ForwarderProtocol, Ipv6Mode, LoggingType, ProxyType, RecursionPolicy } from '@/lib/api/enums'
import type { NetworkAcl, TsigKey } from './common'

/**
 * `GET api/settings/get` — the full server configuration, 132 fields on v15.4.
 *
 * Nullable strings are fields Technitium renders as empty text boxes; they come
 * back as `null` rather than `""`, so every consumer must handle both.
 */
export interface DnsSettings {
  // ---- identity
  version: string
  uptimestamp: string
  clusterInitialized: boolean
  dnsServerDomain: string

  // ---- DNS server listeners
  dnsServerLocalEndPoints: string[]
  dnsServerIPv4SourceAddresses: string[]
  dnsServerIPv6SourceAddresses: string[]

  // ---- zone defaults
  defaultRecordTtl: number
  defaultNsRecordTtl: number
  defaultSoaRecordTtl: number
  defaultResponsiblePerson: string | null
  useSoaSerialDateScheme: boolean
  minSoaRefresh: number
  minSoaRetry: number
  zoneTransferAllowedNetworks: string[]
  notifyAllowedNetworks: string[]

  // ---- updates
  dnsServerEnableCheckForUpdate: boolean
  dnsAppsEnableAutomaticUpdate: boolean

  // ---- transport behaviour
  ipv6Mode: Ipv6Mode
  preferIPv6: boolean
  enableUdpSocketPool: boolean
  socketPoolExcludedPorts: number[]
  udpPayloadSize: number
  dnssecValidation: boolean

  // ---- EDNS client subnet
  eDnsClientSubnet: boolean
  eDnsClientSubnetIPv4PrefixLength: number
  eDnsClientSubnetIPv6PrefixLength: number
  eDnsClientSubnetIpv4Override: string | null
  eDnsClientSubnetIpv6Override: string | null

  // ---- queries-per-minute rate limiting
  qpmPrefixLimitsIPv4: QpmPrefixLimit[]
  qpmPrefixLimitsIPv6: QpmPrefixLimit[]
  qpmLimitSampleMinutes: number
  qpmLimitUdpTruncationPercentage: number
  qpmLimitBypassList: string[]

  // ---- timeouts and buffers
  clientTimeout: number
  tcpSendTimeout: number
  tcpReceiveTimeout: number
  quicIdleTimeout: number
  quicMaxInboundStreams: number
  listenBacklog: number
  udpSendBufferSizeKB: number
  udpReceiveBufferSizeKB: number
  maxConcurrentResolutionsPerCore: number

  // ---- web service (this console's own HTTP endpoint)
  webServiceLocalAddresses: string[]
  webServiceHttpPort: number
  webServiceEnableHttpUnixSocket: boolean
  webServiceHttpUnixSocket: string | null
  webServiceEnableTlsUnixSocket: boolean
  webServiceTlsUnixSocket: string | null
  webServiceEnableTls: boolean
  webServiceEnableHttp3: boolean
  webServiceHttpToTlsRedirect: boolean
  webServiceUseSelfSignedTlsCertificate: boolean
  webServiceTlsPort: number
  webServiceReverseProxyAddresses: string[]
  webServiceRealIpHeader: string
  webServiceCspFrameAncestorsHeader: string
  webServiceTlsCertificatePath: string | null
  webServiceTlsCertificatePassword: string | null

  // ---- DNS-over-X transports
  enableEDnsClientSubnetSourceAddress: boolean
  enableDnsOverUdpProxy: boolean
  enableDnsOverTcpProxy: boolean
  enableDnsOverHttp: boolean
  enableDnsOverHttpUnixSocket: boolean
  enableDnsOverHttpsUnixSocket: boolean
  enableDnsOverTls: boolean
  enableDnsOverHttps: boolean
  enableDnsOverHttp3: boolean
  enableDnsOverQuic: boolean
  enableDnsOverHttpHelpRedirect: boolean
  dnsOverUdpProxyPort: number
  dnsOverTcpProxyPort: number
  dnsOverHttpPort: number
  dnsOverHttpUnixSocket: string | null
  dnsOverHttpsUnixSocket: string | null
  dnsOverTlsPort: number
  dnsOverHttpsPort: number
  dnsOverQuicPort: number
  dnsReverseProxyNetworkACL: NetworkAcl[]
  dnsOverHttpRealIpHeader: string
  dnsTlsCertificatePath: string | null
  dnsTlsCertificatePassword: string | null

  // ---- TSIG
  tsigKeys: TsigKey[]

  // ---- recursion / resolver
  recursion: RecursionPolicy
  recursionNetworkACL: NetworkAcl[]
  randomizeName: boolean
  qnameMinimization: boolean
  locallyServedDnsZones: boolean
  resolverRetries: number
  resolverTimeout: number
  resolverConcurrency: number
  resolverMaxStackCount: number

  // ---- cache
  saveCache: boolean
  serveStale: boolean
  serveStaleTtl: number
  serveStaleAnswerTtl: number
  serveStaleResetTtl: number
  serveStaleMaxWaitTime: number
  cacheMaximumEntries: number
  cacheMinimumRecordTtl: number
  cacheMaximumRecordTtl: number
  cacheNegativeRecordTtl: number
  cacheFailureRecordTtl: number
  cachePrefetchEligibility: number
  cachePrefetchTrigger: number
  cachePrefetchSampleIntervalInMinutes: number
  cachePrefetchSampleEligibilityHitsPerHour: number

  // ---- blocking
  enableBlocking: boolean
  allowTxtBlockingReport: boolean
  blockingBypassList: string[]
  blockingType: BlockingType
  blockingAnswerTtl: number
  customBlockingAddresses: string[]
  /** `null` when the operator never configured a block list. */
  blockListUrls: string[] | null
  blockListUpdateIntervalHours: number

  // ---- upstream proxy + forwarders
  proxy: UpstreamProxy | null
  forwarders: string[]
  forwarderProtocol: ForwarderProtocol
  concurrentForwarding: boolean
  forwarderRetries: number
  forwarderTimeout: number
  forwarderConcurrency: number

  // ---- logging + stats
  enableLogging: boolean
  loggingType: LoggingType
  ignoreResolverLogs: boolean
  logQueries: boolean
  noStackTrace: boolean
  useLocalTime: boolean
  logFolder: string
  maxLogFileDays: number
  enableInMemoryStats: boolean
  maxStatFileDays: number
}

/**
 * One queries-per-minute rate-limit rule.
 *
 * `prefix` is the *mask length* (32 for a single IPv4 address, 64 for an IPv6
 * subnet), not an address — verified against a live `settings/get`.
 */
export interface QpmPrefixLimit {
  prefix: number
  udpLimit: number
  tcpLimit: number
}

/**
 * `settings/get` nests the proxy; `settings/set` takes the same values as five
 * flat parameters. Both shapes are modelled so the mapper is explicit.
 */
export interface UpstreamProxy {
  type: ProxyType
  address: string
  port: number
  username?: string | null
  password?: string | null
  bypass?: string[]
}

/** Settings that are safe to show in the UI header/summary. */
export const SETTINGS_FIELD_COUNT = 132 as const
