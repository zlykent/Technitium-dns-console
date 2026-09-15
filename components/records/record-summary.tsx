'use client'

import * as React from 'react'
import { DataValue } from '@/components/app/copy-button'
import type { DnsRecord, RecordRData } from '@/lib/api/types/zones'
import { displayDomain, formatDigest } from '@/lib/format'

/**
 * Human-readable rData rendering.
 *
 * A record's `rData` is a flat object whose populated keys depend entirely on
 * the record type (`lib/api/types/zones.ts`), so there is no single field to
 * print. This module turns each type back into the one-line form an operator
 * expects from `dig` / the stock console — priority before exchange for MX,
 * `order preference "flags" "services" "regexp" replacement` for NAPTR, and so
 * on.
 *
 * Two functions matter:
 *  - `summarizeRecord` returns a plain string. It feeds the table cell, the
 *    clipboard, the client-side global filter and the editor's "current value"
 *    preview, so all of those stay byte-identical.
 *  - `<RecordSummary>` renders that string through `DataValue`, giving the
 *    monospace + hover-to-copy treatment every DNS blob in the console uses.
 *
 * The `default` branch falls back to a compact `key=value` dump so an
 * unmodelled type (a future Technitium extension, or `Unknown`) still shows
 * something rather than an empty cell.
 */

/** Join the non-empty parts of a summary with single spaces. */
function parts(...values: (string | number | null | undefined)[]): string {
  return values
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .filter((value) => value.length > 0)
    .join(' ')
}

/** Quote a free-text rData chunk the way a zone file would. */
function quoted(value: string | null | undefined): string {
  if (!value) return ''
  return `"${value}"`
}

/** TXT prefers the decoded character strings; fall back to the raw `text`. */
function txtValue(rData: RecordRData): string {
  if (Array.isArray(rData.characterStrings) && rData.characterStrings.length > 0) {
    return rData.characterStrings.map((chunk) => quoted(chunk)).join(' ')
  }
  return quoted(rData.text)
}

export function summarizeRecord(record: DnsRecord): string {
  const r = record.rData ?? {}
  switch (record.type) {
    case 'A':
    case 'AAAA':
      return r.ipAddress ?? '—'
    case 'NS':
      return displayDomain(r.nameServer)
    case 'SOA':
      return parts(
        displayDomain(r.primaryNameServer),
        displayDomain(r.responsiblePerson),
        r.serial,
        r.refresh,
        r.retry,
        r.expire,
        r.minimum,
      )
    case 'CNAME':
      return displayDomain(r.cname)
    case 'PTR':
      return displayDomain(r.ptrName)
    case 'MX':
      return parts(r.preference, displayDomain(r.exchange))
    case 'TXT':
      return txtValue(r)
    case 'RP':
      return parts(displayDomain(r.mailbox), displayDomain(r.txtDomain))
    case 'SRV':
      return parts(r.priority, r.weight, r.port, displayDomain(r.target))
    case 'NAPTR':
      // `RecordRData.flags` is typed `number` for CAA; NAPTR's flags is a
      // string on the wire, so coerce defensively rather than trust the type.
      return parts(
        r.order,
        r.preference,
        quoted(r.flags == null ? undefined : String(r.flags)),
        quoted(r.services),
        quoted(r.regexp),
        displayDomain(r.replacement),
      )
    case 'DNAME':
      return displayDomain(r.dname)
    case 'DS':
      return parts(r.keyTag, r.algorithm, r.digestType, formatDigest(r.digest))
    case 'SSHFP':
      return parts(r.algorithm, r.fingerprintType, r.fingerprint)
    case 'TLSA':
      return parts(r.certificateUsage, r.selector, r.matchingType, r.certificateAssociationData)
    case 'SVCB':
    case 'HTTPS':
      return parts(r.svcPriority, displayDomain(r.svcTargetName), r.svcParams)
    case 'URI':
      return parts(r.priority, r.weight, quoted(r.uri))
    case 'CAA':
      return parts(r.flags, r.tag, quoted(r.value))
    case 'ANAME':
      return displayDomain(r.aname ?? r.alias)
    case 'FWD':
      return parts(r.protocol, r.forwarder)
    case 'APP':
      return parts(r.appName, r.classPath)
    default:
      return fallback(r)
  }
}

/** Compact `key=value` dump for any type this module does not model explicitly. */
function fallback(rData: RecordRData): string {
  const entries = Object.entries(rData).filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : String(value)}`).join(' ')
}

export interface RecordSummaryProps {
  record: DnsRecord
  /** Toast/aria label for the copy affordance; omit to copy silently. */
  copyLabel?: string
  className?: string
}

/** rData rendered as a monospace, copyable one-liner for the table cell. */
export function RecordSummary({ record, copyLabel, className }: RecordSummaryProps) {
  const text = React.useMemo(() => summarizeRecord(record), [record])
  return <DataValue value={text} copyLabel={copyLabel} className={className} />
}
