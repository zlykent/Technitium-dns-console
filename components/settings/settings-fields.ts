import {
  formatLineList,
  formatQpmPrefixLimits,
  parseLineList,
  parseQpmPrefixLimits,
  patchToProxy,
  proxyToPatch,
  serializeLineList,
  serializeQpmPrefixLimits,
  type SettingsPatch,
} from '@/lib/api/domains/settings'
import { SETTINGS_FIELD_COUNT, type DnsSettings, type QpmPrefixLimit } from '@/lib/api/types/settings'
import type { SettingsFormValues } from '@/components/settings/settings-schema'

/**
 * Field metadata and the two-way mapping between `settings/get` and
 * `settings/set`.
 *
 * This file is the single place that knows *which* of the 132 configuration
 * keys belongs to which UI section, which ones the server treats as
 * cluster-wide versus per-node, and how a list becomes a wire string. The
 * non-obvious parts:
 *
 *  - **Scope is per field, not per section.** `main.js:1634-2201` interleaves
 *    `includeClusterParameters` / `includeNodeParameters` blocks *inside* what
 *    the console presents as one tab — e.g. the "Listeners" panel holds
 *    node-scoped `dnsServerLocalEndPoints` next to cluster-scoped
 *    `clientTimeout`. Grouping by section would silently drop half a save when
 *    a node is selected, so `CLUSTER_FIELDS` is a flat set.
 *  - **Empty list means the literal string `false`.** `appendParams`
 *    (`lib/api/client.ts:223`) skips empty arrays, and the SDK serialisers
 *    return `undefined` for an empty list — both of which mean "leave the old
 *    value alone". The stock console sends `key=false` to *clear*
 *    (`main.js:1658/1678/1700/1760/1938/1969/2091/2099/2108/2155`), so every
 *    list here goes through `listOr(…, 'false')`. Four fields deliberately
 *    deviate and are called out inline.
 *  - **`enableLogging` has no write side.** `settings/get` returns it but
 *    `settings/set` never receives it (`main.js:2189` sends only
 *    `loggingType`). The switch is real UI, mapped onto `loggingType` in
 *    `buildPatch`, and `FIELD_TO_PARAM` marks it as non-submittable so a
 *    section save cannot emit a parameter the server would reject.
 *  - **`preferIPv6` is derived.** The stock console has no control for it —
 *    the three `rdIPv6Mode` radios are the only input (`main.js:1695`) — and
 *    the API exposes no setter, so it is rendered read-only.
 */

// -------------------------------------------------------------------- sections

/**
 * Section ids double as `sections.<id>` message keys and as DOM anchor ids, so
 * they must stay URL-safe and must not be renamed without touching both.
 */
export const SECTION_IDS = [
  'general',
  'listeners',
  'zoneDefaults',
  'webService',
  'dnsOverX',
  'recursion',
  'proxy',
  'blocking',
  'cache',
  'rateLimit',
  'edns',
  'logging',
  'tsig',
  'updates',
  'backup',
  'advanced',
] as const

export type SectionId = (typeof SECTION_IDS)[number]

/** A form field name; identical to the `settings/set` parameter except where `FIELD_TO_PARAM` says otherwise. */
export type SettingsFieldName = keyof SettingsFormValues

/**
 * Form fields owned by each section. Drives three things: `form.trigger()` for
 * "save this section only", the dirty counter, and search filtering (a section
 * with no matching field is hidden entirely).
 *
 * `tsig`, `backup` and `advanced` own no react-hook-form field — the TSIG table
 * is edited outside the form (see `SECTION_PARAMS`) and the other two are
 * action/raw-view panels.
 */
export const SECTION_FIELDS: Record<SectionId, readonly SettingsFieldName[]> = {
  general: [
    'dnsServerDomain',
    'ipv6Mode',
    'enableUdpSocketPool',
    'socketPoolExcludedPorts',
    'udpPayloadSize',
    'dnssecValidation',
  ],
  listeners: [
    'dnsServerLocalEndPoints',
    'dnsServerIPv4SourceAddresses',
    'dnsServerIPv6SourceAddresses',
    'clientTimeout',
    'tcpSendTimeout',
    'tcpReceiveTimeout',
    'quicIdleTimeout',
    'quicMaxInboundStreams',
    'listenBacklog',
    'udpSendBufferSizeKB',
    'udpReceiveBufferSizeKB',
    'maxConcurrentResolutionsPerCore',
  ],
  zoneDefaults: [
    'defaultRecordTtl',
    'defaultNsRecordTtl',
    'defaultSoaRecordTtl',
    'defaultResponsiblePerson',
    'useSoaSerialDateScheme',
    'minSoaRefresh',
    'minSoaRetry',
    'zoneTransferAllowedNetworks',
    'notifyAllowedNetworks',
  ],
  webService: [
    'webServiceLocalAddresses',
    'webServiceHttpPort',
    'webServiceEnableTls',
    'webServiceTlsPort',
    'webServiceHttpToTlsRedirect',
    'webServiceUseSelfSignedTlsCertificate',
    'webServiceTlsCertificatePath',
    'webServiceTlsCertificatePassword',
    'webServiceEnableHttp3',
    'webServiceEnableHttpUnixSocket',
    'webServiceHttpUnixSocket',
    'webServiceEnableTlsUnixSocket',
    'webServiceTlsUnixSocket',
    'webServiceReverseProxyAddresses',
    'webServiceRealIpHeader',
    'webServiceCspFrameAncestorsHeader',
  ],
  dnsOverX: [
    'enableEDnsClientSubnetSourceAddress',
    'enableDnsOverUdpProxy',
    'enableDnsOverTcpProxy',
    'enableDnsOverHttp',
    'enableDnsOverHttpUnixSocket',
    'enableDnsOverHttpsUnixSocket',
    'enableDnsOverTls',
    'enableDnsOverHttps',
    'enableDnsOverHttp3',
    'enableDnsOverQuic',
    'enableDnsOverHttpHelpRedirect',
    'dnsOverUdpProxyPort',
    'dnsOverTcpProxyPort',
    'dnsOverHttpPort',
    'dnsOverHttpUnixSocket',
    'dnsOverHttpsUnixSocket',
    'dnsOverTlsPort',
    'dnsOverHttpsPort',
    'dnsOverQuicPort',
    'dnsReverseProxyNetworkACL',
    'dnsOverHttpRealIpHeader',
    'dnsTlsCertificatePath',
    'dnsTlsCertificatePassword',
  ],
  recursion: [
    'recursion',
    'recursionNetworkACL',
    'randomizeName',
    'qnameMinimization',
    'locallyServedDnsZones',
    'resolverRetries',
    'resolverTimeout',
    'resolverConcurrency',
    'resolverMaxStackCount',
    'forwarders',
    'forwarderProtocol',
    'concurrentForwarding',
    'forwarderRetries',
    'forwarderTimeout',
    'forwarderConcurrency',
  ],
  proxy: ['proxyType', 'proxyAddress', 'proxyPort', 'proxyUsername', 'proxyPassword', 'proxyBypass'],
  blocking: [
    'enableBlocking',
    'allowTxtBlockingReport',
    'blockingBypassList',
    'blockingType',
    'blockingAnswerTtl',
    'customBlockingAddresses',
    'blockListUrls',
    'blockListUpdateIntervalHours',
  ],
  cache: [
    'saveCache',
    'serveStale',
    'serveStaleTtl',
    'serveStaleAnswerTtl',
    'serveStaleResetTtl',
    'serveStaleMaxWaitTime',
    'cacheMaximumEntries',
    'cacheMinimumRecordTtl',
    'cacheMaximumRecordTtl',
    'cacheNegativeRecordTtl',
    'cacheFailureRecordTtl',
    'cachePrefetchEligibility',
    'cachePrefetchTrigger',
    'cachePrefetchSampleIntervalInMinutes',
    'cachePrefetchSampleEligibilityHitsPerHour',
  ],
  rateLimit: [
    'qpmPrefixLimitsIPv4',
    'qpmPrefixLimitsIPv6',
    'qpmLimitSampleMinutes',
    'qpmLimitUdpTruncationPercentage',
    'qpmLimitBypassList',
  ],
  edns: [
    'eDnsClientSubnet',
    'eDnsClientSubnetIPv4PrefixLength',
    'eDnsClientSubnetIPv6PrefixLength',
    'eDnsClientSubnetIpv4Override',
    'eDnsClientSubnetIpv6Override',
  ],
  logging: [
    'enableLogging',
    'loggingType',
    'ignoreResolverLogs',
    'logQueries',
    'noStackTrace',
    'useLocalTime',
    'logFolder',
    'maxLogFileDays',
    'enableInMemoryStats',
    'maxStatFileDays',
  ],
  tsig: [],
  updates: ['dnsServerEnableCheckForUpdate', 'dnsAppsEnableAutomaticUpdate'],
  backup: [],
  advanced: [],
}

/** Every editable form field, aggregated from `SECTION_FIELDS` (132 entries). */
export const ALL_FORM_FIELDS: readonly SettingsFieldName[] = SECTION_IDS.flatMap((id) => SECTION_FIELDS[id])

/**
 * Reverse index of `SECTION_FIELDS`. The nav marks a panel dirty when *any* of
 * its fields changed, and the diff table has to jump from a field name back to
 * the panel that owns it; both would otherwise re-scan all sixteen lists.
 */
export const FIELD_SECTION: ReadonlyMap<string, SectionId> = new Map(
  SECTION_IDS.flatMap((id) => SECTION_FIELDS[id].map((field) => [field, id] as const)),
)

/** Read-only keys from `settings/get`, shown in the General panel. */
export const READONLY_FIELDS = ['version', 'uptimestamp', 'clusterInitialized', 'preferIPv6'] as const

/** Form field -> `settings/set` parameter. `null` means "never submitted". */
const FIELD_TO_PARAM: Partial<Record<SettingsFieldName, string | null>> = {
  enableLogging: null,
}

/**
 * API parameters a section writes. `tsig` is special: the table lives outside
 * react-hook-form but is still submitted through `settings/set`, so its
 * parameter is declared here rather than in `SECTION_FIELDS`.
 */
export function sectionParams(id: SectionId): string[] {
  const out = new Set<string>()
  if (id === 'tsig') out.add('tsigKeys')
  for (const field of SECTION_FIELDS[id]) {
    const param = field in FIELD_TO_PARAM ? FIELD_TO_PARAM[field] : field
    if (param) out.add(param)
  }
  return [...out]
}

// --------------------------------------------------------------- cluster scope

/**
 * Cluster-wide parameters — sent only when `node` is `""` (this machine, which
 * is also the cluster primary's own copy) or `"cluster"` (fan out to every
 * node). Verbatim from the `includeClusterParameters` blocks in
 * `main.js:1667-2185`; everything else in `ALL_FORM_FIELDS` is node-scoped.
 */
export const CLUSTER_FIELDS: ReadonlySet<SettingsFieldName> = new Set<SettingsFieldName>([
  // zone defaults + updates
  'defaultRecordTtl',
  'defaultNsRecordTtl',
  'defaultSoaRecordTtl',
  'defaultResponsiblePerson',
  'useSoaSerialDateScheme',
  'minSoaRefresh',
  'minSoaRetry',
  'zoneTransferAllowedNetworks',
  'notifyAllowedNetworks',
  'dnsServerEnableCheckForUpdate',
  'dnsAppsEnableAutomaticUpdate',
  // general
  'udpPayloadSize',
  'dnssecValidation',
  // EDNS client subnet
  'eDnsClientSubnet',
  'eDnsClientSubnetIPv4PrefixLength',
  'eDnsClientSubnetIPv6PrefixLength',
  'eDnsClientSubnetIpv4Override',
  'eDnsClientSubnetIpv6Override',
  // rate limiting
  'qpmPrefixLimitsIPv4',
  'qpmPrefixLimitsIPv6',
  'qpmLimitSampleMinutes',
  'qpmLimitUdpTruncationPercentage',
  'qpmLimitBypassList',
  // timeouts and buffers
  'clientTimeout',
  'tcpSendTimeout',
  'tcpReceiveTimeout',
  'quicIdleTimeout',
  'quicMaxInboundStreams',
  'listenBacklog',
  'udpSendBufferSizeKB',
  'udpReceiveBufferSizeKB',
  'maxConcurrentResolutionsPerCore',
  // recursion
  'recursion',
  'recursionNetworkACL',
  'randomizeName',
  'qnameMinimization',
  'locallyServedDnsZones',
  'resolverRetries',
  'resolverTimeout',
  'resolverConcurrency',
  'resolverMaxStackCount',
  // blocking
  'enableBlocking',
  'allowTxtBlockingReport',
  'blockingBypassList',
  'blockingType',
  'customBlockingAddresses',
  'blockingAnswerTtl',
  'blockListUrls',
  'blockListUpdateIntervalHours',
  // proxy + forwarders
  'proxyType',
  'proxyAddress',
  'proxyPort',
  'proxyUsername',
  'proxyPassword',
  'proxyBypass',
  'forwarders',
  'forwarderProtocol',
  'concurrentForwarding',
  'forwarderRetries',
  'forwarderTimeout',
  'forwarderConcurrency',
])

/**
 * Settings that only take effect after the DNS service restarts, flagged with
 * the `restartHint` badge.
 *
 * **Inferred, not served.** Neither `settings/get` nor the stock console marks
 * any option as "needs a restart" — Technitium applies almost everything live.
 * The set below is the residue that cannot be: Unix-domain socket paths are
 * bound once at startup, the UDP socket pool and the listen backlog are
 * properties of already-created sockets, the kernel UDP buffer sizes are set
 * per socket, HTTP/3 needs a new QUIC listener, and the log folder is resolved
 * when the file logger is constructed. Treat it as documentation, not as a
 * server contract.
 */
export const RESTART_FIELDS: ReadonlySet<SettingsFieldName> = new Set<SettingsFieldName>([
  'enableUdpSocketPool',
  'socketPoolExcludedPorts',
  'listenBacklog',
  'udpSendBufferSizeKB',
  'udpReceiveBufferSizeKB',
  'webServiceEnableHttp3',
  'webServiceEnableHttpUnixSocket',
  'webServiceHttpUnixSocket',
  'webServiceEnableTlsUnixSocket',
  'webServiceTlsUnixSocket',
  'enableDnsOverHttpUnixSocket',
  'dnsOverHttpUnixSocket',
  'enableDnsOverHttpsUnixSocket',
  'dnsOverHttpsUnixSocket',
  'logFolder',
])

// ------------------------------------------------------------------- i18n index

/**
 * Field name -> message key inside the `settings` namespace. Used for the
 * search index, for the `{other}` slot of `dnsOverX.portConflict`, and for the
 * diff table. Every editable field *and* every read-only one has an entry;
 * `fieldLabel` falls back to the raw parameter name so a newly added field
 * degrades into "untranslated but present" instead of throwing.
 */
export const FIELD_LABEL_KEYS: Record<string, string> = {
  // read-only
  version: 'general.version',
  uptimestamp: 'general.uptimestamp',
  clusterInitialized: 'general.clusterInitialized',
  preferIPv6: 'general.preferIPv6',
  // general
  dnsServerDomain: 'general.dnsServerDomain',
  ipv6Mode: 'general.ipv6Mode',
  enableUdpSocketPool: 'general.enableUdpSocketPool',
  socketPoolExcludedPorts: 'general.socketPoolExcludedPorts',
  udpPayloadSize: 'general.udpPayloadSize',
  dnssecValidation: 'general.dnssecValidation',
  // listeners
  dnsServerLocalEndPoints: 'listeners.dnsServerLocalEndPoints',
  dnsServerIPv4SourceAddresses: 'listeners.dnsServerIPv4SourceAddresses',
  dnsServerIPv6SourceAddresses: 'listeners.dnsServerIPv6SourceAddresses',
  clientTimeout: 'listeners.clientTimeout',
  tcpSendTimeout: 'listeners.tcpSendTimeout',
  tcpReceiveTimeout: 'listeners.tcpReceiveTimeout',
  quicIdleTimeout: 'listeners.quicIdleTimeout',
  quicMaxInboundStreams: 'listeners.quicMaxInboundStreams',
  listenBacklog: 'listeners.listenBacklog',
  udpSendBufferSizeKB: 'listeners.udpSendBufferSizeKB',
  udpReceiveBufferSizeKB: 'listeners.udpReceiveBufferSizeKB',
  maxConcurrentResolutionsPerCore: 'listeners.maxConcurrentResolutionsPerCore',
  // zone defaults
  defaultRecordTtl: 'zoneDefaults.defaultRecordTtl',
  defaultNsRecordTtl: 'zoneDefaults.defaultNsRecordTtl',
  defaultSoaRecordTtl: 'zoneDefaults.defaultSoaRecordTtl',
  defaultResponsiblePerson: 'zoneDefaults.defaultResponsiblePerson',
  useSoaSerialDateScheme: 'zoneDefaults.useSoaSerialDateScheme',
  minSoaRefresh: 'zoneDefaults.minSoaRefresh',
  minSoaRetry: 'zoneDefaults.minSoaRetry',
  zoneTransferAllowedNetworks: 'zoneDefaults.zoneTransferAllowedNetworks',
  notifyAllowedNetworks: 'zoneDefaults.notifyAllowedNetworks',
  // web service
  webServiceLocalAddresses: 'webService.webServiceLocalAddresses',
  webServiceHttpPort: 'webService.webServiceHttpPort',
  webServiceEnableTls: 'webService.webServiceEnableTls',
  webServiceTlsPort: 'webService.webServiceTlsPort',
  webServiceHttpToTlsRedirect: 'webService.webServiceHttpToTlsRedirect',
  webServiceUseSelfSignedTlsCertificate: 'webService.webServiceUseSelfSignedTlsCertificate',
  webServiceTlsCertificatePath: 'webService.webServiceTlsCertificatePath',
  webServiceTlsCertificatePassword: 'webService.webServiceTlsCertificatePassword',
  webServiceEnableHttp3: 'webService.webServiceEnableHttp3',
  webServiceEnableHttpUnixSocket: 'webService.webServiceEnableHttpUnixSocket',
  webServiceHttpUnixSocket: 'webService.webServiceHttpUnixSocket',
  webServiceEnableTlsUnixSocket: 'webService.webServiceEnableTlsUnixSocket',
  webServiceTlsUnixSocket: 'webService.webServiceTlsUnixSocket',
  webServiceReverseProxyAddresses: 'webService.webServiceReverseProxyAddresses',
  webServiceRealIpHeader: 'webService.webServiceRealIpHeader',
  webServiceCspFrameAncestorsHeader: 'webService.webServiceCspFrameAncestorsHeader',
  // DNS-over-X
  enableEDnsClientSubnetSourceAddress: 'dnsOverX.enableEDnsClientSubnetSourceAddress',
  enableDnsOverUdpProxy: 'dnsOverX.enableDnsOverUdpProxy',
  enableDnsOverTcpProxy: 'dnsOverX.enableDnsOverTcpProxy',
  enableDnsOverHttp: 'dnsOverX.enableDnsOverHttp',
  enableDnsOverHttpUnixSocket: 'dnsOverX.enableDnsOverHttpUnixSocket',
  enableDnsOverHttpsUnixSocket: 'dnsOverX.enableDnsOverHttpsUnixSocket',
  enableDnsOverTls: 'dnsOverX.enableDnsOverTls',
  enableDnsOverHttps: 'dnsOverX.enableDnsOverHttps',
  enableDnsOverHttp3: 'dnsOverX.enableDnsOverHttp3',
  enableDnsOverQuic: 'dnsOverX.enableDnsOverQuic',
  enableDnsOverHttpHelpRedirect: 'dnsOverX.enableDnsOverHttpHelpRedirect',
  dnsOverUdpProxyPort: 'dnsOverX.dnsOverUdpProxyPort',
  dnsOverTcpProxyPort: 'dnsOverX.dnsOverTcpProxyPort',
  dnsOverHttpPort: 'dnsOverX.dnsOverHttpPort',
  dnsOverHttpUnixSocket: 'dnsOverX.dnsOverHttpUnixSocket',
  dnsOverHttpsUnixSocket: 'dnsOverX.dnsOverHttpsUnixSocket',
  dnsOverTlsPort: 'dnsOverX.dnsOverTlsPort',
  dnsOverHttpsPort: 'dnsOverX.dnsOverHttpsPort',
  dnsOverQuicPort: 'dnsOverX.dnsOverQuicPort',
  dnsReverseProxyNetworkACL: 'dnsOverX.dnsReverseProxyNetworkACL',
  dnsOverHttpRealIpHeader: 'dnsOverX.dnsOverHttpRealIpHeader',
  dnsTlsCertificatePath: 'dnsOverX.dnsTlsCertificatePath',
  dnsTlsCertificatePassword: 'dnsOverX.dnsTlsCertificatePassword',
  // recursion
  recursion: 'recursion.recursion',
  recursionNetworkACL: 'recursion.recursionNetworkACL',
  randomizeName: 'recursion.randomizeName',
  qnameMinimization: 'recursion.qnameMinimization',
  locallyServedDnsZones: 'recursion.locallyServedDnsZones',
  resolverRetries: 'recursion.resolverRetries',
  resolverTimeout: 'recursion.resolverTimeout',
  resolverConcurrency: 'recursion.resolverConcurrency',
  resolverMaxStackCount: 'recursion.resolverMaxStackCount',
  forwarders: 'recursion.forwarders',
  forwarderProtocol: 'recursion.forwarderProtocol',
  concurrentForwarding: 'recursion.concurrentForwarding',
  forwarderRetries: 'recursion.forwarderRetries',
  forwarderTimeout: 'recursion.forwarderTimeout',
  forwarderConcurrency: 'recursion.forwarderConcurrency',
  // proxy
  proxyType: 'proxy.proxyType',
  proxyAddress: 'proxy.proxyAddress',
  proxyPort: 'proxy.proxyPort',
  proxyUsername: 'proxy.proxyUsername',
  proxyPassword: 'proxy.proxyPassword',
  proxyBypass: 'proxy.proxyBypass',
  // blocking
  enableBlocking: 'blocking.enableBlocking',
  allowTxtBlockingReport: 'blocking.allowTxtBlockingReport',
  blockingBypassList: 'blocking.blockingBypassList',
  blockingType: 'blocking.blockingType',
  blockingAnswerTtl: 'blocking.blockingAnswerTtl',
  customBlockingAddresses: 'blocking.customBlockingAddresses',
  blockListUrls: 'blocking.blockListUrls',
  blockListUpdateIntervalHours: 'blocking.blockListUpdateIntervalHours',
  // cache
  saveCache: 'cache.saveCache',
  serveStale: 'cache.serveStale',
  serveStaleTtl: 'cache.serveStaleTtl',
  serveStaleAnswerTtl: 'cache.serveStaleAnswerTtl',
  serveStaleResetTtl: 'cache.serveStaleResetTtl',
  serveStaleMaxWaitTime: 'cache.serveStaleMaxWaitTime',
  cacheMaximumEntries: 'cache.cacheMaximumEntries',
  cacheMinimumRecordTtl: 'cache.cacheMinimumRecordTtl',
  cacheMaximumRecordTtl: 'cache.cacheMaximumRecordTtl',
  cacheNegativeRecordTtl: 'cache.cacheNegativeRecordTtl',
  cacheFailureRecordTtl: 'cache.cacheFailureRecordTtl',
  cachePrefetchEligibility: 'cache.cachePrefetchEligibility',
  cachePrefetchTrigger: 'cache.cachePrefetchTrigger',
  cachePrefetchSampleIntervalInMinutes: 'cache.cachePrefetchSampleIntervalInMinutes',
  cachePrefetchSampleEligibilityHitsPerHour: 'cache.cachePrefetchSampleEligibilityHitsPerHour',
  // rate limiting
  qpmPrefixLimitsIPv4: 'rateLimit.qpmPrefixLimitsIPv4',
  qpmPrefixLimitsIPv6: 'rateLimit.qpmPrefixLimitsIPv6',
  qpmLimitSampleMinutes: 'rateLimit.qpmLimitSampleMinutes',
  qpmLimitUdpTruncationPercentage: 'rateLimit.qpmLimitUdpTruncationPercentage',
  qpmLimitBypassList: 'rateLimit.qpmLimitBypassList',
  // EDNS
  eDnsClientSubnet: 'edns.eDnsClientSubnet',
  eDnsClientSubnetIPv4PrefixLength: 'edns.eDnsClientSubnetIPv4PrefixLength',
  eDnsClientSubnetIPv6PrefixLength: 'edns.eDnsClientSubnetIPv6PrefixLength',
  eDnsClientSubnetIpv4Override: 'edns.eDnsClientSubnetIpv4Override',
  eDnsClientSubnetIpv6Override: 'edns.eDnsClientSubnetIpv6Override',
  // logging
  enableLogging: 'logging.enableLogging',
  loggingType: 'logging.loggingType',
  ignoreResolverLogs: 'logging.ignoreResolverLogs',
  logQueries: 'logging.logQueries',
  noStackTrace: 'logging.noStackTrace',
  useLocalTime: 'logging.useLocalTime',
  logFolder: 'logging.logFolder',
  maxLogFileDays: 'logging.maxLogFileDays',
  enableInMemoryStats: 'logging.enableInMemoryStats',
  maxStatFileDays: 'logging.maxStatFileDays',
  // updates (labels live under `general.*` in the message file)
  dnsServerEnableCheckForUpdate: 'general.dnsServerEnableCheckForUpdate',
  dnsAppsEnableAutomaticUpdate: 'general.dnsAppsEnableAutomaticUpdate',
  // TSIG rows are not form fields but still need a searchable label
  tsigKeys: 'tsig.title',
}

/** Every key the search box matches against: form fields plus read-only ones. */
export const SEARCHABLE_FIELDS: readonly string[] = [...ALL_FORM_FIELDS, ...READONLY_FIELDS, 'tsigKeys']

/** Total number of `settings/get` keys, for the `subtitle` message. */
export const SETTINGS_KEY_COUNT = SETTINGS_FIELD_COUNT

// ------------------------------------------------------------------- node scope

/** Radix `Select` forbids `""`, so "this machine only" travels as a sentinel. */
export const NODE_LOCAL = '__local__'

/** Value the server interprets as "apply to every node in the cluster". */
export const NODE_CLUSTER = 'cluster'

export function nodeToSelectValue(node: string): string {
  return node === '' ? NODE_LOCAL : node
}

export function selectValueToNode(value: string): string {
  return value === NODE_LOCAL ? '' : value
}

// ------------------------------------------------------------------------ TSIG

/**
 * TSIG algorithms Technitium accepts. Harvested from the stock console's
 * `<select>` (`index.html:1774-1782`); `hmac-sha256` is the one it pre-selects.
 * Note the two truncated variants — they are distinct algorithms, not aliases.
 */
export const TSIG_ALGORITHMS = [
  'hmac-md5.sig-alg.reg.int',
  'hmac-sha1',
  'hmac-sha256',
  'hmac-sha256-128',
  'hmac-sha384',
  'hmac-sha384-192',
  'hmac-sha512',
  'hmac-sha512-256',
] as const

export type TsigAlgorithm = (typeof TSIG_ALGORITHMS)[number]

export const DEFAULT_TSIG_ALGORITHM: TsigAlgorithm = 'hmac-sha256'

/**
 * `lib/api/types/common.ts:143` declares `TsigKey` without `algorithmName`, but
 * `settings/get` returns it and `main.js:1370/2260` reads and writes it as the
 * third pipe-separated column. Widened locally rather than in `lib/**` (which is
 * off-limits for this task) — see the report.
 */
export interface SettingsTsigKey {
  keyName: string
  sharedSecret: string
  algorithmName: string
}

/** Row state for the editor; `id` keeps React keys stable across reorders. */
export interface TsigRow extends SettingsTsigKey {
  id: string
}

export function toTsigRows(settings: DnsSettings): TsigRow[] {
  return (settings.tsigKeys ?? []).map((key, index) => ({
    id: `tsig-${index}-${key.keyName}`,
    keyName: key.keyName ?? '',
    sharedSecret: key.sharedSecret ?? '',
    algorithmName: normaliseAlgorithm((key as SettingsTsigKey).algorithmName),
  }))
}

/** Unknown or missing algorithm falls back to the console default rather than blanking the select. */
export function normaliseAlgorithm(value: string | null | undefined): TsigAlgorithm {
  return TSIG_ALGORITHMS.includes(value as TsigAlgorithm) ? (value as TsigAlgorithm) : DEFAULT_TSIG_ALGORITHM
}

/**
 * Three pipe-separated columns per row, rows also joined with `|` — exactly
 * `serializeTableData(table, 3)` in `common.js:282`. An empty table becomes the
 * literal `false` so the server clears every key (`main.js:1956`).
 */
export function serializeTsigKeys(rows: readonly SettingsTsigKey[]): string {
  const cells: string[] = []
  for (const row of rows) {
    const name = row.keyName.trim()
    if (name === '') continue
    cells.push(name, row.sharedSecret.trim(), normaliseAlgorithm(row.algorithmName))
  }
  return cells.length === 0 ? 'false' : cells.join('|')
}

/** RFC 4648 base64, allowing the padding Technitium emits. */
export function isBase64(value: string): boolean {
  const text = value.trim()
  if (text === '' || text.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false
  try {
    return atob(text).length > 0
  } catch {
    return false
  }
}

/** 256-bit secret, base64 — the same length the console's generator produces. */
export function generateTsigSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// ------------------------------------------------------------- list wire format

/**
 * Multi-line textarea -> comma-joined parameter. Empty becomes `fallback`
 * (`'false'` for "clear this list", see the header note).
 */
export function listOr(text: string, fallback: string): string {
  return serializeLineList(parseLineList(text)) ?? fallback
}

/** Most lists clear with the literal `false`. */
export function list(text: string): string {
  return listOr(text, 'false')
}

/** QPM rules: `prefix/udp/tcp` lines -> `prefix|udp|tcp|…`, empty -> `false`. */
export function qpmRules(text: string): string {
  const limits: QpmPrefixLimit[] = parseQpmPrefixLimits(text)
  return serializeQpmPrefixLimits(limits) ?? 'false'
}

// -------------------------------------------------------------------- to form

/** `settings/get` payload -> react-hook-form `defaultValues`. */
export function toFormValues(settings: DnsSettings): SettingsFormValues {
  const proxy = settings.proxy
  // The SDK mapper is the single source of truth for the nested -> flat
  // spelling, so the form is seeded with exactly the six values `buildPatch`
  // will later send back.
  const proxyFlat = proxyToPatch(proxy)
  return {
    // general
    dnsServerDomain: settings.dnsServerDomain ?? '',
    ipv6Mode: settings.ipv6Mode ?? 'Disabled',
    enableUdpSocketPool: settings.enableUdpSocketPool,
    socketPoolExcludedPorts: formatLineList((settings.socketPoolExcludedPorts ?? []).map(String)),
    udpPayloadSize: settings.udpPayloadSize,
    dnssecValidation: settings.dnssecValidation,

    // listeners
    dnsServerLocalEndPoints: formatLineList(settings.dnsServerLocalEndPoints ?? []),
    dnsServerIPv4SourceAddresses: formatLineList(settings.dnsServerIPv4SourceAddresses ?? []),
    dnsServerIPv6SourceAddresses: formatLineList(settings.dnsServerIPv6SourceAddresses ?? []),
    clientTimeout: settings.clientTimeout,
    tcpSendTimeout: settings.tcpSendTimeout,
    tcpReceiveTimeout: settings.tcpReceiveTimeout,
    quicIdleTimeout: settings.quicIdleTimeout,
    quicMaxInboundStreams: settings.quicMaxInboundStreams,
    listenBacklog: settings.listenBacklog,
    udpSendBufferSizeKB: settings.udpSendBufferSizeKB,
    udpReceiveBufferSizeKB: settings.udpReceiveBufferSizeKB,
    maxConcurrentResolutionsPerCore: settings.maxConcurrentResolutionsPerCore,

    // zone defaults
    defaultRecordTtl: settings.defaultRecordTtl,
    defaultNsRecordTtl: settings.defaultNsRecordTtl,
    defaultSoaRecordTtl: settings.defaultSoaRecordTtl,
    defaultResponsiblePerson: settings.defaultResponsiblePerson ?? '',
    useSoaSerialDateScheme: settings.useSoaSerialDateScheme,
    minSoaRefresh: settings.minSoaRefresh,
    minSoaRetry: settings.minSoaRetry,
    zoneTransferAllowedNetworks: formatLineList(settings.zoneTransferAllowedNetworks ?? []),
    notifyAllowedNetworks: formatLineList(settings.notifyAllowedNetworks ?? []),

    // web service
    webServiceLocalAddresses: formatLineList(settings.webServiceLocalAddresses ?? []),
    webServiceHttpPort: settings.webServiceHttpPort,
    webServiceEnableTls: settings.webServiceEnableTls,
    webServiceTlsPort: settings.webServiceTlsPort,
    webServiceHttpToTlsRedirect: settings.webServiceHttpToTlsRedirect,
    webServiceUseSelfSignedTlsCertificate: settings.webServiceUseSelfSignedTlsCertificate,
    webServiceTlsCertificatePath: settings.webServiceTlsCertificatePath ?? '',
    webServiceTlsCertificatePassword: settings.webServiceTlsCertificatePassword ?? '',
    webServiceEnableHttp3: settings.webServiceEnableHttp3,
    webServiceEnableHttpUnixSocket: settings.webServiceEnableHttpUnixSocket,
    webServiceHttpUnixSocket: settings.webServiceHttpUnixSocket ?? '',
    webServiceEnableTlsUnixSocket: settings.webServiceEnableTlsUnixSocket,
    webServiceTlsUnixSocket: settings.webServiceTlsUnixSocket ?? '',
    webServiceReverseProxyAddresses: formatLineList(settings.webServiceReverseProxyAddresses ?? []),
    webServiceRealIpHeader: settings.webServiceRealIpHeader ?? '',
    webServiceCspFrameAncestorsHeader: settings.webServiceCspFrameAncestorsHeader ?? '',

    // DNS-over-X
    enableEDnsClientSubnetSourceAddress: settings.enableEDnsClientSubnetSourceAddress,
    enableDnsOverUdpProxy: settings.enableDnsOverUdpProxy,
    enableDnsOverTcpProxy: settings.enableDnsOverTcpProxy,
    enableDnsOverHttp: settings.enableDnsOverHttp,
    enableDnsOverHttpUnixSocket: settings.enableDnsOverHttpUnixSocket,
    enableDnsOverHttpsUnixSocket: settings.enableDnsOverHttpsUnixSocket,
    enableDnsOverTls: settings.enableDnsOverTls,
    enableDnsOverHttps: settings.enableDnsOverHttps,
    enableDnsOverHttp3: settings.enableDnsOverHttp3,
    enableDnsOverQuic: settings.enableDnsOverQuic,
    enableDnsOverHttpHelpRedirect: settings.enableDnsOverHttpHelpRedirect,
    dnsOverUdpProxyPort: settings.dnsOverUdpProxyPort,
    dnsOverTcpProxyPort: settings.dnsOverTcpProxyPort,
    dnsOverHttpPort: settings.dnsOverHttpPort,
    dnsOverHttpUnixSocket: settings.dnsOverHttpUnixSocket ?? '',
    dnsOverHttpsUnixSocket: settings.dnsOverHttpsUnixSocket ?? '',
    dnsOverTlsPort: settings.dnsOverTlsPort,
    dnsOverHttpsPort: settings.dnsOverHttpsPort,
    dnsOverQuicPort: settings.dnsOverQuicPort,
    dnsReverseProxyNetworkACL: formatLineList(settings.dnsReverseProxyNetworkACL ?? []),
    dnsOverHttpRealIpHeader: settings.dnsOverHttpRealIpHeader ?? '',
    dnsTlsCertificatePath: settings.dnsTlsCertificatePath ?? '',
    dnsTlsCertificatePassword: settings.dnsTlsCertificatePassword ?? '',

    // recursion
    recursion: settings.recursion ?? 'Deny',
    recursionNetworkACL: formatLineList(settings.recursionNetworkACL ?? []),
    randomizeName: settings.randomizeName,
    qnameMinimization: settings.qnameMinimization,
    locallyServedDnsZones: settings.locallyServedDnsZones,
    resolverRetries: settings.resolverRetries,
    resolverTimeout: settings.resolverTimeout,
    resolverConcurrency: settings.resolverConcurrency,
    resolverMaxStackCount: settings.resolverMaxStackCount,
    forwarders: formatLineList(settings.forwarders ?? []),
    forwarderProtocol: settings.forwarderProtocol ?? 'Udp',
    concurrentForwarding: settings.concurrentForwarding,
    forwarderRetries: settings.forwarderRetries,
    forwarderTimeout: settings.forwarderTimeout,
    forwarderConcurrency: settings.forwarderConcurrency,

    // proxy (flattened)
    proxyType: (proxyFlat.proxyType as SettingsFormValues['proxyType'] | undefined) ?? 'None',
    proxyAddress: String(proxyFlat.proxyAddress ?? ''),
    proxyPort: Number(proxyFlat.proxyPort ?? 0),
    proxyUsername: String(proxyFlat.proxyUsername ?? ''),
    proxyPassword: String(proxyFlat.proxyPassword ?? ''),
    proxyBypass: formatLineList(Array.isArray(proxyFlat.proxyBypass) ? proxyFlat.proxyBypass : []),

    // cache
    saveCache: settings.saveCache,
    serveStale: settings.serveStale,
    serveStaleTtl: settings.serveStaleTtl,
    serveStaleAnswerTtl: settings.serveStaleAnswerTtl,
    serveStaleResetTtl: settings.serveStaleResetTtl,
    serveStaleMaxWaitTime: settings.serveStaleMaxWaitTime,
    cacheMaximumEntries: settings.cacheMaximumEntries,
    cacheMinimumRecordTtl: settings.cacheMinimumRecordTtl,
    cacheMaximumRecordTtl: settings.cacheMaximumRecordTtl,
    cacheNegativeRecordTtl: settings.cacheNegativeRecordTtl,
    cacheFailureRecordTtl: settings.cacheFailureRecordTtl,
    cachePrefetchEligibility: settings.cachePrefetchEligibility,
    cachePrefetchTrigger: settings.cachePrefetchTrigger,
    cachePrefetchSampleIntervalInMinutes: settings.cachePrefetchSampleIntervalInMinutes,
    cachePrefetchSampleEligibilityHitsPerHour: settings.cachePrefetchSampleEligibilityHitsPerHour,

    // blocking
    enableBlocking: settings.enableBlocking,
    allowTxtBlockingReport: settings.allowTxtBlockingReport,
    blockingBypassList: formatLineList(settings.blockingBypassList ?? []),
    blockingType: settings.blockingType ?? 'NxDomain',
    blockingAnswerTtl: settings.blockingAnswerTtl,
    customBlockingAddresses: formatLineList(settings.customBlockingAddresses ?? []),
    blockListUrls: formatLineList(settings.blockListUrls ?? []),
    blockListUpdateIntervalHours: settings.blockListUpdateIntervalHours,

    // rate limiting
    qpmPrefixLimitsIPv4: formatQpmPrefixLimits(settings.qpmPrefixLimitsIPv4 ?? []),
    qpmPrefixLimitsIPv6: formatQpmPrefixLimits(settings.qpmPrefixLimitsIPv6 ?? []),
    qpmLimitSampleMinutes: settings.qpmLimitSampleMinutes,
    qpmLimitUdpTruncationPercentage: settings.qpmLimitUdpTruncationPercentage,
    qpmLimitBypassList: formatLineList(settings.qpmLimitBypassList ?? []),

    // EDNS
    eDnsClientSubnet: settings.eDnsClientSubnet,
    eDnsClientSubnetIPv4PrefixLength: settings.eDnsClientSubnetIPv4PrefixLength,
    eDnsClientSubnetIPv6PrefixLength: settings.eDnsClientSubnetIPv6PrefixLength,
    eDnsClientSubnetIpv4Override: settings.eDnsClientSubnetIpv4Override ?? '',
    eDnsClientSubnetIpv6Override: settings.eDnsClientSubnetIpv6Override ?? '',

    // logging
    enableLogging: settings.enableLogging,
    loggingType: settings.loggingType ?? 'None',
    ignoreResolverLogs: settings.ignoreResolverLogs,
    logQueries: settings.logQueries,
    noStackTrace: settings.noStackTrace,
    useLocalTime: settings.useLocalTime,
    logFolder: settings.logFolder ?? '',
    maxLogFileDays: settings.maxLogFileDays,
    enableInMemoryStats: settings.enableInMemoryStats,
    maxStatFileDays: settings.maxStatFileDays,

    // updates
    dnsServerEnableCheckForUpdate: settings.dnsServerEnableCheckForUpdate,
    dnsAppsEnableAutomaticUpdate: settings.dnsAppsEnableAutomaticUpdate,
  }
}

// ------------------------------------------------------------------ to wire

export interface BuildPatchOptions {
  values: SettingsFormValues
  tsigRows: readonly SettingsTsigKey[]
  /** `''` = this machine, `'cluster'` = every node, anything else = one node name. */
  node: string
}

/**
 * Form values -> `settings/set` body, filtered by cluster/node scope.
 *
 * `setSettings` drops `undefined` entries, so scope filtering is expressed by
 * simply not assigning out-of-scope keys.
 */
export function buildPatch({ values, tsigRows, node }: BuildPatchOptions): SettingsPatch {
  const includeCluster = node === '' || node === NODE_CLUSTER
  const includeNode = node === '' || !includeCluster

  const patch: SettingsPatch = {}
  const put = (key: string, value: SettingsPatch[string]) => {
    patch[key] = value
  }

  if (includeNode) {
    // `main.js:1649-1652` — an empty listener list is *not* a clear, it falls
    // back to the well-known defaults, because a server with no listener cannot
    // answer anything and would be unrecoverable from the console.
    put('dnsServerDomain', values.dnsServerDomain.trim())
    put('dnsServerLocalEndPoints', listOr(values.dnsServerLocalEndPoints, '0.0.0.0:53,[::]:53'))
    put('dnsServerIPv4SourceAddresses', list(values.dnsServerIPv4SourceAddresses))
    put('dnsServerIPv6SourceAddresses', list(values.dnsServerIPv6SourceAddresses))

    put('ipv6Mode', values.ipv6Mode)
    put('enableUdpSocketPool', values.enableUdpSocketPool)
    put('socketPoolExcludedPorts', list(values.socketPoolExcludedPorts))

    // Same reasoning for the web listener (`main.js:1837-1845`).
    put('webServiceLocalAddresses', listOr(values.webServiceLocalAddresses, '0.0.0.0,[::]'))
    put('webServiceHttpPort', values.webServiceHttpPort > 0 ? values.webServiceHttpPort : 5380)
    put('webServiceEnableHttpUnixSocket', values.webServiceEnableHttpUnixSocket)
    put('webServiceHttpUnixSocket', values.webServiceHttpUnixSocket.trim())
    put('webServiceEnableTlsUnixSocket', values.webServiceEnableTlsUnixSocket)
    put('webServiceTlsUnixSocket', values.webServiceTlsUnixSocket.trim())
    put('webServiceEnableTls', values.webServiceEnableTls)
    put('webServiceEnableHttp3', values.webServiceEnableHttp3)
    put('webServiceHttpToTlsRedirect', values.webServiceHttpToTlsRedirect)
    put('webServiceUseSelfSignedTlsCertificate', values.webServiceUseSelfSignedTlsCertificate)
    put('webServiceTlsPort', values.webServiceTlsPort)
    put('webServiceReverseProxyAddresses', list(values.webServiceReverseProxyAddresses))
    put('webServiceRealIpHeader', values.webServiceRealIpHeader.trim())
    put('webServiceCspFrameAncestorsHeader', values.webServiceCspFrameAncestorsHeader.trim())
    put('webServiceTlsCertificatePath', values.webServiceTlsCertificatePath.trim())
    put('webServiceTlsCertificatePassword', values.webServiceTlsCertificatePassword.trim())

    put('enableEDnsClientSubnetSourceAddress', values.enableEDnsClientSubnetSourceAddress)
    put('enableDnsOverUdpProxy', values.enableDnsOverUdpProxy)
    put('enableDnsOverTcpProxy', values.enableDnsOverTcpProxy)
    put('enableDnsOverHttp', values.enableDnsOverHttp)
    put('enableDnsOverHttpUnixSocket', values.enableDnsOverHttpUnixSocket)
    put('enableDnsOverHttpsUnixSocket', values.enableDnsOverHttpsUnixSocket)
    put('enableDnsOverTls', values.enableDnsOverTls)
    put('enableDnsOverHttps', values.enableDnsOverHttps)
    put('enableDnsOverHttp3', values.enableDnsOverHttp3)
    put('enableDnsOverQuic', values.enableDnsOverQuic)
    put('enableDnsOverHttpHelpRedirect', values.enableDnsOverHttpHelpRedirect)
    put('dnsOverUdpProxyPort', values.dnsOverUdpProxyPort)
    put('dnsOverTcpProxyPort', values.dnsOverTcpProxyPort)
    put('dnsOverHttpPort', values.dnsOverHttpPort)
    put('dnsOverHttpUnixSocket', values.dnsOverHttpUnixSocket.trim())
    put('dnsOverHttpsUnixSocket', values.dnsOverHttpsUnixSocket.trim())
    put('dnsOverTlsPort', values.dnsOverTlsPort)
    put('dnsOverHttpsPort', values.dnsOverHttpsPort)
    put('dnsOverQuicPort', values.dnsOverQuicPort)
    put('dnsReverseProxyNetworkACL', list(values.dnsReverseProxyNetworkACL))
    put('dnsOverHttpRealIpHeader', values.dnsOverHttpRealIpHeader.trim())
    put('dnsTlsCertificatePath', values.dnsTlsCertificatePath.trim())
    put('dnsTlsCertificatePassword', values.dnsTlsCertificatePassword.trim())

    put('saveCache', values.saveCache)
    put('serveStale', values.serveStale)
    put('serveStaleTtl', values.serveStaleTtl)
    put('serveStaleAnswerTtl', values.serveStaleAnswerTtl)
    put('serveStaleResetTtl', values.serveStaleResetTtl)
    put('serveStaleMaxWaitTime', values.serveStaleMaxWaitTime)
    put('cacheMaximumEntries', values.cacheMaximumEntries)
    put('cacheMinimumRecordTtl', values.cacheMinimumRecordTtl)
    put('cacheMaximumRecordTtl', values.cacheMaximumRecordTtl)
    put('cacheNegativeRecordTtl', values.cacheNegativeRecordTtl)
    put('cacheFailureRecordTtl', values.cacheFailureRecordTtl)
    put('cachePrefetchEligibility', values.cachePrefetchEligibility)
    put('cachePrefetchTrigger', values.cachePrefetchTrigger)
    put('cachePrefetchSampleIntervalInMinutes', values.cachePrefetchSampleIntervalInMinutes)
    put('cachePrefetchSampleEligibilityHitsPerHour', values.cachePrefetchSampleEligibilityHitsPerHour)

    // `enableLogging` is *not* submitted: the server derives it from
    // `loggingType`. Turning logging off means `None`; turning it on while the
    // stored type is `None` restores the file logger, matching the console's
    // radio default.
    put('loggingType', values.enableLogging ? (values.loggingType === 'None' ? 'File' : values.loggingType) : 'None')
    put('ignoreResolverLogs', values.ignoreResolverLogs)
    put('noStackTrace', values.noStackTrace)
    put('logQueries', values.logQueries)
    put('useLocalTime', values.useLocalTime)
    put('logFolder', values.logFolder.trim())
    put('maxLogFileDays', values.maxLogFileDays)
    put('enableInMemoryStats', values.enableInMemoryStats)
    put('maxStatFileDays', values.maxStatFileDays)
  }

  if (includeCluster) {
    put('defaultRecordTtl', values.defaultRecordTtl)
    put('defaultNsRecordTtl', values.defaultNsRecordTtl)
    put('defaultSoaRecordTtl', values.defaultSoaRecordTtl)
    put('defaultResponsiblePerson', values.defaultResponsiblePerson.trim())
    put('useSoaSerialDateScheme', values.useSoaSerialDateScheme)
    put('minSoaRefresh', values.minSoaRefresh)
    put('minSoaRetry', values.minSoaRetry)
    put('zoneTransferAllowedNetworks', list(values.zoneTransferAllowedNetworks))
    put('notifyAllowedNetworks', list(values.notifyAllowedNetworks))
    put('dnsServerEnableCheckForUpdate', values.dnsServerEnableCheckForUpdate)
    put('dnsAppsEnableAutomaticUpdate', values.dnsAppsEnableAutomaticUpdate)

    put('udpPayloadSize', values.udpPayloadSize)
    put('dnssecValidation', values.dnssecValidation)

    put('eDnsClientSubnet', values.eDnsClientSubnet)
    put('eDnsClientSubnetIPv4PrefixLength', values.eDnsClientSubnetIPv4PrefixLength)
    put('eDnsClientSubnetIPv6PrefixLength', values.eDnsClientSubnetIPv6PrefixLength)
    put('eDnsClientSubnetIpv4Override', values.eDnsClientSubnetIpv4Override.trim())
    put('eDnsClientSubnetIpv6Override', values.eDnsClientSubnetIpv6Override.trim())

    put('qpmPrefixLimitsIPv4', qpmRules(values.qpmPrefixLimitsIPv4))
    put('qpmPrefixLimitsIPv6', qpmRules(values.qpmPrefixLimitsIPv6))
    put('qpmLimitSampleMinutes', values.qpmLimitSampleMinutes)
    put('qpmLimitUdpTruncationPercentage', values.qpmLimitUdpTruncationPercentage)
    put('qpmLimitBypassList', list(values.qpmLimitBypassList))

    put('clientTimeout', values.clientTimeout)
    put('tcpSendTimeout', values.tcpSendTimeout)
    put('tcpReceiveTimeout', values.tcpReceiveTimeout)
    put('quicIdleTimeout', values.quicIdleTimeout)
    put('quicMaxInboundStreams', values.quicMaxInboundStreams)
    put('listenBacklog', values.listenBacklog)
    put('udpSendBufferSizeKB', values.udpSendBufferSizeKB)
    put('udpReceiveBufferSizeKB', values.udpReceiveBufferSizeKB)
    put('maxConcurrentResolutionsPerCore', values.maxConcurrentResolutionsPerCore)

    put('tsigKeys', serializeTsigKeys(tsigRows))

    put('recursion', values.recursion)
    put('recursionNetworkACL', list(values.recursionNetworkACL))
    put('randomizeName', values.randomizeName)
    put('qnameMinimization', values.qnameMinimization)
    put('locallyServedDnsZones', values.locallyServedDnsZones)
    put('resolverRetries', values.resolverRetries)
    put('resolverTimeout', values.resolverTimeout)
    put('resolverConcurrency', values.resolverConcurrency)
    put('resolverMaxStackCount', values.resolverMaxStackCount)

    put('enableBlocking', values.enableBlocking)
    put('allowTxtBlockingReport', values.allowTxtBlockingReport)
    put('blockingBypassList', list(values.blockingBypassList))
    put('blockingType', values.blockingType)
    put('customBlockingAddresses', list(values.customBlockingAddresses))
    put('blockingAnswerTtl', values.blockingAnswerTtl)
    put('blockListUrls', list(values.blockListUrls))
    put('blockListUpdateIntervalHours', values.blockListUpdateIntervalHours)

    // Round-trip the flat form values through the SDK mappers — `patchToProxy`
    // normalises, `proxyToPatch` re-spells — so the nested and flat shapes can
    // never drift apart. Two corrections on top, per `main.js:2121-2124`: the
    // type goes over the wire lower-cased, and a disabled proxy sends *only*
    // `proxyType`, whereas `proxyToPatch` alone would emit the other five and
    // resurrect stale credentials on the server.
    const proxyNormalised = patchToProxy({
      proxyType: values.proxyType,
      proxyAddress: values.proxyAddress.trim(),
      proxyPort: values.proxyPort,
      proxyUsername: values.proxyUsername.trim(),
      proxyPassword: values.proxyPassword.trim(),
      proxyBypass: parseLineList(values.proxyBypass),
    })
    const proxyPatch = proxyToPatch(proxyNormalised)
    put('proxyType', String(proxyPatch.proxyType ?? 'None').toLowerCase())
    if (proxyNormalised) {
      put('proxyAddress', proxyPatch.proxyAddress)
      put('proxyPort', proxyPatch.proxyPort)
      put('proxyUsername', proxyPatch.proxyUsername)
      put('proxyPassword', proxyPatch.proxyPassword)
      // The one list that clears with an empty string rather than `false`.
      put('proxyBypass', serializeLineList(Array.isArray(proxyPatch.proxyBypass) ? proxyPatch.proxyBypass : []) ?? '')
    }

    put('forwarders', list(values.forwarders))
    put('forwarderProtocol', values.forwarderProtocol)
    put('concurrentForwarding', values.concurrentForwarding)
    put('forwarderRetries', values.forwarderRetries)
    put('forwarderTimeout', values.forwarderTimeout)
    put('forwarderConcurrency', values.forwarderConcurrency)
  }

  return patch
}

/** Slice a full patch down to the parameters one section owns ("save section"). */
export function pickParams(patch: SettingsPatch, params: readonly string[]): SettingsPatch {
  const out: SettingsPatch = {}
  for (const param of params) {
    const value = patch[param]
    if (value !== undefined) out[param] = value
  }
  return out
}

// ------------------------------------------------------------------------ diff

export interface SettingsDiffEntry {
  field: string
  from: string
  to: string
}

/** Human-readable rendering of one form value for the diff table. */
export function formatFieldValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null || value === undefined) return ''
  const text = String(value)
  return text.includes('\n') ? text.split('\n').filter(Boolean).join(', ') : text
}

/**
 * Field-by-field comparison against the last payload the server sent, for the
 * Advanced panel. Compares *form* values (not wire values) so an operator sees
 * `32/600/600` rather than `32|600|600`.
 */
export function diffFormValues(server: DnsSettings, values: SettingsFormValues): SettingsDiffEntry[] {
  const before = toFormValues(server) as Record<string, unknown>
  const after = values as unknown as Record<string, unknown>
  const out: SettingsDiffEntry[] = []
  for (const field of ALL_FORM_FIELDS) {
    const from = formatFieldValue(before[field])
    const to = formatFieldValue(after[field])
    if (from !== to) out.push({ field, from, to })
  }
  return out
}
