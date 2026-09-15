import type { RecordType } from '../enums'
import type { RecordRData } from './zones'

/**
 * Cache / Allowed / Blocked.
 *
 * All three return the same lazy tree envelope: a `domain` you are currently
 * looking at, the `zones` beneath it, and any `records` at that exact name. You
 * navigate by passing the child domain as the next `domain`, or `direction=up`
 * to go to the parent.
 *
 * The stock console renders `records` with `JSON.stringify` into a `<pre>`. We
 * type them as `TreeRecord[]` and render them properly, which is one of the
 * places this UI is a genuine step up.
 */

export interface DomainTreeResult {
  /** The node being listed; empty string at the root. */
  domain: string
  /** Child domain names. */
  zones: string[]
  /** Records stored at exactly `domain`. */
  records: TreeRecord[]
}

/**
 * A record inside the cache/allowed/blocked tree.
 *
 * This is deliberately NOT the authoritative `DnsRecord` shape from
 * `zones/records/get`. Upstream serialises all three scopes through
 * `WriteRecordsAsJson(records, jsonWriter, authoritativeZoneRecords)` where the
 * flag is **false for cache** and **true for allowed/blocked** — and that flag
 * changes the wire shape:
 *
 *  - `ttl` is a pre-rendered *string* (`"300 (5m)"`, or `"0 (0s)"` once the
 *    entry is stale) on the cache side, but a *number* plus a separate
 *    `ttlString` on the authoritative side. Feeding the cache string to
 *    `formatTtl` `Number()`-coerces it to `NaN` and renders an empty cell, so
 *    the union is modelled explicitly here.
 *  - `disabled`, `comments`, `expiryTtl(String)`, `lastModified`, `lastUsedOn`
 *    exist only for allowed/blocked.
 *  - `eDnsClientSubnet` and `dnssecRecords` exist only for cache.
 *  - `glueRecords` are RDATA *strings* on both sides (upstream writes
 *    `glueRecord.RDATA.ToString()`), not nested records.
 */
export interface TreeRecord {
  name: string
  /** Punycode-decoded name; present only when `name` is an IDN. */
  nameIdn?: string
  type: RecordType
  /** Authoritative (allowed/blocked): seconds. Cache: pre-rendered `"300 (5m)"`. */
  ttl: number | string
  /** Authoritative only. */
  ttlString?: string
  /** Authoritative only. */
  disabled?: boolean
  /** Authoritative only. */
  comments?: string | null
  /** Authoritative only: record-level expiry TTL. */
  expiryTtl?: number | null
  /** Authoritative only. */
  expiryTtlString?: string | null
  /** Authoritative only. */
  lastModified?: string
  /** Authoritative only; null when the record was never served. */
  lastUsedOn?: string | null
  /** Both shapes: `Signed`, `Unsigned`, `NSEC3`, … */
  dnssecStatus?: string
  rData: RecordRData
  /** Both shapes: glue as RDATA strings. */
  glueRecords?: string[]
  /** Cache only: RRSIG/NSEC strings carried alongside the cached answer. */
  dnssecRecords?: string[]
  /** Cache only: the EDNS Client Subnet the answer was cached for. */
  eDnsClientSubnet?: string
}

/** `direction` is only ever `up`; anything else means "list this domain". */
export type TreeDirection = 'up' | null

export interface TreeListParams {
  domain?: string
  direction?: TreeDirection
  node?: string
}

export interface DomainActionParams {
  domain: string
  node?: string
}

/** `allowed/import` and `blocked/import` take newline/comma text, not a file. */
export interface ImportZoneListParams {
  /** One domain per line (commas also accepted upstream). */
  zones: string
  node?: string
}

/** Split pasted text into a clean domain list, mirroring `cleanTextList`. */
export function normalizeZoneList(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((line) => line.trim().replace(/^\./, ''))
    .filter(Boolean)
}

/** Join a domain list back into the text form the server expects. */
export function serializeZoneList(domains: readonly string[]): string {
  return domains.join(',')
}

/** `example.com` -> `com`; the root has no parent. */
export function parentDomain(domain: string): string {
  const idx = domain.indexOf('.')
  if (idx < 0) return ''
  return domain.slice(idx + 1)
}

export function domainLabel(domain: string): string {
  if (!domain) return '.'
  const idx = domain.indexOf('.')
  return idx < 0 ? domain : domain.slice(0, idx)
}
