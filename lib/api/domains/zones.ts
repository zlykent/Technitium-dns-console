import { apiDownload, apiRequest } from '../client'
import type { ConvertibleZoneType, ZoneImportMode, ZoneType } from '../enums'
import type {
  CatalogZoneListResult,
  CreateZoneParams,
  CreateZoneResult,
  SetZoneOptionsParams,
  ZoneListResult,
  ZoneOptions,
  ZonePermissions,
} from '../types/zones'

/**
 * Zone lifecycle: list, create, import, clone, convert, enable/disable, resync,
 * delete, export, plus the per-zone replication options and permissions.
 *
 * Two Technitium quirks the signatures encode deliberately:
 *
 *  - `zones/create` and `zones/import` carry **every parameter in the query
 *    string**; only the optional zone file travels in a multipart body.
 *  - `zones/options/get` answers with the zone under `name`, while the write
 *    side asks for `zone`.
 */

export interface ListZonesParams {
  pageNumber?: number
  zonesPerPage?: number
  /** Substring match on the zone name; empty means "all". */
  filterName?: string
  filterType?: ZoneType | ''
  node?: string
}

export function listZones(params: ListZonesParams = {}): Promise<ZoneListResult> {
  return apiRequest<ZoneListResult>('zones/list', { params: { ...params } })
}

/** Catalog zones only — the target list for the "member of catalog" picker. */
export function listCatalogZones(node?: string): Promise<CatalogZoneListResult> {
  return apiRequest<CatalogZoneListResult>('zones/catalogs/list', { params: { node } })
}

export async function createZone(params: CreateZoneParams): Promise<CreateZoneResult> {
  const { fileImportZone, ...query } = params
  if (fileImportZone) {
    const formData = new FormData()
    formData.append('fileImportZone', fileImportZone)
    return apiRequest<CreateZoneResult>('zones/create', { method: 'POST', params: { ...query }, formData })
  }
  return apiRequest<CreateZoneResult>('zones/create', { method: 'POST', params: { ...query } })
}

export interface ImportZoneParams {
  zone: string
  mode: ZoneImportMode
  /** Pasted zone file text; used when `mode` is `Text`. */
  text?: string
  /** Uploaded zone file; used when `mode` is `File`. */
  file?: File
  /** Replace records that already exist instead of failing. */
  overwrite?: boolean
  /** Replace the whole zone instead of merging into it. */
  overwriteZone?: boolean
  /** Take the SOA serial from the imported file rather than bumping ours. */
  overwriteSoaSerial?: boolean
  node?: string
}

export async function importZone(params: ImportZoneParams): Promise<null> {
  const { mode, text, file, ...query } = params
  if (mode === 'File') {
    if (!file) throw new Error('A zone file is required for a file import.')
    const formData = new FormData()
    formData.append('fileImportZone', file)
    return apiRequest<null>('zones/import', { method: 'POST', params: { ...query }, formData })
  }
  return apiRequest<null>('zones/import', {
    method: 'POST',
    params: { ...query },
    text: { value: text ?? '' },
  })
}

/** One zone or many; the API accepts `zone` for a single name and `zones` for a batch. */
export function deleteZones(zones: readonly string[], node?: string): Promise<null> {
  const single = zones.length === 1
  return apiRequest<null>('zones/delete', {
    params: single ? { zone: zones[0], node } : { zones: zones.join(','), node },
  })
}

export function enableZone(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/enable', { params: { zone, node } })
}

export function disableZone(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/disable', { params: { zone, node } })
}

/** Re-pull a secondary/stub zone from its primaries. */
export function resyncZone(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/resync', { params: { zone, node } })
}

export function cloneZone(zone: string, sourceZone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/clone', { params: { zone, sourceZone, node } })
}

export function convertZone(zone: string, type: ConvertibleZoneType, node?: string): Promise<null> {
  return apiRequest<null>('zones/convert', { params: { zone, type, node } })
}

/** Downloads the zone file; the token never reaches the browser. */
export function exportZone(zone: string, node?: string): Promise<void> {
  return apiDownload('zones/export', { zone, node }, `${zone}.zone`)
}

// ------------------------------------------------------------------- options

export function getZoneOptions(zone: string, node?: string): Promise<ZoneOptions> {
  return apiRequest<ZoneOptions>('zones/options/get', {
    params: { zone, includeAvailableCatalogZoneNames: true, includeAvailableTsigKeyNames: true, node },
  })
}

export function setZoneOptions(params: SetZoneOptionsParams): Promise<null> {
  return apiRequest<null>('zones/options/set', { params: { ...params } })
}

// --------------------------------------------------------------- permissions

export function getZonePermissions(zone: string, includeUsersAndGroups = true, node?: string): Promise<ZonePermissions> {
  return apiRequest<ZonePermissions>('zones/permissions/get', { params: { zone, includeUsersAndGroups, node } })
}

/**
 * `userPermissions` / `groupPermissions` are pipe-delimited rows of four
 * columns (`name|canView|canModify|canDelete`); build them with
 * `serializePermissionTable` from `@/lib/api/types/admin`.
 */
export function setZonePermissions(params: {
  zone: string
  userPermissions: string
  groupPermissions: string
  node?: string
}): Promise<null> {
  return apiRequest<null>('zones/permissions/set', { params: { ...params } })
}
