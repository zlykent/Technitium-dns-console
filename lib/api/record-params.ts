import type { RecordType } from './enums'

/**
 * Per-record-type parameter matrix for `zones/records/{add,update,delete}`.
 *
 * Technitium does not accept a nested `rData` object. Each record type has its
 * own flat parameter names and — crucially — **three different vocabularies**:
 *
 *   add     one value per field.
 *   update  the record's *current* value (to identify it) **and** its
 *           replacement, under a separate name. The naming is inconsistent:
 *           `newIpAddress`, `newAName`, `newTlsaSelector`, but NAPTR alone uses
 *           `naptrNewOrder`. Types with a single canonical instance (SOA, CNAME,
 *           DNAME, APP) send only the new value.
 *   delete  the current value only.
 *
 * Every name below was harvested from the console's own `addRecord` /
 * `updateRecord` / `deleteRecord` switch blocks by
 * `scripts/probe/dump-record-formdata.mjs`; do not retype them by hand.
 */

export type FieldKind = 'text' | 'domain' | 'ip' | 'number' | 'textarea' | 'select' | 'boolean' | 'pem'

export interface RecordField {
  /** Parameter name used by `zones/records/add`. */
  add: string
  /**
   * Parameter carrying the record's current value on `update`/`delete`.
   * `null` means the type has no separate identity slot (SOA, CNAME, DNAME, APP).
   */
  old: string | null
  /** Parameter carrying the replacement value on `update`; equals `add` when there is only one. */
  next: string
  /** Key the value is read back from in `rData`, when it differs from `add`. */
  rData?: string
  kind: FieldKind
  /** Enum id from `lib/api/enums` for `select` fields. */
  enumRef?: string
  required?: boolean
}

export interface RecordTypeSpec {
  type: RecordType
  fields: RecordField[]
}

/** A field whose three vocabularies share one name. */
const p = (name: string, kind: FieldKind, extra: Partial<RecordField> = {}): RecordField => ({
  add: name,
  old: name,
  next: name,
  kind,
  ...extra,
})

/** A field the console renames for the replacement value on `update`. */
const q = (name: string, next: string, kind: FieldKind, extra: Partial<RecordField> = {}): RecordField => ({
  add: name,
  old: name,
  next,
  kind,
  ...extra,
})

/** A field with no identity slot — the server matches on `zone`+`domain`+`type` alone. */
const s = (name: string, kind: FieldKind, extra: Partial<RecordField> = {}): RecordField => ({
  add: name,
  old: null,
  next: name,
  kind,
  ...extra,
})

/** Extra parameters on address records: reverse-zone maintenance and SVCB hints. */
const ADDRESS_EXTRAS: RecordField[] = [
  p('ptr', 'boolean'),
  p('createPtrZone', 'boolean'),
  p('updateSvcbHints', 'boolean'),
]

const SVCB_FIELDS: RecordField[] = [
  q('svcPriority', 'newSvcPriority', 'number', { required: true }),
  q('svcTargetName', 'newSvcTargetName', 'domain', { required: true }),
  q('svcParams', 'newSvcParams', 'text'),
  p('autoIpv4Hint', 'boolean'),
  p('autoIpv6Hint', 'boolean'),
]

export const RECORD_TYPE_SPECS: Record<RecordType, RecordField[]> = {
  A: [p('ipAddress', 'ip', { required: true }), ...ADDRESS_EXTRAS],
  AAAA: [q('ipAddress', 'newIpAddress', 'ip', { required: true }), ...ADDRESS_EXTRAS],
  NS: [q('nameServer', 'newNameServer', 'domain', { required: true }), p('glue', 'textarea')],
  SOA: [
    s('primaryNameServer', 'domain', { required: true }),
    s('responsiblePerson', 'text'),
    s('serial', 'number'),
    s('refresh', 'number'),
    s('retry', 'number'),
    s('expire', 'number'),
    s('minimum', 'number'),
    s('useSerialDateScheme', 'boolean'),
  ],
  CNAME: [s('cname', 'domain', { required: true })],
  PTR: [q('ptrName', 'newPtrName', 'domain', { required: true })],
  MX: [
    q('preference', 'newPreference', 'number', { required: true }),
    q('exchange', 'newExchange', 'domain', { required: true }),
  ],
  TXT: [
    // add takes plain text; update identifies the record by its base64 strings
    { add: 'text', old: 'characterStringsBase64', next: 'newText', kind: 'textarea', required: true },
    { add: 'splitText', old: null, next: 'newSplitText', kind: 'boolean' },
  ],
  RP: [
    q('mailbox', 'newMailbox', 'text', { required: true }),
    q('txtDomain', 'newTxtDomain', 'domain', { required: true }),
  ],
  SRV: [
    q('priority', 'newPriority', 'number', { required: true }),
    q('weight', 'newWeight', 'number', { required: true }),
    q('port', 'newPort', 'number', { required: true }),
    q('target', 'newTarget', 'domain', { required: true }),
  ],
  NAPTR: [
    q('naptrOrder', 'naptrNewOrder', 'number', { rData: 'order', required: true }),
    q('naptrPreference', 'naptrNewPreference', 'number', { rData: 'preference', required: true }),
    q('naptrFlags', 'naptrNewFlags', 'text', { rData: 'flags' }),
    q('naptrServices', 'naptrNewServices', 'text', { rData: 'services' }),
    q('naptrRegexp', 'naptrNewRegexp', 'text', { rData: 'regexp' }),
    q('naptrReplacement', 'naptrNewReplacement', 'domain', { rData: 'replacement' }),
  ],
  DNAME: [s('dname', 'domain', { required: true })],
  DS: [
    q('keyTag', 'newKeyTag', 'number', { required: true }),
    q('algorithm', 'newAlgorithm', 'select', { enumRef: 'DS_ALGORITHMS', required: true }),
    q('digestType', 'newDigestType', 'select', { enumRef: 'DS_DIGEST_TYPES', required: true }),
    q('digest', 'newDigest', 'text', { required: true }),
  ],
  SSHFP: [
    q('sshfpAlgorithm', 'newSshfpAlgorithm', 'select', { enumRef: 'SSHFP_ALGORITHMS', rData: 'algorithm', required: true }),
    q('sshfpFingerprintType', 'newSshfpFingerprintType', 'select', {
      enumRef: 'SSHFP_FINGERPRINT_TYPES',
      rData: 'fingerprintType',
      required: true,
    }),
    q('sshfpFingerprint', 'newSshfpFingerprint', 'text', { rData: 'fingerprint', required: true }),
  ],
  TLSA: [
    q('tlsaCertificateUsage', 'newTlsaCertificateUsage', 'select', {
      enumRef: 'TLSA_CERTIFICATE_USAGES',
      rData: 'certificateUsage',
      required: true,
    }),
    q('tlsaSelector', 'newTlsaSelector', 'select', { enumRef: 'TLSA_SELECTORS', rData: 'selector', required: true }),
    q('tlsaMatchingType', 'newTlsaMatchingType', 'select', {
      enumRef: 'TLSA_MATCHING_TYPES',
      rData: 'matchingType',
      required: true,
    }),
    q('tlsaCertificateAssociationData', 'newTlsaCertificateAssociationData', 'text', {
      rData: 'certificateAssociationData',
      required: true,
    }),
  ],
  SVCB: SVCB_FIELDS,
  HTTPS: SVCB_FIELDS,
  URI: [
    q('uriPriority', 'newUriPriority', 'number', { rData: 'priority', required: true }),
    q('uriWeight', 'newUriWeight', 'number', { rData: 'weight', required: true }),
    q('uri', 'newUri', 'text', { required: true }),
  ],
  CAA: [
    q('flags', 'newFlags', 'number', { required: true }),
    q('tag', 'newTag', 'text', { required: true }),
    q('value', 'newValue', 'text', { required: true }),
  ],
  ANAME: [q('aname', 'newAName', 'domain', { required: true })],
  FWD: [
    q('protocol', 'newProtocol', 'select', { enumRef: 'FORWARDER_PROTOCOLS', required: true }),
    q('forwarder', 'newForwarder', 'text', { required: true }),
    p('forwarderPriority', 'number'),
    p('dnssecValidation', 'boolean'),
    p('proxyType', 'select', { enumRef: 'FORWARDER_PROXY_TYPES' }),
    p('proxyAddress', 'text'),
    p('proxyPort', 'number'),
    p('proxyUsername', 'text'),
    p('proxyPassword', 'text'),
  ],
  APP: [
    s('appName', 'select', { required: true }),
    s('classPath', 'select', { required: true }),
    s('recordData', 'textarea', { rData: 'data' }),
  ],
  Unknown: [q('rdata', 'newRData', 'textarea', { required: true })],
}

/** Fields Technitium itself reads when identifying the record to update. */
export interface RecordMutationBase {
  zone: string
  domain: string
  type: RecordType
  ttl: number
  comments?: string | null
  /** Record-level expiry in seconds; `0` means "never expires". */
  expiryTtl?: number
  node?: string
}

export interface AddRecordParams extends RecordMutationBase {
  /** Replace an identical record instead of failing. */
  overwrite?: boolean
}

export interface UpdateRecordParams extends RecordMutationBase {
  /** Renaming the owner; send the unchanged name when only rData moves. */
  newDomain: string
  disable: boolean
}

export interface DeleteRecordParams {
  zone: string
  domain: string
  type: RecordType
  node?: string
}

export function specFor(type: RecordType): RecordField[] {
  return RECORD_TYPE_SPECS[type] ?? RECORD_TYPE_SPECS.Unknown
}

export function requiredFields(type: RecordType): RecordField[] {
  return specFor(type).filter((field) => field.required)
}

/**
 * Read a field's value out of a fetched record's `rData`.
 *
 * The rData keys do not match the parameter names for the prefixed types
 * (`sshfpAlgorithm` vs `algorithm`, `uriPriority` vs `priority`). TXT is the one
 * genuinely divergent case: the add form wants plain `text`, while `update` and
 * `delete` identify the record by its comma-joined `characterStringsBase64`.
 *
 * @param slot `'form'` prefers the add-side name (what a textarea should show);
 *             `'identity'` prefers the old-value name (what update/delete send).
 */
export function readRecordFieldValue(
  field: RecordField,
  rData: Record<string, unknown> | undefined,
  slot: 'form' | 'identity' = 'form',
): unknown {
  if (!rData) return undefined
  const candidates =
    slot === 'identity'
      ? [field.rData, field.old, field.add]
      : [field.rData, field.add, field.old]

  for (const key of candidates.filter((k): k is string => Boolean(k))) {
    if (key in rData) return rData[key]
    const lower = key.toLowerCase()
    for (const [k, v] of Object.entries(rData)) {
      if (k.toLowerCase() === lower) return v
    }
  }

  // TXT: rebuild plain text from the character strings when only base64 came back
  if (slot === 'form' && field.add === 'text' && Array.isArray(rData.characterStrings)) {
    return rData.characterStrings.join('')
  }
  return undefined
}

/** Coerce a form value into what the API expects for this field kind. */
export function encodeFieldValue(field: RecordField, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    // booleans must still be sent so an unchecked box clears the flag
    return field.kind === 'boolean' ? 'false' : undefined
  }
  if (field.kind === 'boolean') return value === true || value === 'true' ? 'true' : 'false'
  if (Array.isArray(value)) return value.map((v) => String(v)).join(',')
  return String(value)
}

/**
 * Build the type-specific half of the body for `zones/records/add`.
 * `values` is keyed by the field's `add` parameter name.
 */
export function buildAddFields(type: RecordType, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of specFor(type)) {
    const encoded = encodeFieldValue(field, values[field.add])
    if (encoded !== undefined) out[field.add] = encoded
  }
  return out
}

/**
 * Build the type-specific half of the body for `zones/records/update`: the
 * current value under its identity name plus the replacement under its `next`
 * name. `current` comes from the fetched record, `values` from the form.
 */
export function buildUpdateFields(
  type: RecordType,
  values: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of specFor(type)) {
    if (field.old) {
      const existing = readRecordFieldValue(field, current, 'identity')
      const encodedExisting = encodeFieldValue(field, existing)
      if (encodedExisting !== undefined) out[field.old] = encodedExisting
    }
    const encoded = encodeFieldValue(field, values[field.add])
    // SOA/CNAME/DNAME/APP carry no identity slot, so `next` doubles as the value
    if (encoded !== undefined) out[field.next] = encoded
  }
  return out
}

/** Build the identity half of the body for `zones/records/delete`. */
export function buildDeleteFields(type: RecordType, current: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of specFor(type)) {
    if (!field.old) continue
    const encoded = encodeFieldValue(field, readRecordFieldValue(field, current, 'identity'))
    if (encoded !== undefined) out[field.old] = encoded
  }
  return out
}
