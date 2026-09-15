'use client'

import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useWatch, useFormContext } from 'react-hook-form'
import { CirclePause, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  SettingsFieldGrid,
  SettingsNumberField,
  SettingsSection,
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextareaField,
} from '@/components/settings/settings-field'
import type { SettingsFormValues } from '@/components/settings/settings-schema'
import { describeError } from '@/lib/api/client'
import { forceUpdateBlockLists, temporaryDisableBlocking } from '@/lib/api/domains/settings'
import { BLOCKING_TYPES } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Domain blocking plus the block-list downloader. Cluster-scoped
 * (`main.js:2085-2115`).
 *
 * The two action buttons are the reason this panel owns mutations instead of
 * leaving everything to the save bar: `forceUpdateBlockLists` and
 * `temporaryDisableBlocking` are *immediate* server operations, not settings
 * edits, and mixing them into the dirty-tracking form would mean an operator
 * who only wanted a block-list refresh also commits eleven unrelated edits.
 *
 * `temporaryDisableBlocking` needs a duration the API takes as a plain minute
 * count, so it goes through a dialog rather than a bare click — suspending
 * blocking network-wide is exactly the kind of one-click action that should
 * have a confirmation step.
 */

const DEFAULT_DISABLE_MINUTES = 30

export interface SectionBlockingProps {
  disabled: boolean
}

export function SectionBlocking({ disabled }: SectionBlockingProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const { control } = useFormContext<SettingsFormValues>()
  const blockingType = useWatch({ control, name: 'blockingType' })

  const [disableOpen, setDisableOpen] = React.useState(false)
  const [minutes, setMinutes] = React.useState(String(DEFAULT_DISABLE_MINUTES))

  const typeOptions = React.useMemo(
    () => BLOCKING_TYPES.map((value) => ({ value, label: t(`blocking.types.${value}`) })),
    [t],
  )

  const forceUpdate = useMutation({
    mutationFn: () => forceUpdateBlockLists(),
    onSuccess: (result) => {
      if (result?.taskWasAlreadyRunning) toast.warning(t('blocking.forceUpdateAlreadyRunning'))
      else toast.success(t('blocking.forceUpdateSuccess', { count: result?.totalBlockLists ?? 0 }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'blocked') })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const suspend = useMutation({
    mutationFn: (value: number) => temporaryDisableBlocking(value),
    onSuccess: () => {
      toast.success(t('blocking.temporaryDisableSuccess'))
      setDisableOpen(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings(target) })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const parsedMinutes = Number(minutes)
  const minutesValid = Number.isInteger(parsedMinutes) && parsedMinutes > 0

  return (
    <SettingsSection
      id="blocking"
      title={t('blocking.title')}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            loading={forceUpdate.isPending}
            onClick={() => forceUpdate.mutate()}
          >
            {!forceUpdate.isPending && <RefreshCw className="size-3.5" aria-hidden />}
            {forceUpdate.isPending ? t('blocking.forceUpdating') : t('blocking.forceUpdate')}
          </Button>
          <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => setDisableOpen(true)}>
            <CirclePause className="size-3.5" aria-hidden />
            {t('blocking.temporaryDisable')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <SettingsSwitchField name="enableBlocking" help={t('blocking.enableBlockingHelp')} disabled={disabled} />
        <SettingsSwitchField name="allowTxtBlockingReport" help={t('blocking.allowTxtBlockingReportHelp')} disabled={disabled} />
      </div>

      <SettingsFieldGrid columns={2}>
        <SettingsSelectField name="blockingType" options={typeOptions} help={t('blocking.blockingTypeHelp')} disabled={disabled} />
        <SettingsNumberField name="blockingAnswerTtl" min={0} disabled={disabled} compact />
      </SettingsFieldGrid>

      <SettingsFieldGrid columns={2}>
        <SettingsTextareaField
          name="customBlockingAddresses"
          help={t('blocking.customBlockingAddressesHelp')}
          rows={4}
          disabled={disabled || blockingType !== 'CustomAddress'}
          placeholder="10.10.10.10"
        />
        <SettingsTextareaField
          name="blockingBypassList"
          help={t('blocking.blockingBypassListHelp')}
          rows={4}
          disabled={disabled}
          placeholder="example.com"
        />
      </SettingsFieldGrid>

      <SettingsFieldGrid columns={2}>
        <SettingsTextareaField
          name="blockListUrls"
          help={t('blocking.blockListUrlsHelp')}
          rows={5}
          disabled={disabled}
          placeholder="https://example.com/blocklist.txt"
        />
        <SettingsNumberField name="blockListUpdateIntervalHours" min={0} disabled={disabled} compact />
      </SettingsFieldGrid>

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={t('blocking.temporaryDisable')}
        description={t('blocking.temporaryDisableHelp')}
        confirmLabel={t('blocking.temporaryDisable')}
        tone="default"
        pending={suspend.isPending}
        error={suspend.error ?? undefined}
        onConfirm={async () => {
          if (!minutesValid) return
          await suspend.mutateAsync(parsedMinutes)
        }}
      >
        <Field>
          <FieldLabel htmlFor="blocking-disable-minutes">{t('blocking.temporaryDisableMinutes')}</FieldLabel>
          <Input
            id="blocking-disable-minutes"
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className="font-data sm:max-w-40"
            aria-invalid={minutesValid ? undefined : true}
            autoComplete="off"
          />
          <FieldError>{minutesValid ? undefined : tc('form.invalidNumber')}</FieldError>
        </Field>
      </ConfirmDialog>
    </SettingsSection>
  )
}
