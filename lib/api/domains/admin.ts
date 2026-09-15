import { apiRequest } from '../client'
import type { PermissionSection } from '../types/common'
import type {
  ClusterInitParams,
  ClusterJoinParams,
  ClusterLeaveParams,
  ClusterOptionsParams,
  ClusterPromoteParams,
  ClusterState,
  ClusterStateParams,
  ClusterUpdatePrimaryParams,
  CreateUserParams,
  CreateTokenResult,
  GroupDetail,
  GroupListResult,
  PermissionListResult,
  SectionPermissions,
  SessionListResult,
  SetGroupParams,
  SetPermissionsParams,
  SetUserParams,
  SsoSettings,
  SetSsoParams,
  UserDetail,
  UserListResult,
} from '../types/admin'

/**
 * Administration: users, groups, permissions, live sessions, SSO and cluster.
 *
 * Most of these endpoints are GETs that *mutate* — that is Technitium's design,
 * not ours. The registry records the real verbs so the proxy accepts them.
 */

// -------------------------------------------------------------------- users

export function listUsers(node?: string): Promise<UserListResult> {
  return apiRequest<UserListResult>('admin/users/list', { params: { node } })
}

export function getUser(user: string, node?: string): Promise<UserDetail> {
  return apiRequest<UserDetail>('admin/users/get', { params: { user, node } })
}

export function createUser(params: CreateUserParams): Promise<null> {
  return apiRequest<null>('admin/users/create', { method: 'POST', body: { ...params } })
}

export function setUser(params: SetUserParams): Promise<null> {
  return apiRequest<null>('admin/users/set', { method: 'POST', body: { ...params } })
}

export function deleteUser(user: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/users/delete', { params: { user, node } })
}

// ------------------------------------------------------------------- groups

export function listGroups(node?: string): Promise<GroupListResult> {
  return apiRequest<GroupListResult>('admin/groups/list', { params: { node } })
}

export function getGroup(group: string, includeUsers = true, node?: string): Promise<GroupDetail> {
  return apiRequest<GroupDetail>('admin/groups/get', { params: { group, includeUsers, node } })
}

export function createGroup(group: string, description = '', node?: string): Promise<null> {
  return apiRequest<null>('admin/groups/create', { params: { group, description, node } })
}

export function setGroup(params: SetGroupParams): Promise<null> {
  return apiRequest<null>('admin/groups/set', { params: { ...params } })
}

export function deleteGroup(group: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/groups/delete', { params: { group, node } })
}

// -------------------------------------------------------------- permissions

export function listPermissions(includeUsersAndGroups = true, node?: string): Promise<PermissionListResult> {
  return apiRequest<PermissionListResult>('admin/permissions/list', { params: { includeUsersAndGroups, node } })
}

export function getPermissions(section: PermissionSection, includeUsersAndGroups = true, node?: string): Promise<SectionPermissions> {
  return apiRequest<SectionPermissions>('admin/permissions/get', { params: { section, includeUsersAndGroups, node } })
}

export function setPermissions(params: SetPermissionsParams): Promise<null> {
  return apiRequest<null>('admin/permissions/set', { params: { ...params } })
}

// ----------------------------------------------------------------- sessions

export function listSessions(node?: string): Promise<SessionListResult> {
  return apiRequest<SessionListResult>('admin/sessions/list', { params: { node } })
}

export function deleteAnySession(partialToken: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/sessions/delete', { params: { partialToken, node } })
}

export function createTokenForUser(user: string, tokenName: string, node?: string): Promise<CreateTokenResult> {
  return apiRequest<CreateTokenResult>('admin/sessions/createToken', { params: { user, tokenName, node } })
}

// ---------------------------------------------------------------------- SSO

export function getSso(node?: string): Promise<SsoSettings> {
  return apiRequest<SsoSettings>('admin/sso/get', { params: { node } })
}

export function setSso(params: SetSsoParams): Promise<null> {
  return apiRequest<null>('admin/sso/set', { method: 'POST', body: { ...params } })
}

// ------------------------------------------------------------------ cluster

/**
 * Read the cluster state.
 *
 * `includeServerIpAddresses` defaults to **true** here, which is deliberately
 * not upstream's default: without the flag a live v15.4 omits
 * `serverIpAddresses` from the response entirely, and the UI needs those
 * addresses both to show "this machine" and to prefill the init/join forms.
 * Passing `{ includeServerIpAddresses: false }` gets the bare response back.
 */
export function getClusterState(params: ClusterStateParams = {}): Promise<ClusterState> {
  const { includeServerIpAddresses = true, ...rest } = params
  return apiRequest<ClusterState>('admin/cluster/state', {
    params: { includeServerIpAddresses, ...rest },
  })
}

export function initCluster(params: ClusterInitParams = {}): Promise<null> {
  return apiRequest<null>('admin/cluster/init', { params: { ...params } })
}

export function joinCluster(params: ClusterJoinParams): Promise<null> {
  return apiRequest<null>('admin/cluster/initJoin', { method: 'POST', body: { ...params } })
}

/**
 * Delete the cluster. `forceDelete` is required by upstream; without it a
 * cluster that still has reachable secondaries refuses to go away.
 */
export function deleteCluster(forceDelete = false, node?: string): Promise<null> {
  return apiRequest<null>('admin/cluster/primary/delete', { params: { forceDelete, node } })
}

export function setClusterOptions(params: ClusterOptionsParams): Promise<null> {
  return apiRequest<null>('admin/cluster/primary/setOptions', { params: { ...params } })
}

/**
 * Take a secondary out of the cluster. Upstream drives both endpoints from one
 * "Remove Node" dialog and its *Force Remove* checkbox
 * (`.probe/console-js/cluster.js:470-475`):
 *
 *  - `deleteSecondary` (forced) drops the node from the cluster without asking
 *    it to leave gracefully. Use it when the node is already unreachable; it
 *    leaves that machine's own copy of the configuration in place.
 *  - `removeSecondary` (graceful) asks the node to leave first.
 *
 * Keyed by node **id**, not name — sending the name is accepted and silently
 * does nothing.
 */
export function deleteSecondaryNode(secondaryNodeId: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/cluster/primary/deleteSecondary', { params: { secondaryNodeId, node } })
}

/** Graceful counterpart of {@link deleteSecondaryNode}. */
export function removeSecondaryNode(secondaryNodeId: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/cluster/primary/removeSecondary', { params: { secondaryNodeId, node } })
}

/**
 * Leave the cluster. `forceLeave` drops out without informing the primary, which
 * is the only way off a cluster whose primary no longer exists.
 */
export function leaveCluster(params: ClusterLeaveParams = {}): Promise<null> {
  return apiRequest<null>('admin/cluster/secondary/leave', { params: { ...params } })
}

/**
 * Promote this secondary to primary. `forceDeletePrimary` skips both the config
 * resync from the current primary and the notification to it — the option for a
 * primary that is gone for good.
 */
export function promoteSecondary(params: ClusterPromoteParams = {}): Promise<null> {
  return apiRequest<null>('admin/cluster/secondary/promote', { params: { ...params } })
}

export function resyncSecondary(node?: string): Promise<null> {
  return apiRequest<null>('admin/cluster/secondary/resync', { params: { node } })
}

export function updatePrimaryServer(params: ClusterUpdatePrimaryParams): Promise<null> {
  return apiRequest<null>('admin/cluster/secondary/updatePrimary', { params: { ...params } })
}

/**
 * Re-point this node at a different local address. The parameter is plural —
 * `ipAddress` is accepted and ignored.
 */
export function updateClusterIpAddress(ipAddresses: string, node?: string): Promise<null> {
  return apiRequest<null>('admin/cluster/updateIpAddress', { params: { ipAddresses, node } })
}
