'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Braces, Download, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { CopyButton } from '@/components/app/copy-button'
import { EmptyState, ErrorState } from '@/components/app/states'
import { DynamicField, inferFieldType } from '@/components/apps/dynamic-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { getAppConfig, setAppConfig } from '@/lib/api/domains/apps'
import { queryKeys } from '@/lib/api/query-keys'
import { type AppConfigResult, tryParseJsonConfig } from '@/lib/api/types/apps'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * App configuration editor.
 *
 * `apps/config/get` hands back the app's config as a single opaque string
 * (`AppConfigResult = { config: string }`) — there is no field schema, so this
 * dialog *derives* one. When the string parses to a JSON object it offers a
 * Form view that renders one `DynamicField` per key (control type inferred from
 * each value), plus a Raw view over the same text; anything that is not a JSON
 * object (a bare array, a scalar, an app-proprietary blob) gets the Raw view
 * only. Both views edit the same `text` state, so switching is lossless and Save
 * always posts the current text via `setAppConfig` (which also reloads the app).
 *
 * Two deliberate choices:
 *
 *  - **No `ScrollArea`.** Its viewport is `size-full`, which inside a
 *    `max-h` flex `DialogContent` never converges and swallows the footer's
 *    click. The scrollable region is a plain `min-h-0 flex-1 overflow-y-auto`.
 *  - **Dirty-guarded close.** Editing config is expensive to lose, so any close
 *    (Cancel, Escape, overlay, X) with unsaved text routes through a discard
 *    confirm instead of dropping the operator's work silently.
 */

export interface AppConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` keeps the dialog mounted but idle. */
  appName: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function AppConfigDialog({ open, onOpenChange, appName }: AppConfigDialogProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Apps')
  const name = appName ?? ''

  const config = useQuery({
    queryKey: queryKeys.appConfig(target, name),
    queryFn: () => getAppConfig(name),
    enabled: open && Boolean(appName),
    // Config is edited, not browsed — always re-read on open so a stale cache
    // never overwrites a change made elsewhere.
    staleTime: 0,
  })

  const [text, setText] = React.useState('')
  const [initialText, setInitialText] = React.useState('')
  const [mode, setMode] = React.useState<'form' | 'raw'>('raw')
  const [formKey, setFormKey] = React.useState(0)
  const [invalidKeys, setInvalidKeys] = React.useState<ReadonlySet<string>>(new Set())
  const [discardOpen, setDiscardOpen] = React.useState(false)

  // Seed the editor from a freshly-arrived config *during render* — React's
  // sanctioned "adjust state when a value changes" pattern — rather than in an
  // effect, which `react-hooks/set-state-in-effect` (rightly) flags as a
  // cascading-render source. `seedToken` is the config payload while open and
  // `undefined` once closed, so it changes exactly when a re-seed is owed: a new
  // payload arrives, or the dialog re-opens (which clears a previously discarded
  // edit). Comparing against `lastSeed` makes ordinary re-renders — typing, mode
  // switches — no-ops, so in-progress edits survive.
  const seedToken = open ? config.data : undefined
  const [lastSeed, setLastSeed] = React.useState<AppConfigResult | undefined>(undefined)
  if (seedToken !== lastSeed) {
    setLastSeed(seedToken)
    if (seedToken) {
      const loaded = seedToken.config ?? ''
      setInitialText(loaded)
      setText(loaded)
      setInvalidKeys(new Set())
      setFormKey((key) => key + 1)
      setMode(isPlainObject(tryParseJsonConfig(loaded)) ? 'form' : 'raw')
    }
  }

  const save = useMutation({
    mutationFn: (next: string) => setAppConfig(name, next),
    onSuccess: () => {
      toast.success(t('config.saved'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.appConfig(target, name) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps(target) })
      onOpenChange(false)
    },
  })

  const parsed = React.useMemo(() => tryParseJsonConfig(text), [text])
  const formObject = isPlainObject(parsed) ? parsed : null
  const canForm = formObject !== null
  const loadedIsEmpty = Boolean(config.data) && (config.data?.config ?? '').trim() === ''
  const initialWasJson = tryParseJsonConfig(initialText) !== undefined
  const dirty = text !== initialText

  // Block Save while a nested JSON/number draft is unparseable, or while the Raw
  // view of a config that started life as JSON no longer parses.
  const rawInvalid = mode === 'raw' && initialWasJson && text.trim() !== '' && parsed === undefined
  const blockSave = (mode === 'form' && invalidKeys.size > 0) || rawInvalid

  function updateField(key: string, value: unknown) {
    if (!formObject) return
    setText(JSON.stringify({ ...formObject, [key]: value }, null, 2))
  }

  function markInvalid(key: string, invalid: boolean) {
    setInvalidKeys((prev) => {
      const next = new Set(prev)
      if (invalid) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function formatRaw() {
    const reparsed = tryParseJsonConfig(text)
    if (reparsed === undefined) {
      toast.error(t('config.formatFailed'))
      return
    }
    setText(JSON.stringify(reparsed, null, 2))
  }

  function resetToSaved() {
    setText(initialText)
    setInvalidKeys(new Set())
    setFormKey((key) => key + 1)
  }

  function downloadConfig() {
    const isJson = tryParseJsonConfig(text) !== undefined
    const blob = new Blob([text], { type: isJson ? 'application/json' : 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${name || 'app'}-config.${isJson ? 'json' : 'txt'}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function requestClose() {
    if (dirty && !save.isPending) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  const entries = formObject ? Object.entries(formObject) : []

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('config.title', { name })}</DialogTitle>
            <DialogDescription>{t('config.subtitle')}</DialogDescription>
          </DialogHeader>

          {!config.isPending && !config.error && !loadedIsEmpty && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canForm && (
                <div role="group" aria-label={t('config.viewMode')} className="flex items-center gap-0.5 rounded-md border border-input p-0.5">
                  <Button type="button" variant={mode === 'form' ? 'secondary' : 'ghost'} size="xs" aria-pressed={mode === 'form'} onClick={() => setMode('form')}>
                    {t('config.formMode')}
                  </Button>
                  <Button type="button" variant={mode === 'raw' ? 'secondary' : 'ghost'} size="xs" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>
                    {t('config.rawMode')}
                  </Button>
                </div>
              )}

              <div className="ml-auto flex items-center gap-1">
                {mode === 'raw' && (
                  <Button type="button" variant="ghost" size="xs" onClick={formatRaw} disabled={!can.canModify}>
                    <Braces className="size-3.5" aria-hidden />
                    {t('config.formatted')}
                  </Button>
                )}
                <CopyButton value={text} label={t('config.copy')} variant="ghost" size="icon-xs" disabled={!can.canModify} />
                <Button type="button" variant="ghost" size="icon-xs" onClick={downloadConfig} aria-label={t('config.download')} title={t('config.download')}>
                  <Download className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {config.isPending ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : config.error ? (
              <ErrorState
                error={config.error}
                title={t('config.loadFailed')}
                onRetry={() => void config.refetch()}
                compact
              />
            ) : loadedIsEmpty ? (
              <EmptyState title={t('config.empty')} body={t('config.loadFailedHint')} icon={Braces} className="py-8" />
            ) : mode === 'form' ? (
              <div key={formKey} className="flex flex-col gap-3">
                {entries.map(([key, value]) => {
                  const type = inferFieldType(value)
                  return (
                    <DynamicField
                      key={key}
                      id={`app-config-${name}-${key}`}
                      label={key}
                      value={value}
                      type={type}
                      hint={type === 'json' ? t('config.jsonFieldHint') : undefined}
                      disabled={!can.canModify}
                      onChange={(next) => updateField(key, next)}
                      onInvalidChange={(invalid) => markInvalid(key, invalid)}
                    />
                  )
                })}
              </div>
            ) : (
              <Field>
                <FieldLabel htmlFor="app-config-raw">{t('config.rawLabel')}</FieldLabel>
                <Textarea
                  id="app-config-raw"
                  className={cn('font-data min-h-64', rawInvalid && 'border-destructive focus-visible:ring-destructive/30')}
                  value={text}
                  spellCheck={false}
                  aria-invalid={rawInvalid || undefined}
                  disabled={!can.canModify}
                  onChange={(event) => setText(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('config.rawHint')}</p>
              </Field>
            )}

            {blockSave && !config.isPending && !config.error && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {t('config.invalidJson')}
              </p>
            )}
            {save.error ? <ErrorState error={save.error} compact className="mt-3" /> : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-3">
            <span className="min-w-0 text-xs text-warning" aria-live="polite">
              {dirty ? t('config.unsavedChanges') : ''}
            </span>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={requestClose} disabled={save.isPending}>
                {tc('actions.cancel')}
              </Button>
              {can.canModify && (
                <Button type="button" variant="outline" onClick={resetToSaved} disabled={!dirty || save.isPending} title={t('config.resetHint')}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('config.reset')}
                </Button>
              )}
              {can.canModify && (
                <Button type="button" onClick={() => save.mutate(text)} loading={save.isPending} disabled={blockSave || loadedIsEmpty}>
                  {save.isPending ? t('config.saving') : t('config.save')}
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('config.unsavedChanges')}
        description={t('config.discardConfirm')}
        tone="destructive"
        onConfirm={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
