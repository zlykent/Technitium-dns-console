/**
 * Enumerations accepted by the Technitium DNS Server v15.4 API.
 *
 * Harvested from the official console's own `<select>` / radio markup
 * (`scripts/probe/extract-enums.mjs`), not from documentation — so the strings
 * here are exactly what the server parses. Casing is significant: `Udp` is not
 * `udp`, and `AllowOnlyPrivateNetworks` differs between the recursion setting
 * (`AllowOnlyForPrivateNetworks`) and the zone query-access setting.
 */

// ---------------------------------------------------------------- DNS records

/** Record types the add/edit record dialog offers. `FWD` and `APP` are Technitium extensions. */
export const RECORD_TYPES = [
  'A', 'NS', 'SOA', 'CNAME', 'PTR', 'MX', 'TXT', 'RP', 'AAAA', 'SRV', 'NAPTR',
  'DNAME', 'DS', 'SSHFP', 'TLSA', 'SVCB', 'HTTPS', 'URI', 'CAA', 'ANAME',
  'FWD', 'APP', 'Unknown',
] as const
export type RecordType = (typeof RECORD_TYPES)[number]

/** Wider set the DNS client resolver can query, including pseudo-types. */
export const QUERY_RECORD_TYPES = [
  'A', 'NS', 'CNAME', 'SOA', 'PTR', 'MX', 'TXT', 'RP', 'AAAA', 'SRV', 'NAPTR',
  'DNAME', 'DS', 'SSHFP', 'RRSIG', 'NSEC', 'DNSKEY', 'NSEC3', 'NSEC3PARAM',
  'TLSA', 'ZONEMD', 'SVCB', 'HTTPS', 'URI', 'CAA', 'ANY', 'AXFR', 'ANAME',
] as const
export type QueryRecordType = (typeof QUERY_RECORD_TYPES)[number]

// ------------------------------------------------------------------- DNS class

export const DNS_CLASSES = ['IN', 'CS', 'CH', 'HS', 'NONE', 'ANY'] as const
export type DnsClass = (typeof DNS_CLASSES)[number]

// ------------------------------------------------------------------ response codes

export const RESPONSE_CODES = [
  'NoError', 'FormatError', 'ServerFailure', 'NxDomain', 'NotImplemented',
  'Refused', 'YXDomain', 'YXRRSet', 'NXRRSet', 'NotAuth', 'NotZone',
] as const
export type ResponseCode = (typeof RESPONSE_CODES)[number]

// -------------------------------------------------------------------- zones

export const ZONE_TYPES = [
  'Primary', 'Secondary', 'Stub', 'Forwarder', 'SecondaryForwarder',
  'Catalog', 'SecondaryCatalog',
] as const
export type ZoneType = (typeof ZONE_TYPES)[number]

/** `zones/create` also accepts `SecondaryRoot`, which the console expands into a Secondary seeded with the 13 root hints. */
export const CREATABLE_ZONE_TYPES = [...ZONE_TYPES, 'SecondaryRoot'] as const
export type CreatableZoneType = (typeof CREATABLE_ZONE_TYPES)[number]

export const CONVERTIBLE_ZONE_TYPES = ['Primary', 'Forwarder', 'Catalog'] as const
export type ConvertibleZoneType = (typeof CONVERTIBLE_ZONE_TYPES)[number]

export const ZONE_TRANSFER_PROTOCOLS = ['Tcp', 'Tls', 'Quic'] as const
export type ZoneTransferProtocol = (typeof ZONE_TRANSFER_PROTOCOLS)[number]

export const QUERY_ACCESS_POLICIES = [
  'Deny', 'Allow', 'AllowOnlyPrivateNetworks', 'AllowOnlyZoneNameServers',
  'UseSpecifiedNetworkACL', 'AllowZoneNameServersAndUseSpecifiedNetworkACL',
] as const
export type QueryAccessPolicy = (typeof QUERY_ACCESS_POLICIES)[number]

/** Zone transfer and dynamic update share this (narrower) policy list. */
export const ZONE_UPDATE_POLICIES = [
  'Deny', 'Allow', 'AllowOnlyZoneNameServers', 'UseSpecifiedNetworkACL',
  'AllowZoneNameServersAndUseSpecifiedNetworkACL',
] as const
export type ZoneUpdatePolicy = (typeof ZONE_UPDATE_POLICIES)[number]

export const NOTIFY_POLICIES = [
  'None', 'ZoneNameServers', 'SpecifiedNameServers',
  'BothZoneAndSpecifiedNameServers', 'SeparateNameServersForCatalogAndMemberZones',
] as const
export type NotifyPolicy = (typeof NOTIFY_POLICIES)[number]

export const DNSSEC_STATUSES = ['Disabled', 'Signed', 'PendingSigning'] as const
export type DnssecStatus = (typeof DNSSEC_STATUSES)[number]

export const SOA_SERIAL_SCHEMES = ['Serial', 'SerialDate'] as const

// ------------------------------------------------------------------ forwarding

export const FORWARDER_PROTOCOLS = ['Udp', 'Tcp', 'Tls', 'Https', 'Quic'] as const
export type ForwarderProtocol = (typeof FORWARDER_PROTOCOLS)[number]

export const RESOLVER_PROTOCOLS = ['UDP', 'TCP', 'TLS', 'HTTPS', 'QUIC'] as const
export type ResolverProtocol = (typeof RESOLVER_PROTOCOLS)[number]

export const PROXY_TYPES = ['None', 'Http', 'Socks5'] as const
export type ProxyType = (typeof PROXY_TYPES)[number]

/** Forwarder records use a differently-spelled "no proxy" value. */
export const FORWARDER_PROXY_TYPES = ['NoProxy', 'DefaultProxy', 'Http', 'Socks5'] as const
export type ForwarderProxyType = (typeof FORWARDER_PROXY_TYPES)[number]

export const RECURSION_POLICIES = ['Deny', 'Allow', 'AllowOnlyForPrivateNetworks', 'UseSpecifiedNetworkACL'] as const
export type RecursionPolicy = (typeof RECURSION_POLICIES)[number]

export const BLOCKING_TYPES = ['AnyAddress', 'NxDomain', 'CustomAddress'] as const
export type BlockingType = (typeof BLOCKING_TYPES)[number]

export const IPV6_MODES = ['Disabled', 'Enabled', 'Preferred'] as const
export type Ipv6Mode = (typeof IPV6_MODES)[number]

export const LOGGING_TYPES = ['None', 'File', 'Console', 'FileAndConsole'] as const
export type LoggingType = (typeof LOGGING_TYPES)[number]

// --------------------------------------------------------------------- DNSSEC

export const SIGNING_ALGORITHMS = ['RSA', 'ECDSA', 'EDDSA'] as const
export type SigningAlgorithm = (typeof SIGNING_ALGORITHMS)[number]

export const RSA_HASH_ALGORITHMS = ['MD5', 'SHA1', 'SHA256', 'SHA512'] as const
export type RsaHashAlgorithm = (typeof RSA_HASH_ALGORITHMS)[number]

export const ECDSA_CURVES = ['P256', 'P384'] as const
export type EcdsaCurve = (typeof ECDSA_CURVES)[number]

export const EDDSA_CURVES = ['ED25519', 'ED448'] as const
export type EddsaCurve = (typeof EDDSA_CURVES)[number]

export const RSA_KEY_SIZES = [1024, 1280, 1536, 2048, 3072, 4096] as const
export type RsaKeySize = (typeof RSA_KEY_SIZES)[number]

export const KEY_TYPES = ['KeySigningKey', 'ZoneSigningKey'] as const
export type DnssecKeyType = (typeof KEY_TYPES)[number]

export const NX_PROOF_TYPES = ['NSEC', 'NSEC3'] as const
export type NxProofType = (typeof NX_PROOF_TYPES)[number]

export const KEY_GENERATION_MODES = ['Automatic', 'UseSpecified'] as const
export type KeyGenerationMode = (typeof KEY_GENERATION_MODES)[number]

/** States a DNSSEC private key moves through during a rollover. */
export const DNS_KEY_STATES = ['Generated', 'Published', 'Ready', 'Active', 'Retiring', 'Retired', 'Deleted'] as const
export type DnsKeyState = (typeof DNS_KEY_STATES)[number]

// ------------------------------------------------------ record rData sub-enums

export const DS_ALGORITHMS = [
  'RSAMD5', 'RSASHA1', 'RSASHA256', 'RSASHA512',
  'ECDSAP256SHA256', 'ECDSAP384SHA384', 'ED25519', 'ED448',
] as const
export type DsAlgorithm = (typeof DS_ALGORITHMS)[number]

export const DS_DIGEST_TYPES = ['SHA1', 'SHA256', 'SHA384'] as const
export type DsDigestType = (typeof DS_DIGEST_TYPES)[number]

export const SSHFP_ALGORITHMS = ['RSA', 'DSA', 'ECDSA', 'Ed25519', 'Ed448'] as const
export type SshfpAlgorithm = (typeof SSHFP_ALGORITHMS)[number]

export const SSHFP_FINGERPRINT_TYPES = ['SHA1', 'SHA256'] as const
export type SshfpFingerprintType = (typeof SSHFP_FINGERPRINT_TYPES)[number]

export const TLSA_CERTIFICATE_USAGES = ['PKIX-TA', 'PKIX-EE', 'DANE-TA', 'DANE-EE'] as const
export type TlsaCertificateUsage = (typeof TLSA_CERTIFICATE_USAGES)[number]

export const TLSA_SELECTORS = ['Cert', 'SPKI'] as const
export type TlsaSelector = (typeof TLSA_SELECTORS)[number]

export const TLSA_MATCHING_TYPES = ['Full', 'SHA2-256', 'SHA2-512'] as const
export type TlsaMatchingType = (typeof TLSA_MATCHING_TYPES)[number]

// ----------------------------------------------------------------- query logs

export const QUERY_LOG_PROTOCOLS = ['Udp', 'Tcp', 'Tls', 'Https', 'Quic', 'UdpProxy', 'TcpProxy'] as const
export type QueryLogProtocol = (typeof QUERY_LOG_PROTOCOLS)[number]

export const QUERY_RESPONSE_TYPES = [
  'Authoritative', 'Recursive', 'Cached', 'Blocked',
  'UpstreamBlocked', 'UpstreamBlockedCached',
] as const
export type QueryResponseType = (typeof QUERY_RESPONSE_TYPES)[number]

export const STAT_RANGES = ['lastHour', 'lastDay', 'lastWeek', 'lastMonth', 'lastYear', 'custom'] as const
export type StatRange = (typeof STAT_RANGES)[number]

// --------------------------------------------------------------------- misc

export const PAGE_SIZES = [10, 25, 50, 100, 250, 500] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export const ZONE_IMPORT_MODES = ['File', 'Text'] as const
export type ZoneImportMode = (typeof ZONE_IMPORT_MODES)[number]

export const LEASE_TYPES = ['Reserved', 'Dynamic'] as const
export type LeaseType = (typeof LEASE_TYPES)[number]

export const CLUSTER_NODE_TYPES = ['Primary', 'Secondary'] as const
export type ClusterNodeType = (typeof CLUSTER_NODE_TYPES)[number]

/**
 * The states a v15.4 `clusterNodes[].state` carries, taken from the stock
 * console's own switch (`.probe/console-js/cluster.js:160-178`).
 *
 * `Self` is not a connectivity state — it is the marker meaning "this row is the
 * machine you are looking at", and it is how both upstream and this console find
 * the local node's role. There is no `isPrimaryNode` field on the response.
 *
 * `ClusterNodeState` widens this with `| string` because upstream's switch has a
 * `default` branch, so the server is free to add a value; the label lookup falls
 * back to the raw text rather than to a missing translation key.
 */
export const CLUSTER_NODE_STATES = ['Self', 'Connected', 'Unreachable'] as const
export type ClusterNodeStateName = (typeof CLUSTER_NODE_STATES)[number]

/**
 * Record types whose rData is a single address, so the UI can offer an address
 * picker instead of a free-text field.
 */
export const ADDRESS_RECORD_TYPES = new Set<RecordType>(['A', 'AAAA'])

/** Record types that point at another domain name. */
export const NAME_RECORD_TYPES = new Set<RecordType>(['CNAME', 'PTR', 'NS', 'ANAME', 'DNAME'])
