import { apiRequest } from '../client'
import type { DhcpScope, LeaseListResult, ScopeListResult, SetScopeParams } from '../types/dhcp'

/**
 * DHCP scopes and leases.
 *
 * `dhcp/scopes/set` doubles as create and update: an unknown `name` creates the
 * scope, and `newName` renames an existing one. Two parameters are conditional in
 * a way that is easy to get wrong — `newName` must be *omitted* (not sent empty)
 * unless renaming, and `dnsServers` must be omitted when `useThisDnsServer` is on.
 */

export function listScopes(node?: string): Promise<ScopeListResult> {
  return apiRequest<ScopeListResult>('dhcp/scopes/list', { params: { node } })
}

export function getScope(name: string, node?: string): Promise<DhcpScope> {
  return apiRequest<DhcpScope>('dhcp/scopes/get', { params: { name, node } })
}

export function setScope(params: SetScopeParams): Promise<null> {
  const { newName, useThisDnsServer, dnsServers, node, ...rest } = params
  return apiRequest<null>('dhcp/scopes/set', {
    method: 'POST',
    params: { node },
    body: {
      ...rest,
      useThisDnsServer,
      ...(newName && newName !== rest.name ? { newName } : {}),
      ...(useThisDnsServer ? {} : { dnsServers: dnsServers ?? [] }),
    },
  })
}

export function enableScope(name: string, node?: string): Promise<null> {
  return apiRequest<null>('dhcp/scopes/enable', { params: { name, node } })
}

export function disableScope(name: string, node?: string): Promise<null> {
  return apiRequest<null>('dhcp/scopes/disable', { params: { name, node } })
}

export function deleteScope(name: string, node?: string): Promise<null> {
  return apiRequest<null>('dhcp/scopes/delete', { params: { name, node } })
}

// ------------------------------------------------------------------- leases

export function listLeases(node?: string): Promise<LeaseListResult> {
  return apiRequest<LeaseListResult>('dhcp/leases/list', { params: { node } })
}

/**
 * Leases are addressed by scope name plus the client's identifier. For clients
 * that sent no `clientIdentifier` option Technitium falls back to the hardware
 * address, so callers should pass whichever the row actually carries.
 */
export interface LeaseRef {
  /** Scope the lease belongs to. */
  name: string
  clientIdentifier: string
  node?: string
}

export function removeLease(ref: LeaseRef): Promise<null> {
  return apiRequest<null>('dhcp/leases/remove', { params: { ...ref } })
}

/** Turn a dynamic lease into a permanent reservation, keeping its address. */
export function convertLeaseToReserved(ref: LeaseRef): Promise<null> {
  return apiRequest<null>('dhcp/leases/convertToReserved', { params: { ...ref } })
}

export function convertLeaseToDynamic(ref: LeaseRef): Promise<null> {
  return apiRequest<null>('dhcp/leases/convertToDynamic', { params: { ...ref } })
}
