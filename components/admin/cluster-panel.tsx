'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ArrowUp,
  Crown,
  EllipsisVertical,
  Network,
  Plug,
  RefreshCw,
  RotateCcw,
  Server,
  Trash,
  TriangleAlert,
} from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import {
  deleteCluster,
  deleteSecondaryNode,
  getClusterState,
  initCluster,
  joinCluster,
  leaveCluster,
  promoteSecondary,
  removeSecondaryNode,
  resyncSecondary,
  setClusterOptions,
  updateClusterIpAddress,
  updatePrimaryServer,
} from '@/lib/api/domains/admin'
import { CLUSTER_NODE_STATES } from '@/lib/api/enums'
import { isDnsApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import type { ClusterNode, ClusterState } from '@/lib/api/types/admin'
import { useCan } from '@/lib/auth/session'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'
import { integerField, type NumberFieldMessages } from '@/lib/validation/number-field'

/**
 * Cluster tab: state, the node table and every cluster mutation.
 *
 * The panel is genuinely two different screens. Before initialisation
 * `admin/cluster/state` answers with *only* `{version, dnsServerDomain,
 * clusterInitialized}` — verified against a live v15.4 — so the uninitialised
 * branch shows this machine's identity and offers exactly two mutually
 * exclusive paths: become the primary (`admin/cluster/init`) or join someone
 * else's (`admin/cluster/initJoin`). Rendering the node table in that state
 * would show an empty grid that looks like a failure.
 *
 * Traps worth knowing before editing. Every one of these is a field or parameter
 * the response *does not* have, discovered by reading the stock console
 * (`.probe/console-js/cluster.js`) rather than by guessing:
 *
 *  - **There is no `isPrimaryNode`.** The response never says what role this
 *    machine has. Upstream derives it by scanning `clusterNodes` for the row
 *    whose `state` is `Self` and reading that row's `type` (`cluster.js:120-127`),
 *    and so does `selfNode` below. Trusting a made-up field instead hides the
 *    entire primary/secondary action area — the tab renders, looks fine, and can
 *    do nothing.
 *  - **`state: 'Self'` is the own-node marker.** It is also why `isThisNode`
 *    checks it first: `promoteSecondary`, `resyncSecondary`, `leaveCluster` and
 *    `updateClusterIpAddress` all act on *this* machine and take no node
 *    parameter, so offering them on a remote row would silently operate on the
 *    wrong box. The address intersection is only a fallback.
 *  - **Node states are `Self` / `Connected` / `Unreachable`.** Not
 *    `Online`/`Offline`/`Syncing`, which is what an earlier pass assumed; the
 *    label lookup falls back to the raw value so an unknown state degrades to
 *    text instead of a raw i18n key.
 *  - **`serverIpAddresses` needs `includeServerIpAddresses=true`.** Without it
 *    the field is absent even on an initialised cluster (`cluster.js:559`), so
 *    `getClusterState` sends it by default and every read still goes through
 *    `joinIps` / `?? []`.
 *  - **`deleteSecondaryNode` / `removeSecondaryNode` are keyed by id, not name.**
 *    Upstream reads `secondaryNodeId`, so the row's `node.id` is what goes in.
 *    Passing `node.name` would delete nothing and report success.
 *  - **Three mutations carry a "force" flag** — `primary/delete?forceDelete`,
 *    `secondary/leave?forceLeave`, `secondary/promote?forceDeletePrimary` — and
 *    each one is the only way to complete that operation when the other node is
 *    already gone. They live in the confirm dialog, not behind a second menu item.
 *  - **Every cluster parameter name comes from the upstream source, not from
 *    intuition.** `admin/cluster/*` answers `status: ok` to a parameter it does
 *    not recognise and then does nothing, so a plausible name is worse than a
 *    rejected one: the toast says it worked. `scripts/audit-params.mjs` diffs
 *    the SDK against `.probe/console-js` to keep this honest.
 */

export function ClusterPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Administration')

  const [initOpen, setInitOpen] = React.useState(false)
  const [joinOpen, setJoinOpen] = React.useState(false)
  const [optionsOpen, setOptionsOpen] = React.useState(false)
  const [primaryOpen, setPrimaryOpen] = React.useState(false)
  const [ipOpen, setIpOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<ClusterConfirm | null>(null)
  /**
   * The confirm dialog's force checkbox, shared by the three mutations that
   * have one. Held here rather than in the dialog because the mutation runs
   * from `run` and must see the value at submit time; cleared whenever the
   * dialog closes so a ticked box never survives into the next confirmation.
   */
  const [force, setForce] = React.useState(false)

  const state = useQuery({
    queryKey: queryKeys.clusterState(target),
    // `includeServerIpAddresses` is what makes `serverIpAddresses` appear at all;
    // the SDK defaults it on, and stating it here keeps the dependency obvious.
    queryFn: () => getClusterState({ includeServerIpAddresses: true }),
    enabled: can.canView,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cluster(target) })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  /** Every non-dialog cluster mutation funnels through here. */
  const run = useMutation({
    mutationFn: (action: ClusterAction) => {
      switch (action.kind) {
        case 'deleteCluster':
          return deleteCluster(force)
        case 'leave':
          return leaveCluster({ forceLeave: force })
        case 'promote':
          return promoteSecondary({ forceDeletePrimary: force })
        case 'resync':
          return resyncSecondary()
        case 'deleteSecondary':
          return deleteSecondaryNode(action.node.id)
        case 'removeSecondary':
          return removeSecondaryNode(action.node.id)
      }
    },
    onSuccess: (_data, action) => {
      toast.success(successMessage(action))
      invalidate()
      setConfirm(null)
    },
    onError,
  })

  function successMessage(action: ClusterAction): string {
    switch (action.kind) {
      case 'deleteCluster':
        return t('cluster.delete.success')
      case 'leave':
        return t('cluster.secondary.leaveSuccess')
      case 'promote':
        return t('cluster.secondary.promoteSuccess')
      case 'resync':
        return t('cluster.secondary.resyncSuccess')
      case 'deleteSecondary':
        return t('cluster.nodes.deleteSecondarySuccess')
      case 'removeSecondary':
        return t('cluster.nodes.removeSecondarySuccess')
    }
  }

  /** Confirm-dialog copy, resolved here so `t` keeps its narrow key type. */
  function copyFor(action: ClusterAction): { title: string; description: string; label: string } {
    switch (action.kind) {
      case 'deleteCluster':
        return {
          title: t('cluster.delete.title'),
          description: t('cluster.delete.body'),
          label: t('cluster.delete.submit'),
        }
      case 'leave':
        return {
          title: t('cluster.secondary.leave'),
          description: t('cluster.secondary.leaveConfirm'),
          label: t('cluster.secondary.leave'),
        }
      case 'promote':
        return {
          title: t('cluster.secondary.promote'),
          description: t('cluster.secondary.promoteConfirm'),
          label: t('cluster.secondary.promote'),
        }
      case 'resync':
        return {
          title: t('cluster.secondary.resync'),
          description: t('cluster.secondary.resyncConfirm'),
          label: t('cluster.secondary.resync'),
        }
      case 'deleteSecondary':
        return {
          title: t('cluster.nodes.deleteSecondary'),
          description: t('cluster.nodes.deleteSecondaryConfirm', {
            name: action.node.name || action.node.id,
          }),
          label: t('cluster.nodes.deleteSecondary'),
        }
      case 'removeSecondary':
        return {
          title: t('cluster.nodes.removeSecondary'),
          description: t('cluster.nodes.removeSecondaryConfirm', {
            name: action.node.name || action.node.id,
          }),
          label: t('cluster.nodes.removeSecondary'),
        }
    }
  }

  const data = state.data
  const nodes = data?.clusterNodes ?? []
  const initialized = data?.clusterInitialized === true
  const requireText = (data?.clusterDomain ?? data?.dnsServerDomain ?? '').trim() || undefined

  /**
   * This machine's row, and the role that comes with it. The response has no
   * `isPrimaryNode`; upstream finds the node marked `Self` and reads its `type`
   * (`.probe/console-js/cluster.js:120-127`), which is the only signal that
   * exists. `undefined` while the cluster is uninitialised or the list has not
   * arrived yet, and the action areas stay hidden until it resolves.
   */
  const selfNode = nodes.find((node) => node.state === 'Self')
  const selfType = selfNode?.type
  const isPrimary = selfType === 'Primary'
  const isSecondary = selfType === 'Secondary'
  /** The cluster's primary row, if there is one — the prefill for "update primary". */
  const primaryNode = nodes.find((node) => node.type === 'Primary')
  const primaryNodeName = primaryNode?.name

  /**
   * Stable identity on purpose: both init dialogs take this as an effect
   * dependency, and a fresh `?? []` literal every render would re-run them.
   */
  const defaultIps = React.useMemo(() => data?.serverIpAddresses ?? [], [data])

  const columns = React.useMemo(
    () => [
      textColumn<ClusterNode>({
        id: 'name',
        accessorKey: 'name',
        header: t('cluster.nodes.columns.name'),
        cell: (value, row) => (
          <span className="inline-flex items-center gap-2">
            <span className="font-data text-sm">{String(value) || row.id}</span>
            {isThisNode(row, data) ? <Badge variant="outline">{t('cluster.nodes.selfBadge')}</Badge> : null}
          </span>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'url',
        accessorKey: 'url',
        header: t('cluster.nodes.columns.url'),
        cell: (value) => <span className="font-data text-xs">{String(value) || '—'}</span>,
      }),
      textColumn<ClusterNode>({
        id: 'type',
        accessorKey: 'type',
        header: t('cluster.nodes.columns.type'),
        cell: (value) => (
          <Badge variant={value === 'Primary' ? 'info' : 'secondary'}>
            {value === 'Primary' ? <Crown className="size-3" aria-hidden /> : null}
            {nodeTypeLabel(String(value), t)}
          </Badge>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'state',
        accessorKey: 'state',
        header: t('cluster.nodes.columns.state'),
        cell: (value) => (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <StatusDot tone={stateTone(String(value))} />
            {nodeStateLabel(String(value), t)}
          </span>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'ipAddresses',
        accessorKey: 'ipAddresses',
        header: t('cluster.nodes.columns.ipAddresses'),
        enableSorting: false,
        cell: (value) => (
          <span className="font-data block max-w-48 truncate text-xs" title={joinIps(value as string[] | undefined)}>
            {joinIps(value as string[] | undefined) || '—'}
          </span>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'upSince',
        accessorKey: 'upSince',
        header: t('cluster.nodes.columns.upSince'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground" title={formatDateTime(value as string | null, locale)}>
            {formatRelative(value as string | null, locale)}
          </span>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'lastSeen',
        accessorKey: 'lastSeen',
        header: t('cluster.nodes.columns.lastSeen'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground" title={formatDateTime(value as string | null, locale)}>
            {formatRelative(value as string | null, locale)}
          </span>
        ),
      }),
      textColumn<ClusterNode>({
        id: 'configLastSynced',
        accessorKey: 'configLastSynced',
        header: t('cluster.nodes.columns.configLastSynced'),
        cell: (value) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(value as string | null, locale)}</span>
        ),
      }),
      ...(can.canModify
        ? [
            textColumn<ClusterNode>({
              id: 'actions',
              header: t('cluster.nodes.columns.actions'),
              align: 'right' as const,
              hug: true,
              enableSorting: false,
              cell: (_value: unknown, row: ClusterNode) => (
                <NodeRowActions
                  row={row}
                  state={data ?? null}
                  canModify={can.canModify}
                  canDelete={can.canDelete}
                  onConfirm={setConfirm}
                  onEditPrimary={() => setPrimaryOpen(true)}
                  onEditIp={() => setIpOpen(true)}
                />
              ),
            }),
          ]
        : []),
    ],
    [t, locale, can.canModify, can.canDelete, data],
  )

  if (state.isPending) {
    return (
      <Section title={t('cluster.title')} description={t('cluster.subtitle')}>
        <LoadingState rows={5} />
      </Section>
    )
  }

  if (state.error) {
    return (
      <Section title={t('cluster.title')} description={t('cluster.subtitle')}>
        <ErrorState error={state.error} onRetry={() => void state.refetch()} />
      </Section>
    )
  }

  return (
    <>
      <Section
        title={t('cluster.title')}
        description={t('cluster.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void state.refetch()} loading={state.isFetching}>
            {!state.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
            {t('cluster.state.refresh')}
          </Button>
        }
      >
        {data && (
          <div className="flex flex-col gap-4">
            <DefinitionList
              items={[
                {
                  label: t('cluster.state.status'),
                  value: (
                    <Badge variant={initialized ? 'success' : 'muted'}>
                      {initialized ? t('cluster.state.initialized') : t('cluster.state.notInitialized')}
                    </Badge>
                  ),
                },
                { label: t('cluster.state.version'), value: <span className="font-data">{data.version}</span> },
                {
                  label: t('cluster.state.dnsServerDomain'),
                  value: <span className="font-data">{data.dnsServerDomain}</span>,
                },
                {
                  label: t('cluster.state.serverIpAddresses'),
                  value: <span className="font-data">{joinIps(data.serverIpAddresses) || tc('fields.none')}</span>,
                },
                {
                  label: t('cluster.state.clusterDomain'),
                  value: data.clusterDomain ? <span className="font-data">{data.clusterDomain}</span> : tc('fields.none'),
                },
                {
                  label: t('cluster.state.primaryNode'),
                  value: primaryNodeName ? <span className="font-data">{primaryNodeName}</span> : tc('fields.none'),
                },
                {
                  label: t('cluster.state.thisNode'),
                  value:
                    selfType === undefined ? (
                      tc('fields.unknown')
                    ) : (
                      <Badge variant={isPrimary ? 'info' : 'secondary'}>{nodeTypeLabel(selfType, t)}</Badge>
                    ),
                },
                // The four intervals only exist once a cluster does, and only the
                // primary may change them — showing them read-only here is what
                // makes the options button unnecessary on a secondary.
                ...(initialized
                  ? INTERVAL_FIELDS.map((field) => {
                      // Hoisted to a const on purpose: `field.key` is a union of
                      // four literals, and TypeScript does not narrow an element
                      // access whose key is a union, so `data[field.key]` stays
                      // `number | undefined` in the false branch and the
                      // `{value}` placeholder would not type-check.
                      const seconds = data[field.key]
                      return {
                        label: t(`cluster.primary.${field.key}`),
                        value: (
                          <span className="font-data">
                            {seconds === undefined
                              ? tc('fields.unknown')
                              : t('cluster.primary.secondsValue', { value: seconds })}
                          </span>
                        ),
                      }
                    })
                  : []),
              ]}
            />
          </div>
        )}
      </Section>

      {!initialized ? (
        <Section>
          <EmptyState
            icon={Network}
            title={t('cluster.notInitialized.title')}
            body={t('cluster.notInitialized.body')}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {can.canModify && (
                  <Button size="sm" onClick={() => setInitOpen(true)}>
                    <Server className="size-3.5" aria-hidden />
                    {t('cluster.notInitialized.init')}
                  </Button>
                )}
                {can.canModify && (
                  <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)}>
                    <Plug className="size-3.5" aria-hidden />
                    {t('cluster.join.title')}
                  </Button>
                )}
              </div>
            }
          />
        </Section>
      ) : (
        <>
          <DataTable<ClusterNode>
            label={t('cluster.nodes.title')}
            columns={columns}
            data={nodes}
            getRowId={(row) => row.id}
            // A fresh object, never `false`: see the note in permissions-panel —
            // `DataTable` freezes its row list when this prop is referentially
            // stable, and the cluster state arrives after the first render.
            clientPagination={{ pageSize: 25 }}
            empty={{ title: t('cluster.nodes.empty'), icon: Network }}
            footerNote={t('cluster.nodes.totalNodes', { count: nodes.length })}
          />

          {isPrimary && (
            <Section title={t('cluster.primary.title')} description={t('cluster.primary.titleHelp')}>
              <div className="flex flex-wrap items-center gap-2">
                {can.canModify && (
                  <Button variant="outline" size="sm" onClick={() => setOptionsOpen(true)}>
                    <Server className="size-3.5" aria-hidden />
                    {t('cluster.primary.setOptions')}
                  </Button>
                )}
                {can.canModify && (
                  <Button variant="outline" size="sm" onClick={() => setIpOpen(true)}>
                    <Network className="size-3.5" aria-hidden />
                    {t('cluster.ipAddress.title')}
                  </Button>
                )}
                {can.canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirm({ kind: 'deleteCluster' })}
                  >
                    <Trash className="size-3.5" aria-hidden />
                    {t('cluster.delete.action')}
                  </Button>
                )}
              </div>
            </Section>
          )}

          {isSecondary && (
            <Section title={t('cluster.secondary.title')}>
              <div className="flex flex-col gap-3">
                <ClusterActionRow
                  label={t('cluster.secondary.promote')}
                  hint={t('cluster.secondary.promoteHint')}
                  disabled={!can.canModify}
                  onClick={() => setConfirm({ kind: 'promote' })}
                  icon={<ArrowUp className="size-3.5" aria-hidden />}
                />
                <ClusterActionRow
                  label={t('cluster.secondary.resync')}
                  hint={t('cluster.secondary.resyncHint')}
                  disabled={!can.canModify}
                  onClick={() => setConfirm({ kind: 'resync' })}
                  icon={<RotateCcw className="size-3.5" aria-hidden />}
                />
                <ClusterActionRow
                  label={t('cluster.secondary.updatePrimary')}
                  hint={t('cluster.secondary.updatePrimaryHelp')}
                  disabled={!can.canModify}
                  onClick={() => setPrimaryOpen(true)}
                  icon={<Server className="size-3.5" aria-hidden />}
                />
                <ClusterActionRow
                  label={t('cluster.ipAddress.title')}
                  hint={t('cluster.ipAddress.hint')}
                  disabled={!can.canModify}
                  onClick={() => setIpOpen(true)}
                  icon={<Network className="size-3.5" aria-hidden />}
                />
                <ClusterActionRow
                  label={t('cluster.secondary.leave')}
                  hint={t('cluster.secondary.leaveConfirm')}
                  disabled={!can.canDelete}
                  destructive
                  onClick={() => setConfirm({ kind: 'leave' })}
                  icon={<Trash className="size-3.5" aria-hidden />}
                />
              </div>
            </Section>
          )}
        </>
      )}

      <InitClusterDialog
        open={initOpen}
        onOpenChange={setInitOpen}
        onDone={invalidate}
        defaultIpAddresses={defaultIps}
      />
      <JoinClusterDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onDone={invalidate}
        defaultIpAddresses={defaultIps}
      />

      <ClusterOptionsDialog open={optionsOpen} onOpenChange={setOptionsOpen} onDone={invalidate} state={data} />

      <UpdatePrimaryDialog
        open={primaryOpen}
        onOpenChange={setPrimaryOpen}
        onDone={invalidate}
        primaryNode={primaryNode}
      />

      <ClusterIpDialog
        open={ipOpen}
        onOpenChange={setIpOpen}
        onDone={invalidate}
        selfNode={selfNode}
        serverIpAddresses={defaultIps}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (open) return
          setConfirm(null)
          setForce(false)
        }}
        title={confirm ? copyFor(confirm).title : ''}
        description={confirm ? copyFor(confirm).description : undefined}
        confirmLabel={confirm ? copyFor(confirm).label : undefined}
        requireText={
          confirm && (confirm.kind === 'deleteCluster' || confirm.kind === 'leave') ? requireText : undefined
        }
        onConfirm={async () => {
          if (confirm) await run.mutateAsync(confirm)
        }}
        pending={run.isPending}
        error={run.error ?? undefined}
      >
        {confirm ? <ForceOption action={confirm} checked={force} onCheckedChange={setForce} /> : null}
        {confirm && (confirm.kind === 'deleteSecondary' || confirm.kind === 'removeSecondary') ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>{copyFor(confirm).title}</AlertTitle>
            <AlertDescription>
              {confirm.kind === 'deleteSecondary'
                ? t('cluster.nodes.deleteSecondaryHint')
                : t('cluster.nodes.removeSecondaryHint')}
            </AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  )
}

/* ------------------------------------------------------------------ */

type ClusterAction =
  | { kind: 'deleteCluster' }
  | { kind: 'leave' }
  | { kind: 'promote' }
  | { kind: 'resync' }
  | { kind: 'deleteSecondary'; node: ClusterNode }
  | { kind: 'removeSecondary'; node: ClusterNode }

type ClusterConfirm = ClusterAction

function stateTone(value: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (value) {
    case 'Self':
      return 'info'
    case 'Connected':
      return 'success'
    case 'Unreachable':
      return 'warning'
    default:
      return 'neutral'
  }
}

/**
 * Derived from the enum rather than spelled out again: `labelCoverage` in
 * `tests/node/enums.test.ts` pins `CLUSTER_NODE_STATES` against the message
 * bundle, so a value added there without a label fails the build instead of
 * showing up as a raw i18n key in the state column.
 */
const NODE_STATES = new Set<string>(CLUSTER_NODE_STATES)

/**
 * The four `primary/setOptions` intervals with the ranges and defaults the stock
 * console prints on the form itself (`.probe/console-js/index.html:7137-7176`).
 *
 * One table drives both the read-only state rows and the edit dialog's bounds,
 * so a range shown in the help text can never disagree with the one the schema
 * enforces — a mismatch there would let an operator type a value the dialog
 * advertises as legal and then be told it is not.
 */
const INTERVAL_FIELDS = [
  { key: 'heartbeatRefreshIntervalSeconds', min: 10, max: 300, fallback: 30 },
  { key: 'heartbeatRetryIntervalSeconds', min: 10, max: 300, fallback: 10 },
  { key: 'configRefreshIntervalSeconds', min: 30, max: 3600, fallback: 900 },
  { key: 'configRetryIntervalSeconds', min: 30, max: 3600, fallback: 60 },
] as const

type IntervalKey = (typeof INTERVAL_FIELDS)[number]['key']

const INTERVAL_BOUNDS = Object.fromEntries(INTERVAL_FIELDS.map((field) => [field.key, field])) as Record<
  IntervalKey,
  (typeof INTERVAL_FIELDS)[number]
>

/**
 * Labels that fall back to the raw wire value instead of a template key. Both
 * columns render whatever the server sent, and a value outside the known set
 * must degrade to readable text — `t(\`cluster.nodes.states.${value}\`)` would
 * paint `admin.cluster.nodes.states.Something` straight into the cell.
 */
function nodeTypeLabel(value: string, t: (key: string) => string): string {
  return value === 'Primary' || value === 'Secondary' ? t(`cluster.nodes.types.${value}`) : value || '—'
}

function nodeStateLabel(value: string, t: (key: string) => string): string {
  return NODE_STATES.has(value) ? t(`cluster.nodes.states.${value}`) : value || '—'
}

/**
 * Best-effort "is this row us?". `state: 'Self'` is upstream's own marker and
 * wins outright; the address intersection is only a fallback for a server that
 * does not send it. Returns false rather than guessing when neither applies — a
 * wrong positive would let the operator promote or resync a *remote* node using
 * an endpoint that only ever acts locally.
 */
function isThisNode(node: ClusterNode, state: ClusterState | null | undefined): boolean {
  if (node.state === 'Self') return true
  if (!state) return false
  const mine = new Set(state.serverIpAddresses ?? [])
  // No addresses to compare against means no evidence, not a match.
  if (mine.size === 0) return false
  return (node.ipAddresses ?? []).some((ip) => mine.has(ip))
}

/**
 * Comma-joins an address list that the server may not have sent at all — see the
 * `serverIpAddresses` trap in the file header. Joining the raw field took the
 * entire tab down with `undefined.join` on an uninitialised server.
 */
function joinIps(value: string[] | null | undefined): string {
  return (value ?? []).join(', ')
}

/* ------------------------------------------------------------------ */

interface NodeRowActionsProps {
  row: ClusterNode
  state: ClusterState | null
  canModify: boolean
  canDelete: boolean
  onConfirm: (action: ClusterAction) => void
  onEditPrimary: () => void
  onEditIp: () => void
}

function NodeRowActions({
  row,
  state,
  canModify,
  canDelete,
  onConfirm,
  onEditPrimary,
  onEditIp,
}: NodeRowActionsProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const mine = isThisNode(row, state)
  const secondary = row.type === 'Secondary'
  /**
   * `primary/removeSecondary` and `primary/deleteSecondary` are primary-only
   * endpoints — called from a secondary they can only fail, so offering them
   * there is a button that exists to produce an error toast.
   *
   * Upstream reaches the same place structurally rather than with a guard: its
   * row menu is a `switch` on this node's own type, and the Secondary branch
   * never emits a remove item at all (`.probe/console-js/cluster.js:214-244`).
   *
   * There is deliberately no per-row "edit primary" either. A cluster has
   * exactly one Primary row, and the secondary action panel already exposes
   * `updatePrimary` prefilled from it, so a row-level duplicate would be a
   * second place to keep in sync without adding a capability.
   */
  const selfIsPrimary = (state?.clusterNodes ?? []).some(
    (node) => node.state === 'Self' && node.type === 'Primary',
  )

  // Everything below is either gated on this being our own row or on this being
  // a secondary we are allowed to remove, so a row that is neither — the common
  // case for the *other* secondaries when this node is one of them — would
  // render a trigger that opens an empty menu. Upstream omits the dropdown
  // entirely in that case, and so does this.
  const hasSelfActions = canModify && mine
  const hasRemoveActions = canDelete && selfIsPrimary && secondary && !mine

  if (!hasSelfActions && !hasRemoveActions) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {/* promote / resync / updatePrimary / cluster IP all act on *this*
            machine upstream, so they are only offered on our own row. */}
        {canModify && mine && secondary && (
          <>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onConfirm({ kind: 'promote' })
              }}
            >
              <ArrowUp aria-hidden />
              {t('cluster.secondary.promote')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onConfirm({ kind: 'resync' })
              }}
            >
              <RotateCcw aria-hidden />
              {t('cluster.secondary.resync')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onEditPrimary()
              }}
            >
              <Server aria-hidden />
              {t('cluster.secondary.updatePrimary')}
            </DropdownMenuItem>
          </>
        )}
        {canModify && mine && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onEditIp()
            }}
          >
            <Network aria-hidden />
            {t('cluster.ipAddress.title')}
          </DropdownMenuItem>
        )}
        {canDelete && selfIsPrimary && secondary && !mine && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault()
                onConfirm({ kind: 'removeSecondary', node: row })
              }}
            >
              <Trash aria-hidden />
              {t('cluster.nodes.removeSecondary')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault()
                onConfirm({ kind: 'deleteSecondary', node: row })
              }}
            >
              <Trash aria-hidden />
              {t('cluster.nodes.deleteSecondary')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ------------------------------------------------------------------ */

function ClusterActionRow({
  label,
  hint,
  icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className={destructive ? 'text-destructive hover:text-destructive' : undefined}
      >
        {icon}
        {label}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface InitClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** This machine's addresses, offered as the starting point for the list. */
  defaultIpAddresses: string[]
}

/**
 * Both fields are mandatory upstream, which answers an empty one with
 * `Parameter 'x' missing.`; the stock console blocks the same submit before it
 * leaves the browser (`.probe/console-js/cluster.js:596-608`). Guarding here
 * means a bare click on "Initialize" is not a real write attempt.
 *
 * `superRefine` rather than `.refine` for the address list so the operator sees
 * *which* of the two failures happened — an empty box and a malformed address
 * have different copy, and `invalidAddresses` already picks between them.
 */
const initSchema = (required: string, invalidIp: string) =>
  z.object({
    clusterDomain: z.string().trim().min(1, required),
    primaryNodeIpAddresses: z.string().superRefine((value, ctx) => {
      const bad = invalidAddresses(value, required, invalidIp)
      if (bad !== null) ctx.addIssue({ code: 'custom', message: bad })
    }),
  })

type InitFormValues = z.infer<ReturnType<typeof initSchema>>

const EMPTY_INIT: InitFormValues = { clusterDomain: '', primaryNodeIpAddresses: '' }

/** `admin/cluster/init` — turn this machine into the cluster primary. */
function InitClusterDialog({ open, onOpenChange, onDone, defaultIpAddresses }: InitClusterDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const schema = React.useMemo(() => initSchema(tc('form.required'), tc('form.invalidIp')), [tc])
  const resolver = React.useMemo(() => zodResolver(schema), [schema])
  const form = useForm<InitFormValues>({ resolver, defaultValues: EMPTY_INIT })
  const { errors } = form.formState

  // Re-seed on every opening rather than relying on `defaultValues`, which RHF
  // reads once at mount: `defaultIpAddresses` arrives with the cluster state,
  // which lands after this dialog is already mounted.
  React.useEffect(() => {
    if (open) form.reset({ ...EMPTY_INIT, primaryNodeIpAddresses: defaultIpAddresses.join('\n') })
  }, [open, defaultIpAddresses, form])

  const init = useMutation({
    mutationFn: (values: InitFormValues) =>
      initCluster({
        clusterDomain: values.clusterDomain.trim(),
        // Upstream sends one comma-joined list, not repeated parameters
        // (`.probe/console-js/cluster.js:614`).
        primaryNodeIpAddresses: toList(values.primaryNodeIpAddresses),
      }),
    onSuccess: () => {
      toast.success(t('cluster.notInitialized.success'))
      onDone()
      onOpenChange(false)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  function close() {
    onOpenChange(false)
    // Deferred so the close animation is not interrupted. The fields themselves
    // are re-seeded by the open effect above; only the mutation error needs
    // clearing, or a failed attempt greets the operator on the next visit.
    setTimeout(() => init.reset(), 0)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('cluster.notInitialized.initTitle')}</DialogTitle>
          <DialogDescription>{t('cluster.notInitialized.body')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => void init.mutateAsync(values))}
        >
          <Field>
            <FieldLabel htmlFor="ci-domain" required>
              {t('cluster.notInitialized.clusterDomain')}
            </FieldLabel>
            <Input
              id="ci-domain"
              className="font-data"
              autoComplete="off"
              aria-invalid={Boolean(errors.clusterDomain)}
              {...form.register('clusterDomain')}
            />
            <FieldDescription>{t('cluster.notInitialized.clusterDomainHelp')}</FieldDescription>
            <FieldError>{errors.clusterDomain?.message}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="ci-ips" required>
              {t('cluster.notInitialized.primaryNodeIpAddresses')}
            </FieldLabel>
            <Textarea
              id="ci-ips"
              className="font-data"
              rows={3}
              autoComplete="off"
              aria-invalid={Boolean(errors.primaryNodeIpAddresses)}
              {...form.register('primaryNodeIpAddresses')}
            />
            <FieldDescription>{t('cluster.notInitialized.primaryNodeIpAddressesHelp')}</FieldDescription>
            <FieldError>{errors.primaryNodeIpAddresses?.message}</FieldError>
          </Field>

          {init.error ? <ErrorState error={init.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={init.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={init.isPending}>
              {!init.isPending && <Server className="size-4" aria-hidden />}
              {init.isPending ? t('cluster.notInitialized.submitting') : t('cluster.notInitialized.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

interface JoinClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** This machine's addresses, offered as the starting point for the list. */
  defaultIpAddresses: string[]
}

const joinSchema = (invalidUrl: string, invalidIp: string, required: string) =>
  z.object({
    secondaryNodeIpAddresses: z.string().min(1, required),
    primaryNodeUrl: z.string().trim().refine(isHttpUrl, invalidUrl),
    primaryNodeIpAddress: z
      .string()
      .trim()
      .refine((value) => value === '' || isIpAddress(value), invalidIp),
    ignoreCertificateErrors: z.boolean(),
    primaryNodeUsername: z.string().trim().min(1, required),
    primaryNodePassword: z.string().min(1, required),
    primaryNodeTotp: z.string().trim(),
  })

type JoinFormValues = z.infer<ReturnType<typeof joinSchema>>

const EMPTY_JOIN: JoinFormValues = {
  secondaryNodeIpAddresses: '',
  primaryNodeUrl: '',
  primaryNodeIpAddress: '',
  ignoreCertificateErrors: false,
  primaryNodeUsername: 'admin',
  primaryNodePassword: '',
  primaryNodeTotp: '',
}

/**
 * `admin/cluster/initJoin` — attach this machine to an existing primary.
 *
 * The handshake is authorised with the primary's *administrator credentials*,
 * not a shared secret: this node logs in there once to pull the configuration.
 * When that administrator has 2FA enabled the first attempt answers
 * `two_factor_required`, which is what reveals the OTP field — the stock console
 * does the same and additionally locks the password box at that point, because
 * the password has already been accepted and re-sending a stale one would only
 * produce a confusing second failure.
 */
function JoinClusterDialog({ open, onOpenChange, onDone, defaultIpAddresses }: JoinClusterDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [needsTotp, setNeedsTotp] = React.useState(false)

  const schema = React.useMemo(
    () => joinSchema(tc('form.invalidUrl'), tc('form.invalidIp'), tc('form.required')),
    [tc],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])
  const form = useForm<JoinFormValues>({ resolver, defaultValues: EMPTY_JOIN })

  React.useEffect(() => {
    if (open) {
      form.setValue('secondaryNodeIpAddresses', defaultIpAddresses.join('\n'), { shouldDirty: false })
    }
  }, [open, defaultIpAddresses, form])

  const join = useMutation({
    mutationFn: (values: JoinFormValues) =>
      joinCluster({
        secondaryNodeIpAddresses: toList(values.secondaryNodeIpAddresses),
        primaryNodeUrl: values.primaryNodeUrl.trim(),
        ...(values.primaryNodeIpAddress.trim() ? { primaryNodeIpAddress: values.primaryNodeIpAddress.trim() } : {}),
        ignoreCertificateErrors: values.ignoreCertificateErrors,
        primaryNodeUsername: values.primaryNodeUsername.trim(),
        primaryNodePassword: values.primaryNodePassword,
        // Only sent once the server has asked for it; an empty OTP on the first
        // attempt would be indistinguishable from a wrong one.
        ...(needsTotp ? { primaryNodeTotp: values.primaryNodeTotp } : {}),
      }),
    onSuccess: () => {
      toast.success(t('cluster.join.success'))
      onDone()
      close()
    },
    onError: (error) => {
      if (isDnsApiError(error) && error.code === 'two_factor_required') {
        setNeedsTotp(true)
        return
      }
      toast.error(describeError(error).message)
    },
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      form.reset(EMPTY_JOIN)
      setNeedsTotp(false)
      join.reset()
    }, 0)
  }

  // `useWatch`, not `form.watch`: the React Compiler lint rule flags the latter
  // as an unmemoisable API and skips compiling the whole dialog.
  const ignoreCertificateErrors = useWatch({ control: form.control, name: 'ignoreCertificateErrors' })
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('cluster.join.title')}</DialogTitle>
          <DialogDescription>{t('cluster.join.body')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => void join.mutateAsync(values))}
        >
          <Field>
            <FieldLabel htmlFor="cj-ips" required>
              {t('cluster.join.secondaryNodeIpAddresses')}
            </FieldLabel>
            <Textarea
              id="cj-ips"
              className="font-data"
              rows={2}
              autoComplete="off"
              aria-invalid={Boolean(errors.secondaryNodeIpAddresses)}
              {...form.register('secondaryNodeIpAddresses')}
            />
            <FieldDescription>{t('cluster.join.secondaryNodeIpAddressesHelp')}</FieldDescription>
            <FieldError>{errors.secondaryNodeIpAddresses?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="cj-url" required>
              {t('cluster.join.primaryNodeUrl')}
            </FieldLabel>
            <Input
              id="cj-url"
              className="font-data"
              autoComplete="off"
              placeholder={t('cluster.join.primaryNodeUrlPlaceholder')}
              aria-invalid={Boolean(errors.primaryNodeUrl)}
              {...form.register('primaryNodeUrl')}
            />
            <FieldError>{errors.primaryNodeUrl?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="cj-ip">{t('cluster.join.primaryNodeIpAddress')}</FieldLabel>
            <Input
              id="cj-ip"
              className="font-data"
              autoComplete="off"
              aria-invalid={Boolean(errors.primaryNodeIpAddress)}
              {...form.register('primaryNodeIpAddress')}
            />
            <FieldDescription>{t('cluster.join.primaryNodeIpAddressHelp')}</FieldDescription>
            <FieldError>{errors.primaryNodeIpAddress?.message}</FieldError>
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
            <div className="min-w-0">
              <label htmlFor="cj-cert" className="text-sm font-medium">
                {t('cluster.join.ignoreCertificateErrors')}
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('cluster.join.ignoreCertificateErrorsHelp')}</p>
            </div>
            <Switch
              id="cj-cert"
              checked={ignoreCertificateErrors}
              onCheckedChange={(value) => form.setValue('ignoreCertificateErrors', value === true)}
            />
          </div>

          {ignoreCertificateErrors && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertDescription>{t('cluster.join.ignoreCertificateErrorsHelp')}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">{t('cluster.join.credentialsTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('cluster.join.credentialsHelp')}</p>
            </div>

            <Field>
              <FieldLabel htmlFor="cj-user" required>
                {t('cluster.join.primaryNodeUsername')}
              </FieldLabel>
              <Input
                id="cj-user"
                className="font-data"
                autoComplete="off"
                aria-invalid={Boolean(errors.primaryNodeUsername)}
                {...form.register('primaryNodeUsername')}
              />
              <FieldError>{errors.primaryNodeUsername?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="cj-pass" required>
                {t('cluster.join.primaryNodePassword')}
              </FieldLabel>
              <Input
                id="cj-pass"
                type="password"
                autoComplete="off"
                disabled={needsTotp}
                aria-invalid={Boolean(errors.primaryNodePassword)}
                {...form.register('primaryNodePassword')}
              />
              <FieldError>{errors.primaryNodePassword?.message}</FieldError>
            </Field>

            {needsTotp && (
              <Field>
                <FieldLabel htmlFor="cj-totp" required>
                  {t('cluster.join.primaryNodeTotp')}
                </FieldLabel>
                <Input
                  id="cj-totp"
                  className="font-data tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  aria-invalid={Boolean(errors.primaryNodeTotp)}
                  {...form.register('primaryNodeTotp')}
                />
                <FieldDescription>{t('cluster.join.primaryNodeTotpHelp')}</FieldDescription>
                <FieldError>{errors.primaryNodeTotp?.message}</FieldError>
              </Field>
            )}
          </div>

          {join.error ? <ErrorState error={join.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={join.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={join.isPending}>
              {!join.isPending && <Plug className="size-4" aria-hidden />}
              {join.isPending ? t('cluster.join.submitting') : t('cluster.join.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

/** Force-checkbox copy for the three actions that have one; `null` otherwise. */
function forceCopy(
  action: ClusterAction,
  t: (key: string) => string,
): { label: string; hint: string } | null {
  switch (action.kind) {
    case 'deleteCluster':
      return { label: t('cluster.delete.forceDelete'), hint: t('cluster.delete.forceDeleteHelp') }
    case 'leave':
      return { label: t('cluster.secondary.forceLeave'), hint: t('cluster.secondary.forceLeaveHelp') }
    case 'promote':
      return {
        label: t('cluster.secondary.forceDeletePrimary'),
        hint: t('cluster.secondary.forceDeletePrimaryHelp'),
      }
    default:
      return null
  }
}

/**
 * The force checkbox inside a cluster confirm dialog.
 *
 * Three of the six destructive cluster mutations have a forced variant, and in
 * each case it is the *only* way to finish the operation once the peer node is
 * gone: `primary/delete?forceDelete`, `secondary/leave?forceLeave` and
 * `secondary/promote?forceDeletePrimary`. Upstream puts a checkbox in the same
 * modal (`.probe/console-js/index.html:7267-7403`); hiding the escape hatch
 * behind a second menu entry would bury it exactly when it is needed.
 *
 * Renders nothing for the actions that have no forced form.
 */
function ForceOption({
  action,
  checked,
  onCheckedChange,
}: {
  action: ClusterAction
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const t = useTranslations('admin')
  const copy = forceCopy(action, t)
  if (!copy) return null

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
      <Checkbox
        id="cluster-force"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex flex-col">
        <FieldLabel htmlFor="cluster-force" className="text-sm font-normal">
          {copy.label}
        </FieldLabel>
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface ClusterOptionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** Prefill source: the four intervals travel with the cluster state. */
  state: ClusterState | null | undefined
}

type OptionsFormValues = Record<IntervalKey, string>

/**
 * Bounds come from `INTERVAL_BOUNDS`, never from literals repeated here, so the
 * range the help text advertises is the range the schema enforces.
 */
function buildOptionsSchema(m: NumberFieldMessages) {
  const seconds = (key: IntervalKey) => {
    const { min, max } = INTERVAL_BOUNDS[key]
    return integerField(min, max, m)
  }
  return z.object({
    heartbeatRefreshIntervalSeconds: seconds('heartbeatRefreshIntervalSeconds'),
    heartbeatRetryIntervalSeconds: seconds('heartbeatRetryIntervalSeconds'),
    configRefreshIntervalSeconds: seconds('configRefreshIntervalSeconds'),
    configRetryIntervalSeconds: seconds('configRetryIntervalSeconds'),
  })
}

function optionsDefaults(state: ClusterState | null | undefined): OptionsFormValues {
  const values = {} as OptionsFormValues
  for (const field of INTERVAL_FIELDS) {
    // A state read that has not landed yet falls back to the documented default
    // rather than to blank: an empty required field is a submit the operator has
    // to notice and repair, and every value here has a known-good one.
    values[field.key] = String(state?.[field.key] ?? field.fallback)
  }
  return values
}

/**
 * `admin/cluster/primary/setOptions` — the four heartbeat / config intervals.
 *
 * Only the primary may change them, which is why the panel offers the button on
 * a primary row alone; a secondary still sees the current values in the state
 * list above.
 */
function ClusterOptionsDialog({ open, onOpenChange, onDone, state }: ClusterOptionsDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const schema = React.useMemo(
    () =>
      buildOptionsSchema({
        invalid: tc('form.invalidNumber'),
        tooSmall: (min) => tc('form.minValue', { min }),
        tooBig: (max) => tc('form.maxValue', { max }),
      }),
    [tc],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])
  const form = useForm<OptionsFormValues>({ resolver, defaultValues: optionsDefaults(state) })

  // Re-seed on every opening: the state may have been refetched since the last
  // one, and a dialog that remembers yesterday's numbers invites a bad save.
  React.useEffect(() => {
    if (open) form.reset(optionsDefaults(state))
  }, [open, state, form])

  const save = useMutation({
    mutationFn: (values: OptionsFormValues) =>
      setClusterOptions({
        heartbeatRefreshIntervalSeconds: Number(values.heartbeatRefreshIntervalSeconds),
        heartbeatRetryIntervalSeconds: Number(values.heartbeatRetryIntervalSeconds),
        configRefreshIntervalSeconds: Number(values.configRefreshIntervalSeconds),
        configRetryIntervalSeconds: Number(values.configRetryIntervalSeconds),
      }),
    onSuccess: () => {
      toast.success(t('cluster.primary.setOptionsSuccess'))
      onDone()
      onOpenChange(false)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('cluster.primary.setOptionsTitle')}</DialogTitle>
          <DialogDescription>{t('cluster.primary.setOptionsBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
        >
          {INTERVAL_FIELDS.map((field) => (
            <Field key={field.key}>
              <FieldLabel htmlFor={`co-${field.key}`} required>
                {t(`cluster.primary.${field.key}`)}
              </FieldLabel>
              <Input
                id={`co-${field.key}`}
                type="number"
                min={field.min}
                max={field.max}
                step={1}
                inputMode="numeric"
                autoComplete="off"
                className="font-data w-36"
                aria-invalid={Boolean(errors[field.key])}
                {...form.register(field.key)}
              />
              <FieldDescription>
                {t('cluster.primary.intervalRange', {
                  min: field.min,
                  max: field.max,
                  fallback: field.fallback,
                })}
              </FieldDescription>
              <FieldError>{errors[field.key]?.message}</FieldError>
            </Field>
          ))}

          {save.error ? <ErrorState error={save.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {save.isPending ? tc('actions.saving') : tc('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

interface UpdatePrimaryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** The cluster's primary row; its URL and addresses prefill the form. */
  primaryNode?: ClusterNode
}

const updatePrimarySchema = (invalidUrl: string, invalidIp: string, required: string) =>
  z.object({
    primaryNodeUrl: z
      .string()
      .trim()
      .min(1, required)
      .refine(isHttpUrl, invalidUrl),
    // Optional: an empty list clears whatever was pinned. `splitAddresses('')`
    // is `[]`, and `every` on an empty array is true, so blank passes.
    primaryNodeIpAddresses: z.string().refine((value) => splitAddresses(value).every(isIpAddress), invalidIp),
  })

type UpdatePrimaryFormValues = z.infer<ReturnType<typeof updatePrimarySchema>>

const EMPTY_PRIMARY: UpdatePrimaryFormValues = { primaryNodeUrl: '', primaryNodeIpAddresses: '' }

/**
 * `admin/cluster/secondary/updatePrimary` — re-point this secondary at a
 * different primary.
 *
 * Both parameters go out even when the address list is empty, because that is
 * what upstream does (`.probe/console-js/cluster.js:427`) and an empty list is
 * how the operator unpins the primary.
 */
function UpdatePrimaryDialog({ open, onOpenChange, onDone, primaryNode }: UpdatePrimaryDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const schema = React.useMemo(
    () => updatePrimarySchema(tc('form.invalidUrl'), tc('form.invalidIp'), tc('form.required')),
    [tc],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])
  const form = useForm<UpdatePrimaryFormValues>({ resolver, defaultValues: EMPTY_PRIMARY })

  React.useEffect(() => {
    if (!open) return
    form.reset({
      primaryNodeUrl: primaryNode?.url ?? '',
      primaryNodeIpAddresses: (primaryNode?.ipAddresses ?? []).join('\n'),
    })
  }, [open, primaryNode, form])

  const save = useMutation({
    mutationFn: (values: UpdatePrimaryFormValues) =>
      updatePrimaryServer({
        primaryNodeUrl: values.primaryNodeUrl.trim(),
        primaryNodeIpAddresses: toList(values.primaryNodeIpAddresses),
      }),
    onSuccess: () => {
      toast.success(t('cluster.secondary.updatePrimarySuccess'))
      onDone()
      onOpenChange(false)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cluster.secondary.updatePrimaryTitle')}</DialogTitle>
          <DialogDescription>{t('cluster.secondary.updatePrimaryHelp')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
        >
          <Field>
            <FieldLabel htmlFor="up-url" required>
              {t('cluster.secondary.updatePrimaryUrl')}
            </FieldLabel>
            <Input
              id="up-url"
              className="font-data"
              autoComplete="off"
              placeholder={t('cluster.join.primaryNodeUrlPlaceholder')}
              aria-invalid={Boolean(errors.primaryNodeUrl)}
              {...form.register('primaryNodeUrl')}
            />
            <FieldError>{errors.primaryNodeUrl?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="up-ips">{t('cluster.secondary.updatePrimaryIps')}</FieldLabel>
            <Textarea
              id="up-ips"
              className="font-data"
              rows={3}
              autoComplete="off"
              aria-invalid={Boolean(errors.primaryNodeIpAddresses)}
              {...form.register('primaryNodeIpAddresses')}
            />
            <FieldDescription>{t('cluster.secondary.updatePrimaryIpsHelp')}</FieldDescription>
            <FieldError>{errors.primaryNodeIpAddresses?.message}</FieldError>
          </Field>

          {save.error ? <ErrorState error={save.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {save.isPending ? tc('actions.saving') : tc('actions.update')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

interface ClusterIpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  /** This machine's cluster row; its addresses prefill the list. */
  selfNode?: ClusterNode
  /** Every address this machine has, offered as the pick-from list. */
  serverIpAddresses: string[]
}

/** `superRefine` so an empty box and a malformed address keep their own copy. */
const clusterIpSchema = (required: string, invalidIp: string) =>
  z.object({
    ipAddresses: z.string().superRefine((value, ctx) => {
      const bad = invalidAddresses(value, required, invalidIp)
      if (bad !== null) ctx.addIssue({ code: 'custom', message: bad })
    }),
  })

type ClusterIpFormValues = z.infer<ReturnType<typeof clusterIpSchema>>

const EMPTY_CLUSTER_IP: ClusterIpFormValues = { ipAddresses: '' }

/**
 * `admin/cluster/updateIpAddress` — change the addresses this node advertises.
 *
 * The parameter is plural and comma-joined upstream (`cluster.js:346-359` runs
 * the textarea through `cleanTextList`), so this is a list editor and not a
 * single-IP prompt: a multi-homed node that could only send one address would
 * silently lose the others.
 */
function ClusterIpDialog({ open, onOpenChange, onDone, selfNode, serverIpAddresses }: ClusterIpDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const schema = React.useMemo(() => clusterIpSchema(tc('form.required'), tc('form.invalidIp')), [tc])
  const resolver = React.useMemo(() => zodResolver(schema), [schema])
  const form = useForm<ClusterIpFormValues>({ resolver, defaultValues: EMPTY_CLUSTER_IP })
  const { errors } = form.formState

  // Re-seed on every opening: `selfNode` arrives with the cluster state, which
  // lands after this dialog mounts, and a stale list would overwrite the
  // addresses the node currently advertises.
  React.useEffect(() => {
    if (!open) return
    // Prefer the addresses this node already advertises; fall back to whatever
    // the machine has, which is the same seed the init dialog uses.
    form.reset({ ipAddresses: (selfNode?.ipAddresses ?? serverIpAddresses).join('\n') })
  }, [open, selfNode, serverIpAddresses, form])

  const save = useMutation({
    mutationFn: (values: ClusterIpFormValues) => updateClusterIpAddress(toList(values.ipAddresses)),
    onSuccess: () => {
      toast.success(t('cluster.ipAddress.success'))
      onDone()
      onOpenChange(false)
    },
    onError: (err) => toast.error(describeError(err).message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cluster.ipAddress.title')}</DialogTitle>
          <DialogDescription>{t('cluster.ipAddress.hint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
        >
          <Field>
            <FieldLabel htmlFor="ci-ip" required>
              {t('cluster.ipAddress.ipAddresses')}
            </FieldLabel>
            <Textarea
              id="ci-ip"
              className="font-data"
              rows={3}
              autoComplete="off"
              aria-invalid={Boolean(errors.ipAddresses)}
              {...form.register('ipAddresses')}
            />
            <FieldDescription>{t('cluster.ipAddress.ipAddressesHelp')}</FieldDescription>
            {serverIpAddresses.length > 0 && (
              <FieldDescription>
                {`${t('cluster.ipAddress.available')}: ${joinIps(serverIpAddresses)}`}
              </FieldDescription>
            )}
            <FieldError>{errors.ipAddresses?.message}</FieldError>
          </Field>

          {save.error ? <ErrorState error={save.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {save.isPending ? tc('actions.saving') : t('cluster.ipAddress.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A newline- or comma-separated box of addresses becomes the single
 * comma-joined value every `*IpAddresses` parameter expects. Upstream runs the
 * same normalisation (`cleanTextList`) before building the query string.
 */
function toList(value: string): string {
  return splitAddresses(value).join(',')
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Validate a whole address list at once, returning the message to show or
 * `null`. An empty list is rejected too: every `*IpAddresses` parameter is
 * mandatory upstream, and sending an empty one just earns a server-side error
 * after the write has already been attempted.
 */
function invalidAddresses(value: string, emptyMessage: string, invalidMessage: string): string | null {
  const addresses = splitAddresses(value)
  if (addresses.length === 0) return emptyMessage
  return addresses.every(isIpAddress) ? null : invalidMessage
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

function isIpAddress(value: string): boolean {
  if (IPV4_RE.test(value)) return value.split('.').every((part) => Number(part) <= 255)
  // IPv6: let the platform decide, but reject anything with a scheme or space.
  if (/[\s/]/.test(value)) return false
  try {
    // `URL` accepts `http://[::1]`, which is the cheapest v6 sanity check
    // available without pulling in a dependency.
    const url = new URL(`http://[${value}]`)
    return url.hostname !== ''
  } catch {
    return false
  }
}
