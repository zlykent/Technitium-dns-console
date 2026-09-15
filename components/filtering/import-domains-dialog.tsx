'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { importDomains, type EditableScope } from '@/lib/api/domains/filtering'
import { normalizeZoneList } from '@/lib/api/types/filtering'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Bulk-import dialog for the allowed and blocked lists.
 *
 * The operator pastes a newline- or comma-separated list of domains (the same
 * format the stock console's `cleanTextList` accepts). A live count of parsed
 * entries is shown so the operator can sanity-check before submitting. Lines
 * starting with `#` are treated as comments and stripped by `normalizeZoneList`.
 *
 * The dialog stays open on error so the pasted text is not lost; the upstream
 * message is rendered inline via `<ErrorState compact />`.
 */

export interface ImportDomainsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: EditableScope
}

export function ImportDomainsDialog({ open, onOpenChange, scope }: ImportDomainsDialogProps) {
  const t = useTranslations('filtering')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [text, setText] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const parsed = React.useMemo(() => {
    const lines = text
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
    return normalizeZoneList(lines.join('\n'))
  }, [text])

  const mutation = useMutation({
    mutationFn: (value: string) => importDomains(scope, value),
    onSuccess: () => {
      toast.success(t('import.success', { count: parsed.length }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, scope) })
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      setText('')
      setTouched(false)
      mutation.reset()
    }, 0)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (parsed.length === 0) return
    mutation.mutate(text)
  }

  // A plain-text file is a convenience over pasting: read it client-side and
  // append to the textarea so the operator still sees (and can edit) the list
  // before submitting. Nothing is uploaded — the server only ever receives the
  // final text via `importDomains`.
  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${content}` : content))
    }
    reader.readAsText(file)
  }

  const showEmpty = touched && parsed.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="import-domains" required>
              {t('import.textLabel')}
            </FieldLabel>
            <Textarea
              id="import-domains"
              className="font-data min-h-40"
              placeholder={t('import.textPlaceholder')}
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showEmpty || undefined}
              aria-describedby="import-domains-help"
            />
            <FieldDescription id="import-domains-help">
              {parsed.length > 0
                ? t('import.parsed', { count: parsed.length })
                : tc('form.onePerLine')}
            </FieldDescription>
            <FieldError>
              {showEmpty ? t('import.empty') : undefined}
            </FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="import-file">{t('import.fileLabel')}</FieldLabel>
            <label
              htmlFor="import-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-4 py-6 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Upload className="size-4" aria-hidden />
              {t('import.fileDrop')}
            </label>
            <input
              id="import-file"
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              onChange={onFile}
            />
          </Field>

          {mutation.error ? <ErrorState error={mutation.error} compact /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={parsed.length === 0}>
              {!mutation.isPending && <Upload className="size-4" aria-hidden />}
              {mutation.isPending ? t('import.submitting') : t('import.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
