import { apiRequest } from '../client'
import type {
  AddPrivateKeyParams,
  DnssecProperties,
  DsRecordView,
  Nsec3Params,
  SignZoneParams,
  UpdateDnsKeyTtlParams,
  UpdatePrivateKeyParams,
  ZoneKeyParams,
} from '../types/dnssec'

/**
 * DNSSEC: signing, key management and DS publication.
 *
 * Every one of these is a GET that mutates — Technitium's convention, recorded
 * faithfully in the registry. All take `zone` plus, for key operations, `keyTag`.
 */

export function signZone(params: SignZoneParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/sign', { params: { ...params } })
}

export function unsignZone(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/dnssec/unsign', { params: { zone, node } })
}

/**
 * The DS records to paste at the registrar / parent zone.
 * Fails with `upstream_error` while the zone is unsigned.
 */
export function viewDsRecords(zone: string, node?: string): Promise<DsRecordView> {
  return apiRequest<DsRecordView>('zones/dnssec/viewDS', { params: { zone, node } })
}

// --------------------------------------------------------------- properties

export function getDnssecProperties(zone: string, node?: string): Promise<DnssecProperties> {
  return apiRequest<DnssecProperties>('zones/dnssec/properties/get', { params: { zone, node } })
}

export function addPrivateKey(params: AddPrivateKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/addPrivateKey', { params: { ...params } })
}

export function updatePrivateKey(params: UpdatePrivateKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/updatePrivateKey', { params: { ...params } })
}

export function deletePrivateKey(params: ZoneKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/deletePrivateKey', { params: { ...params } })
}

/** Publishes every generated key as a DNSKEY record so resolvers can see it. */
export function publishAllPrivateKeys(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/publishAllPrivateKeys', { params: { zone, node } })
}

export function updateDnsKeyTtl(params: UpdateDnsKeyTtlParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/updateDnsKeyTtl', { params: { ...params } })
}

// ---------------------------------------------------------------- key state

/** Move a published KSK to Active — the step after the parent has the DS. */
export function activateKskDnsKey(params: ZoneKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/activateKskDnsKey', { params: { ...params } })
}

/** Start retiring a key; it stays published until the DS TTL has drained. */
export function retireDnsKey(params: ZoneKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/retireDnsKey', { params: { ...params } })
}

/** Retire the current key and generate its replacement in one step. */
export function rolloverDnsKey(params: ZoneKeyParams): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/rolloverDnsKey', { params: { ...params } })
}

// -------------------------------------------------------------------- NSEC3

export function convertToNsec(zone: string, node?: string): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/convertToNSEC', { params: { zone, node } })
}

export function convertToNsec3(params: Nsec3Params): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/convertToNSEC3', { params: { ...params } })
}

export function updateNsec3Params(params: Nsec3Params): Promise<null> {
  return apiRequest<null>('zones/dnssec/properties/updateNSEC3Params', { params: { ...params } })
}
