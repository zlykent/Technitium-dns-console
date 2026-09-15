import type {
  CreatableZoneType,
  DnssecStatus,
  ForwarderProtocol,
  ForwarderProxyType,
  NotifyPolicy,
  QueryAccessPolicy,
  RecordType,
  ZoneTransferProtocol,
  ZoneType,
  ZoneUpdatePolicy,
} from '@/lib/api/enums'
import type { NetworkAcl, PermissionFlags } from './common'

/** A single principal's grant, as returned by the `permissions/get` endpoints. */
export interface UserPermissionEntry extends PermissionFlags {
  username: string
}

export interface GroupPermissionEntry extends PermissionFlags {
  name: string
}

/**
 * `admin/permissions/get` and `zones/permissions/get` share this shape. The
 * console serialises the two arrays back as pipe-delimited rows of four
 * columns (`name|canView|canModify|canDelete`) — see `serializePermissionTable`.
 */
export interface PermissionSetResult {
  section: string
  /** Present only for zone-scoped permissions. */
  subItem?: string
  userPermissions: UserPermissionEntry[]
  groupPermissions: GroupPermissionEntry[]
  /** Every principal that *could* be granted, for the picker. */
  users: string[]
  groups: string[]
}

// ---------------------------------------------------------------------- zones

export interface ZoneSummary {
  /** The API calls it `name`, not `zone` — a frequent source of bugs. */
  name: string
  type: ZoneType
  lastModified: string
  disabled: boolean
  soaSerial: number
  /** Owning catalog zone, when this is a catalog member. */
  catalog: string | null
  dnssecStatus: DnssecStatus | 'Unsigned'
  hasDnssecPrivateKeys: boolean
  notifyFailed: boolean
  notifyFailedFor: string[]
  isExpired?: boolean
  validationFailed?: boolean
  syncFailed?: boolean
  expiry?: string
}

export interface ZoneListResult {
  pageNumber: number
  totalPages: number
  totalZones: number
  zones: ZoneSummary[]
}

export interface CatalogZoneListResult {
  catalogZones: string[]
}

export interface ZonePermissions extends PermissionSetResult {
  section: 'Zones'
  subItem: string
}

/** `zones/options/get` — the replication and access policy for one zone. */
export interface ZoneOptions {
  /** The API returns `name` here, `zone` on the write side. */
  name: string
  type: ZoneType
  dnssecStatus: DnssecStatus | 'Unsigned'
  notifyFailed: boolean
  notifyFailedFor: string[]
  disabled: boolean
  catalog: string | null
  queryAccess: QueryAccessPolicy
  queryAccessNetworkACL: NetworkAcl[]
  zoneTransfer: ZoneUpdatePolicy
  zoneTransferNetworkACL: NetworkAcl[]
  zoneTransferTsigKeyNames: string[]
  notify: NotifyPolicy
  notifyNameServers: string[]
  notifySecondaryCatalogsNameServers?: string[]
  update: ZoneUpdatePolicy
  updateNetworkACL: NetworkAcl[]
  updateSecurityPolicies: ZoneUpdateSecurityPolicy[]
  availableCatalogZoneNames: string[]
  availableTsigKeyNames: string[]
  isDeleteProtected?: boolean
  // secondary / stub zones
  primaryNameServerAddresses?: string[]
  primaryZoneTransferProtocol?: ZoneTransferProtocol
  primaryZoneTransferTsigKeyName?: string
  validateZone?: boolean
  expiry?: string
  syncFailed?: boolean
  // catalog member overrides
  overrideCatalogNotify?: boolean
  overrideCatalogQueryAccess?: boolean
  overrideCatalogUpdate?: boolean
  overrideCatalogZoneTransfer?: boolean
  overrideCatalogUpdateSecurityPolicies?: boolean
}

export interface ZoneUpdateSecurityPolicy {
  domain: string
  tsigKeyName: string
  allowedTypes: string[]
}

/**
 * Wire format for `zones/options/set`'s `updateSecurityPolicies`.
 *
 * The stock console builds it with `serializeTableData(table, 3, …)`, which
 * emits one **flat pipe-delimited stream** — cells and rows use the same
 * separator and the column count is implicit (the server knows it is three).
 * Column order is `tsigKeyName|domain|allowedTypes`, taken from
 * `addZoneOptionsDynamicUpdatesSecurityPolicyRow(i, tsigKeyName, domain,
 * allowedTypes)` in `zone.js`.
 *
 * An empty table is sent as the literal string `false`, not `""`: the console
 * assigns `updateSecurityPolicies = false` before encoding, and the server
 * reads that as "clear every policy". Sending `""` instead leaves the existing
 * policies untouched, which silently makes the table un-clearable.
 */
export const EMPTY_UPDATE_SECURITY_POLICIES = 'false'

export function serializeUpdateSecurityPolicies(policies: readonly ZoneUpdateSecurityPolicy[]): string {
  if (policies.length === 0) return EMPTY_UPDATE_SECURITY_POLICIES
  return policies.map((p) => [p.tsigKeyName, p.domain, p.allowedTypes.join(',')].join('|')).join('|')
}

/** Inverse of the above, for pre-filling a form from `zones/options/get`. */
export function parseUpdateSecurityPolicies(raw: string | null | undefined): ZoneUpdateSecurityPolicy[] {
  if (!raw || raw === EMPTY_UPDATE_SECURITY_POLICIES) return []
  const cells = raw.split('|')
  const out: ZoneUpdateSecurityPolicy[] = []
  for (let i = 0; i + 3 <= cells.length; i += 3) {
    const [tsigKeyName, domain, allowed] = cells.slice(i, i + 3) as [string, string, string]
    out.push({ tsigKeyName, domain, allowedTypes: allowed ? allowed.split(',').filter(Boolean) : [] })
  }
  return out
}

/** `zones/options/set` body. ACLs and name-server lists are comma-joined. */
export interface SetZoneOptionsParams {
  zone: string
  notify?: NotifyPolicy
  notifyNameServers?: string[]
  notifySecondaryCatalogsNameServers?: string[]
  queryAccess?: QueryAccessPolicy
  queryAccessNetworkACL?: NetworkAcl[]
  zoneTransfer?: ZoneUpdatePolicy
  zoneTransferNetworkACL?: NetworkAcl[]
  zoneTransferTsigKeyNames?: string[]
  update?: ZoneUpdatePolicy
  updateNetworkACL?: NetworkAcl[]
  /**
   * Pipe-delimited three-column stream, or the literal `'false'` to clear.
   * Build it with `serializeUpdateSecurityPolicies` — the format is easy to get
   * subtly wrong (see the comment there).
   */
  updateSecurityPolicies?: string
  primaryNameServerAddresses?: string[]
  primaryZoneTransferProtocol?: ZoneTransferProtocol
  primaryZoneTransferTsigKeyName?: string
  validateZone?: boolean
  catalog?: string
  overrideCatalogNotify?: boolean
  overrideCatalogQueryAccess?: boolean
  overrideCatalogZoneTransfer?: boolean
  node?: string
}

/** Parameters for `zones/create`, flattened across every zone type. */
export interface CreateZoneParams {
  zone: string
  type: CreatableZoneType
  /** Cluster node to create on; omit for the local server. */
  node?: string
  catalog?: string
  useSoaSerialDateScheme?: boolean
  primaryNameServerAddresses?: string[]
  zoneTransferProtocol?: ZoneTransferProtocol
  tsigKeyName?: string
  validateZone?: boolean
  // forwarder zones
  protocol?: ForwarderProtocol
  forwarder?: string
  dnssecValidation?: boolean
  initializeForwarder?: boolean
  proxyType?: ForwarderProxyType
  proxyAddress?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
  /** `zones/import` style creation from a pasted zone file. */
  fileImportZone?: File
}

export interface CreateZoneResult {
  domain: string
}

// -------------------------------------------------------------------- records

/**
 * `zones/records/get` with `listZone=true` (and without it — the key is always
 * present) answers with the zone's own metadata under `zone`, not its name.
 */
export interface RecordListResult {
  zone: ZoneSummary
  records: DnsRecord[]
}

export interface DnsRecord {
  name: string
  type: RecordType
  ttl: number
  ttlString: string
  /** Record-level expiry (Technitium's "expiry TTL" for conditional records). */
  expiryTtl: number | null
  expiryTtlString: string | null
  disabled: boolean
  dnssecStatus: string
  lastModified: string
  /** Last time the resolver served this record; null when never used. */
  lastUsedOn: string | null
  comments?: string | null
  rData: RecordRData
  glueRecords?: DnsRecord[]
}

/**
 * rData is a union in practice but Technitium returns a single flat object with
 * only the keys relevant to the record type populated. Modelling it flat keeps
 * every consumer simple; `RecordType` decides which fields to read.
 */
export interface RecordRData {
  // A / AAAA
  ipAddress?: string
  // NS / CNAME / PTR / DNAME / ANAME
  nameServer?: string
  cname?: string
  ptrName?: string
  dname?: string
  aname?: string
  alias?: string
  // SOA
  primaryNameServer?: string
  responsiblePerson?: string
  serial?: number
  refresh?: number
  refreshString?: string
  retry?: number
  retryString?: string
  expire?: number
  expireString?: string
  minimum?: number
  minimumString?: string
  useSerialDateScheme?: boolean
  // MX / SRV / URI
  exchange?: string
  preference?: number
  priority?: number
  weight?: number
  port?: number
  target?: string
  uri?: string
  // TXT / SPF / CAA
  text?: string
  characterStrings?: string[]
  characterStringsBase64?: string[]
  splitText?: string[]
  /**
   * CAA carries a numeric flag; NAPTR's is a string on the wire (and in the
   * JSON), so the union is not pedantry — reading it as a number loses the
   * value for NAPTR.
   */
  flags?: number | string
  tag?: string
  value?: string
  // RP
  mailbox?: string
  txtDomain?: string
  // NAPTR
  order?: number
  regexp?: string
  replacement?: string
  services?: string
  // DS / DNSKEY / RRSIG / NSEC / NSEC3
  keyTag?: number
  algorithm?: string
  algorithmNumber?: number
  digest?: string
  digestType?: string
  digestTypeNumber?: number
  publicKey?: string
  dnsKeyState?: string
  dnsKeyStateReadyBy?: string
  dnsKeyStateActiveBy?: string
  computedDigests?: { digestType: string; digestTypeNumber: number; digest: string }[]
  computedKeyTag?: number
  labels?: number
  originalTtl?: number
  signature?: string
  signatureExpiration?: string
  signatureInception?: string
  signersName?: string
  typeCovered?: string
  types?: string[]
  nextDomainName?: string
  nextHashedOwnerName?: string
  iterations?: number
  salt?: string
  hashAlgorithm?: string
  // SSHFP
  fingerprint?: string
  fingerprintType?: string
  // TLSA
  certificateUsage?: string
  certificateAssociationData?: string
  selector?: string
  matchingType?: string
  // SVCB / HTTPS
  svcPriority?: number
  svcTargetName?: string
  svcParams?: string
  autoIpv4Hint?: boolean
  autoIpv6Hint?: boolean
  // FWD (Technitium's conditional forwarder record)
  protocol?: ForwarderProtocol
  forwarder?: string
  dnssecValidation?: boolean
  proxyType?: ForwarderProxyType
  proxyAddress?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
  // APP (Technitium's DNS application record)
  appName?: string
  classPath?: string
  data?: string
  // unknown / raw
  addressPrefixes?: string[]
}

/** Parameters accepted by `zones/records/add` and `zones/records/update`. */
export interface RecordMutationParams {
  zone: string
  domain: string
  type: RecordType
  ttl?: number
  /** `zones/records/update` only: identifies the record being replaced. */
  index?: number
  disabled?: boolean
  comments?: string
  /** Every rData field is passed flat, prefixed by nothing — see `flattenRData`. */
  [rDataField: string]: unknown
}
