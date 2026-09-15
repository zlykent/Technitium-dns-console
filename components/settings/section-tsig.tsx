'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { CirclePlus, Eye, EyeOff, KeyRound, Trash } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { CopyButton } from '@/components/app/copy-button'
import { InlineLoading } from '@/components/app/states'
import { SettingsSection } from '@/components/settings/settings-field'
import {
  generateTsigSecret,
  isBase64,
  normaliseAlgorithm,
  TSIG_ALGORITHMS,
  type TsigRow,
} from '@/components/settings/settings-fields'
import { getTsigKeyNames } from '@/lib/api/domains/settings'
import { queryKeys } from '@/lib/api/query-keys'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * TSIG key editor.
 *
 * The one panel that does *not* live in react-hook-form. The value is a table
 * whose wire form is `serializeTableData(table, 3)` — three pipe-separated cells
 * per key, all keys flattened into one string (`main.js:1951-1960`) — and an
 * empty table has to become the literal `false` so the server clears every key.
 * Encoding that as a single `z.string()` would give per-cell errors no useful
 * path, so the rows are plain component state owned by the view and handed to
 * `buildPatch`, which serialises them with `serializeTsigKeys`.
 *
 * `getTsigKeyNames` is queried separately even though `settings/get` already
 * returns the keys, because the two answer different questions: `settings/get`
 * is the cached snapshot this editor started from, while `getTsigKeyNames` is the
 * live server state. Comparing them is what lets the panel warn that saving will
 * delete a key somebody else added in the meantime — otherwise the operator
 * would wipe it without ever seeing it.
 *
 * The secret is masked by default (`settings/get` returns it in clear text) and
 * revealed per row, so a shoulder-surfer does not get every key at once.
 */

export interface SectionTsigProps {
  rows: readonly TsigRow[]
  onChange: (rows: TsigRow[]) => void
  disabled: boolean
}

export function SectionTsig({ rows, onChange, disabled }: SectionTsigProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const target = useTargetKey()

  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = React.useState<TsigRow | null>(null)
  const counter = React.useRef(0)

  const serverNames = useQuery({
    queryKey: queryKeys.tsigKeys(target),
    queryFn: () => getTsigKeyNames(),
  })

  function toggleReveal(id: string) {
    setRevealed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function update(id: string, patch: Partial<TsigRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addRow() {
    counter.current += 1
    onChange([
      ...rows,
      {
        id: `tsig-new-${counter.current}`,
        keyName: '',
        sharedSecret: generateTsigSecret(),
        algorithmName: normaliseAlgorithm(null),
      },
    ])
  }

  function remove(id: string) {
    onChange(rows.filter((row) => row.id !== id))
    setPendingDelete(null)
  }

  // Keys the server has that this editor would drop on save.
  const deleted = React.useMemo(() => {
    const names = new Set(rows.map((row) => row.keyName.trim()).filter(Boolean))
    return (serverNames.data?.tsigKeyNames ?? []).filter((name) => !names.has(name))
  }, [rows, serverNames.data])

  return (
    <SettingsSection
      id="tsig"
      title={t('tsig.title')}
      description={t('tsig.hint')}
      actions={
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={addRow}>
          <CirclePlus className="size-3.5" aria-hidden />
          {t('tsig.add')}
        </Button>
      }
    >
      {serverNames.isPending ? (
        <InlineLoading label={t('tsig.serverNames')} />
      ) : serverNames.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('tsig.serverNames')}</span>
          {serverNames.data.tsigKeyNames.length === 0 ? (
            <Badge variant="secondary">{t('tsig.empty')}</Badge>
          ) : (
            serverNames.data.tsigKeyNames.map((name) => (
              <Badge key={name} variant="secondary" className="gap-1 font-data">
                <KeyRound className="size-2.5" aria-hidden />
                {name}
              </Badge>
            ))
          )}
        </div>
      ) : null}

      {deleted.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            {deleted.map((name) => (
              <span key={name} className="block font-data">
                {t('tsig.pendingDelete', { name })}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tsig.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const nameError = row.keyName.trim() === '' ? tc('form.required') : undefined
            const secretError = isBase64(row.sharedSecret) ? undefined : t('tsig.invalidBase64')
            const shown = revealed.has(row.id)

            return (
              <div
                key={row.id}
                role="group"
                aria-label={t('tsig.edit')}
                className="surface-raised flex flex-col gap-3 rounded-md border border-border/60 p-3"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-name`} required className="text-xs">
                      {t('tsig.keyName')}
                    </FieldLabel>
                    <Input
                      id={`${row.id}-name`}
                      value={row.keyName}
                      disabled={disabled}
                      onChange={(event) => update(row.id, { keyName: event.target.value })}
                      aria-invalid={nameError ? true : undefined}
                      autoComplete="off"
                      className="font-data text-xs"
                      placeholder="tsig-key-1"
                    />
                    <FieldError>{nameError}</FieldError>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`${row.id}-secret`} required className="text-xs">
                      {t('tsig.sharedSecret')}
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id={`${row.id}-secret`}
                        type={shown ? 'text' : 'password'}
                        value={row.sharedSecret}
                        disabled={disabled}
                        onChange={(event) => update(row.id, { sharedSecret: event.target.value })}
                        aria-invalid={secretError ? true : undefined}
                        autoComplete="new-password"
                        className="font-data pr-24 text-xs"
                      />
                      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
                        <CopyButton value={row.sharedSecret} label={t('tsig.copySecret')} disabled={disabled} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={disabled}
                          aria-label={shown ? t('tsig.hideSecret') : t('tsig.showSecret')}
                          title={shown ? t('tsig.hideSecret') : t('tsig.showSecret')}
                          onClick={() => toggleReveal(row.id)}
                          className="text-muted-foreground"
                        >
                          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={disabled}
                          aria-label={t('tsig.generate')}
                          title={t('tsig.generate')}
                          onClick={() => update(row.id, { sharedSecret: generateTsigSecret() })}
                          className="text-muted-foreground"
                        >
                          <KeyRound aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <FieldError>{secretError}</FieldError>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`${row.id}-algorithm`} className="text-xs">
                      {t('tsig.algorithm')}
                    </FieldLabel>
                    <Select
                      value={row.algorithmName}
                      disabled={disabled}
                      onValueChange={(value) => update(row.id, { algorithmName: normaliseAlgorithm(value) })}
                    >
                      <SelectTrigger id={`${row.id}-algorithm`} className="font-data text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TSIG_ALGORITHMS.map((algorithm) => (
                          <SelectItem key={algorithm} value={algorithm} className="font-data">
                            {algorithm}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={disabled}
                      aria-label={t('tsig.delete')}
                      title={t('tsig.delete')}
                      onClick={() => setPendingDelete(row)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('tsig.delete')}
        description={pendingDelete ? t('tsig.deleteConfirm', { name: pendingDelete.keyName }) : undefined}
        confirmLabel={t('tsig.delete')}
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete.id)
        }}
      >
        {/* The wording of `deleteConfirm` says transfers fail "immediately", which
            is only true once the change is committed — the table is edited in
            local state and reaches the server through `settings/set`. */}
        <p className="text-sm text-muted-foreground">{t('tsig.applyOnSave')}</p>
      </ConfirmDialog>
    </SettingsSection>
  )
}
