'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronDown, RefreshCw, ShieldQuestionMark } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, textColumn } from '@/components/app/data-table'
import { CopyButton, copyText } from '@/components/app/copy-button'
import { Section } from '@/components/app/page-shell'
import { EmptyState, ErrorState, InlineLoading } from '@/components/app/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { viewDsRecords } from '@/lib/api/domains/dnssec'
import { isDnsApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import type { DsRecord } from '@/lib/api/types/dnssec'
import type { DnsKeyState } from '@/lib/api/enums'
import { formatDigest, formatNumber } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * DS record publication panel (`zones/dnssec/viewDS`).
 *
 * This is the one DNSSEC surface whose output leaves the building: an operator
 * copies it into a registrar form or a parent zone file. Two things follow.
 *
 *  - **The "unsigned zone" error is not an error.** `viewDS` on an unsigned zone
 *    replies `{status:"error", errorMessage:"The zone must be signed with
 *    DNSSEC."}`, which the proxy layer surfaces as a plain `upstream_error`.
 *    Rendering that as a red error card tells the operator something is broken
 *    when in fact nothing has been configured yet, so the message is matched and
 *    downgraded to an `EmptyState` with a "sign the zone" affordance. The query
 *    is additionally gated on `signed`, so on a well-behaved parent the failing
 *    request is never even issued — the match only fires when the parent's view
 *    of the status is stale (the zone was unsigned between the two reads).
 *  - **The BIND block is the primary artefact**, not the table. Registrars ask
 *    for key tag / algorithm / digest type / digest, and the numeric form is
 *    what belongs in a zone file, so the numbers are rendered beside their
 *    mnemonic names and the whole block is one click from the clipboard.
 *
 * `DsRecord.digests` is an array — one KSK legitimately publishes SHA-1,
 * SHA-256 and SHA-384 digests at once — so rows are flattened record x digest.
 * That is why `getRowId` needs the digest type number as well as the key tag.
 *
 * Access control is inherited: the parent view only renders this panel once
 * `zones/dnssec/properties/get` succeeded, which is itself gated on
 * `useCan('Zones').canView`.
 */

export interface DsRecordsPanelProps {
  zone: string
  /** Used as the TTL in the generated BIND zone-file lines. */
  dnsKeyTtl: number
  /** Whether the parent believes the zone is signed. Gates the query. */
  signed: boolean
  canModify: boolean
  /** Opens the sign dialog from the "not signed" empty state. */
  onSign: () => void
}

/** One DS digest row: a `DsRecord` crossed with one of its digests. */
interface DsRow {
  keyTag: number
  algorithm: string
  algorithmNumber: number
  state: DnsKeyState
  retiring: boolean
  digestType: string
  digestTypeNumber: number
  digest: string
}

/** Matches Technitium's "The zone must be signed with DNSSEC." reply. */
const UNSIGNED_MESSAGE = /must be signed/i

export function DsRecordsPanel({ zone, dnsKeyTtl, signed, canModify, onSign }: DsRecordsPanelProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()

  const ds = useQuery({
    queryKey: queryKeys.dnssecDs(target, zone),
    queryFn: () => viewDsRecords(zone),
    enabled: signed,
  })

  const records = ds.data?.dsRecords
  const rows = React.useMemo<DsRow[]>(() => flatten(records ?? []), [records])
  const bindText = React.useMemo(() => toBindFormat(zone, dnsKeyTtl, rows), [zone, dnsKeyTtl, rows])

  const columns = React.useMemo(
    () => [
      textColumn<DsRow>({
        id: 'keyTag',
        accessorKey: 'keyTag',
        header: t('ds.columns.keyTag'),
        align: 'right',
        width: '7rem',
        cell: (_value, row) => <span className="font-data tabular-nums">{formatNumber(row.keyTag, locale)}</span>,
      }),
      textColumn<DsRow>({
        id: 'algorithm',
        accessorKey: 'algorithm',
        header: t('ds.columns.algorithm'),
        cell: (_value, row) => (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-data truncate">{row.algorithm}</span>
            <span className="font-data shrink-0 text-xs text-muted-foreground">{row.algorithmNumber}</span>
          </span>
        ),
      }),
      textColumn<DsRow>({
        id: 'digestType',
        accessorKey: 'digestType',
        header: t('ds.columns.digestType'),
        width: '9rem',
        cell: (_value, row) => (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-data truncate">{row.digestType}</span>
            <span className="font-data shrink-0 text-xs text-muted-foreground">{row.digestTypeNumber}</span>
          </span>
        ),
      }),
      textColumn<DsRow>({
        id: 'digest',
        accessorKey: 'digest',
        header: t('ds.columns.digest'),
        enableSorting: false,
        cell: (_value, row) => (
          <span className="group/ds inline-flex min-w-0 max-w-full items-start gap-1">
            <span className="font-data break-all">{formatDigest(row.digest)}</span>
            <CopyButton
              value={row.digest}
              label={t('ds.copyDigest')}
              className="opacity-0 transition-opacity group-hover/ds:opacity-100 focus-visible:opacity-100"
            />
          </span>
        ),
      }),
      textColumn<DsRow>({
        id: 'state',
        accessorKey: 'state',
        header: t('ds.columns.state'),
        width: '9rem',
        cell: (_value, row) => (
          <Badge variant={row.state === 'Active' ? 'success' : 'muted'}>{t(`keys.states.${row.state}`)}</Badge>
        ),
      }),
      textColumn<DsRow>({
        id: 'retiring',
        accessorKey: 'retiring',
        header: t('ds.columns.retiring'),
        align: 'center',
        width: '7rem',
        cell: (_value, row) => (
          <span className={cn('text-xs', row.retiring ? 'text-warning' : 'text-muted-foreground')}>
            {row.retiring ? tc('fields.yes') : tc('fields.no')}
          </span>
        ),
      }),
    ],
    [t, tc, locale],
  )

  // `notSigned` covers both "the parent knows" and "the server told us", so the
  // stale-cache race degrades to guidance instead of a red card.
  const notSigned = !signed || (isDnsApiError(ds.error) && UNSIGNED_MESSAGE.test(ds.error.message))

  async function onCopyBind() {
    const ok = await copyText(bindText)
    if (ok) toast.success(t('ds.copied'))
    else toast.error(tc('toast.failed'))
  }

  return (
    <Section
      title={t('ds.title')}
      description={t('ds.subtitle')}
      actions={
        signed && !notSigned ? (
          <Button variant="ghost" size="sm" onClick={() => void ds.refetch()} loading={ds.isFetching}>
            {!ds.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
            {t('ds.action')}
          </Button>
        ) : undefined
      }
    >
      {notSigned ? (
        <EmptyState
          icon={ShieldQuestionMark}
          title={t('ds.notSigned')}
          body={t('ds.emptyHint')}
          action={canModify ? <Button size="sm" onClick={onSign}>{t('sign.action')}</Button> : undefined}
          className="py-10"
        />
      ) : ds.error ? (
        <ErrorState error={ds.error} onRetry={() => void ds.refetch()} />
      ) : ds.isPending ? (
        <InlineLoading label={t('ds.loading')} className="justify-center py-8" />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldQuestionMark} title={t('ds.empty')} body={t('ds.emptyHint')} className="py-10" />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <DataTable<DsRow>
            label={t('ds.title')}
            columns={columns}
            data={rows}
            getRowId={(row) => `${row.keyTag}-${row.digestTypeNumber}`}
            clientPagination={false}
            density="compact"
          />

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('ds.bindFormat')}</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => void onCopyBind()}>
                {t('ds.copyBind')}
              </Button>
            </div>
            <pre className="font-data overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre">
              {bindText}
            </pre>
            <p className="text-xs text-muted-foreground">{t('ds.registrarHint')}</p>
            <p className="text-xs text-muted-foreground">{t('ds.waitHint')}</p>
          </div>

          <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
            {(records ?? []).map((record) => (
              <PublicKeyDisclosure key={record.keyTag} record={record} />
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

/**
 * `DsRecord.digests` -> one row per digest. Key tags repeat across digests, so
 * the caller's `getRowId` must include the digest type to stay unique.
 */
function flatten(records: DsRecord[]): DsRow[] {
  return records.flatMap((record) =>
    record.digests.map((digest) => ({
      keyTag: record.keyTag,
      algorithm: record.algorithm,
      algorithmNumber: record.algorithmNumber,
      state: record.dnsKeyState,
      retiring: record.isRetiring,
      digestType: digest.digestType,
      digestTypeNumber: digest.digestTypeNumber,
      digest: digest.digest,
    })),
  )
}

/**
 * The lines an operator pastes into the parent zone. The owner name is forced
 * absolute because Technitium stores zone names without the trailing dot while
 * a zone file requires it.
 */
function toBindFormat(zone: string, ttl: number, rows: DsRow[]): string {
  const owner = zone.endsWith('.') ? zone : `${zone}.`
  return rows
    .map((row) => `${owner} ${ttl} IN DS ${row.keyTag} ${row.algorithmNumber} ${row.digestTypeNumber} ${row.digest}`)
    .join('\n')
}

/** Per-key disclosure for the DNSKEY public key: long, base64, rarely needed. */
function PublicKeyDisclosure({ record }: { record: DsRecord }) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="w-full justify-start gap-2 text-muted-foreground">
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden />
          {open ? t('ds.hidePublicKey') : t('ds.showPublicKey')}
          <span className="font-data text-xs">
            {tc('fields.name')} {record.keyTag}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{t('ds.publicKey')}</span>
            <CopyButton value={record.publicKey} label={tc('toast.copied')} size="icon-xs" />
          </div>
          <pre className="font-data rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap">
            {record.publicKey}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
