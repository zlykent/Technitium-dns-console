'use client'

import { useTranslations } from 'next-intl'
import { Download, ListChecks, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { describeError, saveBlob } from '@/lib/api/client'
import { resolve } from '@/lib/api/domains/dns-client'
import type { QueryRecordType, ResolverProtocol } from '@/lib/api/enums'
import { formatRtt } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'

/**
 * Bulk resolve.
 *
 * Runs the *same* query parameters (server / type / protocol / DNSSEC) the single
 * form is using against a list of domains, one request at a time. Sequential on
 * purpose: Technitium's admin API is single-threaded on a LAN box, so a fan-out
 * of parallel resolves would only queue server-side and risk tripping rate
 * limits — the same reasoning the filtering bulk actions use.
 *
 * It never sets `import`: bulk-writing records into zones is far too destructive
 * for a one-click action, and the single-query form already covers that path with
 * an explicit toggle. Results can be exported as CSV for offline comparison.
 */

const MAX_DOMAINS = 100

export interface BulkResolvePanelProps {
  server: string
  type: QueryRecordType
  protocol: ResolverProtocol
  dnssec: boolean
  className?: string
}

interface BulkRow {
  domain: string
  ok: boolean
  rcode: string
  answers: number
  rttMs: number | null
}

/** Leading number of a pre-formatted duration such as "2.45 ms". */
function parseRttMs(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function BulkResolvePanel({ server, type, protocol, dnssec, className }: BulkResolvePanelProps) {
  const t = useTranslations('dnsClient')
  const tc = useTranslations('common')
  const locale = useLocaleCode()

  const [domainsText, setDomainsText] = React.useState('')
  const [rows, setRows] = React.useState<BulkRow[]>([])
  const [progress, setProgress] = React.useState<{ current: number; total: number } | null>(null)
  const [tooMany, setTooMany] = React.useState(false)

  const bulk = useMutation({
    mutationFn: async (domains: string[]) => {
      const collected: BulkRow[] = []
      for (let index = 0; index < domains.length; index += 1) {
        const domain = domains[index]
        setProgress({ current: index + 1, total: domains.length })
        try {
          const result = await resolve({ server, domain, type, protocol, dnssec })
          collected.push({
            domain,
            ok: true,
            rcode: result.result.RCODE,
            answers: result.result.ANCOUNT,
            rttMs: parseRttMs(result.result.Metadata?.RoundTripTime),
          })
        } catch (error) {
          collected.push({ domain, ok: false, rcode: describeError(error).message, answers: 0, rttMs: null })
        }
        setRows([...collected])
      }
      return collected
    },
    onSuccess: (collected) => {
      const ok = collected.filter((row) => row.ok).length
      toast.success(t('bulk.done', { ok, fail: collected.length - ok }))
      setProgress(null)
    },
    onError: (error) => {
      toast.error(describeError(error).message)
      setProgress(null)
    },
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const domains = domainsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (domains.length > MAX_DOMAINS) {
      setTooMany(true)
      return
    }
    setTooMany(false)
    if (domains.length === 0) return
    setRows([])
    bulk.mutate(domains)
  }

  function exportCsv() {
    const header = ['domain', 'status', 'answers', 'rttMs'].join(',')
    const body = rows.map((row) =>
      [row.domain, row.ok ? row.rcode : `ERROR: ${row.rcode}`, row.answers, row.rttMs ?? '']
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    saveBlob(blob, `bulk-resolve-${type}.csv`)
  }

  const columns = React.useMemo(
    () => [
      textColumn<BulkRow>({
        accessorKey: 'domain',
        header: t('bulk.columns.domain'),
        cell: (value) => <span className="font-data">{String(value)}</span>,
      }),
      textColumn<BulkRow>({
        accessorKey: 'rcode',
        header: t('bulk.columns.status'),
        cell: (value, row) =>
          row.ok ? (
            <Badge variant={row.rcode === 'NoError' ? 'success' : 'warning'} className="font-data">
              {String(value)}
            </Badge>
          ) : (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{String(value)}</span>
            </span>
          ),
      }),
      textColumn<BulkRow>({
        accessorKey: 'answers',
        header: t('bulk.columns.answers'),
        align: 'right',
        cell: (value) => <span className="font-data">{String(value)}</span>,
      }),
      textColumn<BulkRow>({
        id: 'rtt',
        header: t('bulk.columns.rtt'),
        align: 'right',
        cell: (_value, row) => <span className="font-data">{row.rttMs !== null ? formatRtt(row.rttMs, locale) : '—'}</span>,
      }),
    ],
    [t, locale],
  )

  const disabled = server.trim().length === 0

  return (
    <section data-slot="bulk-resolve" className={className}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="bulk-domains">{t('bulk.domainsLabel')}</FieldLabel>
          <Textarea
            id="bulk-domains"
            className="font-data min-h-28"
            value={domainsText}
            disabled={bulk.isPending}
            placeholder={t('bulk.domainsPlaceholder')}
            onChange={(event) => setDomainsText(event.target.value)}
          />
          <FieldDescription>{t('bulk.domainsHelp', { max: MAX_DOMAINS })}</FieldDescription>
          {tooMany && <FieldError>{t('bulk.tooMany', { max: MAX_DOMAINS })}</FieldError>}
          {disabled && <FieldError>{t('form.invalidServer')}</FieldError>}
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={bulk.isPending} disabled={disabled}>
            {!bulk.isPending && <ListChecks className="size-4" aria-hidden />}
            {progress ? t('bulk.running', { current: progress.current, total: progress.total }) : t('bulk.submit')}
          </Button>
          {rows.length > 0 && (
            <Button type="button" variant="outline" onClick={exportCsv} disabled={bulk.isPending}>
              <Download className="size-4" aria-hidden />
              {t('bulk.exportCsv')}
            </Button>
          )}
        </div>
      </form>

      {(rows.length > 0 || bulk.isPending) && (
        <DataTable
          className="mt-3"
          data={rows}
          columns={columns}
          loading={bulk.isPending && rows.length === 0}
          density="compact"
          enableSorting={false}
          clientPagination={{ pageSize: 25 }}
          empty={{ title: tc('table.empty'), body: tc('table.emptyHint') }}
          label={t('bulk.title')}
        />
      )}
    </section>
  )
}
