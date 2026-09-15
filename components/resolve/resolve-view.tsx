'use client'

import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as React from 'react'
import { BulkResolvePanel } from '@/components/resolve/bulk-resolve-panel'
import { HistoryPanel, useResolveHistory, type HistoryEntry } from '@/components/resolve/history-panel'
import { RawResponseViewer } from '@/components/resolve/raw-response-viewer'
import { ResolveForm, effectiveServer, type ResolveFormValues } from '@/components/resolve/resolve-form'
import { ResolveResult } from '@/components/resolve/resolve-result'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { PageShell, Section } from '@/components/app/page-shell'
import { describeError } from '@/lib/api/client'
import { DEFAULT_RESOLVER, resolve } from '@/lib/api/domains/dns-client'
import type { ResolveParams, ResolveResult as ResolveResultType } from '@/lib/api/types/dns-client'
import { queryKeys } from '@/lib/api/query-keys'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * DNS client — resolve-a-name-on-behalf tool.
 *
 * The page owns one piece of state (`ResolveFormValues`) that every child reads:
 * the single-query form, the mutation, the bulk panel and the history replay all
 * derive from it, so there is a single source of truth for "what am I about to
 * ask". Lifting it here (rather than into `ResolveForm`) is what lets a history
 * entry or the bulk panel reuse the exact same parameters.
 *
 * The query itself is a `useMutation`, not a `useQuery`: it is fired by an
 * explicit user action, may carry the `import` write side-effect, and must never
 * be silently re-run by a cache refetch or a window focus. Its result is shown
 * inline as an `ErrorState` on failure rather than a toast, because the result
 * region is exactly where an operator is looking.
 *
 * Non-obvious details:
 *  - The last submitted snapshot is kept in a ref so "retry" and "add as record"
 *    re-run the *queried* parameters even if the form has since been edited.
 *  - Importing writes into a zone, so on success it invalidates the `zones`
 *    subtree — the only write this otherwise read-only page can perform. It is
 *    also the only action here that can *create* a zone the operator never
 *    asked for, so it is gated behind a `ConfirmDialog` naming the domain;
 *    upstream stops with a `confirm()` for the same reason
 *    (`.probe/console-js/dnsclient.js:149-152`).
 *  - History is captured in `onSuccess` from the mutation `variables` (the
 *    snapshot), not from live state, so an in-flight edit cannot corrupt it.
 */

const DEFAULT_VALUES: ResolveFormValues = {
  preset: DEFAULT_RESOLVER,
  customServer: '',
  domain: '',
  type: 'A',
  protocol: 'UDP',
  dnssec: false,
  eDnsClientSubnet: '',
  import: false,
}

/** Build the API params from a form snapshot; `null` when it would be invalid. */
function toParams(values: ResolveFormValues): ResolveParams | null {
  const server = effectiveServer(values)
  const domain = values.domain.trim()
  if (!server || !domain) return null
  return {
    server,
    domain,
    type: values.type,
    protocol: values.protocol,
    dnssec: values.dnssec,
    eDnsClientSubnet: values.eDnsClientSubnet.trim() || undefined,
    import: values.import || undefined,
  }
}

/** Leading number of a pre-formatted duration such as "2.45 ms". */
function parseRttMs(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function ResolveView() {
  const t = useTranslations('dnsClient')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('DnsClient')
  const history = useResolveHistory()

  const [values, setValues] = React.useState<ResolveFormValues>(DEFAULT_VALUES)
  const lastRun = React.useRef<ResolveFormValues | null>(null)
  /** The snapshot awaiting confirmation, or `null` when the dialog is closed. */
  const [importTarget, setImportTarget] = React.useState<ResolveFormValues | null>(null)

  const handleChange = React.useCallback((patch: Partial<ResolveFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }))
  }, [])

  const mutation = useMutation<ResolveResultType, Error, ResolveFormValues>({
    mutationFn: (snapshot) => {
      const params = toParams(snapshot)
      if (!params) return Promise.reject(new Error('invalid query'))
      return resolve(params)
    },
    onSuccess: (result, snapshot) => {
      lastRun.current = snapshot
      history.add({
        id: makeId(),
        time: new Date().toISOString(),
        domain: snapshot.domain.trim(),
        type: snapshot.type,
        server: effectiveServer(snapshot),
        rcode: result.result.RCODE,
        rttMs: parseRttMs(result.result.Metadata?.RoundTripTime),
        values: snapshot,
      })
    },
  })

  const importMutation = useMutation<ResolveResultType, Error, ResolveFormValues>({
    mutationFn: (snapshot) => {
      const params = toParams({ ...snapshot, import: true })
      if (!params) return Promise.reject(new Error('invalid query'))
      return resolve(params)
    },
    onSuccess: () => {
      toast.success(tc('toast.created'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
      setImportTarget(null)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function submit(snapshot: ResolveFormValues) {
    if (!toParams(snapshot)) return
    lastRun.current = snapshot
    mutation.mutate(snapshot)
  }

  function handleReset() {
    setValues(DEFAULT_VALUES)
    lastRun.current = null
    mutation.reset()
  }

  function handleReplay(entry: HistoryEntry) {
    setValues(entry.values)
    submit(entry.values)
  }

  function handleImport() {
    // Opens the dialog rather than writing: the request can create a whole new
    // primary zone, and the operator should see which domain first.
    setImportTarget(lastRun.current ?? values)
  }

  const data = mutation.data
  const dnssecRequested = mutation.variables?.dnssec ?? values.dnssec

  return (
    <PageShell>
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section>
            <ResolveForm
              values={values}
              onChange={handleChange}
              onSubmit={() => submit(values)}
              onReset={handleReset}
              pending={mutation.isPending}
              canModify={can.canModify}
            />
          </Section>

          <ResolveResult
            data={data}
            isPending={mutation.isPending}
            error={mutation.error ?? undefined}
            onRetry={() => submit(lastRun.current ?? values)}
            dnssecRequested={dnssecRequested}
            canModify={can.canModify}
            onImport={handleImport}
            importing={importMutation.isPending}
          />

          {data && <RawResponseViewer rawResponses={data.rawResponses} />}

          <Section title={t('bulk.title')} description={t('bulk.subtitle')}>
            <BulkResolvePanel
              server={effectiveServer(values)}
              type={values.type}
              protocol={values.protocol}
              dnssec={values.dnssec}
            />
          </Section>
        </div>

        <HistoryPanel
          entries={history.entries}
          onReplay={handleReplay}
          onClear={history.clear}
          className="xl:sticky xl:top-0"
        />
      </div>

      <ConfirmDialog
        open={importTarget !== null}
        onOpenChange={(open) => !open && setImportTarget(null)}
        title={t('importConfirm.title')}
        description={t('importConfirm.body', { domain: importTarget?.domain.trim() || '' })}
        confirmLabel={importMutation.isPending ? t('importConfirm.submitting') : t('importConfirm.action')}
        tone="destructive"
        onConfirm={async () => {
          // Guarded even though the dialog only opens with a snapshot: `onConfirm`
          // can fire once more during the close animation.
          if (importTarget) await importMutation.mutateAsync(importTarget)
        }}
        pending={importMutation.isPending}
        error={importMutation.error ?? undefined}
      />
    </PageShell>
  )
}
