'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Check, Copy, Download, KeyRound } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { copyText } from '@/components/app/copy-button'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { describeError, saveBlob } from '@/lib/api/client'
import { createApiToken } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import type { CreatedToken } from '@/lib/api/types/user'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Mint a long-lived API token for the signed-in user and show it exactly once.
 *
 * Upstream stores only a hash of the token, so `CreatedToken.token` exists for
 * the lifetime of this dialog and never again — hence the two-state design (a
 * one-field form, then a read-only reveal) and the deliberate trap: once the
 * value is on screen, `Escape`, the overlay click and the close button are all
 * disabled so it cannot be dismissed by accident before the operator has copied
 * or downloaded it. Only the explicit "done" action closes and resets.
 *
 * The download path reuses `saveBlob` (the same helper the zone/backup exports
 * use) so the plaintext never round-trips through the proxy or touches the URL
 * bar. Closing invalidates the profile query, which is where this panel's token
 * list is derived from (`profile.sessions` filtered to `ApiToken`).
 */

export interface CreateTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateTokenDialog({ open, onOpenChange }: CreateTokenDialogProps) {
  const t = useTranslations('account')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [name, setName] = React.useState('')
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<CreatedToken | null>(null)

  const create = useMutation({
    mutationFn: (tokenName: string) => createApiToken(tokenName),
    onSuccess: (data) => {
      setResult(data)
      toast.success(t('tokens.created'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    // Deferred so the exit animation never flashes an empty form or a stale token.
    setTimeout(() => {
      setName('')
      setNameError(null)
      setResult(null)
      create.reset()
    }, 0)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const tokenName = name.trim()
    if (!tokenName) {
      setNameError(tc('form.required'))
      return
    }
    setNameError(null)
    void create.mutateAsync(tokenName)
  }

  async function copyToken() {
    if (!result) return
    const ok = await copyText(result.token)
    if (ok) toast.success(t('tokens.revealOnce.copied'))
    else toast.error(tc('toast.failed'))
  }

  function download() {
    if (!result) return
    const blob = new Blob([result.token], { type: 'text/plain;charset=utf-8' })
    saveBlob(blob, `${result.tokenName || 'api-token'}.txt`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else if (!result) close()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!result}>
        <DialogHeader>
          <DialogTitle>{result ? t('tokens.revealOnce.title') : t('tokens.create')}</DialogTitle>
          <DialogDescription>{result ? t('tokens.revealOnce.body') : t('tokens.subtitle')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('tokens.revealOnce.token')}</span>
              <code className="font-data break-all rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
                {result.token}
              </code>
            </div>
            <DialogFooter showCloseButton={false}>
              <Button type="button" variant="outline" onClick={() => void copyToken()}>
                <Copy className="size-4" aria-hidden />
                {t('tokens.revealOnce.copy')}
              </Button>
              <Button type="button" variant="outline" onClick={download}>
                <Download className="size-4" aria-hidden />
                {t('tokens.revealOnce.download')}
              </Button>
              <Button type="button" onClick={close}>
                <Check className="size-4" aria-hidden />
                {t('tokens.revealOnce.done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
            <Field>
              <FieldLabel htmlFor="ct-name" required>
                {t('tokens.name')}
              </FieldLabel>
              <Input
                id="ct-name"
                value={name}
                autoComplete="off"
                placeholder={t('tokens.namePlaceholder')}
                aria-invalid={Boolean(nameError)}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>{t('tokens.nameHint')}</FieldDescription>
              <FieldError>{nameError}</FieldError>
            </Field>

            {create.error ? <ErrorState error={create.error} compact /> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {!create.isPending && <KeyRound className="size-4" aria-hidden />}
                {create.isPending ? t('tokens.creating') : t('tokens.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
