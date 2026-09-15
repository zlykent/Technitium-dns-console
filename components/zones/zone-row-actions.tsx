'use client'

import { useTranslations } from 'next-intl'
import {
  ArrowLeftRight,
  Copy,
  CircleCheck,
  CircleStop,
  Download,
  EllipsisVertical,
  FileText,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash,
} from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CONVERTIBLE_ZONE_TYPES, type ZoneType } from '@/lib/api/enums'
import type { ZoneSummary } from '@/lib/api/types/zones'

/**
 * Per-row action menu for the zone list.
 *
 * Kept as its own component so `zones-view.tsx` stays readable and the menu can
 * decide *which* actions apply to a given zone type without the parent branching:
 *
 *  - resync only makes sense for zones that pull data from a primary
 *    (Secondary / Stub / SecondaryCatalog / SecondaryForwarder);
 *  - convert is offered only between the three convertible types;
 *  - enable/disable is a toggle, so exactly one of the two is shown.
 *
 * The component is intentionally "dumb": it emits intents and the parent owns
 * the mutations, confirm dialogs and routing. Destructive entries
 * (disable / delete) never fire on click — they open a `ConfirmDialog` upstream.
 */

/** Zone types whose data is replicated from a primary and can be re-pulled. */
const RESYNCABLE_TYPES = new Set<ZoneType>(['Secondary', 'Stub', 'SecondaryCatalog', 'SecondaryForwarder'])

const CONVERTIBLE = new Set<string>(CONVERTIBLE_ZONE_TYPES)

export interface ZoneRowActionsProps {
  zone: ZoneSummary
  canModify: boolean
  canDelete: boolean
  /** Disables the trigger while a row-level mutation is in flight. */
  busy?: boolean
  onViewRecords: (zone: ZoneSummary) => void
  onEnable: (zone: ZoneSummary) => void
  onDisable: (zone: ZoneSummary) => void
  onResync: (zone: ZoneSummary) => void
  onClone: (zone: ZoneSummary) => void
  onConvert: (zone: ZoneSummary) => void
  onExport: (zone: ZoneSummary) => void
  onOptions: (zone: ZoneSummary) => void
  onPermissions: (zone: ZoneSummary) => void
  onDelete: (zone: ZoneSummary) => void
}

export function ZoneRowActions({
  zone,
  canModify,
  canDelete,
  busy = false,
  onViewRecords,
  onEnable,
  onDisable,
  onResync,
  onClone,
  onConvert,
  onExport,
  onOptions,
  onPermissions,
  onDelete,
}: ZoneRowActionsProps) {
  const t = useTranslations('zones')
  const tc = useTranslations('common')

  const canResync = RESYNCABLE_TYPES.has(zone.type)
  const canConvert = CONVERTIBLE.has(zone.type)
  // Write affordances are hidden entirely when the operator lacks the flag; the
  // read-only entries (view records, options, permissions, export) always stay.
  const showWrite = canModify

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={tc('actions.more')} onClick={(event) => event.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => onViewRecords(zone)}>
          <FileText aria-hidden />
          {t('actions.viewRecords')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOptions(zone)}>
          <SlidersHorizontal aria-hidden />
          {t('actions.options')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPermissions(zone)}>
          <ShieldCheck aria-hidden />
          {t('actions.permissions')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport(zone)}>
          <Download aria-hidden />
          {t('export.action')}
        </DropdownMenuItem>

        {showWrite && (
          <>
            <DropdownMenuSeparator />
            {zone.disabled ? (
              <DropdownMenuItem onSelect={() => onEnable(zone)}>
                <CircleCheck aria-hidden />
                {t('actions.enable')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onDisable(zone)}>
                <CircleStop aria-hidden />
                {t('actions.disable')}
              </DropdownMenuItem>
            )}
            {canResync && (
              <DropdownMenuItem onSelect={() => onResync(zone)}>
                <RefreshCw aria-hidden />
                {t('actions.resync')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onClone(zone)}>
              <Copy aria-hidden />
              {t('actions.clone')}
            </DropdownMenuItem>
            {canConvert && (
              <DropdownMenuItem onSelect={() => onConvert(zone)}>
                <ArrowLeftRight aria-hidden />
                {t('actions.convert')}
              </DropdownMenuItem>
            )}
          </>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(zone)}>
              <Trash aria-hidden />
              {t('actions.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
