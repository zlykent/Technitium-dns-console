import { describe, expect, it } from 'vitest'
import {
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
  RECORD_TYPES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_MATCHING_TYPES,
  TLSA_SELECTORS,
  type RecordType,
} from '@/lib/api/enums'
import {
  RECORD_TYPE_SPECS,
  buildAddFields,
  buildDeleteFields,
  buildUpdateFields,
  encodeFieldValue,
  readRecordFieldValue,
  requiredFields,
  specFor,
  type FieldKind,
  type RecordField,
} from '@/lib/api/record-params'

/**
 * The parameter-assembly layer for DNS record CRUD.
 *
 * Technitium identifies a record on `update` and `delete` by its *current*
 * rData, spelled in a per-type parameter vocabulary that differs from the one
 * `add` uses — and from the one `rData` comes back in. Three vocabularies, one
 * record, no compiler help. A wrong name here does not fail loudly: the server
 * simply does not find the record (delete/update silently no-ops) or, worse,
 * finds a *different* one and rewrites it. Zone data is corrupted with no error
 * on either side.
 *
 * These tests therefore pin two things that are easy to break while refactoring
 * and impossible to notice in a code review:
 *
 *  1. the exact wire parameter set for every one of the 23 record types, on all
 *     three operations, computed from a fixture rData plus a changed form;
 *  2. the cross-function invariants — `update` and `delete` must agree on the
 *     identity half, `add` and `update` must agree on the replacement half, and
 *     no output key may ever be an rData alias (`order`, `algorithm`) or a
 *     caller-supplied key that is not part of the spec.
 *
 * The layer deliberately does no validation and no trimming: that belongs to the
 * form. The negative tests assert the pass-through so a future "helpful"
 * normalisation here shows up as a diff rather than as mangled zone data.
 */

const FIELD_KINDS: readonly FieldKind[] = ['text', 'domain', 'ip', 'number', 'textarea', 'select', 'boolean', 'pem']

/** Every `enumRef` used by the spec, resolved, so a renamed enum fails here. */
const ENUM_REFS: Record<string, readonly string[]> = {
  DS_ALGORITHMS,
  DS_DIGEST_TYPES,
  SSHFP_ALGORITHMS,
  SSHFP_FINGERPRINT_TYPES,
  TLSA_CERTIFICATE_USAGES,
  TLSA_SELECTORS,
  TLSA_MATCHING_TYPES,
  FORWARDER_PROTOCOLS,
  FORWARDER_PROXY_TYPES,
}

/** Types whose every field has no identity slot: the server matches on names alone. */
const IDENTITY_LESS_TYPES: readonly RecordType[] = ['SOA', 'CNAME', 'DNAME', 'APP']

function fieldNames(fields: RecordField[], pick: 'add' | 'old' | 'next'): string[] {
  return fields.map((f) => f[pick]).filter((n): n is string => n !== null)
}

/** Parameters that cannot express "old differs from new" because both share a name. */
function collapsedFields(type: RecordType): string[] {
  return specFor(type)
    .filter((f) => f.old !== null && f.old === f.next)
    .map((f) => f.add)
}

interface Fixture {
  type: RecordType
  /** rData exactly as `zones/records/get` returns it. */
  rData: Record<string, unknown>
  /** What the edit form submits after the operator changed one value. */
  values: Record<string, unknown>
  /** Full expected `buildAddFields` output, when present. */
  add?: Record<string, string>
  /** Full expected `buildUpdateFields` output, when present. */
  update?: Record<string, string>
  /** Full expected `buildDeleteFields` output, when present. */
  del?: Record<string, string>
}

/** One fixture per record type; the high-risk ones carry fully spelled-out output. */
const FIXTURES: Fixture[] = [
  {
    type: 'A',
    rData: { ipAddress: '10.0.0.1' },
    values: { ipAddress: '10.0.0.9', ptr: true },
    add: { ipAddress: '10.0.0.9', ptr: 'true', createPtrZone: 'false', updateSvcbHints: 'false' },
    update: { ipAddress: '10.0.0.9', ptr: 'true', createPtrZone: 'false', updateSvcbHints: 'false' },
    del: { ipAddress: '10.0.0.1', ptr: 'false', createPtrZone: 'false', updateSvcbHints: 'false' },
  },
  {
    type: 'AAAA',
    rData: { ipAddress: '2001:db8::1' },
    values: { ipAddress: '2001:db8::9', createPtrZone: true },
    add: { ipAddress: '2001:db8::9', ptr: 'false', createPtrZone: 'true', updateSvcbHints: 'false' },
    update: {
      ipAddress: '2001:db8::1',
      newIpAddress: '2001:db8::9',
      ptr: 'false',
      createPtrZone: 'true',
      updateSvcbHints: 'false',
    },
    del: { ipAddress: '2001:db8::1', ptr: 'false', createPtrZone: 'false', updateSvcbHints: 'false' },
  },
  {
    type: 'NS',
    rData: { nameServer: 'ns1.example.com' },
    values: { nameServer: 'ns2.example.com', glue: 'ns2.example.com 10.0.0.2' },
  },
  {
    type: 'SOA',
    rData: {
      primaryNameServer: 'ns1.example.com',
      responsiblePerson: 'admin.example.com',
      serial: 2026010101,
      refresh: 3600,
      retry: 600,
      expire: 86400,
      minimum: 3600,
      useSerialDateScheme: true,
    },
    values: {
      primaryNameServer: 'ns1.example.com',
      responsiblePerson: 'admin.example.com',
      serial: 2026010102,
      refresh: 3600,
      retry: 600,
      expire: 86400,
      minimum: 3600,
      useSerialDateScheme: true,
    },
    add: {
      primaryNameServer: 'ns1.example.com',
      responsiblePerson: 'admin.example.com',
      serial: '2026010102',
      refresh: '3600',
      retry: '600',
      expire: '86400',
      minimum: '3600',
      useSerialDateScheme: 'true',
    },
    update: {
      primaryNameServer: 'ns1.example.com',
      responsiblePerson: 'admin.example.com',
      serial: '2026010102',
      refresh: '3600',
      retry: '600',
      expire: '86400',
      minimum: '3600',
      useSerialDateScheme: 'true',
    },
    del: {},
  },
  {
    type: 'CNAME',
    // Trailing root dot: the layer must not add or strip it, or the identity no
    // longer matches what the server stored.
    rData: { cname: 'target.example.com.' },
    values: { cname: 'other.example.com.' },
    add: { cname: 'other.example.com.' },
    update: { cname: 'other.example.com.' },
    del: {},
  },
  {
    type: 'PTR',
    rData: { ptrName: 'host.example.com' },
    values: { ptrName: 'other.example.com' },
  },
  {
    type: 'MX',
    rData: { preference: 10, exchange: 'mx1.example.com' },
    values: { preference: 0, exchange: 'mx2.example.com' },
    add: { preference: '0', exchange: 'mx2.example.com' },
    update: {
      preference: '10',
      newPreference: '0',
      exchange: 'mx1.example.com',
      newExchange: 'mx2.example.com',
    },
    del: { preference: '10', exchange: 'mx1.example.com' },
  },
  {
    type: 'TXT',
    rData: {
      text: 'v=spf1 -all',
      characterStrings: ['v=spf1 -all'],
      characterStringsBase64: ['dj1zcGYxIC1hbGw='],
    },
    values: { text: 'v=spf1 include:_spf.example.com -all', splitText: false },
    add: { text: 'v=spf1 include:_spf.example.com -all', splitText: 'false' },
    update: {
      characterStringsBase64: 'dj1zcGYxIC1hbGw=',
      newText: 'v=spf1 include:_spf.example.com -all',
      newSplitText: 'false',
    },
    del: { characterStringsBase64: 'dj1zcGYxIC1hbGw=' },
  },
  {
    type: 'RP',
    rData: { mailbox: 'admin.example.com', txtDomain: 'txt.example.com' },
    values: { mailbox: 'ops.example.com', txtDomain: 'txt.example.com' },
  },
  {
    type: 'SRV',
    rData: { priority: 10, weight: 20, port: 5060, target: 'sip.example.com' },
    values: { priority: 10, weight: 30, port: 5061, target: 'sip.example.com' },
  },
  {
    type: 'NAPTR',
    // rData keys are unprefixed (`order`), the wire keys are prefixed
    // (`naptrOrder`), and the replacement uses a third shape (`naptrNewOrder`).
    rData: {
      order: 100,
      preference: 10,
      flags: 'S',
      services: 'SIP+D2U',
      regexp: '',
      replacement: '_sip._udp.example.com',
    },
    values: {
      naptrOrder: 100,
      naptrPreference: 20,
      naptrFlags: 'S',
      naptrServices: 'SIP+D2T',
      naptrRegexp: '',
      naptrReplacement: '_sip._tcp.example.com',
    },
    add: {
      naptrOrder: '100',
      naptrPreference: '20',
      naptrFlags: 'S',
      naptrServices: 'SIP+D2T',
      naptrReplacement: '_sip._tcp.example.com',
    },
    update: {
      naptrOrder: '100',
      naptrNewOrder: '100',
      naptrPreference: '10',
      naptrNewPreference: '20',
      naptrFlags: 'S',
      naptrNewFlags: 'S',
      naptrServices: 'SIP+D2U',
      naptrNewServices: 'SIP+D2T',
      naptrReplacement: '_sip._udp.example.com',
      naptrNewReplacement: '_sip._tcp.example.com',
    },
    del: {
      naptrOrder: '100',
      naptrPreference: '10',
      naptrFlags: 'S',
      naptrServices: 'SIP+D2U',
      naptrReplacement: '_sip._udp.example.com',
    },
  },
  {
    type: 'DNAME',
    rData: { dname: 'target.example.com' },
    values: { dname: 'other.example.com' },
  },
  {
    type: 'DS',
    rData: { keyTag: 12345, algorithm: 'RSASHA256', digestType: 'SHA256', digest: 'ABCDEF0123' },
    values: { keyTag: 12345, algorithm: 'ECDSAP256SHA256', digestType: 'SHA256', digest: 'ABCDEF0123' },
  },
  {
    type: 'SSHFP',
    rData: { algorithm: 'RSA', fingerprintType: 'SHA256', fingerprint: 'ABCDEF0123456789' },
    values: {
      sshfpAlgorithm: 'ECDSA',
      sshfpFingerprintType: 'SHA256',
      sshfpFingerprint: 'ABCDEF0123456789',
    },
    add: {
      sshfpAlgorithm: 'ECDSA',
      sshfpFingerprintType: 'SHA256',
      sshfpFingerprint: 'ABCDEF0123456789',
    },
    update: {
      sshfpAlgorithm: 'RSA',
      newSshfpAlgorithm: 'ECDSA',
      sshfpFingerprintType: 'SHA256',
      newSshfpFingerprintType: 'SHA256',
      sshfpFingerprint: 'ABCDEF0123456789',
      newSshfpFingerprint: 'ABCDEF0123456789',
    },
    del: {
      sshfpAlgorithm: 'RSA',
      sshfpFingerprintType: 'SHA256',
      sshfpFingerprint: 'ABCDEF0123456789',
    },
  },
  {
    type: 'TLSA',
    rData: {
      certificateUsage: 'DANE-EE',
      selector: 'SPKI',
      matchingType: 'SHA2-256',
      certificateAssociationData: 'AABBCCDD',
    },
    values: {
      tlsaCertificateUsage: 'DANE-EE',
      tlsaSelector: 'Cert',
      tlsaMatchingType: 'SHA2-256',
      tlsaCertificateAssociationData: 'AABBCCDD',
    },
  },
  {
    type: 'SVCB',
    rData: {
      svcPriority: 1,
      svcTargetName: 'svc.example.com',
      svcParams: 'alpn=h2',
      autoIpv4Hint: true,
      autoIpv6Hint: false,
    },
    values: {
      svcPriority: 2,
      svcTargetName: 'svc.example.com',
      svcParams: 'alpn=h3',
      autoIpv4Hint: false,
    },
    add: {
      svcPriority: '2',
      svcTargetName: 'svc.example.com',
      svcParams: 'alpn=h3',
      autoIpv4Hint: 'false',
      autoIpv6Hint: 'false',
    },
    update: {
      svcPriority: '1',
      newSvcPriority: '2',
      svcTargetName: 'svc.example.com',
      newSvcTargetName: 'svc.example.com',
      svcParams: 'alpn=h2',
      newSvcParams: 'alpn=h3',
      autoIpv4Hint: 'false',
      autoIpv6Hint: 'false',
    },
    del: {
      svcPriority: '1',
      svcTargetName: 'svc.example.com',
      svcParams: 'alpn=h2',
      autoIpv4Hint: 'true',
      autoIpv6Hint: 'false',
    },
  },
  {
    type: 'HTTPS',
    rData: {
      svcPriority: 1,
      svcTargetName: 'www.example.com',
      svcParams: 'alpn=h2',
      autoIpv4Hint: true,
      autoIpv6Hint: true,
    },
    values: {
      svcPriority: 1,
      svcTargetName: 'www.example.com',
      svcParams: 'alpn=h2,h3',
      autoIpv4Hint: true,
      autoIpv6Hint: true,
    },
  },
  {
    type: 'URI',
    rData: { priority: 10, weight: 1, uri: 'https://old.example.com' },
    values: { uriPriority: 10, uriWeight: 1, uri: 'https://new.example.com' },
    add: { uriPriority: '10', uriWeight: '1', uri: 'https://new.example.com' },
    update: {
      uriPriority: '10',
      newUriPriority: '10',
      uriWeight: '1',
      newUriWeight: '1',
      uri: 'https://old.example.com',
      newUri: 'https://new.example.com',
    },
    del: { uriPriority: '10', uriWeight: '1', uri: 'https://old.example.com' },
  },
  {
    type: 'CAA',
    // `flags: 0` is a real value (non-critical) and must survive encoding.
    rData: { flags: 0, tag: 'issue', value: 'letsencrypt.org' },
    values: { flags: 0, tag: 'issuewild', value: 'letsencrypt.org' },
    add: { flags: '0', tag: 'issuewild', value: 'letsencrypt.org' },
    update: {
      flags: '0',
      newFlags: '0',
      tag: 'issue',
      newTag: 'issuewild',
      value: 'letsencrypt.org',
      newValue: 'letsencrypt.org',
    },
    del: { flags: '0', tag: 'issue', value: 'letsencrypt.org' },
  },
  {
    type: 'ANAME',
    rData: { aname: 'target.example.com' },
    values: { aname: 'other.example.com' },
  },
  {
    type: 'FWD',
    rData: {
      protocol: 'Tcp',
      forwarder: '10.0.0.53',
      forwarderPriority: 1,
      dnssecValidation: false,
      proxyType: 'NoProxy',
      proxyAddress: '',
      proxyPort: 0,
      proxyUsername: '',
      proxyPassword: '',
    },
    values: {
      protocol: 'Tls',
      forwarder: '10.0.0.53',
      forwarderPriority: 2,
      dnssecValidation: true,
      proxyType: 'Http',
      proxyAddress: 'proxy.example.com',
      proxyPort: 8080,
      proxyUsername: 'ops',
      proxyPassword: 's3cret',
    },
    add: {
      protocol: 'Tls',
      forwarder: '10.0.0.53',
      forwarderPriority: '2',
      dnssecValidation: 'true',
      proxyType: 'Http',
      proxyAddress: 'proxy.example.com',
      proxyPort: '8080',
      proxyUsername: 'ops',
      proxyPassword: 's3cret',
    },
    update: {
      protocol: 'Tcp',
      newProtocol: 'Tls',
      forwarder: '10.0.0.53',
      newForwarder: '10.0.0.53',
      forwarderPriority: '2',
      dnssecValidation: 'true',
      proxyType: 'Http',
      proxyAddress: 'proxy.example.com',
      proxyPort: '8080',
      proxyUsername: 'ops',
      proxyPassword: 's3cret',
    },
    del: {
      protocol: 'Tcp',
      forwarder: '10.0.0.53',
      forwarderPriority: '1',
      dnssecValidation: 'false',
      proxyType: 'NoProxy',
      proxyPort: '0',
    },
  },
  {
    type: 'APP',
    rData: {
      appName: 'Block Page App',
      classPath: 'Technitium.Dns.Server.Apps.BlockPageApp',
      data: '{"blockPage":"old"}',
    },
    values: {
      appName: 'Block Page App',
      classPath: 'Technitium.Dns.Server.Apps.BlockPageApp',
      recordData: '{"blockPage":"new"}',
    },
    add: {
      appName: 'Block Page App',
      classPath: 'Technitium.Dns.Server.Apps.BlockPageApp',
      recordData: '{"blockPage":"new"}',
    },
    update: {
      appName: 'Block Page App',
      classPath: 'Technitium.Dns.Server.Apps.BlockPageApp',
      recordData: '{"blockPage":"new"}',
    },
    del: {},
  },
  {
    type: 'Unknown',
    rData: { rdata: 'AAEC' },
    values: { rdata: 'AAEE' },
    add: { rdata: 'AAEE' },
    update: { rdata: 'AAEC', newRData: 'AAEE' },
    del: { rdata: 'AAEC' },
  },
]

const FORBIDDEN_VALUES = ['', 'undefined', 'null', '[object Object]', 'NaN'] as readonly string[]

describe('RECORD_TYPE_SPECS structure', () => {
  it('has one spec per record type the enum declares', () => {
    expect(Object.keys(RECORD_TYPE_SPECS).sort()).toEqual([...RECORD_TYPES].sort())
    expect(Object.keys(RECORD_TYPE_SPECS)).toHaveLength(RECORD_TYPES.length)
  })

  it('gives every type at least one field and every field a usable shape', () => {
    for (const type of RECORD_TYPES) {
      const fields = RECORD_TYPE_SPECS[type]
      expect(fields.length, `${type} has no fields`).toBeGreaterThan(0)
      for (const field of fields) {
        const where = `${type}.${field.add}`
        expect(typeof field.add, where).toBe('string')
        expect(field.add.length, where).toBeGreaterThan(0)
        expect(typeof field.next, where).toBe('string')
        expect(field.next.length, where).toBeGreaterThan(0)
        expect(field.old === null || (typeof field.old === 'string' && field.old.length > 0), where).toBe(true)
        expect(FIELD_KINDS, `${where} has kind '${field.kind}'`).toContain(field.kind)
      }
    }
  })

  it('never reuses one parameter name for two fields of the same type', () => {
    // A collision would make the later field overwrite the earlier one in the
    // body map, silently dropping a value.
    for (const type of RECORD_TYPES) {
      const fields = RECORD_TYPE_SPECS[type]
      for (const pick of ['add', 'old', 'next'] as const) {
        const names = fieldNames(fields, pick)
        expect(new Set(names).size, `${type}.${pick} has a duplicate`).toBe(names.length)
      }
    }
  })

  it('treats HTTPS as an alias of SVCB', () => {
    expect(RECORD_TYPE_SPECS.HTTPS).toEqual(RECORD_TYPE_SPECS.SVCB)
    expect(fieldNames(RECORD_TYPE_SPECS.HTTPS, 'next')).toEqual([
      'newSvcPriority',
      'newSvcTargetName',
      'newSvcParams',
      'autoIpv4Hint',
      'autoIpv6Hint',
    ])
  })

  it('gives both address records the reverse-zone and SVCB-hint extras', () => {
    for (const type of ['A', 'AAAA'] as const) {
      expect(fieldNames(RECORD_TYPE_SPECS[type], 'add')).toEqual(
        expect.arrayContaining(['ptr', 'createPtrZone', 'updateSvcbHints']),
      )
    }
  })

  it('leaves exactly the single-instance types without an identity slot', () => {
    for (const type of RECORD_TYPES) {
      const identityLess = RECORD_TYPE_SPECS[type].every((field) => field.old === null)
      expect(identityLess, `${type} identity-less`).toBe(IDENTITY_LESS_TYPES.includes(type))
    }
  })

  it('marks TXT splitText as the one non-identity boolean beside the s() types', () => {
    const splitText = RECORD_TYPE_SPECS.TXT.find((f) => f.add === 'splitText')
    expect(splitText).toMatchObject({ add: 'splitText', old: null, next: 'newSplitText', kind: 'boolean' })
  })

  it('points every select field at an enum that still exists', () => {
    for (const type of RECORD_TYPES) {
      for (const field of RECORD_TYPE_SPECS[type]) {
        if (field.kind !== 'select') {
          expect(field.enumRef, `${type}.${field.add} is not a select`).toBeUndefined()
          continue
        }
        if (field.add === 'appName' || field.add === 'classPath') continue // free-form app picker
        const ref = field.enumRef
        expect(ref, `${type}.${field.add} has no enumRef`).toBeDefined()
        const values = ENUM_REFS[ref as string]
        expect(values, `${type}.${field.add} references unknown enum '${ref}'`).toBeDefined()
        expect(values.length, `${ref} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('names every rData alias exactly once per prefixed type', () => {
    expect(RECORD_TYPE_SPECS.NAPTR.map((f) => f.rData)).toEqual([
      'order',
      'preference',
      'flags',
      'services',
      'regexp',
      'replacement',
    ])
    expect(RECORD_TYPE_SPECS.SSHFP.map((f) => f.rData)).toEqual(['algorithm', 'fingerprintType', 'fingerprint'])
    expect(RECORD_TYPE_SPECS.URI.map((f) => f.rData)).toEqual(['priority', 'weight', undefined])
    expect(RECORD_TYPE_SPECS.APP.find((f) => f.add === 'recordData')?.rData).toBe('data')
  })
})

describe('specFor / requiredFields', () => {
  it('returns the declared spec for a known type', () => {
    expect(specFor('MX')).toBe(RECORD_TYPE_SPECS.MX)
    expect(specFor('Unknown')).toBe(RECORD_TYPE_SPECS.Unknown)
  })

  it('falls back to the Unknown spec for a type the enum does not declare', () => {
    // A future Technitium release adds a type; the UI must still be able to show
    // and re-submit the raw rData rather than crash the editor.
    const future = 'WALLET' as unknown as RecordType
    expect(specFor(future)).toBe(RECORD_TYPE_SPECS.Unknown)
    expect(requiredFields(future)).toEqual(RECORD_TYPE_SPECS.Unknown.filter((f) => f.required))
  })

  it('reports the required add parameters for a type', () => {
    expect(requiredFields('A').map((f) => f.add)).toEqual(['ipAddress'])
    expect(requiredFields('SRV').map((f) => f.add)).toEqual(['priority', 'weight', 'port', 'target'])
    expect(requiredFields('TXT').map((f) => f.add)).toEqual(['text'])
  })

  it('requires at least one field for every type, so a blank form is always caught', () => {
    for (const type of RECORD_TYPES) {
      expect(requiredFields(type).length, `${type} has no required field`).toBeGreaterThan(0)
      for (const field of requiredFields(type)) {
        expect(specFor(type), `${type}.${field.add} is not in the spec`).toContain(field)
      }
    }
  })

  it('requires nothing on the types whose values are all optional', () => {
    expect(requiredFields('FWD').map((f) => f.add)).toEqual(['protocol', 'forwarder'])
  })
})

describe('encodeFieldValue', () => {
  const bool: RecordField = { add: 'ptr', old: 'ptr', next: 'ptr', kind: 'boolean' }
  const text: RecordField = { add: 'tag', old: 'tag', next: 'tag', kind: 'text' }

  it('always spells a boolean out, so an unchecked box clears the flag', () => {
    expect(encodeFieldValue(bool, true)).toBe('true')
    expect(encodeFieldValue(bool, 'true')).toBe('true')
    expect(encodeFieldValue(bool, false)).toBe('false')
    expect(encodeFieldValue(bool, 'false')).toBe('false')
    // Absent means "off", not "leave whatever the server has".
    expect(encodeFieldValue(bool, undefined)).toBe('false')
    expect(encodeFieldValue(bool, null)).toBe('false')
    expect(encodeFieldValue(bool, '')).toBe('false')
  })

  it('accepts only the two exact truthy spellings for a boolean', () => {
    expect(encodeFieldValue(bool, 'TRUE')).toBe('false')
    expect(encodeFieldValue(bool, 'yes')).toBe('false')
    expect(encodeFieldValue(bool, 1)).toBe('false')
    expect(encodeFieldValue(bool, '1')).toBe('false')
  })

  it('drops an empty value for every non-boolean kind', () => {
    for (const value of [undefined, null, '']) {
      expect(encodeFieldValue(text, value), String(value)).toBeUndefined()
    }
  })

  it('keeps zero and false-looking values that are real data', () => {
    const num: RecordField = { add: 'preference', old: 'preference', next: 'preference', kind: 'number' }
    expect(encodeFieldValue(num, 0)).toBe('0')
    expect(encodeFieldValue(num, '0')).toBe('0')
    expect(encodeFieldValue(text, '0')).toBe('0')
    expect(encodeFieldValue(text, false)).toBe('false')
  })

  it('comma-joins an array and stringifies a scalar', () => {
    expect(encodeFieldValue(text, ['a', 'b'])).toBe('a,b')
    expect(encodeFieldValue(text, [1, true])).toBe('1,true')
    expect(encodeFieldValue(text, 3600)).toBe('3600')
  })

  it('turns an empty array into an empty string rather than dropping it', () => {
    // Documented wart: `[]` bypasses the emptiness guard because `[] !== ''`.
    expect(encodeFieldValue(text, [])).toBe('')
  })

  it('does not trim or re-case the value', () => {
    // Normalising here would make the update identity differ from what the
    // server stored, and the record would no longer be found.
    expect(encodeFieldValue(text, '  issue  ')).toBe('  issue  ')
    expect(encodeFieldValue(text, 'ISSUE')).toBe('ISSUE')
  })

  it('stringifies an object visibly instead of producing plausible garbage', () => {
    // Nothing upstream validates, so a nested rData handed over by mistake must
    // at least look wrong on the wire rather than silently writing "[object…]".
    expect(encodeFieldValue(text, { a: 1 })).toBe('[object Object]')
  })
})

describe('readRecordFieldValue', () => {
  const txt: RecordField = { add: 'text', old: 'characterStringsBase64', next: 'newText', kind: 'textarea' }
  const sshfp: RecordField = { add: 'sshfpAlgorithm', old: 'sshfpAlgorithm', next: 'newSshfpAlgorithm', kind: 'select', rData: 'algorithm' }

  it('returns undefined when there is no rData at all', () => {
    expect(readRecordFieldValue(sshfp, undefined)).toBeUndefined()
    expect(readRecordFieldValue(sshfp, undefined, 'identity')).toBeUndefined()
  })

  it('reads the plain parameter name when it matches', () => {
    expect(readRecordFieldValue({ add: 'ipAddress', old: 'ipAddress', next: 'ipAddress', kind: 'ip' }, { ipAddress: '10.0.0.1' })).toBe('10.0.0.1')
  })

  it('prefers the rData alias over both parameter names', () => {
    expect(readRecordFieldValue(sshfp, { algorithm: 'RSA', sshfpAlgorithm: 'ECDSA' })).toBe('RSA')
    expect(readRecordFieldValue(sshfp, { algorithm: 'RSA', sshfpAlgorithm: 'ECDSA' }, 'identity')).toBe('RSA')
  })

  it('falls back to a case-insensitive key match', () => {
    expect(readRecordFieldValue(sshfp, { Algorithm: 'DSA' })).toBe('DSA')
    expect(readRecordFieldValue({ add: 'rdata', old: 'rdata', next: 'newRData', kind: 'textarea' }, { RData: 'AAEC' })).toBe('AAEC')
  })

  it('picks the identity name or the form name depending on the slot', () => {
    const rData = { text: 'v=spf1 -all', characterStringsBase64: ['dj1zcGYxIC1hbGw='] }
    expect(readRecordFieldValue(txt, rData, 'identity')).toEqual(['dj1zcGYxIC1hbGw='])
    expect(readRecordFieldValue(txt, rData, 'form')).toBe('v=spf1 -all')
    // `form` is the default: the editor shows text, never base64.
    expect(readRecordFieldValue(txt, rData)).toBe('v=spf1 -all')
  })

  it('rebuilds plain TXT from character strings only for the form slot', () => {
    const rData = { characterStrings: ['v=spf1 ', '-all'] }
    expect(readRecordFieldValue(txt, rData, 'form')).toBe('v=spf1 -all')
    // The identity has to be the exact base64 the server sent; reconstructing
    // it from decoded chunks would not round-trip and the record would not match.
    expect(readRecordFieldValue(txt, rData, 'identity')).toBeUndefined()
  })

  it('returns falsy rData values instead of treating them as missing', () => {
    const flag: RecordField = { add: 'useSerialDateScheme', old: null, next: 'useSerialDateScheme', kind: 'boolean' }
    expect(readRecordFieldValue(flag, { useSerialDateScheme: false })).toBe(false)
    const serial: RecordField = { add: 'serial', old: null, next: 'serial', kind: 'number' }
    expect(readRecordFieldValue(serial, { serial: 0 })).toBe(0)
    expect(readRecordFieldValue(serial, { serial: '' })).toBe('')
  })

  it('returns undefined for a record that carries none of the candidate keys', () => {
    expect(readRecordFieldValue(sshfp, { fingerprint: 'AB' })).toBeUndefined()
    expect(readRecordFieldValue(txt, { characterStringsBase64: null }, 'form')).toBeNull()
  })
})

describe('buildAddFields', () => {
  it('reads the form by add-name only', () => {
    expect(buildAddFields('AAAA', { ipAddress: '2001:db8::9', newIpAddress: 'ignored' })).toEqual({
      ipAddress: '2001:db8::9',
      ptr: 'false',
      createPtrZone: 'false',
      updateSvcbHints: 'false',
    })
  })

  it('ignores keys that are not part of the spec', () => {
    // `zone`, `domain`, `ttl` and `node` belong to the mutation base; leaking
    // them here would double-write them and could override the caller's value.
    expect(buildAddFields('A', { ipAddress: '10.0.0.9', zone: 'example.com', domain: 'www', ttl: 3600, bogus: 'x' })).toEqual({
      ipAddress: '10.0.0.9',
      ptr: 'false',
      createPtrZone: 'false',
      updateSvcbHints: 'false',
    })
  })

  it('omits a missing or empty field rather than sending an empty parameter', () => {
    expect(buildAddFields('NS', { nameServer: '', glue: undefined })).toEqual({})
    expect(buildAddFields('MX', {})).toEqual({})
  })

  it('does not invent a value for a missing required field', () => {
    // Validation is the form's job; this layer must not paper over it.
    const out = buildAddFields('A', {})
    expect(out).not.toHaveProperty('ipAddress')
    expect(out).toEqual({ ptr: 'false', createPtrZone: 'false', updateSvcbHints: 'false' })
  })

  it('coerces a wrongly typed value to a string instead of throwing', () => {
    expect(buildAddFields('MX', { preference: 'abc', exchange: 42 })).toEqual({ preference: 'abc', exchange: '42' })
  })

  it('keeps a trailing root dot exactly as the operator typed it', () => {
    expect(buildAddFields('NS', { nameServer: 'ns1.example.com.' }).nameServer).toBe('ns1.example.com.')
    expect(buildAddFields('NS', { nameServer: 'ns1.example.com' }).nameServer).toBe('ns1.example.com')
    // No normalisation: the two spellings must stay distinguishable so an update
    // identity keeps matching what the server stored.
    expect(buildAddFields('NS', { nameServer: 'ns1.example.com.' }).nameServer).not.toBe(
      buildAddFields('NS', { nameServer: 'ns1.example.com' }).nameServer,
    )
  })

  it('falls back to the raw rData parameter for an unknown type', () => {
    expect(buildAddFields('WALLET' as unknown as RecordType, { rdata: 'AAEE' })).toEqual({ rdata: 'AAEE' })
  })
})

describe('buildUpdateFields', () => {
  it('sends the current value under the identity name and the new one under the replacement name', () => {
    expect(buildUpdateFields('MX', { preference: 20, exchange: 'mx2.example.com' }, { preference: 10, exchange: 'mx1.example.com' })).toEqual({
      preference: '10',
      newPreference: '20',
      exchange: 'mx1.example.com',
      newExchange: 'mx2.example.com',
    })
  })

  it('sends only the new value for a type with no identity slot', () => {
    expect(buildUpdateFields('CNAME', { cname: 'other.example.com' }, { cname: 'target.example.com' })).toEqual({
      cname: 'other.example.com',
    })
  })

  it('still emits an identity-less body when the record was never fetched', () => {
    // Dangerous by construction: for a type that *does* have an identity slot the
    // server would match on nothing but zone/domain/type. Pinned so the shape is
    // visible to whoever is tempted to call this with `undefined`.
    expect(buildUpdateFields('A', { ipAddress: '10.0.0.9' }, undefined)).toEqual({
      ipAddress: '10.0.0.9',
      ptr: 'false',
      createPtrZone: 'false',
      updateSvcbHints: 'false',
    })
    expect(buildDeleteFields('A', undefined)).toEqual({
      ptr: 'false',
      createPtrZone: 'false',
      updateSvcbHints: 'false',
    })
  })
})

describe('buildDeleteFields', () => {
  it('sends the identity and nothing else', () => {
    expect(buildDeleteFields('SSHFP', { algorithm: 'RSA', fingerprintType: 'SHA256', fingerprint: 'AB' })).toEqual({
      sshfpAlgorithm: 'RSA',
      sshfpFingerprintType: 'SHA256',
      sshfpFingerprint: 'AB',
    })
  })

  it('sends no rData at all for a single-instance type', () => {
    for (const type of IDENTITY_LESS_TYPES) {
      expect(buildDeleteFields(type, { cname: 'x', dname: 'y' }), type).toEqual({})
    }
  })

  it('never emits a replacement parameter', () => {
    for (const { type, rData } of FIXTURES) {
      const out = buildDeleteFields(type, rData)
      for (const key of Object.keys(out)) {
        const isIdentity = specFor(type).some((f) => f.old === key)
        expect(isIdentity, `${type} delete sent '${key}' which is not an identity name`).toBe(true)
        const isReplacementOnly = specFor(type).some((f) => f.next === key && f.old !== key)
        expect(isReplacementOnly, `${type} delete leaked replacement '${key}'`).toBe(false)
      }
    }
  })
})

describe('cross-operation agreement', () => {
  it.each(FIXTURES)('pins the exact wire body for $type', ({ type, rData, values, add, update, del }) => {
    if (add) expect(buildAddFields(type, values), `${type} add`).toEqual(add)
    if (update) expect(buildUpdateFields(type, values, rData), `${type} update`).toEqual(update)
    if (del) expect(buildDeleteFields(type, rData), `${type} delete`).toEqual(del)
  })

  it.each(FIXTURES)('agrees on the identity half between $type update and delete', ({ type, rData, values }) => {
    const update = buildUpdateFields(type, values, rData)
    const del = buildDeleteFields(type, rData)
    for (const field of specFor(type)) {
      if (field.old === null || field.old === field.next) continue
      expect(update[field.old], `${type}.${field.old}`).toBe(del[field.old])
    }
    // Every identity parameter the delete sends must also be in the update body.
    expect(Object.keys(del).sort()).toEqual(
      Object.keys(del)
        .filter((key) => key in update)
        .sort(),
    )
  })

  it.each(FIXTURES)('writes what the form showed for $type, on add and on update alike', ({ type, rData }) => {
    // Round-trip: fetch a record, read it back into the form, submit unchanged.
    // The value the server receives must be the value it sent, whichever
    // operation carries it.
    const unchanged: Record<string, unknown> = {}
    for (const field of specFor(type)) unchanged[field.add] = readRecordFieldValue(field, rData, 'form')

    const add = buildAddFields(type, unchanged)
    const update = buildUpdateFields(type, unchanged, rData)
    for (const field of specFor(type)) {
      expect(update[field.next], `${type}.${field.next}`).toBe(add[field.add])
    }
  })

  it.each(FIXTURES)('keeps every $type parameter inside the harvested vocabulary', ({ type, rData, values }) => {
    const spec = specFor(type)
    const bodies: [string, Record<string, string>][] = [
      ['add', buildAddFields(type, values)],
      ['update', buildUpdateFields(type, values, rData)],
      ['delete', buildDeleteFields(type, rData)],
    ]
    for (const [op, body] of bodies) {
      for (const [key, value] of Object.entries(body)) {
        const known = spec.some((f) => f.add === key || f.old === key || f.next === key)
        expect(known, `${type} ${op} sent unknown parameter '${key}'`).toBe(true)
        expect(FORBIDDEN_VALUES, `${type} ${op} sent '${key}'='${value}'`).not.toContain(value)
      }
    }
  })

  it.each(FIXTURES)('serialises every required $type field', ({ type, rData, values }) => {
    const add = buildAddFields(type, values)
    for (const field of requiredFields(type)) {
      expect(field.add in add, `${type}.${field.add} is required but missing`).toBe(true)
      expect(add[field.add].length, `${type}.${field.add} is empty`).toBeGreaterThan(0)
    }
    // An identity that is only partly sent would match a different record.
    const del = buildDeleteFields(type, rData)
    for (const field of requiredFields(type)) {
      if (field.old === null) continue
      expect(field.old in del, `${type}.${field.old} is a required identity but missing from delete`).toBe(true)
    }
  })
})

describe('collapsed update parameters', () => {
  /**
   * Where `old === next` the body map can only hold one of the two, and the
   * replacement wins because it is written second. Enumerated so the set is a
   * visible diff: adding a type here means an edit of that field cannot tell the
   * server what it used to be.
   */
  const EXPECTED_COLLAPSED: Partial<Record<RecordType, string[]>> = {
    A: ['ipAddress', 'ptr', 'createPtrZone', 'updateSvcbHints'],
    AAAA: ['ptr', 'createPtrZone', 'updateSvcbHints'],
    NS: ['glue'],
    SVCB: ['autoIpv4Hint', 'autoIpv6Hint'],
    HTTPS: ['autoIpv4Hint', 'autoIpv6Hint'],
    FWD: ['forwarderPriority', 'dnssecValidation', 'proxyType', 'proxyAddress', 'proxyPort', 'proxyUsername', 'proxyPassword'],
  }

  it('is limited to the address extras, the glue field and the forwarder options', () => {
    for (const type of RECORD_TYPES) {
      expect(collapsedFields(type), type).toEqual(EXPECTED_COLLAPSED[type] ?? [])
    }
  })

  it('lets the replacement win over the identity for a collapsed field', () => {
    // A's `ipAddress` is both identity and replacement, so editing the address
    // sends only the new one. AAAA does have `newIpAddress`, which makes the
    // asymmetry worth a look against a live server — see the report.
    const out = buildUpdateFields('A', { ipAddress: '10.0.0.9' }, { ipAddress: '10.0.0.1' })
    expect(out.ipAddress).toBe('10.0.0.9')
    expect(Object.keys(out).filter((k) => k.toLowerCase().includes('ip'))).toEqual(['ipAddress'])
  })
})
