import { apiDownload, apiRequest } from '../client'
import { normalizeZoneList, serializeZoneList, type DomainTreeResult, type TreeListParams } from '../types/filtering'

/**
 * Cache / Allowed / Blocked.
 *
 * The three scopes answer with the same lazy domain tree, so one module drives
 * all three and the UI picks a scope rather than duplicating a page. `cache` is
 * the odd one out: it is read-only apart from eviction, with no add/import/export.
 */

export const FILTER_SCOPES = ['cache', 'allowed', 'blocked'] as const
export type FilterScope = (typeof FILTER_SCOPES)[number]

/** Scope-specific endpoint ids, so the registry stays the single allowlist. */
const LIST_ENDPOINT = { cache: 'cache/list', allowed: 'allowed/list', blocked: 'blocked/list' } as const
const DELETE_ENDPOINT = { cache: 'cache/delete', allowed: 'allowed/delete', blocked: 'blocked/delete' } as const
const FLUSH_ENDPOINT = { cache: 'cache/flush', allowed: 'allowed/flush', blocked: 'blocked/flush' } as const
const ADD_ENDPOINT = { allowed: 'allowed/add', blocked: 'blocked/add' } as const
const IMPORT_ENDPOINT = { allowed: 'allowed/import', blocked: 'blocked/import' } as const
const EXPORT_ENDPOINT = { allowed: 'allowed/export', blocked: 'blocked/export' } as const

/** Body parameter name each import endpoint expects. */
const IMPORT_FIELD = { allowed: 'allowedZones', blocked: 'blockedZones' } as const

export function listTree(scope: FilterScope, params: TreeListParams = {}): Promise<DomainTreeResult> {
  return apiRequest<DomainTreeResult>(LIST_ENDPOINT[scope], { params: { ...params } })
}

/** Evict one cached domain, or remove one allowed/blocked entry. */
export function deleteDomain(scope: FilterScope, domain: string, node?: string): Promise<null> {
  return apiRequest<null>(DELETE_ENDPOINT[scope], { params: { domain, node } })
}

/** Empty the whole scope. Destructive but always recoverable by re-resolving. */
export function flushScope(scope: FilterScope, node?: string): Promise<null> {
  return apiRequest<null>(FLUSH_ENDPOINT[scope], { params: { node } })
}

export type EditableScope = 'allowed' | 'blocked'

export function addDomain(scope: EditableScope, domain: string, node?: string): Promise<null> {
  return apiRequest<null>(ADD_ENDPOINT[scope], { params: { domain, node } })
}

/**
 * Bulk-add from pasted text. The body parameter name differs per scope
 * (`allowedZones` vs `blockedZones`) even though the payload is identical.
 */
export function importDomains(scope: EditableScope, text: string, node?: string): Promise<null> {
  const domains = normalizeZoneList(text)
  return apiRequest<null>(IMPORT_ENDPOINT[scope], {
    method: 'POST',
    params: { node },
    body: { [IMPORT_FIELD[scope]]: serializeZoneList(domains) },
  })
}

/** Downloads the full list as a text file. */
export function exportDomains(scope: EditableScope): Promise<void> {
  return apiDownload(EXPORT_ENDPOINT[scope], {}, `${scope}-zones.txt`)
}
