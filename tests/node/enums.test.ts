/**
 * API enumerations — the wire vocabulary shared with Technitium DNS Server v15.4.
 *
 * These arrays are the only thing standing between a form control and an HTTP
 * request the server rejects. Casing is significant and irregular (`Udp` for a
 * forwarder protocol but `UDP` for a resolver protocol, `NoProxy` in a FWD
 * record but `None` in the global proxy setting, `AllowOnlyPrivateNetworks` for
 * zone query access but `AllowOnlyForPrivateNetworks` for recursion). A rename
 * upstream, or a well-meaning "fix" of the casing here, produces a value the
 * server silently ignores or answers with a generic error — no type error, no
 * test failure, just a settings page that appears to save and does not.
 *
 * So each array is pinned literally, the near-miss pairs are asserted to stay
 * distinct, and every enum that has a translation map is checked to have a
 * message key for every value. The last block pins the type-level wiring: each
 * `lib/api/types/*` field still names exactly the enum it is supposed to, so
 * widening one to `string` fails here instead of at runtime.
 */

import { describe, expect, it } from 'vitest'
import {
  ADDRESS_RECORD_TYPES,
  BLOCKING_TYPES,
  CLUSTER_NODE_STATES,
  CLUSTER_NODE_TYPES,
  CONVERTIBLE_ZONE_TYPES,
  CREATABLE_ZONE_TYPES,
  DNS_CLASSES,
  DNS_KEY_STATES,
  DNSSEC_STATUSES,
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  ECDSA_CURVES,
  EDDSA_CURVES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
  IPV6_MODES,
  KEY_GENERATION_MODES,
  KEY_TYPES,
  LEASE_TYPES,
  LOGGING_TYPES,
  NAME_RECORD_TYPES,
  NOTIFY_POLICIES,
  NX_PROOF_TYPES,
  PAGE_SIZES,
  PROXY_TYPES,
  QUERY_ACCESS_POLICIES,
  QUERY_LOG_PROTOCOLS,
  QUERY_RECORD_TYPES,
  QUERY_RESPONSE_TYPES,
  RECURSION_POLICIES,
  RECORD_TYPES,
  RESOLVER_PROTOCOLS,
  RESPONSE_CODES,
  RSA_HASH_ALGORITHMS,
  RSA_KEY_SIZES,
  SIGNING_ALGORITHMS,
  SOA_SERIAL_SCHEMES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  STAT_RANGES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_MATCHING_TYPES,
  TLSA_SELECTORS,
  ZONE_IMPORT_MODES,
  ZONE_TRANSFER_PROTOCOLS,
  ZONE_TYPES,
  ZONE_UPDATE_POLICIES,
} from '@/lib/api/enums'
import { loadMessages } from '@/lib/i18n/messages'
import { locales } from '@/lib/i18n/config'
import type {
  BlockingType,
  ClusterNodeType,
  CreatableZoneType,
  DnsClass,
  DnsKeyState,
  DnssecKeyType,
  DnssecStatus,
  ForwarderProtocol,
  ForwarderProxyType,
  Ipv6Mode,
  LeaseType,
  LoggingType,
  NotifyPolicy,
  NxProofType,
  ProxyType,
  QueryAccessPolicy,
  QueryLogProtocol,
  QueryRecordType,
  QueryResponseType,
  RecursionPolicy,
  RecordType,
  ResolverProtocol,
  ResponseCode,
  RsaHashAlgorithm,
  RsaKeySize,
  SigningAlgorithm,
  StatRange,
  ZoneTransferProtocol,
  ZoneType,
  ZoneUpdatePolicy,
} from '@/lib/api/enums'
import type { DnssecPrivateKey, DnssecProperties, SignZoneParams } from '@/lib/api/types/dnssec'
import type { ResolveParams } from '@/lib/api/types/dns-client'
import type { CreateZoneParams, DnsRecord, RecordMutationParams, SetZoneOptionsParams, ZoneOptions, ZoneSummary } from '@/lib/api/types/zones'
import type { ClusterNode } from '@/lib/api/types/admin'
import type { Lease } from '@/lib/api/types/dhcp'
import type { StatsQuery } from '@/lib/api/types/dashboard'
import type { QueryLogEntry, QueryLogFilter } from '@/lib/api/types/logs'
import type { DnsSettings, UpstreamProxy } from '@/lib/api/types/settings'

/** Every string enum in the module, so the structural checks can be shared. */
const STRING_ENUMS: Record<string, readonly string[]> = {
  RECORD_TYPES,
  QUERY_RECORD_TYPES,
  DNS_CLASSES,
  RESPONSE_CODES,
  ZONE_TYPES,
  CREATABLE_ZONE_TYPES,
  CONVERTIBLE_ZONE_TYPES,
  ZONE_TRANSFER_PROTOCOLS,
  QUERY_ACCESS_POLICIES,
  ZONE_UPDATE_POLICIES,
  NOTIFY_POLICIES,
  DNSSEC_STATUSES,
  SOA_SERIAL_SCHEMES,
  FORWARDER_PROTOCOLS,
  RESOLVER_PROTOCOLS,
  PROXY_TYPES,
  FORWARDER_PROXY_TYPES,
  RECURSION_POLICIES,
  BLOCKING_TYPES,
  IPV6_MODES,
  LOGGING_TYPES,
  SIGNING_ALGORITHMS,
  RSA_HASH_ALGORITHMS,
  ECDSA_CURVES,
  EDDSA_CURVES,
  KEY_TYPES,
  NX_PROOF_TYPES,
  KEY_GENERATION_MODES,
  DNS_KEY_STATES,
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_SELECTORS,
  TLSA_MATCHING_TYPES,
  QUERY_LOG_PROTOCOLS,
  QUERY_RESPONSE_TYPES,
  STAT_RANGES,
  ZONE_IMPORT_MODES,
  LEASE_TYPES,
  CLUSTER_NODE_TYPES,
}

/** Read a nested key out of a message namespace. */
function labelKeys(namespace: string, path: string): string[] {
  const node = path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[part]
  }, loadMessages('en')[namespace])
  if (node === null || typeof node !== 'object') {
    throw new Error(`${namespace}:${path} is not an object in the en bundle`)
  }
  return Object.keys(node as Record<string, unknown>)
}

/** Assert `values` all have a key under `namespace:path`, and return the extras. */
function labelCoverage(values: readonly string[], namespace: string, path: string): string[] {
  const keys = labelKeys(namespace, path)
  for (const value of values) {
    expect(keys, `${namespace}:${path} has no label for '${value}'`).toContain(value)
  }
  return keys.filter((key) => !values.includes(key)).sort()
}

describe('enum value sets are pinned', () => {
  it('lists the record types the add/edit dialog offers', () => {
    expect([...RECORD_TYPES]).toEqual([
      'A', 'NS', 'SOA', 'CNAME', 'PTR', 'MX', 'TXT', 'RP', 'AAAA', 'SRV', 'NAPTR',
      'DNAME', 'DS', 'SSHFP', 'TLSA', 'SVCB', 'HTTPS', 'URI', 'CAA', 'ANAME',
      'FWD', 'APP', 'Unknown',
    ])
  })

  it('lists the wider resolver query types, pseudo-types included', () => {
    expect([...QUERY_RECORD_TYPES]).toEqual([
      'A', 'NS', 'CNAME', 'SOA', 'PTR', 'MX', 'TXT', 'RP', 'AAAA', 'SRV', 'NAPTR',
      'DNAME', 'DS', 'SSHFP', 'RRSIG', 'NSEC', 'DNSKEY', 'NSEC3', 'NSEC3PARAM',
      'TLSA', 'ZONEMD', 'SVCB', 'HTTPS', 'URI', 'CAA', 'ANY', 'AXFR', 'ANAME',
    ])
  })

  it('lists the DNS classes', () => {
    expect([...DNS_CLASSES]).toEqual(['IN', 'CS', 'CH', 'HS', 'NONE', 'ANY'])
  })

  it('lists the response codes', () => {
    expect([...RESPONSE_CODES]).toEqual([
      'NoError', 'FormatError', 'ServerFailure', 'NxDomain', 'NotImplemented',
      'Refused', 'YXDomain', 'YXRRSet', 'NXRRSet', 'NotAuth', 'NotZone',
    ])
  })

  it('lists the zone types and the three derived subsets', () => {
    expect([...ZONE_TYPES]).toEqual([
      'Primary', 'Secondary', 'Stub', 'Forwarder', 'SecondaryForwarder', 'Catalog', 'SecondaryCatalog',
    ])
    // `SecondaryRoot` exists only on the create path; the console expands it.
    expect([...CREATABLE_ZONE_TYPES]).toEqual([...ZONE_TYPES, 'SecondaryRoot'])
    expect([...CONVERTIBLE_ZONE_TYPES]).toEqual(['Primary', 'Forwarder', 'Catalog'])
    expect([...CONVERTIBLE_ZONE_TYPES].every((t) => ZONE_TYPES.includes(t))).toBe(true)
  })

  it('lists the zone transfer protocols', () => {
    expect([...ZONE_TRANSFER_PROTOCOLS]).toEqual(['Tcp', 'Tls', 'Quic'])
  })

  it('lists the three policy families, which are deliberately not the same list', () => {
    expect([...QUERY_ACCESS_POLICIES]).toEqual([
      'Deny', 'Allow', 'AllowOnlyPrivateNetworks', 'AllowOnlyZoneNameServers',
      'UseSpecifiedNetworkACL', 'AllowZoneNameServersAndUseSpecifiedNetworkACL',
    ])
    expect([...ZONE_UPDATE_POLICIES]).toEqual([
      'Deny', 'Allow', 'AllowOnlyZoneNameServers', 'UseSpecifiedNetworkACL',
      'AllowZoneNameServersAndUseSpecifiedNetworkACL',
    ])
    expect([...NOTIFY_POLICIES]).toEqual([
      'None', 'ZoneNameServers', 'SpecifiedNameServers',
      'BothZoneAndSpecifiedNameServers', 'SeparateNameServersForCatalogAndMemberZones',
    ])
  })

  it('keeps zone transfer and dynamic update inside the query-access family', () => {
    for (const policy of ZONE_UPDATE_POLICIES) {
      expect([...QUERY_ACCESS_POLICIES], `${policy} is not a query access policy`).toContain(policy)
    }
    const wider: readonly string[] = ZONE_UPDATE_POLICIES
    expect([...QUERY_ACCESS_POLICIES].filter((p) => !wider.includes(p))).toEqual(['AllowOnlyPrivateNetworks'])
  })

  it('lists the DNSSEC statuses and the SOA serial schemes', () => {
    expect([...DNSSEC_STATUSES]).toEqual(['Disabled', 'Signed', 'PendingSigning'])
    expect([...SOA_SERIAL_SCHEMES]).toEqual(['Serial', 'SerialDate'])
  })

  it('lists the forwarder and resolver protocols with their different casing', () => {
    expect([...FORWARDER_PROTOCOLS]).toEqual(['Udp', 'Tcp', 'Tls', 'Https', 'Quic'])
    expect([...RESOLVER_PROTOCOLS]).toEqual(['UDP', 'TCP', 'TLS', 'HTTPS', 'QUIC'])
  })

  it('lists both proxy vocabularies, which spell "no proxy" differently', () => {
    expect([...PROXY_TYPES]).toEqual(['None', 'Http', 'Socks5'])
    expect([...FORWARDER_PROXY_TYPES]).toEqual(['NoProxy', 'DefaultProxy', 'Http', 'Socks5'])
  })

  it('lists the recursion, blocking, IPv6 and logging settings enums', () => {
    expect([...RECURSION_POLICIES]).toEqual([
      'Deny', 'Allow', 'AllowOnlyForPrivateNetworks', 'UseSpecifiedNetworkACL',
    ])
    expect([...BLOCKING_TYPES]).toEqual(['AnyAddress', 'NxDomain', 'CustomAddress'])
    expect([...IPV6_MODES]).toEqual(['Disabled', 'Enabled', 'Preferred'])
    expect([...LOGGING_TYPES]).toEqual(['None', 'File', 'Console', 'FileAndConsole'])
  })

  it('lists the DNSSEC signing vocabulary', () => {
    expect([...SIGNING_ALGORITHMS]).toEqual(['RSA', 'ECDSA', 'EDDSA'])
    expect([...RSA_HASH_ALGORITHMS]).toEqual(['MD5', 'SHA1', 'SHA256', 'SHA512'])
    expect([...ECDSA_CURVES]).toEqual(['P256', 'P384'])
    expect([...EDDSA_CURVES]).toEqual(['ED25519', 'ED448'])
    expect([...RSA_KEY_SIZES]).toEqual([1024, 1280, 1536, 2048, 3072, 4096])
    expect([...KEY_TYPES]).toEqual(['KeySigningKey', 'ZoneSigningKey'])
    expect([...NX_PROOF_TYPES]).toEqual(['NSEC', 'NSEC3'])
    expect([...KEY_GENERATION_MODES]).toEqual(['Automatic', 'UseSpecified'])
    expect([...DNS_KEY_STATES]).toEqual([
      'Generated', 'Published', 'Ready', 'Active', 'Retiring', 'Retired', 'Deleted',
    ])
  })

  it('lists the record rData sub-enums', () => {
    expect([...DS_ALGORITHMS]).toEqual([
      'RSAMD5', 'RSASHA1', 'RSASHA256', 'RSASHA512',
      'ECDSAP256SHA256', 'ECDSAP384SHA384', 'ED25519', 'ED448',
    ])
    expect([...DS_DIGEST_TYPES]).toEqual(['SHA1', 'SHA256', 'SHA384'])
    expect([...SSHFP_ALGORITHMS]).toEqual(['RSA', 'DSA', 'ECDSA', 'Ed25519', 'Ed448'])
    expect([...SSHFP_FINGERPRINT_TYPES]).toEqual(['SHA1', 'SHA256'])
    expect([...TLSA_CERTIFICATE_USAGES]).toEqual(['PKIX-TA', 'PKIX-EE', 'DANE-TA', 'DANE-EE'])
    expect([...TLSA_SELECTORS]).toEqual(['Cert', 'SPKI'])
    expect([...TLSA_MATCHING_TYPES]).toEqual(['Full', 'SHA2-256', 'SHA2-512'])
  })

  it('lists the query log vocabulary, stat ranges and misc enums', () => {
    expect([...QUERY_LOG_PROTOCOLS]).toEqual(['Udp', 'Tcp', 'Tls', 'Https', 'Quic', 'UdpProxy', 'TcpProxy'])
    expect([...QUERY_RESPONSE_TYPES]).toEqual([
      'Authoritative', 'Recursive', 'Cached', 'Blocked', 'UpstreamBlocked', 'UpstreamBlockedCached',
    ])
    expect([...STAT_RANGES]).toEqual(['lastHour', 'lastDay', 'lastWeek', 'lastMonth', 'lastYear', 'custom'])
    expect([...PAGE_SIZES]).toEqual([10, 25, 50, 100, 250, 500])
    expect([...ZONE_IMPORT_MODES]).toEqual(['File', 'Text'])
    expect([...LEASE_TYPES]).toEqual(['Reserved', 'Dynamic'])
    expect([...CLUSTER_NODE_TYPES]).toEqual(['Primary', 'Secondary'])
    expect([...CLUSTER_NODE_STATES]).toEqual(['Self', 'Connected', 'Unreachable'])
  })

  it('classifies address-valued and name-valued record types', () => {
    expect([...ADDRESS_RECORD_TYPES].sort()).toEqual(['A', 'AAAA'])
    expect([...NAME_RECORD_TYPES].sort()).toEqual(['ANAME', 'CNAME', 'DNAME', 'NS', 'PTR'])
    for (const type of [...ADDRESS_RECORD_TYPES, ...NAME_RECORD_TYPES]) {
      expect([...RECORD_TYPES], `${type} is not a record type`).toContain(type)
    }
    expect([...ADDRESS_RECORD_TYPES].some((t) => NAME_RECORD_TYPES.has(t))).toBe(false)
  })
})

describe('structural invariants', () => {
  it('holds no duplicates in any enum', () => {
    for (const [name, values] of Object.entries(STRING_ENUMS)) {
      expect(new Set(values).size, `${name} has a duplicate value`).toBe(values.length)
    }
  })

  it('holds no empty or padded string value', () => {
    for (const [name, values] of Object.entries(STRING_ENUMS)) {
      for (const value of values) {
        expect(value.length, `${name} has an empty value`).toBeGreaterThan(0)
        expect(value, `${name} value '${value}' is padded`).toBe(value.trim())
      }
    }
  })

  it('holds ascending, positive page sizes and RSA key sizes', () => {
    for (const [name, values] of [
      ['PAGE_SIZES', PAGE_SIZES],
      ['RSA_KEY_SIZES', RSA_KEY_SIZES],
    ] as const) {
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${name} is not ascending at index ${i}`).toBeGreaterThan(values[i - 1])
      }
      expect(values[0], `${name} starts below 1`).toBeGreaterThan(0)
    }
  })

  it('keeps the resolver protocols as the upper-case spelling of the forwarder protocols', () => {
    // Both lists describe the same five transports for two different endpoints.
    // The casing difference is the server's, not ours — conflating them is the
    // single easiest way to break forwarding or resolution silently.
    expect([...RESOLVER_PROTOCOLS].map((p) => p.toLowerCase())).toEqual(
      [...FORWARDER_PROTOCOLS].map((p) => p.toLowerCase()),
    )
    expect([...FORWARDER_PROTOCOLS].some((p) => RESOLVER_PROTOCOLS.includes(p as never))).toBe(false)
  })

  it('keeps the two "no proxy" spellings apart', () => {
    expect([...PROXY_TYPES]).not.toContain('NoProxy')
    expect([...FORWARDER_PROXY_TYPES]).not.toContain('None')
    const forwarderProxies: readonly string[] = FORWARDER_PROXY_TYPES
    expect([...PROXY_TYPES].filter((t) => forwarderProxies.includes(t))).toEqual(['Http', 'Socks5'])
  })

  it('keeps the two "private networks only" spellings apart', () => {
    // Recursion says `AllowOnlyForPrivateNetworks`, zone query access says
    // `AllowOnlyPrivateNetworks`. Neither accepts the other's value.
    expect([...RECURSION_POLICIES]).toContain('AllowOnlyForPrivateNetworks')
    expect([...RECURSION_POLICIES]).not.toContain('AllowOnlyPrivateNetworks')
    expect([...QUERY_ACCESS_POLICIES]).toContain('AllowOnlyPrivateNetworks')
    expect([...QUERY_ACCESS_POLICIES]).not.toContain('AllowOnlyForPrivateNetworks')
    expect([...RECURSION_POLICIES].filter((p) => QUERY_ACCESS_POLICIES.includes(p as never))).toEqual([
      'Deny',
      'Allow',
      'UseSpecifiedNetworkACL',
    ])
  })

  it('keeps the resolver pseudo-types out of the record dialog and vice versa', () => {
    const queryTypes: readonly string[] = QUERY_RECORD_TYPES
    const recordTypes: readonly string[] = RECORD_TYPES
    const recordOnly = [...RECORD_TYPES].filter((t) => !queryTypes.includes(t))
    const queryOnly = [...QUERY_RECORD_TYPES].filter((t) => !recordTypes.includes(t))
    expect(recordOnly).toEqual(['FWD', 'APP', 'Unknown'])
    expect(queryOnly).toEqual(['RRSIG', 'NSEC', 'DNSKEY', 'NSEC3', 'NSEC3PARAM', 'ZONEMD', 'ANY', 'AXFR'])
  })

  it('keeps query log protocols a superset of the forwarder protocols', () => {
    for (const protocol of FORWARDER_PROTOCOLS) {
      expect([...QUERY_LOG_PROTOCOLS], `${protocol} missing from the log filter`).toContain(protocol)
    }
    const forwarder: readonly string[] = FORWARDER_PROTOCOLS
    expect([...QUERY_LOG_PROTOCOLS].filter((p) => !forwarder.includes(p))).toEqual(['UdpProxy', 'TcpProxy'])
  })
})

describe('message coverage', () => {
  it('labels every record type, with no key left over', () => {
    expect(labelCoverage(RECORD_TYPES, 'records', 'types')).toEqual([])
    expect(labelKeys('records', 'types')).toHaveLength(RECORD_TYPES.length)
  })

  it('labels every zone type the console can create', () => {
    // `zones.types` also carries `ConditionalForwarder` and `Reverse`, which the
    // server reports but `zones/create` never accepts.
    expect(labelCoverage(CREATABLE_ZONE_TYPES, 'zones', 'types')).toEqual([
      'ConditionalForwarder',
      'Reverse',
    ])
  })

  it('labels every DNSSEC status, plus the "Unsigned" state only the read side returns', () => {
    expect(labelCoverage(DNSSEC_STATUSES, 'zones', 'list.dnssecStatus')).toEqual(['Unsigned'])
    expect(labelCoverage(DNSSEC_STATUSES, 'dnssec', 'status').sort()).toEqual([
      'Unsigned',
      'disabledHint',
      'label',
      'pendingHint',
      'signedHint',
      'unsignedHint',
    ])
  })

  it('labels every DNSSEC key type and key state', () => {
    expect(labelCoverage(KEY_TYPES, 'dnssec', 'keys.keyTypes')).toEqual([])
    expect(labelCoverage(DNS_KEY_STATES, 'dnssec', 'keys.states')).toEqual([])
    expect(labelCoverage(DNS_KEY_STATES, 'dnssec', 'keys.stateHints')).toEqual([])
  })

  it('labels every settings enum', () => {
    expect(labelCoverage(PROXY_TYPES, 'settings', 'proxy.types')).toEqual([])
    expect(labelCoverage(RECURSION_POLICIES, 'settings', 'recursion.policies')).toEqual([])
    expect(labelCoverage(BLOCKING_TYPES, 'settings', 'blocking.types')).toEqual([])
    expect(labelCoverage(IPV6_MODES, 'settings', 'general.ipv6Modes')).toEqual([])
    expect(labelCoverage(LOGGING_TYPES, 'settings', 'logging.types')).toEqual([])
  })

  it('labels every stat range, leaving the picker chrome as the only extras', () => {
    expect(labelCoverage(STAT_RANGES, 'dashboard', 'range')).toEqual([
      'apply',
      'from',
      'invalidRange',
      'label',
      'to',
      'tooWide',
    ])
  })

  it('labels every lease type and cluster node type', () => {
    expect(labelCoverage(LEASE_TYPES, 'dhcp', 'leases.types')).toEqual([])
    expect(labelCoverage(CLUSTER_NODE_TYPES, 'admin', 'cluster.nodes.types')).toEqual([])
  })

  it('labels every cluster node state', () => {
    // `ClusterNodeState` widens `CLUSTER_NODE_STATES` with `| string`, so the
    // type cannot enumerate itself and this coverage check is the only thing
    // keeping the label map honest. The three values come from the stock
    // console's own switch (`.probe/console-js/cluster.js:160-178`); an earlier
    // pass guessed `Online`/`Offline`/`Syncing`, which the server never sends, so
    // the map matched nothing and every state cell rendered a raw i18n key.
    expect(labelCoverage(CLUSTER_NODE_STATES, 'admin', 'cluster.nodes.states')).toEqual([])
  })

  it('labels every zone policy through the component-level key remap', () => {
    // `zone-options-view.tsx` maps two wire values onto differently spelled
    // message keys; the map is reproduced here so a change on either side fails.
    const POLICY_LABEL_KEY: Record<string, string> = {
      Deny: 'Deny',
      Allow: 'Allow',
      AllowOnlyPrivateNetworks: 'AllowOnlyForPrivateNetworks',
      AllowOnlyZoneNameServers: 'AllowOnlyForZoneNameServers',
      UseSpecifiedNetworkACL: 'UseSpecifiedNetworkACL',
      AllowZoneNameServersAndUseSpecifiedNetworkACL: 'AllowZoneNameServersAndUseSpecifiedNetworkACL',
    }
    const NOTIFY_LABEL_KEY: Record<string, string> = {
      None: 'Disable',
      ZoneNameServers: 'ThisServer',
      SpecifiedNameServers: 'SpecifiedNameServers',
      BothZoneAndSpecifiedNameServers: 'BothThisServerAndSpecifiedNameServers',
      SeparateNameServersForCatalogAndMemberZones: 'SeparateNameServersForCatalogAndMemberZones',
    }

    const policyKeys = labelKeys('zones', 'options.policies')
    for (const family of [QUERY_ACCESS_POLICIES, ZONE_UPDATE_POLICIES]) {
      for (const value of family) {
        const key = POLICY_LABEL_KEY[value]
        expect(key, `no label-key remap for policy '${value}'`).toBeDefined()
        expect(policyKeys, `zones:options.policies has no '${key}' for '${value}'`).toContain(key)
      }
    }
    // The shared map also serves the recursion setting's two extra spellings.
    expect(policyKeys.filter((k) => !Object.values(POLICY_LABEL_KEY).includes(k)).sort()).toEqual([
      'AllowOnlyForNameServers',
      'AllowOnlyForPrivateNetworksAndUseSpecifiedNetworkACL',
    ])

    const notifyKeys = labelKeys('zones', 'options.notifyPolicies')
    for (const value of NOTIFY_POLICIES) {
      const key = NOTIFY_LABEL_KEY[value]
      expect(key, `no label-key remap for notify policy '${value}'`).toBeDefined()
      expect(notifyKeys, `zones:options.notifyPolicies has no '${key}'`).toContain(key)
    }
    expect(notifyKeys).toHaveLength(NOTIFY_POLICIES.length)
  })

  it('labels the query-log filter values the server actually reports', () => {
    // The filter offers a curated subset: four response codes and four response
    // types, plus `Dropped`. The remaining codes are not filterable and have no
    // label — pinned so an accidental half-added label map is caught.
    const keys = labelKeys('logs', 'query.responseTypes').sort()
    expect(keys).toEqual([
      'Authoritative',
      'Blocked',
      'Cached',
      'Dropped',
      'NoError',
      'NxDomain',
      'Recursive',
      'Refused',
      'ServerFailure',
    ])
    const codes = keys.filter((key) => RESPONSE_CODES.includes(key as ResponseCode))
    expect(codes).toEqual(['NoError', 'NxDomain', 'Refused', 'ServerFailure'])
    const types = keys.filter((key) => QUERY_RESPONSE_TYPES.includes(key as QueryResponseType))
    expect(types).toEqual(['Authoritative', 'Blocked', 'Cached', 'Recursive'])
  })

  it('keeps the same label keys in Chinese and in English', () => {
    const maps: Array<[string, string]> = [
      ['records', 'types'],
      ['zones', 'types'],
      ['zones', 'list.dnssecStatus'],
      ['zones', 'options.policies'],
      ['zones', 'options.notifyPolicies'],
      ['dnssec', 'status'],
      ['dnssec', 'keys.keyTypes'],
      ['dnssec', 'keys.states'],
      ['settings', 'proxy.types'],
      ['settings', 'recursion.policies'],
      ['settings', 'blocking.types'],
      ['settings', 'general.ipv6Modes'],
      ['settings', 'logging.types'],
      ['dashboard', 'range'],
      ['dhcp', 'leases.types'],
      ['admin', 'cluster.nodes.types'],
      ['admin', 'cluster.nodes.states'],
      ['logs', 'query.responseTypes'],
    ]
    for (const [namespace, path] of maps) {
      const en = labelKeys(namespace, path).sort()
      const zh = path
        .split('.')
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], loadMessages('zh')[namespace])
      expect(Object.keys(zh as Record<string, unknown>).sort(), `${namespace}:${path}`).toEqual(en)
    }
  })

  it('has one non-empty label string per enum value, in both locales', () => {
    const maps: Array<[string, string, readonly string[]]> = [
      ['dhcp', 'leases.types', LEASE_TYPES],
      ['admin', 'cluster.nodes.types', CLUSTER_NODE_TYPES],
      ['admin', 'cluster.nodes.states', CLUSTER_NODE_STATES],
      ['settings', 'proxy.types', PROXY_TYPES],
      ['settings', 'blocking.types', BLOCKING_TYPES],
      ['settings', 'general.ipv6Modes', IPV6_MODES],
      ['settings', 'logging.types', LOGGING_TYPES],
      ['settings', 'recursion.policies', RECURSION_POLICIES],
      ['dnssec', 'keys.keyTypes', KEY_TYPES],
      ['dnssec', 'keys.states', DNS_KEY_STATES],
      ['zones', 'list.dnssecStatus', [...DNSSEC_STATUSES, 'Unsigned']],
    ]
    for (const locale of locales) {
      for (const [namespace, path, values] of maps) {
        const node = path
          .split('.')
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], loadMessages(locale)[namespace])
        for (const value of values) {
          const label = (node as Record<string, unknown>)[value]
          expect(typeof label, `${locale}:${namespace}:${path}.${value}`).toBe('string')
          expect((label as string).trim().length, `${locale}:${namespace}:${path}.${value} is blank`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('gives record types and zone types a label plus a hint, in both locales', () => {
    // These two pickers explain the choice under the control, so the value is
    // `{ label, hint }` rather than a bare string.
    const maps: Array<[string, string, readonly string[]]> = [
      ['records', 'types', RECORD_TYPES],
      ['zones', 'types', CREATABLE_ZONE_TYPES],
    ]
    for (const locale of locales) {
      for (const [namespace, path, values] of maps) {
        const node = loadMessages(locale)[namespace] as Record<string, Record<string, Record<string, unknown>>>
        for (const value of values) {
          const entry = node[path][value]
          expect(entry, `${locale}:${namespace}:${path}.${value}`).not.toBeUndefined()
          expect(Object.keys(entry).sort(), `${locale}:${namespace}:${path}.${value}`).toEqual(['hint', 'label'])
          for (const field of ['label', 'hint']) {
            expect(typeof entry[field], `${locale}:${namespace}:${path}.${value}.${field}`).toBe('string')
            expect(
              (entry[field] as string).trim().length,
              `${locale}:${namespace}:${path}.${value}.${field} is blank`,
            ).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('shows the RFC mnemonic verbatim for record types, in English', () => {
    // Record type labels are protocol mnemonics; translating them would make the
    // picker disagree with every `dig` transcript and RFC the user reads.
    const types = loadMessages('en').records as Record<string, Record<string, { label: string }>>
    for (const value of RECORD_TYPES) {
      expect(types.types[value].label, `en:records:types.${value}.label`).toBe(value)
    }
  })
})

// ----------------------------------------------------------- type-level checks

/** True only when the two types are mutually assignable. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * Compile-time assertions. Each `satisfies` fails `tsc --noEmit` if the wire
 * type drifted away from its enum; the runtime test just proves the table ran.
 */
const TYPE_WIRING: Record<string, true> = {
  recordType: true satisfies Equals<DnsRecord['type'], RecordType>,
  recordMutationType: true satisfies Equals<RecordMutationParams['type'], RecordType>,
  creatableZoneType: true satisfies Equals<CreateZoneParams['type'], CreatableZoneType>,
  zoneSummaryType: true satisfies Equals<ZoneSummary['type'], ZoneType>,
  zoneOptionsType: true satisfies Equals<ZoneOptions['type'], ZoneType>,
  dnssecPropertiesType: true satisfies Equals<DnssecProperties['type'], ZoneType>,
  queryAccessPolicy: true satisfies Equals<ZoneOptions['queryAccess'], QueryAccessPolicy>,
  zoneTransferPolicy: true satisfies Equals<ZoneOptions['zoneTransfer'], ZoneUpdatePolicy>,
  updatePolicy: true satisfies Equals<SetZoneOptionsParams['update'], ZoneUpdatePolicy | undefined>,
  notifyPolicy: true satisfies Equals<ZoneOptions['notify'], NotifyPolicy>,
  zoneTransferProtocol: true satisfies Equals<NonNullable<ZoneOptions['primaryZoneTransferProtocol']>, ZoneTransferProtocol>,
  /** The read side accepts an `Unsigned` the write-side enum does not contain. */
  dnssecStatus: true satisfies Equals<DnssecProperties['dnssecStatus'], DnssecStatus | 'Unsigned'>,
  zoneSummaryDnssecStatus: true satisfies Equals<ZoneSummary['dnssecStatus'], DnssecStatus | 'Unsigned'>,
  keyType: true satisfies Equals<DnssecPrivateKey['keyType'], DnssecKeyType>,
  keyState: true satisfies Equals<DnssecPrivateKey['state'], DnsKeyState>,
  signingAlgorithm: true satisfies Equals<SignZoneParams['algorithm'], SigningAlgorithm>,
  nxProofType: true satisfies Equals<SignZoneParams['nxProof'], NxProofType>,
  rsaHashAlgorithm: true satisfies Equals<NonNullable<SignZoneParams['hashAlgorithm']>, RsaHashAlgorithm>,
  rsaKeySize: true satisfies Equals<NonNullable<SignZoneParams['kskKeySize']>, RsaKeySize>,
  resolveType: true satisfies Equals<ResolveParams['type'], QueryRecordType>,
  resolveProtocol: true satisfies Equals<ResolveParams['protocol'], ResolverProtocol>,
  recursionPolicy: true satisfies Equals<DnsSettings['recursion'], RecursionPolicy>,
  blockingType: true satisfies Equals<DnsSettings['blockingType'], BlockingType>,
  ipv6Mode: true satisfies Equals<DnsSettings['ipv6Mode'], Ipv6Mode>,
  loggingType: true satisfies Equals<DnsSettings['loggingType'], LoggingType>,
  forwarderProtocol: true satisfies Equals<DnsSettings['forwarderProtocol'], ForwarderProtocol>,
  proxyType: true satisfies Equals<UpstreamProxy['type'], ProxyType>,
  statRange: true satisfies Equals<NonNullable<StatsQuery['type']>, StatRange>,
  leaseType: true satisfies Equals<Lease['type'], LeaseType>,
  clusterNodeType: true satisfies Equals<ClusterNode['type'], ClusterNodeType>,
  queryLogProtocol: true satisfies Equals<NonNullable<QueryLogFilter['protocol']>, QueryLogProtocol | ''>,
  queryLogEntryClass: true satisfies Equals<QueryLogEntry['qclass'], DnsClass | string>,
  queryLogEntryRcode: true satisfies Equals<QueryLogEntry['rcode'], ResponseCode | string>,
  queryLogEntryResponseType: true satisfies Equals<QueryLogEntry['responseType'], QueryResponseType | string>,
  /** A forwarder zone spells the proxy type with its own vocabulary. */
  forwarderProxyType: true satisfies Equals<NonNullable<CreateZoneParams['proxyType']>, ForwarderProxyType>,
}

describe('wire types still name their enum', () => {
  it('wires all thirty-five fields to the enum they came from', () => {
    expect(Object.keys(TYPE_WIRING)).toHaveLength(35)
    expect(Object.values(TYPE_WIRING).every((value) => value === true)).toBe(true)
  })

  it('assigns every enum value to the type it generates', () => {
    // Runtime twin of the table above: proves the arrays are not empty and that
    // each value is assignable where the UI will put it.
    const recordTypes: RecordType[] = [...RECORD_TYPES]
    const queryTypes: QueryRecordType[] = [...QUERY_RECORD_TYPES]
    const creatable: CreatableZoneType[] = [...CREATABLE_ZONE_TYPES]
    const protocols: ResolverProtocol[] = [...RESOLVER_PROTOCOLS]
    const keySizes: RsaKeySize[] = [...RSA_KEY_SIZES]
    const statRanges: StatRange[] = [...STAT_RANGES]
    expect(recordTypes).toHaveLength(23)
    expect(queryTypes).toHaveLength(28)
    expect(creatable).toHaveLength(8)
    expect(protocols).toHaveLength(5)
    expect(keySizes).toHaveLength(6)
    expect(statRanges).toHaveLength(6)
  })
})
