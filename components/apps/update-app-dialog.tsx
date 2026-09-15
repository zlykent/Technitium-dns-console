'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/app/states'
import { ZipDropzone } from '@/components/apps/zip-dropzone'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { describeError } from '@/lib/api/client'
import { updateApp } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Update an installed app from a locally-held ZIP (`apps/update`, multipart).
 *
 * The sibling of `install-app-dialog.tsx` for the offline path: the target app is
 * already chosen (its name arrives as a prop and is sent as the `name` param), so
 * there is no name field — only the package picker. `updateApp` responds with the
 * reloaded `InstalledApp`, whose `version` feeds the `update.success{name}{version}`
 * toast; we read the version from the *response*, not from local state, because
 * the whole point of updating is that the version changed.
 *
 * Store-sourced updates (`downloadAndUpdateApp`) are a different flow and live in
 * the panels behind a `ConfirmDialog` — they download server-side and need no
 * file, so they must not be conflated with this upload path.
 */

export interface UpdateAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The installed app being updated; `null` keeps the dialog idle. */
  appName: string | null
}

export function UpdateAppDialog({ open, onOpenChange, appName }: UpdateAppDialogProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const name = appName ?? ''

  const [file, setFile] = React.useState<File | null>(null)

  const update = useMutation({
    mutationFn: (fileAppZip: File) => updateApp(name, fileAppZip),
    onSuccess: (result) => {
      toast.success(t('update.success', { name, version: result.updatedApp.version }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps(target) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeApps(target) })
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      setFile(null)
      update.reset()
    }, 0)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      toast.error(t('install.noFile'))
      return
    }
    update.mutate(file)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('update.localTitle')}</DialogTitle>
          <DialogDescription>{t('update.localSubtitle', { name })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="update-app-file" required>
              {t('install.fileLabel')}
            </FieldLabel>
            <ZipDropzone
              id="update-app-file"
              file={file}
              onFileChange={setFile}
              prompt={t('install.fileDrop')}
              disabled={update.isPending}
            />
            <FieldDescription>{t('install.fileHint')}</FieldDescription>
          </Field>

          {update.error ? <ErrorState error={update.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={update.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending} disabled={!file}>
              {!update.isPending && <Upload className="size-4" aria-hidden />}
              {update.isPending ? t('update.submitting') : t('update.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
