'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/api/client'
import { convertZone } from '@/lib/api/domains/zones'
import { CONVERTIBLE_ZONE_TYPES, type ConvertibleZoneType } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import type { ZoneSummary } from '@/lib/api/types/zones'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Convert-zone dialog.
 *
 * Conversion changes where a zone's data comes from (Primary ⇄ Forwarder ⇄
 * Catalog) and can discard records, so this is destructive: the whole thing is
 * a `ConfirmDialog` with the type picker rendered in its `children` slot rather
 * than a bespoke form dialog. That keeps the red confirm button, the inline
 * error surface and the "stays open on failure" behaviour for free.
 *
 * Only the three convertible types are offered, minus the zone's current one —
 * converting a zone to the type it already is would be a no-op the server
 * rejects.
 */

export interface ConvertZoneDialogProps {
  /** The zone being converted; `null` keeps the dialog closed. */
  zone: ZoneSummary | null
  onOpenChange: (open: boolean) => void
}

export function ConvertZoneDialog({ zone, onOpenChange }: ConvertZoneDialogProps) {
  const t = useTranslations('zones')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const open = Boolean(zone)

  const targets = React.useMemo(
    () => CONVERTIBLE_ZONE_TYPES.filter((type) => type !== zone?.type),
    [zone?.type],
  )
  const [type, setType] = React.useState<ConvertibleZoneType>(targets[0] ?? 'Primary')

  // Re-seed the picker whenever a different row opens the dialog. Render-phase
  // adjustment rather than an effect (see clone-zone-dialog) so the default is
  // correct on the first paint.
  const [prevZone, setPrevZone] = React.useState<string | null>(null)
  const zoneName = zone?.name ?? null
  if (zoneName !== prevZone) {
    setPrevZone(zoneName)
    setType(targets[0] ?? 'Primary')
  }

  const mutate = useMutation({
    mutationFn: (next: ConvertibleZoneType) => convertZone(zone?.name ?? '', next),
    onSuccess: (_r, next) => {
      toast.success(t('actions.convertSuccess', { zone: zone?.name ?? '', type: t(`types.${next}.label`) }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
      onOpenChange(false)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && onOpenChange(false)}
      title={t('actions.convertTitle')}
      description={t('actions.convertWarning')}
      confirmLabel={t('actions.convert')}
      tone="destructive"
      onConfirm={async () => {
        await mutate.mutateAsync(type)
      }}
      pending={mutate.isPending}
      error={mutate.error ?? undefined}
    >
      <Field>
        <FieldLabel htmlFor="convert-current">{t('actions.cloneSourceLabel')}</FieldLabel>
        <p className="font-data text-sm text-muted-foreground">{zone?.name}</p>
      </Field>

      <Field>
        <FieldLabel htmlFor="convert-type">{t('actions.convertTypeLabel')}</FieldLabel>
        <Select value={type} onValueChange={(value) => setType(value as ConvertibleZoneType)}>
          <SelectTrigger id="convert-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`types.${value}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t('actions.convertHint')}</FieldDescription>
      </Field>
    </ConfirmDialog>
  )
}
