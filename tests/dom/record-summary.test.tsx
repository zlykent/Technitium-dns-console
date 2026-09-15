import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordSummary, summarizeRecord } from '@/components/records/record-summary'
import type { RecordType } from '@/lib/api/enums'
import type { DnsRecord, RecordRData } from '@/lib/api/types/zones'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * `summarizeRecord` turns a record's flat `rData` union back into the one-line
 * form an operator expects from `dig`. It feeds the table cell, the clipboard,
 * the client-side filter and the editor preview, so all four must stay
 * byte-identical — which is exactly why the string is asserted per type here
 * rather than eyeballed in a snapshot.
 *
 * The regressions worth guarding are the type-specific orderings and decorations
 * that are trivial to get subtly wrong and impossible to notice until an
 * operator pastes a malformed value into a registrar: priority *before* exchange
 * for MX, the four-field `priority weight port target` order for SRV, quoting of
 * free-text chunks (TXT character strings, NAPTR flags/services, URI, CAA value),
 * the root-dot trim on every domain, and the 4-char grouping of a DS digest.
 *
 * `<RecordSummary>` is the thin DOM wrapper: it must render that same string
 * through `DataValue`, which per `docs/ui-conventions.md` means the DNS blob
 * carries the monospace `.font-data` class and a copy affordance.
 */

/** Build a complete `DnsRecord`; only `type` and `rData` vary across cases. */
function record(type: RecordType, rData: RecordRData): DnsRecord {
  return {
    name: 'test.example.com',
    type,
    ttl: 3600,
    ttlString: '1h',
    expiryTtl: null,
    expiryTtlString: null,
    disabled: false,
    dnssecStatus: 'Signed',
    lastModified: '2026-01-01T00:00:00Z',
    lastUsedOn: null,
    rData,
  }
}

describe('summarizeRecord — address & single-name records', () => {
  it('renders A and AAAA as the bare IP address', () => {
    expect(summarizeRecord(record('A', { ipAddress: '192.0.2.1' }))).toBe('192.0.2.1')
    expect(summarizeRecord(record('AAAA', { ipAddress: '2001:db8::1' }))).toBe('2001:db8::1')
  })

  it('falls back to an em dash when an address record has no ipAddress', () => {
    expect(summarizeRecord(record('A', {}))).toBe('—')
  })

  it('trims the root dot off every name-bearing rData field', () => {
    // displayDomain strips a trailing '.' for display; the wire value keeps it.
    expect(summarizeRecord(record('NS', { nameServer: 'ns1.example.com.' }))).toBe('ns1.example.com')
    expect(summarizeRecord(record('CNAME', { cname: 'target.example.com.' }))).toBe('target.example.com')
    expect(summarizeRecord(record('PTR', { ptrName: 'host.example.com.' }))).toBe('host.example.com')
    expect(summarizeRecord(record('DNAME', { dname: 'sub.example.com.' }))).toBe('sub.example.com')
  })

  it('renders an em dash for a name record with a missing name', () => {
    expect(summarizeRecord(record('CNAME', {}))).toBe('—')
  })
})

describe('summarizeRecord — SOA', () => {
  it('renders the seven SOA fields in wire order', () => {
    const summary = summarizeRecord(
      record('SOA', {
        primaryNameServer: 'ns1.example.com.',
        responsiblePerson: 'admin.example.com.',
        serial: 2026010101,
        refresh: 3600,
        retry: 900,
        expire: 1209600,
        minimum: 86400,
      }),
    )
    expect(summary).toBe('ns1.example.com admin.example.com 2026010101 3600 900 1209600 86400')
  })

  it('keeps a zero numeric field rather than dropping it', () => {
    // parts() filters null/undefined but String(0) is non-empty, so a legitimate
    // 0 (e.g. minimum) must survive — dropping it would shift every later field.
    const summary = summarizeRecord(
      record('SOA', { primaryNameServer: 'ns1.', responsiblePerson: 'admin.', serial: 1, refresh: 0, retry: 0, expire: 0, minimum: 0 }),
    )
    expect(summary).toBe('ns1 admin 1 0 0 0 0')
  })

  it('omits absent numeric SOA fields without leaving stray separators', () => {
    // The two name fields always render (displayDomain turns a missing one into
    // an em dash), but absent numerics collapse away cleanly with no dangling
    // spaces or separators.
    expect(
      summarizeRecord(record('SOA', { primaryNameServer: 'ns1.', responsiblePerson: 'admin.', serial: 5 })),
    ).toBe('ns1 admin 5')
  })
})

describe('summarizeRecord — mail & service records', () => {
  it('puts MX preference before the exchange', () => {
    expect(summarizeRecord(record('MX', { preference: 10, exchange: 'mail.example.com.' }))).toBe('10 mail.example.com')
  })

  it('keeps an MX preference of zero', () => {
    expect(summarizeRecord(record('MX', { preference: 0, exchange: 'mail.example.com.' }))).toBe('0 mail.example.com')
  })

  it('renders SRV as priority weight port target', () => {
    expect(
      summarizeRecord(record('SRV', { priority: 10, weight: 20, port: 443, target: 'svc.example.com.' })),
    ).toBe('10 20 443 svc.example.com')
  })

  it('renders RP as mailbox then txt domain', () => {
    expect(
      summarizeRecord(record('RP', { mailbox: 'admin.example.com.', txtDomain: 'txt.example.com.' })),
    ).toBe('admin.example.com txt.example.com')
  })

  it('renders NAPTR with quoted flags/services/regexp and skips an empty regexp', () => {
    expect(
      summarizeRecord(
        record('NAPTR', {
          order: 100,
          preference: 10,
          flags: 'S',
          services: 'SIP+D2U',
          regexp: '',
          replacement: '_sip._udp.example.com.',
        }),
      ),
    ).toBe('100 10 "S" "SIP+D2U" _sip._udp.example.com')
  })

  it('coerces a numeric NAPTR flags field to a quoted string', () => {
    // The rData type says `flags` is a number (for CAA); NAPTR's is a string on
    // the wire, so summarizeRecord must not read it as a number and lose it.
    expect(
      summarizeRecord(record('NAPTR', { order: 1, preference: 1, flags: 0, replacement: 'r.example.com.' })),
    ).toBe('1 1 "0" r.example.com')
  })
})

describe('summarizeRecord — TXT', () => {
  it('prefers decoded character strings, each quoted and space-joined', () => {
    expect(summarizeRecord(record('TXT', { characterStrings: ['v=spf1 -all', 'extra'] }))).toBe('"v=spf1 -all" "extra"')
  })

  it('quotes a single character string', () => {
    expect(summarizeRecord(record('TXT', { characterStrings: ['hello world'] }))).toBe('"hello world"')
  })

  it('falls back to the raw text when characterStrings is absent', () => {
    expect(summarizeRecord(record('TXT', { text: 'hello' }))).toBe('"hello"')
  })

  it('falls back to text when characterStrings is an empty array', () => {
    expect(summarizeRecord(record('TXT', { characterStrings: [], text: 'fallback' }))).toBe('"fallback"')
  })

  it('prefers characterStrings over text when both are present', () => {
    expect(summarizeRecord(record('TXT', { characterStrings: ['a'], text: 'ignored' }))).toBe('"a"')
  })

  it('returns an empty string for a TXT record with no data at all', () => {
    expect(summarizeRecord(record('TXT', {}))).toBe('')
  })
})

describe('summarizeRecord — DNSSEC records', () => {
  it('renders DS as keyTag algorithm digestType then a grouped digest', () => {
    // formatDigest groups the hex into 4-char blocks the way dig prints them;
    // a 64-char run is unreadable and error-prone to paste at a registrar.
    expect(
      summarizeRecord(record('DS', { keyTag: 12345, algorithm: '8', digestType: '2', digest: 'ABCDEF0123456789' })),
    ).toBe('12345 8 2 ABCD EF01 2345 6789')
  })

  it('renders an em dash for a DS record with no digest', () => {
    expect(summarizeRecord(record('DS', { keyTag: 1, algorithm: '8', digestType: '2' }))).toBe('1 8 2 —')
  })

  it('renders SSHFP as algorithm fingerprintType fingerprint', () => {
    expect(summarizeRecord(record('SSHFP', { algorithm: '2', fingerprintType: '1', fingerprint: 'abc123' }))).toBe('2 1 abc123')
  })

  it('renders TLSA as usage selector matchingType associationData', () => {
    expect(
      summarizeRecord(
        record('TLSA', { certificateUsage: '3', selector: '1', matchingType: '1', certificateAssociationData: 'DEADBEEF' }),
      ),
    ).toBe('3 1 1 DEADBEEF')
  })
})

describe('summarizeRecord — SVCB / HTTPS / URI / CAA', () => {
  it('renders SVCB and HTTPS identically', () => {
    const rData = { svcPriority: 1, svcTargetName: 'svc.example.net.', svcParams: 'port=443' }
    expect(summarizeRecord(record('SVCB', rData))).toBe('1 svc.example.net port=443')
    expect(summarizeRecord(record('HTTPS', rData))).toBe('1 svc.example.net port=443')
  })

  it('renders URI with a quoted target', () => {
    expect(summarizeRecord(record('URI', { priority: 10, weight: 1, uri: 'https://example.com/' }))).toBe(
      '10 1 "https://example.com/"',
    )
  })

  it('renders CAA as flags tag quoted-value, keeping a zero flag', () => {
    expect(summarizeRecord(record('CAA', { flags: 0, tag: 'issue', value: 'letsencrypt.org' }))).toBe(
      '0 issue "letsencrypt.org"',
    )
  })
})

describe('summarizeRecord — Technitium-specific records', () => {
  it('renders ANAME from aname, falling back to alias', () => {
    expect(summarizeRecord(record('ANAME', { aname: 'target.example.com.' }))).toBe('target.example.com')
    expect(summarizeRecord(record('ANAME', { alias: 'other.example.com.' }))).toBe('other.example.com')
  })

  it('renders FWD as protocol then forwarder', () => {
    expect(summarizeRecord(record('FWD', { protocol: 'Tcp', forwarder: '1.1.1.1' }))).toBe('Tcp 1.1.1.1')
  })

  it('renders APP as appName then classPath', () => {
    expect(summarizeRecord(record('APP', { appName: 'MyApp', classPath: 'com.example.App' }))).toBe('MyApp com.example.App')
  })
})

describe('summarizeRecord — fallback & robustness', () => {
  it('dumps an unmodelled type as compact key=value pairs', () => {
    // A future Technitium extension (or `Unknown`) must still show something
    // rather than an empty cell.
    expect(summarizeRecord(record('Unknown', { appName: 'MyApp', classPath: 'com.x.App' }))).toBe(
      'appName=MyApp classPath=com.x.App',
    )
  })

  it('joins an array field with pipes in the fallback dump', () => {
    expect(summarizeRecord(record('Unknown', { types: ['A', 'NS', 'SOA'] }))).toBe('types=A|NS|SOA')
  })

  it('skips empty and undefined fields in the fallback dump', () => {
    expect(summarizeRecord(record('Unknown', { text: 'kept', appName: '', classPath: undefined }))).toBe('text=kept')
  })

  it('renders an em dash for an unmodelled type with no populated fields', () => {
    expect(summarizeRecord(record('Unknown', {}))).toBe('—')
  })

  it('does not crash when rData is null at runtime', () => {
    // The type says rData is required, but a malformed upstream response must
    // not throw inside a table cell renderer.
    const broken = { ...record('A', {}), rData: null } as unknown as DnsRecord
    expect(summarizeRecord(broken)).toBe('—')
  })
})

describe('<RecordSummary> — rendering', () => {
  it('renders the summarized text inside a .font-data monospace span', () => {
    // docs/ui-conventions.md: DNS data must use the .font-data class, not a raw
    // font-family, so the whole console stays visually consistent.
    renderWithProviders(<RecordSummary record={record('A', { ipAddress: '192.0.2.1' })} />)
    expect(screen.getByText('192.0.2.1')).toHaveClass('font-data')
  })

  it('renders the same string summarizeRecord produces for a complex type', () => {
    const rec = record('MX', { preference: 10, exchange: 'mail.example.com.' })
    renderWithProviders(<RecordSummary record={rec} />)
    expect(screen.getByText(summarizeRecord(rec))).toBeInTheDocument()
  })

  it('exposes a copy affordance for a non-empty value', () => {
    renderWithProviders(<RecordSummary record={record('A', { ipAddress: '192.0.2.1' })} />)
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('renders an em dash (and no crash) for a record with no data', () => {
    renderWithProviders(<RecordSummary record={record('CNAME', {})} />)
    expect(screen.getByText('—')).toHaveClass('font-data')
  })

  it('forwards a className to the rendered value', () => {
    const { container } = renderWithProviders(
      <RecordSummary record={record('A', { ipAddress: '10.0.0.1' })} className="text-xs" />,
    )
    expect(container.querySelector('.text-xs')).not.toBeNull()
  })

  it('sets the summary as the title so a truncated value stays readable on hover', () => {
    renderWithProviders(<RecordSummary record={record('A', { ipAddress: '192.0.2.1' })} />)
    expect(screen.getByTitle('192.0.2.1')).toBeInTheDocument()
  })
})
