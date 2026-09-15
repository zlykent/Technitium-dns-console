import type { LeaseType } from '@/lib/api/enums'

/** `dhcp/scopes/list` */
export interface ScopeSummary {
  name: string
  enabled: boolean
  startingAddress: string
  endingAddress: string
  subnetMask: string
  networkAddress: string
  broadcastAddress: string
}

export interface ScopeListResult {
  scopes: ScopeSummary[]
}

/** `dhcp/scopes/get` — only fields that are actually configured are returned. */
export interface DhcpScope {
  name: string
  enabled?: boolean
  startingAddress: string
  endingAddress: string
  subnetMask: string
  leaseTimeDays: number
  leaseTimeHours: number
  leaseTimeMinutes: number
  /** Milliseconds the server waits before offering, for failover ordering. */
  offerDelayTime: number
  pingCheckEnabled: boolean
  pingCheckTimeout: number
  pingCheckRetries: number
  domainName: string
  domainSearchList?: string[]
  dnsUpdates: boolean
  dnsOverwriteForDynamicLease: boolean
  dnsTtl: number
  serverAddress?: string
  serverHostName?: string
  bootFileName?: string
  routerAddress: string
  useThisDnsServer: boolean
  dnsServers: string[]
  winsServers?: string[]
  ntpServers?: string[]
  ntpServerDomainNames?: string[]
  capwapAcIpAddresses?: string[]
  tftpServerAddresses?: string[]
  staticRoutes?: StaticRoute[]
  vendorInfo?: VendorInfo[]
  genericOptions?: GenericOption[]
  exclusions: AddressExclusion[]
  reservedLeases: ReservedLease[]
  allowOnlyReservedLeases: boolean
  blockLocallyAdministeredMacAddresses: boolean
  ignoreClientIdentifierOption: boolean
}

export interface AddressExclusion {
  startingAddress: string
  endingAddress: string
}

export interface ReservedLease {
  address: string
  hostName: string
  hardwareAddress: string
  comments: string
}

export interface StaticRoute {
  destination: string
  subnetMask: string
  router: string
}

export interface VendorInfo {
  identifier: string
  information: string
}

export interface GenericOption {
  code: number
  value: string
}

/** `dhcp/leases/list` */
export interface Lease {
  scope: string
  hardwareAddress: string
  address: string
  type: LeaseType
  hostName: string
  leaseObtained: string
  leaseExpires: string
  clientIdentifier: string | null
}

export interface LeaseListResult {
  leases: Lease[]
}

/**
 * `dhcp/scopes/set` body.
 *
 * The five table-shaped lists are **pipe-delimited** strings, not JSON — that is
 * Technitium's `serializeTableData` convention. Column counts are fixed and
 * order matters:
 *
 *   exclusions      startingAddress|endingAddress                       (2)
 *   reservedLeases  address|hostName|hardwareAddress|comments           (4)
 *   staticRoutes    destination|subnetMask|router                       (3)
 *   vendorInfo      identifier|information                              (2)
 *   genericOptions  code|value                                          (2)
 *
 * `serializePipeTable` below builds them, so call sites never hand-roll a join.
 */
export interface SetScopeParams {
  name: string
  newName?: string
  startingAddress: string
  endingAddress: string
  subnetMask: string
  leaseTimeDays: number
  leaseTimeHours: number
  leaseTimeMinutes: number
  offerDelayTime: number
  pingCheckEnabled: boolean
  pingCheckTimeout: number
  pingCheckRetries: number
  domainName: string
  domainSearchList?: string[]
  dnsUpdates: boolean
  dnsOverwriteForDynamicLease: boolean
  dnsTtl: number
  serverAddress?: string
  serverHostName?: string
  bootFileName?: string
  routerAddress: string
  useThisDnsServer: boolean
  dnsServers?: string[]
  winsServers?: string[]
  ntpServers?: string[]
  ntpServerDomainNames?: string[]
  capwapAcIpAddresses?: string[]
  tftpServerAddresses?: string[]
  staticRoutes?: string
  vendorInfo?: string
  genericOptions?: string
  exclusions?: string
  reservedLeases?: string
  allowOnlyReservedLeases: boolean
  blockLocallyAdministeredMacAddresses: boolean
  ignoreClientIdentifierOption: boolean
  node?: string
}

export const EXCLUSION_COLUMNS = 2
export const RESERVED_LEASE_COLUMNS = 4
export const STATIC_ROUTE_COLUMNS = 3
export const VENDOR_INFO_COLUMNS = 2
export const GENERIC_OPTION_COLUMNS = 2

/**
 * Flatten rows into Technitium's pipe format. Values containing `|` would
 * corrupt the row structure, so they are stripped rather than escaped — the
 * upstream parser has no escaping to speak of.
 */
export function serializePipeTable(rows: readonly (readonly (string | number | boolean)[])[]): string {
  return rows
    .map((row) => row.map((cell) => String(cell ?? '').replace(/\|/g, ' ').trim()).join('|'))
    .join('|')
}

/** Inverse of `serializePipeTable`, for pre-filling an edit form from a string. */
export function parsePipeTable(value: string, columns: number): string[][] {
  if (!value) return []
  const cells = value.split('|')
  const rows: string[][] = []
  for (let i = 0; i + columns <= cells.length; i += columns) {
    rows.push(cells.slice(i, i + columns))
  }
  return rows
}
