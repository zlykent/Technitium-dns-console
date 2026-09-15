'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  CirclePlus,
  CircleStop,
  EllipsisVertical,
  KeyRound,
  Pencil,
  RotateCw,
  ShieldCheck,
  Trash,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, textColumn } from '@/components/app/data-table'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { Section } from '@/components/app/page-shell'
import { AddPrivateKeyDialog, type PrivateKeyDialogMode } from '@/components/dnssec/add-private-key-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { describeError } from '@/lib/api/client'
import {
  activateKskDnsKey,
  deletePrivateKey,
  publishAllPrivateKeys,
  retireDnsKey,
  rolloverDnsKey,
} from '@/lib/api/domains/dnssec'
import type { DnsKeyState, ZoneType } from '@/lib/api/enums'
import type { DnssecPrivateKey } from '@/lib/api/types/dnssec'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import type { Locale } from '@/lib/i18n/config'

/**
 * Private-key lifecycle table (`zones/dnssec/*PrivateKey`, plus the four
 * state-transition endpoints).
 *
 * The DNSSEC key state machine is the hard part, not the table. Technitium moves
 * a key Generated -> Published -> Ready -> Active -> Retiring -> Retired, and
 * each transition endpoint is only meaningful from certain states. Offering all
 * of them on every row trains operators to click until something happens, so the
 * menu is filtered by `state` / `keyType` / `isRetiring` (`availableActions`).
 *
 * Two traps worth spelling out:
 *
 *  - **`activateKskDnsKey` is the one irreversible-by-omission action here.**
 *    Activating a KSK before the parent zone actually holds its DS record makes
 *    the zone unresolvable for every validating resolver. There is no server-side
 *    guard, so the confirm dialog carries the warning copy instead.
 *  - **Every one of these endpoints is an HTTP GET that mutates.** The proxy
 *    layer keeps them as GETs to match the upstream contract, which means a
 *    pre-fetch or a browser retry can re-run a rollover. Mutations here are
 *    therefore fired only from explicit clicks, never from an effect.
 *
 * The rows are supplied by the parent rather than fetched here: `dnssecStatus`,
 * the overview tiles and this table all read the same `properties/get` payload,
 * and a second query would make the tiles and the table disagree while a signing
 * job is in flight.
 */

export interface PrivateKeysPanelProps {
  zone: string
  /** Only `Primary` zones hold signing keys. */
  zoneType: ZoneType
  keys: DnssecPrivateKey[]
  canModify: boolean
  canDelete: boolean
  /** Invalidates the DNSSEC + zones caches; owned by the parent view. */
  onChanged: () => void
}

/** Which state-transition endpoint a menu entry maps to. */
export type KeyActionKind = 'activate' | 'retire' | 'rollover'

interface PendingAction {
  kind: KeyActionKind
  keyTag: number
}

export function PrivateKeysPanel({ zone, zoneType, keys, canModify, canDelete, onChanged }: PrivateKeysPanelProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')
  const locale = useLocaleCode()

  const [dialogMode, setDialogMode] = React.useState<PrivateKeyDialogMode | null>(null)
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const [deleteTag, setDeleteTag] = React.useState<number | null>(null)

  const publishAll = useMutation({
    mutationFn: () => publishAllPrivateKeys(zone),
    onSuccess: () => {
      toast.success(t('keys.publishAllSuccess'))
      onChanged()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const transition = useMutation({
    mutationFn: (action: PendingAction) => {
      const params = { zone, keyTag: action.keyTag }
      if (action.kind === 'activate') return activateKskDnsKey(params)
      if (action.kind === 'retire') return retireDnsKey(params)
      return rolloverDnsKey(params)
    },
    onSuccess: (_data, action) => {
      toast.success(t(TRANSITION_SUCCESS_KEY[action.kind]))
      onChanged()
      setPending(null)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const remove = useMutation({
    mutationFn: (keyTag: number) => deletePrivateKey({ zone, keyTag }),
    onSuccess: () => {
      toast.success(t('keys.deleteSuccess'))
      onChanged()
      setDeleteTag(null)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const columns = React.useMemo(
    () => [
      textColumn<DnssecPrivateKey>({
        id: 'keyTag',
        accessorKey: 'keyTag',
        header: t('keys.columns.keyTag'),
        align: 'right',
        width: '7rem',
        cell: (_value, row) => <span className="font-data tabular-nums">{formatNumber(row.keyTag, locale)}</span>,
      }),
      textColumn<DnssecPrivateKey>({
        id: 'keyType',
        accessorKey: 'keyType',
        header: t('keys.columns.keyType'),
        width: '11rem',
        cell: (_value, row) => (
          <Badge variant={row.keyType === 'KeySigningKey' ? 'default' : 'info'}>
            {t(`keys.keyTypes.${row.keyType}`)}
          </Badge>
        ),
      }),
      textColumn<DnssecPrivateKey>({
        id: 'algorithm',
        accessorKey: 'algorithm',
        header: t('keys.columns.algorithm'),
        width: '8rem',
        cell: (_value, row) => (
          <span className="flex items-baseline gap-1.5">
            <Badge variant="outline">{row.algorithm}</Badge>
            <span className="font-data text-xs text-muted-foreground">{row.algorithmNumber}</span>
          </span>
        ),
      }),
      textColumn<DnssecPrivateKey>({
        id: 'state',
        accessorKey: 'state',
        header: t('keys.columns.state'),
        width: '11rem',
        cell: (_value, row) => (
          <span className="flex flex-wrap items-center gap-1" title={t(`keys.stateHints.${row.state}`)}>
            <Badge variant={STATE_BADGE_VARIANT[row.state]}>{t(`keys.states.${row.state}`)}</Badge>
            {row.isRetiring && <Badge variant="warning">{t('keys.columns.retiring')}</Badge>}
          </span>
        ),
      }),
      textColumn<DnssecPrivateKey>({
        id: 'stateChangedOn',
        accessorKey: 'stateChangedOn',
        header: t('keys.columns.stateChangedOn'),
        width: '11rem',
        cell: (_value, row) => <Timestamp value={row.stateChangedOn} locale={locale} />,
      }),
      textColumn<DnssecPrivateKey>({
        id: 'stateReadyBy',
        accessorKey: 'stateReadyBy',
        header: t('keys.columns.stateReadyBy'),
        width: '11rem',
        cell: (_value, row) => <Timestamp value={row.stateReadyBy} locale={locale} />,
      }),
      textColumn<DnssecPrivateKey>({
        id: 'stateActiveBy',
        accessorKey: 'stateActiveBy',
        header: t('keys.columns.stateActiveBy'),
        width: '11rem',
        cell: (_value, row) => <Timestamp value={row.stateActiveBy} locale={locale} />,
      }),
      textColumn<DnssecPrivateKey>({
        id: 'rolloverDays',
        accessorKey: 'rolloverDays',
        header: t('keys.columns.rolloverDays'),
        align: 'right',
        width: '8rem',
        cell: (_value, row) =>
          row.rolloverDays === 0 ? (
            <span className="text-xs text-muted-foreground">{tc('fields.none')}</span>
          ) : (
            <span className="font-data tabular-nums">
              {formatNumber(row.rolloverDays, locale)} {tc('units.days')}
            </span>
          ),
      }),
      textColumn<DnssecPrivateKey>({
        id: 'actions',
        header: tc('fields.actions'),
        align: 'right',
        width: '4rem',
        enableSorting: false,
        cell: (_value, row) => (
          <KeyRowActions
            privateKey={row}
            canModify={canModify}
            canDelete={canDelete}
            busy={transition.isPending || remove.isPending}
            onAction={(kind) => setPending({ kind, keyTag: row.keyTag })}
            onEdit={() => setDialogMode({ kind: 'update', keyTag: row.keyTag, rolloverDays: row.rolloverDays })}
            onDelete={() => setDeleteTag(row.keyTag)}
          />
        ),
      }),
    ],
    [t, tc, locale, canModify, canDelete, transition.isPending, remove.isPending],
  )

  const primary = zoneType === 'Primary'
  const pendingAction = pending ? { ...pending, label: t(TRANSITION_LABEL_KEY[pending.kind]) } : null

  return (
    <Section
      title={t('keys.title')}
      description={t('keys.subtitle')}
      actions={
        canModify && primary ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => publishAll.mutate()}
              loading={publishAll.isPending}
              disabled={keys.length === 0}
            >
              {!publishAll.isPending && <Upload className="size-3.5" aria-hidden />}
              {publishAll.isPending ? t('keys.publishingAll') : t('keys.publishAll')}
            </Button>
            <Button size="sm" onClick={() => setDialogMode({ kind: 'add' })}>
              <CirclePlus className="size-3.5" aria-hidden />
              {t('keys.add')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {!primary && (
          <Alert variant="info">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('sign.requiresPrimary')}</AlertDescription>
          </Alert>
        )}

        {canModify && primary && <p className="text-xs text-muted-foreground">{t('keys.publishAllHint')}</p>}

        <DataTable<DnssecPrivateKey>
          label={t('keys.title')}
          columns={columns}
          data={keys}
          getRowId={(row) => String(row.keyTag)}
          clientPagination={false}
          density="compact"
          empty={{
            title: t('keys.empty'),
            body: t('keys.emptyHint'),
            icon: KeyRound,
            action:
              canModify && primary ? (
                <Button size="sm" onClick={() => setDialogMode({ kind: 'add' })}>
                  <CirclePlus className="size-3.5" aria-hidden />
                  {t('keys.add')}
                </Button>
              ) : undefined,
          }}
        />
      </div>

      <AddPrivateKeyDialog
        open={dialogMode !== null}
        onOpenChange={(next) => {
          if (!next) setDialogMode(null)
        }}
        zone={zone}
        mode={dialogMode ?? { kind: 'add' }}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPending(null)
            transition.reset()
          }
        }}
        title={pendingAction?.label ?? ''}
        description={pending ? t(TRANSITION_HINT_KEY[pending.kind]) : undefined}
        confirmLabel={pendingAction?.label}
        tone="default"
        pending={transition.isPending}
        error={transition.error}
        onConfirm={async () => {
          if (pending) await transition.mutateAsync(pending)
        }}
      >
        {pending?.kind === 'activate' && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('keys.activateKskHint')}</AlertDescription>
          </Alert>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTag !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteTag(null)
            remove.reset()
          }
        }}
        title={t('keys.delete')}
        description={deleteTag === null ? undefined : t('keys.deleteConfirm', { keyTag: deleteTag })}
        confirmLabel={tc('actions.delete')}
        tone="destructive"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={async () => {
          if (deleteTag !== null) await remove.mutateAsync(deleteTag)
        }}
      />
    </Section>
  )
}

/** Menu label per transition. */
const TRANSITION_LABEL_KEY: Record<KeyActionKind, string> = {
  activate: 'keys.activateKsk',
  retire: 'keys.retire',
  rollover: 'keys.rollover',
}

/** Body copy for the transition's confirm dialog. */
const TRANSITION_HINT_KEY: Record<KeyActionKind, string> = {
  activate: 'keys.activateKskHint',
  retire: 'keys.retireHint',
  rollover: 'keys.rolloverHint',
}

/** Toast copy after a successful transition. */
const TRANSITION_SUCCESS_KEY: Record<KeyActionKind, string> = {
  activate: 'keys.activateKskSuccess',
  retire: 'keys.retireSuccess',
  rollover: 'keys.rolloverSuccess',
}

/** Badge tone per key state — colour carries the "is this key in use?" answer. */
const STATE_BADGE_VARIANT: Record<DnsKeyState, 'default' | 'secondary' | 'success' | 'warning' | 'muted' | 'info'> = {
  Generated: 'secondary',
  Published: 'info',
  Ready: 'info',
  Active: 'success',
  Retiring: 'warning',
  Retired: 'muted',
  Deleted: 'muted',
}

export interface KeyRowActionsProps {
  privateKey: DnssecPrivateKey
  canModify: boolean
  canDelete: boolean
  busy: boolean
  onAction: (kind: KeyActionKind) => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Per-row menu.
 *
 * Intentionally "dumb": it emits intents and the panel owns the mutations and
 * confirm dialogs. The entry list is filtered by state so operators are never
 * offered a transition the server would reject — or worse, one it would accept
 * with surprising results.
 */
export function KeyRowActions({ privateKey, canModify, canDelete, busy, onAction, onEdit, onDelete }: KeyRowActionsProps) {
  const t = useTranslations('dnssec')
  const tc = useTranslations('common')

  const actions = availableActions(privateKey, canModify)
  if (actions.length === 0 && !canDelete) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={tc('actions.more')} onClick={(event) => event.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.includes('activate') && (
          <DropdownMenuItem onSelect={() => onAction('activate')}>
            <ShieldCheck aria-hidden />
            {t('keys.activateKsk')}
          </DropdownMenuItem>
        )}
        {actions.includes('retire') && (
          <DropdownMenuItem onSelect={() => onAction('retire')}>
            <CircleStop aria-hidden />
            {t('keys.retire')}
          </DropdownMenuItem>
        )}
        {actions.includes('rollover') && (
          <DropdownMenuItem onSelect={() => onAction('rollover')}>
            <RotateCw aria-hidden />
            {t('keys.rollover')}
          </DropdownMenuItem>
        )}
        {canModify && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden />
            {t('keys.updateRollover')}
          </DropdownMenuItem>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash aria-hidden />
              {t('keys.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * State-machine filter for the transition menu.
 *
 *  - activate applies to a KSK that is published or ready but not yet signing;
 *  - retire only makes sense for a key that is still in use;
 *  - rollover is offered for any live key that is not already retiring, since a
 *    second concurrent rollover of the same key would strand the first one.
 */
function availableActions(key: DnssecPrivateKey, canModify: boolean): KeyActionKind[] {
  if (!canModify || key.isRetiring) return []

  const out: KeyActionKind[] = []
  const live = key.state === 'Generated' || key.state === 'Published' || key.state === 'Ready' || key.state === 'Active'

  if (key.keyType === 'KeySigningKey' && (key.state === 'Published' || key.state === 'Ready')) out.push('activate')
  if (key.state === 'Active' || key.state === 'Ready') out.push('retire')
  if (live) out.push('rollover')
  return out
}

/** Localised absolute time with a relative tooltip; em dash when unset. */
function Timestamp({ value, locale }: { value: string | null; locale: Locale }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="font-data text-xs whitespace-nowrap" title={formatRelative(value, locale)}>
      {formatDateTime(value, locale)}
    </span>
  )
}

