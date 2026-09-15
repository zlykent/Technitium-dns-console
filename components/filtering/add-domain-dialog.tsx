'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CirclePlus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
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
import { describeError } from '@/lib/api/client'
import { addDomain, type EditableScope } from '@/lib/api/domains/filtering'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Add-domain dialog for the allowed and blocked lists.
 *
 * A single controlled input — no react-hook-form overhead for one field. The
 * validation is deliberately lenient on the client (only checks for a non-empty
 * string that looks like a domain) because the server is the authority and will
 * reject anything truly invalid with a descriptive message.
 *
 * The dialog stays open on error so the operator does not lose what they typed;
 * the upstream message is rendered inline via `<ErrorState compact />`.
 */

/** Minimal domain shape check: at least one label, no spaces, no protocol. */
const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

export interface AddDomainDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: EditableScope
}

export function AddDomainDialog({ open, onOpenChange, scope }: AddDomainDialogProps) {
  const t = useTranslations('filtering')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [domain, setDomain] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const trimmed = domain.trim().replace(/^\./, '').replace(/\.$/, '')
  const invalid = touched && trimmed.length > 0 && !DOMAIN_PATTERN.test(trimmed)
  const empty = touched && trimmed.length === 0

  const mutation = useMutation({
    mutationFn: (value: string) => addDomain(scope, value),
    onSuccess: (_result, value) => {
      toast.success(t('add.success', { domain: value }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, scope) })
      close()
    },
    onError: (error, value) => {
      const message = describeError(error).message
      // Technitium rejects a duplicate with a free-text upstream message; swap
      // in the localized hint when it looks like an "already exists" rejection.
      toast.error(/already|exists/i.test(message) ? t('add.alreadyExists', { domain: value }) : message)
    },
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      setDomain('')
      setTouched(false)
      mutation.reset()
    }, 0)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!trimmed || invalid) return
    mutation.mutate(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('add.title')}</DialogTitle>
          <DialogDescription>{t(`scopes.${scope}.description`)}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="add-domain" required>
              {t('add.domainLabel')}
            </FieldLabel>
            <Input
              id="add-domain"
              className="font-data"
              placeholder={t('add.domainPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={invalid || empty || undefined}
              aria-describedby="add-domain-help"
              autoFocus
            />
            <FieldDescription id="add-domain-help">{t('add.domainHelp')}</FieldDescription>
            <FieldError>
              {invalid ? t('add.invalidDomain') : empty ? tc('form.required') : undefined}
            </FieldError>
          </Field>

          {mutation.error ? <ErrorState error={mutation.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={touched && (invalid || empty)}>
              {!mutation.isPending && <CirclePlus className="size-4" aria-hidden />}
              {mutation.isPending ? t('add.submitting') : t('add.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
