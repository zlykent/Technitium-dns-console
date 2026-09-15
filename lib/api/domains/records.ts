import { apiRequest } from '../client'
import type { RecordType } from '../enums'
import {
  buildAddFields,
  buildDeleteFields,
  buildUpdateFields,
  type AddRecordParams,
  type DeleteRecordParams,
  type UpdateRecordParams,
} from '../record-params'
import type { DnsRecord, RecordListResult } from '../types/zones'

/**
 * Record CRUD.
 *
 * All three mutations are POSTs with a form-encoded body whose parameter names
 * differ per record type and per operation — see `lib/api/record-params.ts` for
 * the harvested matrix. Only `node` goes in the query string.
 *
 * `update` and `delete` identify the record by its **current** values rather
 * than by an index, so callers pass the fetched `DnsRecord` alongside the new
 * values. That is also why a rename is expressed as `domain` (old) plus
 * `newDomain`.
 */

export interface GetRecordsParams {
  /** Owner name to list; omit or pass the zone name for the apex. */
  domain?: string
  /** Also return the zone's own metadata alongside the records. */
  listZone?: boolean
  zone?: string
  node?: string
}

export function getRecords(params: GetRecordsParams): Promise<RecordListResult> {
  return apiRequest<RecordListResult>('zones/records/get', { params: { ...params } })
}

/**
 * Form values keyed by each field's `add` parameter name, e.g.
 * `{ ipAddress: '10.0.0.1', ptr: false }`. Build the form from
 * `RECORD_TYPE_SPECS` so the keys can never drift from the API.
 */
export type RecordFormValues = Record<string, unknown>

export function addRecord(params: AddRecordParams, values: RecordFormValues): Promise<{ addedRecord?: DnsRecord }> {
  const { node, ...rest } = params
  return apiRequest('zones/records/add', {
    method: 'POST',
    params: { node },
    body: {
      ...rest,
      ttl: rest.ttl ?? 0,
      overwrite: rest.overwrite ?? false,
      comments: rest.comments ?? '',
      expiryTtl: rest.expiryTtl ?? 0,
      ...buildAddFields(rest.type, values),
    },
  })
}

export function updateRecord(
  params: UpdateRecordParams,
  values: RecordFormValues,
  current: DnsRecord,
): Promise<{ updatedRecord?: DnsRecord }> {
  const { node, ...rest } = params
  return apiRequest('zones/records/update', {
    method: 'POST',
    params: { node },
    body: {
      ...rest,
      ttl: rest.ttl ?? current.ttl,
      disable: rest.disable ?? current.disabled,
      comments: rest.comments ?? current.comments ?? '',
      expiryTtl: rest.expiryTtl ?? current.expiryTtl ?? 0,
      ...buildUpdateFields(rest.type, values, current.rData as Record<string, unknown>),
    },
  })
}

/**
 * Enable or disable without touching rData.
 *
 * The console implements this as a full `update` carrying the record's identity
 * fields and the new `disable` flag; there is no dedicated endpoint.
 */
export function setRecordState(record: DnsRecord, zone: string, disable: boolean, node?: string): Promise<null> {
  return apiRequest<null>('zones/records/update', {
    method: 'POST',
    params: { node },
    body: {
      zone,
      type: record.type,
      domain: record.name,
      newDomain: record.name,
      ttl: record.ttl,
      disable,
      comments: record.comments ?? '',
      expiryTtl: record.expiryTtl ?? 0,
      ...buildDeleteFields(record.type, record.rData as Record<string, unknown>),
    },
  })
}

export function deleteRecord(params: DeleteRecordParams, current: DnsRecord): Promise<null> {
  const { node, ...rest } = params
  return apiRequest<null>('zones/records/delete', {
    method: 'POST',
    params: { node },
    body: {
      ...rest,
      ...buildDeleteFields(rest.type, current.rData as Record<string, unknown>),
    },
  })
}

/** Every type the add-record form can produce, for the type picker. */
export const WRITABLE_RECORD_TYPES: readonly RecordType[] = [
  'A', 'AAAA', 'NS', 'SOA', 'CNAME', 'PTR', 'MX', 'TXT', 'RP', 'SRV', 'NAPTR',
  'DNAME', 'DS', 'SSHFP', 'TLSA', 'SVCB', 'HTTPS', 'URI', 'CAA', 'ANAME', 'FWD', 'APP', 'Unknown',
]
