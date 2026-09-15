'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  FolderPlus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { copyText, DataValue } from '@/components/app/copy-button'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { EmptyState, ErrorState } from '@/components/app/states'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { saveBlob } from '@/lib/api/client'
import type { DnsMessageRecord, DnsQuestion, ResolveResult } from '@/lib/api/types/dns-client'
import { formatRData } from '@/lib/api/types/dns-client'
import { displayDomain, formatRtt } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { cn } from '@/lib/utils'

/**
 * Parsed DNS message inspector.
 *
 * The whole result of `dnsClient/resolve` is a serialised DNS message whose keys
 * are PascalCase on purpose (`lib/api/types/dns-client.ts`) — it mirrors the wire
 * format, so this component reads like `dig`: a summary strip of the header
 * flags, then the QUESTION / ANSWER / AUTHORITY / ADDITIONAL sections, then EDNS.
 *
 * Non-obvious details:
 *  - The server's `RCODE` is a .NET enum name (`NoError`, `NxDomain`), but the
 *    i18n table is keyed by the RFC mnemonic (`NOERROR`, `NXDOMAIN`). `RCODE_KEY`
 *    bridges them and anything unmapped falls back to the raw string rather than
 *    throwing on a missing translation key.
 *  - `Metadata.RoundTripTime` arrives pre-formatted ("2.45 ms"). We parse the
 *    leading number back out so it can go through `formatRtt` and stay
 *    locale-consistent with the rest of the console.
 *  - `DnssecStatus` is usually `Disabled` unless DNSSEC was requested; the
 *    `result.dnssec.*` table only covers the five validation states, so this too
 *    falls back to the raw value.
 *  - The OPT pseudo-record in ADDITIONAL carries its UDP payload size in the
 *    `Class` field and an empty `Name`; both are rendered verbatim because that
 *    is exactly what a packet inspector should show.
 */

/** Server `RCODE` enum name -> RFC mnemonic key under `result.rcode`. */
const RCODE_KEY: Record<string, string> = {
  NoError: 'NOERROR',
  FormatError: 'FORMERR',
  ServerFailure: 'SERVFAIL',
  NxDomain: 'NXDOMAIN',
  NotImplemented: 'NOTIMP',
  Refused: 'REFUSED',
  YXDomain: 'YXDOMAIN',
  YXRRSet: 'YXRRSET',
  NXRRSet: 'NXRRSET',
  NotAuth: 'NOTAUTH',
  NotZone: 'NOTZONE',
}

const VALID_RCODE_KEYS = new Set(Object.values(RCODE_KEY))

const VALID_DNSSEC_STATES = new Set(['Secure', 'Insecure', 'Bogus', 'Indeterminate', 'NotApplicable'])

/** RCODEs that mean "the query itself failed" and should read as an error. */
const ERROR_RCODES = new Set(['SERVFAIL', 'REFUSED', 'NOTIMP', 'FORMERR', 'NOTAUTH', 'BADVERS', 'BADKEY'])

type BadgeVariant = NonNullable<BadgeProps['variant']>

function typeVariant(type: string): BadgeVariant {
  switch (type) {
    case 'OPT':
      return 'muted'
    case 'RRSIG':
    case 'DNSKEY':
    case 'DS':
    case 'NSEC':
    case 'NSEC3':
    case 'NSEC3PARAM':
      return 'info'
    case 'A':
    case 'AAAA':
      return 'success'
    case 'CNAME':
    case 'ANAME':
    case 'DNAME':
      return 'secondary'
    default:
      return 'outline'
  }
}

/** Extract the leading number from a pre-formatted duration like "2.45 ms". */
function parseRttMs(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const value = Number(match[0])
  return Number.isFinite(value) ? value : null
}

export interface ResolveResultProps {
  data: ResolveResult | undefined
  isPending?: boolean
  error?: unknown
  onRetry?: () => void
  /** Show the DNSSEC validation panel. */
  dnssecRequested?: boolean
  /** Import writes into a zone — a modify permission. */
  canModify?: boolean
  onImport?: () => void
  importing?: boolean
  className?: string
}

export function ResolveResult({
  data,
  isPending = false,
  error,
  onRetry,
  dnssecRequested = false,
  canModify = true,
  onImport,
  importing = false,
  className,
}: ResolveResultProps) {
  const t = useTranslations('dnsClient')
  const tc = useTranslations('common')
  const locale = useLocaleCode()

  const message = data?.result

  const rcodeLabel = React.useCallback(
    (rcode: string): string => {
      const key = RCODE_KEY[rcode] ?? (VALID_RCODE_KEYS.has(rcode) ? rcode : null)
      return key ? t(`result.rcode.${key}`) : rcode
    },
    [t],
  )

  const dnssecLabel = React.useCallback(
    (status: string): string => (VALID_DNSSEC_STATES.has(status) ? t(`result.dnssec.${status}`) : status),
    [t],
  )

  const recordColumns = React.useMemo(
    () => [
      textColumn<DnsMessageRecord>({
        accessorKey: 'Name',
        header: t('result.columns.name'),
        cell: (value) => <span className="font-data">{value ? displayDomain(String(value)) : '.'}</span>,
      }),
      textColumn<DnsMessageRecord>({
        accessorKey: 'Type',
        header: t('result.columns.type'),
        cell: (value) => <Badge variant={typeVariant(String(value))}>{String(value)}</Badge>,
      }),
      textColumn<DnsMessageRecord>({
        accessorKey: 'Class',
        header: t('result.columns.class'),
        cell: (value) => <span className="font-data text-muted-foreground">{String(value)}</span>,
      }),
      textColumn<DnsMessageRecord>({
        accessorKey: 'TTL',
        header: t('result.columns.ttl'),
        align: 'right',
        cell: (value) => <span className="font-data text-muted-foreground">{String(value)}</span>,
      }),
      textColumn<DnsMessageRecord>({
        accessorKey: 'RDLENGTH',
        header: t('result.columns.rdlength'),
        align: 'right',
        cell: (value) => <span className="font-data text-muted-foreground">{String(value)}</span>,
      }),
      textColumn<DnsMessageRecord>({
        id: 'rdata',
        header: t('result.columns.rdata'),
        cell: (_value, row) => <DataValue value={formatRData(row.RDATA) || '—'} copyLabel={tc('toast.copied')} />,
      }),
      textColumn<DnsMessageRecord>({
        accessorKey: 'DnssecStatus',
        header: t('result.columns.dnssec'),
        cell: (value) => <span className="text-xs text-muted-foreground">{dnssecLabel(String(value))}</span>,
      }),
    ],
    [t, tc, dnssecLabel],
  )

  const questionColumns = React.useMemo(
    () => [
      textColumn<DnsQuestion>({
        accessorKey: 'Name',
        header: t('result.columns.name'),
        cell: (value) => <span className="font-data">{displayDomain(String(value))}</span>,
      }),
      textColumn<DnsQuestion>({
        accessorKey: 'Type',
        header: t('result.columns.type'),
        cell: (value) => <Badge variant={typeVariant(String(value))}>{String(value)}</Badge>,
      }),
      textColumn<DnsQuestion>({
        accessorKey: 'Class',
        header: t('result.columns.class'),
        cell: (value) => <span className="font-data text-muted-foreground">{String(value)}</span>,
      }),
    ],
    [t],
  )

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} className={className} />
  }

  if (isPending) {
    return (
      <div className={cn('flex flex-col gap-3', className)} role="status" aria-live="polite">
        <span className="sr-only">{tc('table.loading')}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!message) {
    return (
      <div className={cn('surface rounded-lg', className)}>
        <EmptyState title={t('result.empty')} body={t('result.emptyHint')} icon={ShieldCheck} />
      </div>
    )
  }

  const meta = message.Metadata
  const rcode = message.RCODE
  const rcodeKey = RCODE_KEY[rcode] ?? (VALID_RCODE_KEYS.has(rcode) ? rcode : null)
  const rcodeTone: BadgeVariant =
    rcodeKey === 'NOERROR' ? 'success' : ERROR_RCODES.has(rcodeKey ?? '') ? 'destructive' : 'warning'
  const rttMs = parseRttMs(meta?.RoundTripTime)

  const allRecords = [...message.Answer, ...message.Authority, ...message.Additional]
  const dnssecStates = Array.from(new Set(allRecords.map((record) => record.DnssecStatus).filter(Boolean)))

  // Arrow consts (not hoisted `function`s) so the `message` narrowing from the
  // guard above survives inside the closure.
  const buildAnswerText = (): string =>
    message.Answer.map((record) =>
      [displayDomain(record.Name), record.TTL, record.Class, record.Type, formatRData(record.RDATA)]
        .filter(Boolean)
        .join('\t'),
    ).join('\n')

  const downloadTxt = () => {
    const name = message.Question[0]?.Name ?? 'resolve'
    const type = message.Question[0]?.Type ?? 'result'
    const blob = new Blob([JSON.stringify(message, null, 2)], { type: 'text/plain;charset=utf-8' })
    saveBlob(blob, `${name}-${type}.txt`)
  }

  async function copyAnswer() {
    const ok = await copyText(buildAnswerText())
    toast[ok ? 'success' : 'error'](ok ? tc('toast.copied') : tc('toast.failed'))
  }

  const metadataItems = [
    { label: t('result.summary.server'), value: <span className="font-data">{meta?.NameServer ?? '—'}</span> },
    { label: t('result.summary.protocol'), value: <span className="font-data">{meta?.Protocol ?? '—'}</span> },
    { label: t('result.summary.datagramSize'), value: <span className="font-data">{meta?.DatagramSize ?? '—'}</span> },
    {
      label: t('result.summary.rtt'),
      value: <span className="font-data">{rttMs !== null ? formatRtt(rttMs, locale) : (meta?.RoundTripTime ?? '—')}</span>,
    },
    { label: t('result.summary.identifier'), value: <span className="font-data">{message.Identifier}</span> },
    { label: t('result.summary.opcode'), value: <span className="font-data">{message.OPCODE}</span> },
    {
      label: t('result.summary.recursionDesired'),
      value: message.RecursionDesired ? tc('fields.yes') : tc('fields.no'),
    },
    {
      label: t('result.summary.recursionAvailable'),
      value: message.RecursionAvailable ? tc('fields.yes') : tc('fields.no'),
    },
    {
      label: t('result.summary.counts'),
      value: (
        <span className="font-data">
          {`${message.QDCOUNT}/${message.ANCOUNT}/${message.NSCOUNT}/${message.ARCOUNT} `}
          <span className="text-muted-foreground">
            ({t('result.counts.question')}/{t('result.counts.answer')}/{t('result.counts.authority')}/
            {t('result.counts.additional')})
          </span>
        </span>
      ),
    },
  ]

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{t('result.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry} disabled={!onRetry}>
            <RefreshCw className="size-3.5" aria-hidden />
            {t('result.actions.retry')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyAnswer()} disabled={message.Answer.length === 0}>
            <Copy className="size-3.5" aria-hidden />
            {t('result.actions.copyAnswer')}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadTxt}>
            <Download className="size-3.5" aria-hidden />
            {t('result.actions.downloadTxt')}
          </Button>
          {canModify && onImport && (
            <Button variant="outline" size="sm" onClick={onImport} loading={importing}>
              {!importing && <FolderPlus className="size-3.5" aria-hidden />}
              {t('result.actions.addRecord')}
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/zones">
              <ExternalLink className="size-3.5" aria-hidden />
              {t('result.actions.openInZone')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary strip: the header flags an operator checks first. */}
      <div className="surface flex flex-wrap items-center gap-2 rounded-lg p-3">
        <Badge variant={rcodeTone} className="font-data">
          {rcodeKey === 'NOERROR' ? <CircleCheck className="size-3" aria-hidden /> : <TriangleAlert className="size-3" aria-hidden />}
          {rcodeLabel(rcode)}
        </Badge>
        <SummaryFlag label={t('result.summary.rtt')} value={rttMs !== null ? formatRtt(rttMs, locale) : (meta?.RoundTripTime ?? '—')} />
        <SummaryFlag label={t('result.summary.authoritative')} value={message.AuthoritativeAnswer ? tc('fields.yes') : tc('fields.no')} />
        <SummaryFlag label={t('result.summary.truncated')} value={message.Truncation ? tc('fields.yes') : tc('fields.no')} tone={message.Truncation ? 'warning' : undefined} />
        <SummaryFlag
          label={t('result.summary.authenticData')}
          value={message.AuthenticData ? tc('fields.yes') : tc('fields.no')}
          tone={message.AuthenticData ? 'success' : undefined}
        />
        <SummaryFlag label={t('result.summary.checkingDisabled')} value={message.CheckingDisabled ? tc('fields.yes') : tc('fields.no')} />
      </div>

      <Section title={t('result.sections.metadata')}>
        <DefinitionList items={metadataItems} />
      </Section>

      {message.Question.length > 0 && (
        <Section title={t('result.sections.question')} contentClassName="p-0">
          <DataTable
            data={message.Question}
            columns={questionColumns}
            density="compact"
            enableSorting={false}
            clientPagination={false}
            label={t('result.sections.question')}
          />
        </Section>
      )}

      <Section
        title={t('result.sections.answer')}
        actions={<Badge variant="muted" className="font-data">{message.ANCOUNT}</Badge>}
        contentClassName={message.Answer.length === 0 ? undefined : 'p-0'}
      >
        {message.Answer.length === 0 ? (
          <EmptyState
            icon={TriangleAlert}
            title={t('result.noAnswer')}
            body={t('result.noAnswerHint', { rcode: rcodeLabel(rcode) })}
          />
        ) : (
          <DataTable
            data={message.Answer}
            columns={recordColumns}
            density="compact"
            enableSorting={false}
            clientPagination={false}
            label={t('result.sections.answer')}
          />
        )}
      </Section>

      {message.Authority.length > 0 && (
        <Section
          title={t('result.sections.authority')}
          actions={<Badge variant="muted" className="font-data">{message.NSCOUNT}</Badge>}
          contentClassName="p-0"
        >
          <DataTable
            data={message.Authority}
            columns={recordColumns}
            density="compact"
            enableSorting={false}
            clientPagination={false}
            label={t('result.sections.authority')}
          />
        </Section>
      )}

      {message.Additional.length > 0 && (
        <Section
          title={t('result.sections.additional')}
          actions={<Badge variant="muted" className="font-data">{message.ARCOUNT}</Badge>}
          contentClassName="p-0"
        >
          <DataTable
            data={message.Additional}
            columns={recordColumns}
            density="compact"
            enableSorting={false}
            clientPagination={false}
            label={t('result.sections.additional')}
          />
        </Section>
      )}

      {dnssecRequested && dnssecStates.length > 0 && (
        <Section title={t('result.columns.dnssec')}>
          <div className="flex flex-wrap items-center gap-2">
            {dnssecStates.map((status) => (
              <Badge key={status} variant={status === 'Secure' ? 'success' : status === 'Bogus' ? 'destructive' : 'outline'}>
                {dnssecLabel(status)}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {message.EDNS && (
        <Section title={t('result.sections.edns')}>
          <DefinitionList
            items={[
              { label: t('result.edns.version'), value: <span className="font-data">{message.EDNS.Version}</span> },
              { label: t('result.edns.flags'), value: <span className="font-data">{message.EDNS.Flags || '—'}</span> },
              { label: t('result.edns.extendedRcode'), value: <span className="font-data">{message.EDNS.ExtendedRCODE}</span> },
              { label: t('result.edns.udpPayloadSize'), value: <span className="font-data">{message.EDNS.UdpPayloadSize}</span> },
            ]}
          />
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-muted-foreground">{t('result.edns.options')}</p>
            {message.EDNS.Options.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('result.edns.none')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {message.EDNS.Options.map((option, index) => (
                  <li key={index} className="font-data flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
                    <span className="text-muted-foreground">{t('result.edns.optionCode')}:</span>
                    <span>{option.Code ?? '—'}</span>
                    <span className="text-muted-foreground">{t('result.edns.optionName')}:</span>
                    <span>{option.Name ?? '—'}</span>
                    {option.Data && (
                      <>
                        <span className="text-muted-foreground">{t('result.edns.optionData')}:</span>
                        <span className="break-all">{String(option.Data)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

/** One label/value chip in the summary strip. */
function SummaryFlag({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'success' | 'warning'
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-data font-medium',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </span>
    </span>
  )
}
