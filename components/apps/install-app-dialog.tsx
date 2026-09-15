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
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/api/client'
import { installApp } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Install an app from a locally-held ZIP (`apps/install`, multipart).
 *
 * This is the offline / custom-app path — the operator already has the package,
 * so nothing is downloaded. Two fields, so it stays on plain controlled state
 * rather than react-hook-form (per `docs/page-patterns.md`).
 *
 * The `File` lives in local state, never in the mutation key or a zod schema.
 * The submit button is disabled only while the *name* is empty; a missing file is
 * reported on submit via the `install.noFile` toast instead of a dead button, so
 * the operator gets an explicit message rather than wondering why nothing is
 * clickable. Success invalidates both the installed list and the store (the same
 * app flips to "installed" there), then closes.
 */

export interface InstallAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InstallAppDialog({ open, onOpenChange }: InstallAppDialogProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [name, setName] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)

  const install = useMutation({
    mutationFn: (vars: { name: string; file: File }) => installApp(vars.name, vars.file),
    onSuccess: (_result, vars) => {
      toast.success(t('install.success', { name: vars.name }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps(target) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeApps(target) })
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    // Reset after the close transition kicks off so the operator never sees the
    // previous package's name/file flash on the next open.
    setTimeout(() => {
      setName('')
      setFile(null)
      install.reset()
    }, 0)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      toast.error(t('install.noFile'))
      return
    }
    install.mutate({ name: name.trim(), file })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('install.localTitle')}</DialogTitle>
          <DialogDescription>{t('install.localSubtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="install-app-name" required>
              {t('install.nameLabel')}
            </FieldLabel>
            <Input
              id="install-app-name"
              className="font-data"
              value={name}
              placeholder={t('install.namePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              disabled={install.isPending}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>{t('install.nameHelp')}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="install-app-file" required>
              {t('install.fileLabel')}
            </FieldLabel>
            <ZipDropzone
              id="install-app-file"
              file={file}
              onFileChange={setFile}
              prompt={t('install.fileDrop')}
              disabled={install.isPending}
            />
            <FieldDescription>{t('install.fileHint')}</FieldDescription>
          </Field>

          {install.error ? <ErrorState error={install.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={install.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={install.isPending} disabled={!name.trim()}>
              {!install.isPending && <Upload className="size-4" aria-hidden />}
              {install.isPending ? t('install.submitting') : t('install.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
