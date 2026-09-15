'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Download, TriangleAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { SettingsGroup, SettingsSection } from '@/components/settings/settings-field'
import { describeError } from '@/lib/api/client'
import { backup, restore, type BackupSections } from '@/lib/api/domains/settings'
import { queryKeys } from '@/lib/api/query-keys'
import { ALL_BACKUP_OPTIONS, DEFAULT_BACKUP_OPTIONS, type BackupOptions } from '@/lib/api/types/user'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Backup download and the destructive restore upload.
 *
 * Neither is a settings *edit*, so the panel opts out of the shared save button
 * (`hideSave`) and owns its own two mutations. Keeping them out of the dirty
 * form matters: a restore must not be commitable by the same click that saves
 * eleven unrelated field edits, and a backup must not be blocked by a
 * validation error in a field it has nothing to do with.
 *
 * Two things worth knowing:
 *
 *  - **`deleteExistingFiles` is restore-only.** The server reads it when
 *    unpacking an archive, not when producing one, so it lives in the restore
 *    block even though `BackupSections` accepts it — and it is deliberately
 *    excluded from `selectAll`, which would otherwise turn a routine download
 *    into "wipe the destination first".
 *  - **Restore asks for a typed confirmation.** `ConfirmDialog`'s `requireText`
 *    is the only gate in this console that cannot be passed with a single click,
 *    which is the point: the operation replaces auth config, zones and the web
 *    listener in one shot and can drop the current session (`restoreWarning`).
 *
 * The SDK posts the file under the multipart field name `file`, whereas the stock
 * console uses `fileBackupZip` (`main.js:3178`), and it exposes no way to send
 * the per-section restore flags. Both are shared-layer gaps, listed in the
 * report; the upload itself is the only thing this panel controls.
 */

const TZSP_PATTERN = /\.tzsp$/i

type BackupFlag = Exclude<keyof BackupOptions, 'node'>

/**
 * `ALL_BACKUP_OPTIONS` is typed `(keyof BackupOptions)[]`, which includes `node`
 * — a routing parameter, not a section. Narrowing once here is what lets the
 * flags be written through a computed key at all: with the wider union,
 * TypeScript intersects every property type and rejects `boolean`.
 */
const BACKUP_FLAGS: readonly BackupFlag[] = ALL_BACKUP_OPTIONS.filter((key): key is BackupFlag => key !== 'node')

export interface SectionBackupProps {
  disabled: boolean
  /** Node the restore should be applied to; `undefined` means this machine. */
  node?: string
}

export function SectionBackup({ disabled, node }: SectionBackupProps) {
  const t = useTranslations('settings')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const tr = t as unknown as (key: string) => string

  const [flags, setFlags] = React.useState<BackupOptions>(() => ({ ...DEFAULT_BACKUP_OPTIONS }))
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const inputId = 'settings-restore-file'

  function setFlag(key: BackupFlag, value: boolean) {
    setFlags((current) => ({ ...current, [key]: value }))
  }

  function setAll(value: boolean) {
    setFlags((current) => {
      const next: BackupOptions = { deleteExistingFiles: current.deleteExistingFiles ?? false }
      for (const key of BACKUP_FLAGS) next[key] = value
      return next
    })
  }

  function acceptFile(next: File | null) {
    if (next && !TZSP_PATTERN.test(next.name)) {
      setFile(null)
      setFileError(t('backup.invalidFile'))
      return
    }
    setFile(next)
    setFileError(null)
  }

  const download = useMutation({
    mutationFn: () => {
      const sections: BackupSections = {}
      for (const key of BACKUP_FLAGS) sections[key] = flags[key]
      return backup(sections)
    },
    onSuccess: () => toast.success(t('backup.backupSuccess')),
    onError: (error) => toast.error(describeError(error).message),
  })

  const upload = useMutation({
    mutationFn: (value: File) => restore(value, node),
    onSuccess: () => {
      toast.success(t('backup.restoreSuccess'))
      setConfirmOpen(false)
      setFile(null)
      // A restore replaces zones, apps, auth and settings alike; there is no
      // meaningful subset to keep cached.
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings(target) })
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  return (
    <SettingsSection id="backup" title={t('backup.title')} description={t('backup.subtitle')} hideSave>
      <SettingsGroup
        label={t('backup.sectionsTitle')}
        className="gap-2"
      >
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => setAll(true)}>
            {t('backup.selectAll')}
          </Button>
          <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => setAll(false)}>
            {t('backup.selectNone')}
          </Button>
        </div>

        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {BACKUP_FLAGS.map((key) => (
            <BackupOptionRow
              key={key}
              id={`backup-option-${key}`}
              label={tr(`backup.sections.${key}`)}
              hint={key === 'logs' ? tr('backup.sectionHints.logs') : undefined}
              checked={Boolean(flags[key])}
              disabled={disabled}
              onCheckedChange={(value) => setFlag(key, value === true)}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t('backup.backupHint')}</p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={disabled}
          loading={download.isPending}
          onClick={() => download.mutate()}
        >
          {!download.isPending && <Download className="size-3.5" aria-hidden />}
          {download.isPending ? t('backup.backing') : t('backup.backup')}
        </Button>
      </SettingsGroup>

      <SettingsGroup label={t('backup.restoreTitle')} className="gap-3">
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('backup.restoreWarning')}</AlertTitle>
          <AlertDescription>{t('backup.restoreHint')}</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId} className="text-sm">
            {t('backup.restoreFile')}
          </Label>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              acceptFile(event.dataTransfer.files?.[0] ?? null)
            }}
            className={cn(
              'surface-raised flex flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
              dragging ? 'border-primary bg-accent' : 'border-border/70',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">{t('backup.restoreFileDrop')}</span>
            {file && <span className="font-data text-xs text-foreground">{file.name}</span>}
            <input
              id={inputId}
              type="file"
              accept=".tzsp"
              disabled={disabled}
              className="sr-only"
              onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
        </div>

        <BackupOptionRow
          id="backup-option-deleteExistingFiles"
          label={tr('backup.sections.deleteExistingFiles')}
          hint={tr('backup.sectionHints.deleteExistingFiles')}
          checked={Boolean(flags.deleteExistingFiles)}
          disabled={disabled}
          onCheckedChange={(value) => setFlag('deleteExistingFiles', value === true)}
        />

        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="self-start"
          disabled={disabled || file === null || upload.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <Upload className="size-3.5" aria-hidden />
          {upload.isPending ? t('backup.restoring') : t('backup.restore')}
        </Button>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('backup.restoreTitle')}
        description={t('backup.restoreConfirm')}
        confirmLabel={t('backup.restore')}
        tone="destructive"
        requireText={t('backup.restoreRequireWord')}
        pending={upload.isPending}
        error={upload.error ?? undefined}
        onConfirm={async () => {
          if (!file) return
          await upload.mutateAsync(file)
        }}
      />
    </SettingsSection>
  )
}

interface BackupOptionRowProps {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean | 'indeterminate') => void
}

function BackupOptionRow({ id, label, hint, checked, disabled, onCheckedChange }: BackupOptionRowProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="mt-0.5" />
      <div className="min-w-0 flex flex-col">
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
