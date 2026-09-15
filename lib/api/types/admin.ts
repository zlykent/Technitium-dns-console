import type { ClusterNodeStateName, ClusterNodeType } from '@/lib/api/enums'
import type { PermissionFlags, SessionEntry } from './common'

// --------------------------------------------------------------------- users

export interface UserSummary {
  displayName: string
  username: string
  isSsoUser: boolean
  totpEnabled: boolean
  disabled: boolean
  previousSessionLoggedOn: string | null
  previousSessionRemoteAddress: string | null
  recentSessionLoggedOn: string | null
  recentSessionRemoteAddress: string | null
}

export interface UserListResult {
  users: UserSummary[]
}

/** `admin/users/get` — a user plus their live sessions. */
export interface UserDetail extends UserSummary {
  sessionTimeoutSeconds: number
  ssoManagedGroups: boolean
  memberOfGroups: string[]
  sessions: SessionEntry[]
}

export interface CreateUserParams {
  user: string
  pass: string
  displayName?: string
  node?: string
}

/**
 * `admin/users/set`.
 *
 * Two names here differ from what they obviously should be, and getting either
 * wrong is silent: the server accepts an unrecognised parameter, answers
 * `status: ok`, and changes nothing. Verified against v15.4 by creating a
 * scratch user, sending each spelling and then attempting to log in with the
 * new password — `pass` left the old one working, `newPass` did not.
 */
export interface SetUserParams {
  user: string
  /** Renames the account. `newUsername` is ignored. */
  newUser?: string
  displayName?: string
  /** Sets a new password. `pass` is ignored. */
  newPass?: string
  disabled?: boolean
  totpEnabled?: boolean
  sessionTimeoutSeconds?: number
  /** Replaces the whole membership list; comma-joined group names. */
  memberOfGroups?: string[]
  node?: string
}

// -------------------------------------------------------------------- groups

export interface GroupSummary {
  name: string
  description: string
}

export interface GroupListResult {
  groups: GroupSummary[]
}

export interface GroupDetail {
  name: string
  description: string
  members: string[]
  /** Duplicate of `members`, present when `includeUsers=true`. */
  users: string[]
}

export interface SetGroupParams {
  group: string
  /** Renames the group; omit to keep the current name. */
  newGroup?: string
  description?: string
  members?: string[]
  node?: string
}

// --------------------------------------------------------------- permissions

export interface SectionUserPermission extends PermissionFlags {
  username: string
}

export interface SectionGroupPermission extends PermissionFlags {
  name: string
}

export interface SectionPermissions {
  section: string
  userPermissions: SectionUserPermission[]
  groupPermissions: SectionGroupPermission[]
  users?: string[]
  groups?: string[]
}

export interface PermissionListResult {
  permissions: SectionPermissions[]
}

/**
 * `admin/permissions/set` takes both tables as pipe-delimited strings of four
 * columns: `name|canView|canModify|canDelete`, rows concatenated.
 */
export interface SetPermissionsParams {
  section: string
  userPermissions: string
  groupPermissions: string
  includeUsersAndGroups?: boolean
  node?: string
}

/**
 * One row of a permission table. `admin/permissions/*` keys users by `username`
 * and groups by `name`; `zones/permissions/*` does the same. Accepting both
 * means a caller can hand over the array it already fetched instead of mapping
 * `username -> name` at every call site.
 */
export type PermissionTableRow = PermissionFlags & { name?: string; username?: string }

/**
 * Serialise a permission table for `admin/permissions/set` /
 * `zones/permissions/set`.
 *
 * Both endpoints expect a single **flat pipe-delimited stream** of four columns
 * (`name|canView|canModify|canDelete`) with rows concatenated using the same
 * separator — the column count is implicit and known to the server. An empty
 * table serialises to `""`, which the server reads as "grant nobody".
 */
export function serializePermissionTable(rows: readonly PermissionTableRow[]): string {
  return rows
    .map((r) => [r.name ?? r.username ?? '', String(r.canView), String(r.canModify), String(r.canDelete)].join('|'))
    .join('|')
}

// ------------------------------------------------------------------ sessions

export interface SessionListResult {
  sessions: SessionEntry[]
}

export interface CreateTokenResult {
  token: string
  tokenName: string
  partialToken: string
  username: string
}

// ----------------------------------------------------------------------- SSO

export interface SsoGroupMapEntry {
  remoteGroup: string
  localGroup: string
}

export interface SsoSettings {
  ssoEnabled: boolean
  ssoAuthority: string | null
  ssoClientId: string | null
  ssoClientSecret: string | null
  ssoMetadataAddress: string | null
  ssoScopes: string[]
  ssoAllowSignup: boolean
  ssoAllowSignupOnlyForMappedUsers: boolean
  ssoGroupMap: SsoGroupMapEntry[]
  localGroups: string[]
}

export interface SetSsoParams {
  ssoEnabled?: boolean
  ssoAuthority?: string
  ssoClientId?: string
  ssoClientSecret?: string
  ssoMetadataAddress?: string
  ssoScopes?: string[]
  ssoAllowSignup?: boolean
  ssoAllowSignupOnlyForMappedUsers?: boolean
  /** Pipe-delimited `remoteGroup|localGroup` pairs. */
  ssoGroupMap?: string
  node?: string
}

// ------------------------------------------------------------------- cluster

/**
 * The states a v15.4 `clusterNodes[].state` carries. The named members live in
 * `CLUSTER_NODE_STATES` so the label map, the badge colours and the tests all
 * enumerate one list instead of three copies of it.
 *
 * The union stays open (`| string`) because an unrecognised value must render as
 * its raw text rather than crash the table or paint a missing translation key
 * into the cell.
 *
 * `Self` is the authoritative "this row is us" marker: the stock console finds
 * the local node by scanning for it and derives the node's own role from that
 * row's `type` (`.probe/console-js/cluster.js:120-127`). There is no
 * `isPrimaryNode` field on the response.
 */
export type ClusterNodeState = ClusterNodeStateName | string

export interface ClusterNode {
  id: string
  name: string
  url: string
  type: ClusterNodeType
  state: ClusterNodeState
  ipAddresses: string[]
  upSince: string | null
  lastSeen: string | null
  configLastSynced: string | null
}

/**
 * Before initialisation the server reports only `{version, dnsServerDomain,
 * clusterInitialized}` — verified against a live v15.4, and *not* what
 * `.probe/admin.cluster.state.json` shows, because that capture was taken with
 * `includeServerIpAddresses=true`. Every field below except the three above is
 * therefore optional, and nothing may assume the node list or the address list
 * is present.
 */
export interface ClusterState {
  version: string
  dnsServerDomain: string
  clusterInitialized: boolean
  /** Only returned when the request set `includeServerIpAddresses=true`. */
  serverIpAddresses?: string[]
  clusterDomain?: string
  clusterNodes?: ClusterNode[]
  /** Present once a cluster exists; the values the options dialog prefills. */
  heartbeatRefreshIntervalSeconds?: number
  heartbeatRetryIntervalSeconds?: number
  configRefreshIntervalSeconds?: number
  configRetryIntervalSeconds?: number
}

/** `admin/cluster/state` — read parameters. */
export interface ClusterStateParams {
  /** Without this the response omits `serverIpAddresses` entirely. */
  includeServerIpAddresses?: boolean
  node?: string
}

/**
 * Cluster write parameters.
 *
 * Every name below is taken from the upstream console's own request building
 * (`.probe/console-js/cluster.js`) rather than inferred, because
 * `admin/cluster/*` shares the users/set behaviour: an unrecognised parameter
 * is accepted and quietly dropped, so a plausible-looking name produces a
 * success toast and no change. There is no second node in this deployment to
 * test against, so the source is the only authority available.
 */
export interface ClusterInitParams {
  clusterDomain?: string
  /** Newline- or comma-separated list; the addresses this primary answers on. */
  primaryNodeIpAddresses?: string
  node?: string
}

/** `admin/cluster/initJoin` — POST, form body. */
export interface ClusterJoinParams {
  /** The addresses *this* secondary will answer on. */
  secondaryNodeIpAddresses?: string
  primaryNodeUrl: string
  /**
   * A single pinned address for the primary, so the join handshake cannot be
   * redirected by a DNS answer that differs from what the operator saw.
   */
  primaryNodeIpAddress?: string
  ignoreCertificateErrors?: boolean
  primaryNodeUsername: string
  primaryNodePassword: string
  /** The primary admin's current OTP; required when that account has 2FA on. */
  primaryNodeTotp?: string
}

/**
 * `admin/cluster/secondary/leave`. `forceLeave` makes this secondary drop out
 * without telling the primary — the only way out when the primary is gone.
 */
export interface ClusterLeaveParams {
  forceLeave?: boolean
  node?: string
}

/**
 * `admin/cluster/secondary/promote`. `forceDeletePrimary` promotes without
 * resyncing from, or informing, the current primary.
 */
export interface ClusterPromoteParams {
  forceDeletePrimary?: boolean
  node?: string
}

/** `admin/cluster/primary/setOptions` — all four intervals, in seconds. */
export interface ClusterOptionsParams {
  heartbeatRefreshIntervalSeconds: number
  heartbeatRetryIntervalSeconds: number
  configRefreshIntervalSeconds: number
  configRetryIntervalSeconds: number
  node?: string
}

/** `admin/cluster/secondary/updatePrimary` — a secondary re-points itself. */
export interface ClusterUpdatePrimaryParams {
  primaryNodeUrl: string
  primaryNodeIpAddresses?: string
  node?: string
}
