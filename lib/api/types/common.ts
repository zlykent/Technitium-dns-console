/**
 * Shared API types.
 *
 * Field names mirror Technitium's JSON exactly — including its inconsistencies
 * (`uptimestamp`, `dnsOverHttpRealIpHeader`) — because renaming them would force
 * a translation layer on every endpoint for no gain.
 */

/** Every successful Technitium response carries these before the payload. */
export interface UpstreamEnvelope<T> {
  status: 'ok' | 'invalid-token' | '2fa-required' | 'error'
  server?: string
  response?: T
}

/** `GET api/status` — the only endpoint reachable with no session at all. */
export interface ServerStatus {
  status: 'ok' | string
  server: string
  hasDefaultCredentials: boolean
  ssoEnabled: boolean
}

// --------------------------------------------------------------- permissions

/**
 * The eleven permission sections. Names are the API's own casing and are used
 * verbatim as the `section` parameter of `admin/permissions/*`.
 */
export const PERMISSION_SECTIONS = [
  'Administration',
  'Allowed',
  'Apps',
  'Blocked',
  'Cache',
  'Dashboard',
  'DhcpServer',
  'DnsClient',
  'Logs',
  'Settings',
  'Zones',
] as const
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number]

export interface PermissionFlags {
  canView: boolean
  canModify: boolean
  canDelete: boolean
}

export type PermissionMap = Record<PermissionSection, PermissionFlags>

export const NO_PERMISSIONS: PermissionFlags = { canView: false, canModify: false, canDelete: false }

export function emptyPermissionMap(): PermissionMap {
  return PERMISSION_SECTIONS.reduce((acc, section) => {
    acc[section] = { ...NO_PERMISSIONS }
    return acc
  }, {} as PermissionMap)
}

// -------------------------------------------------------------------- session

/** Server metadata returned alongside a successful login. */
export interface SessionInfo {
  version: string
  uptimestamp: string
  dnsServerDomain: string
  defaultRecordTtl: number
  defaultNsRecordTtl: number
  defaultSoaRecordTtl: number
  useSoaSerialDateScheme: boolean
  dnssecValidation: boolean
  clusterInitialized: boolean
  permissions: PermissionMap
}

export interface Session {
  displayName: string
  username: string
  isSsoUser: boolean
  totpEnabled: boolean
  /** Absent when the account has 2FA on and no TOTP was supplied yet. */
  token?: string
  info: SessionInfo
}

export type SessionType = 'Standard' | 'ApiToken'

export interface SessionEntry {
  username: string
  isCurrentSession: boolean
  /** First 16 hex chars of the token — enough to identify, not to reuse. */
  partialToken: string
  type: SessionType
  tokenName: string | null
  lastSeen: string
  lastSeenRemoteAddress: string
  lastSeenUserAgent: string
}

// ------------------------------------------------------------------ utilities

/** Technitium returns both a seconds value and a pre-rendered string. */
export interface TtlPair {
  ttl: number
  ttlString: string
}

/**
 * A network ACL entry as Technitium spells it on the wire: a plain string.
 *
 * Accepted forms are `10.0.0.0/8`, `192.168.1.5`, `!2000::/3` (negated) and
 * an optional `:Allow` / `:Deny` suffix. The API both returns and accepts an
 * array of these, so there is nothing to unpack — the UI just edits lines.
 */
export type NetworkAcl = string

/** `<textarea>` (one entry per line) -> array, dropping blanks and comments. */
export function parseNetworkAclText(text: string): NetworkAcl[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** Array -> `<textarea>` content. */
export function formatNetworkAclText(acls: NetworkAcl[] | null | undefined): string {
  return (acls ?? []).join('\n')
}

/**
 * Array -> the comma-joined form the settings/zone endpoints want. Technitium
 * treats an empty list as "unset", which the console signals by sending
 * `false`; `serializeNetworkAclList` returns `undefined` so the caller omits the
 * key instead.
 */
export function serializeNetworkAclList(acls: NetworkAcl[]): string | undefined {
  const list = acls.filter((a) => a.trim().length > 0)
  return list.length === 0 ? undefined : list.join(',')
}

export interface TsigKey {
  keyName: string
  sharedSecret: string
}

/** Anything the API may return as an ISO-8601 timestamp. */
export type IsoTimestamp = string

/** Page shape used by every paginated list endpoint. */
export interface Paginated<T> {
  pageNumber: number
  totalPages: number
  totalEntries?: number
  items: T[]
}
