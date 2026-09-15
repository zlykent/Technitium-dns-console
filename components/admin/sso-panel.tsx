'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CirclePlus, ExternalLink, KeyRound, Save, Trash, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { CopyButton } from '@/components/app/copy-button'
import { Section } from '@/components/app/page-shell'
import { ErrorState, LoadingState } from '@/components/app/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { getSso, listGroups, setSso } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { SsoSettings } from '@/lib/api/types/admin'
import { useCan } from '@/lib/auth/session'
import { maskSecret } from '@/lib/format'
import { useServers, useTargetKey } from '@/lib/servers/provider'

/**
 * Single sign-on tab: the OIDC / OAuth2 configuration and the group map.
 *
 * Everything here is one `admin/sso/set` call — there is no per-field endpoint —
 * so the whole form is submitted as a unit and a partial edit is impossible.
 *
 * Three wire-format traps, all inherited from the stock console
 * (`.probe/console-js/auth.js:2197-2270`):
 *
 *  - **`ssoScopes` is pipe-delimited, not comma-delimited.** `appendParams`
 *    (`lib/api/client.ts:231-236`) joins arrays with commas, so the scope list is
 *    sent as a *single-element* array whose value is already `a|b|c`. That
 *    round-trips to exactly what upstream's `serializeTableData(..., 1)` emits.
 *  - **`ssoGroupMap` is a flat pipe stream** of `remoteGroup|localGroup` pairs —
 *    rows are concatenated with the same separator as columns, and an empty map
 *    is `""`, which must still be sent or the existing mappings survive.
 *  - **`ssoClientSecret` is write-only.** `admin/sso/get` returns the stored
 *    secret, but showing it in the input would put a credential in the DOM and
 *    in every screenshot; the field renders `maskSecret(...)` as a hint and an
 *    empty value means "keep what is stored", so the parameter is omitted
 *    entirely rather than sent blank.
 *
 * The redirect URI is derived from the *selected server's* origin, not
 * `window.location`. This console is a separate Next.js app on its own port; the
 * `/sso/callback` route belongs to Technitium's web service, so copying the
 * stock console's `window.location`-based value would hand the operator a URI
 * that their identity provider can never reach.
 *
 * Finally: `sso.authorityPlaceholder` reads `...com/'<tenant>'/v2.0` in
 * `messages/{zh,en}/admin.json`. Those apostrophes are *load-bearing* — ICU
 * MessageFormat treats `<word>` as a rich-text tag, so an unescaped `<tenant>`
 * fails to parse (`INVALID_MESSAGE: UNCLOSED_TAG`) and next-intl renders the raw
 * key as the placeholder. Do not "tidy" them away.
 */

const NONE = '__none__'

/** Stable empty array so the `useMemo` below does not re-run every render. */
const NO_GROUPS: string[] = []

export function SsoPanel() {
  const t = useTranslations('admin')
  const target = useTargetKey()
  const can = useCan('Administration')

  const sso = useQuery({
    queryKey: queryKeys.sso(target),
    queryFn: () => getSso(),
    enabled: can.canView,
  })

  return (
    <Section title={t('sso.title')} description={t('sso.subtitle')}>
      {sso.isPending ? (
        <LoadingState rows={6} />
      ) : sso.error ? (
        <ErrorState error={sso.error} onRetry={() => void sso.refetch()} />
      ) : sso.data ? (
        // Keyed so `defaultValues` are captured from the payload instead of
        // needing a render-phase or effect-based `reset()` that could race the
        // Radix Select internals.
        <SsoForm key={sso.data.ssoEnabled ? 'on' : 'off'} settings={sso.data} canModify={can.canModify} />
      ) : null}
    </Section>
  )
}

/* ------------------------------------------------------------------ */

interface SsoFormProps {
  settings: SsoSettings
  canModify: boolean
}

interface GroupMapRow {
  remoteGroup: string
  localGroup: string
}

interface SsoFormValues {
  ssoEnabled: boolean
  ssoAuthority: string
  ssoClientId: string
  ssoClientSecret: string
  ssoMetadataAddress: string
  scopes: string
  ssoAllowSignup: boolean
  ssoAllowSignupOnlyForMappedUsers: boolean
}

function toFormValues(settings: SsoSettings): SsoFormValues {
  return {
    ssoEnabled: settings.ssoEnabled,
    ssoAuthority: settings.ssoAuthority ?? '',
    ssoClientId: settings.ssoClientId ?? '',
    ssoClientSecret: '',
    ssoMetadataAddress: settings.ssoMetadataAddress ?? '',
    scopes: (settings.ssoScopes ?? []).join('\n'),
    ssoAllowSignup: settings.ssoAllowSignup,
    ssoAllowSignupOnlyForMappedUsers: settings.ssoAllowSignupOnlyForMappedUsers,
  }
}

function toRows(settings: SsoSettings): GroupMapRow[] {
  return (settings.ssoGroupMap ?? []).map((entry) => ({
    remoteGroup: entry.remoteGroup,
    localGroup: entry.localGroup,
  }))
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Trimmed, de-duplicated, order-preserving line parser for the scopes textarea. */
function parseScopes(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function SsoForm({ settings, canModify }: SsoFormProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const { active } = useServers()

  const [rows, setRows] = React.useState<GroupMapRow[]>(() => toRows(settings))

  const schema = React.useMemo(
    () =>
      z
        .object({
          ssoEnabled: z.boolean(),
          ssoAuthority: z.string().trim(),
          ssoClientId: z.string().trim(),
          ssoClientSecret: z.string(),
          ssoMetadataAddress: z.string().trim(),
          scopes: z.string(),
          ssoAllowSignup: z.boolean(),
          ssoAllowSignupOnlyForMappedUsers: z.boolean(),
        })
        .superRefine((data, ctx) => {
          // Only an enabled provider has to be complete; a half-filled disabled
          // form must stay saveable so the operator can stash a draft.
          if (!data.ssoEnabled) return
          if (!data.ssoAuthority) {
            ctx.addIssue({ code: 'custom', path: ['ssoAuthority'], message: tc('form.required') })
          } else if (!isHttpUrl(data.ssoAuthority)) {
            ctx.addIssue({ code: 'custom', path: ['ssoAuthority'], message: tc('form.invalidUrl') })
          }
          if (!data.ssoClientId) {
            ctx.addIssue({ code: 'custom', path: ['ssoClientId'], message: tc('form.required') })
          }
          if (data.ssoMetadataAddress && !isHttpUrl(data.ssoMetadataAddress)) {
            ctx.addIssue({ code: 'custom', path: ['ssoMetadataAddress'], message: tc('form.invalidUrl') })
          }
        }),
    [tc],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])

  const form = useForm<SsoFormValues>({ resolver, defaultValues: toFormValues(settings) })
  // `useWatch`, not `form.watch`: the React Compiler lint rule treats the latter
  // as an unmemoisable API and would skip compiling this component.
  const enabled = useWatch({ control: form.control, name: 'ssoEnabled' })

  const save = useMutation({
    mutationFn: (values: SsoFormValues) => {
      const scopes = parseScopes(values.scopes)
      const map = rows.filter((row) => row.remoteGroup.trim() && row.localGroup)
      return setSso({
        ssoEnabled: values.ssoEnabled,
        ssoAuthority: values.ssoAuthority,
        ssoClientId: values.ssoClientId,
        // Blank means "keep the stored secret" — omitting is what says that.
        ...(values.ssoClientSecret ? { ssoClientSecret: values.ssoClientSecret } : {}),
        ssoMetadataAddress: values.ssoMetadataAddress,
        // Single-element array: `appendParams` would comma-join a real list, but
        // upstream wants `a|b|c`. See the file header.
        ssoScopes: [scopes.join('|')],
        ssoAllowSignup: values.ssoAllowSignup,
        ssoAllowSignupOnlyForMappedUsers: values.ssoAllowSignupOnlyForMappedUsers,
        ssoGroupMap: map.map((row) => `${row.remoteGroup.trim()}|${row.localGroup}`).join('|'),
      })
    },
    onSuccess: () => {
      toast.success(t('sso.saved'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const serverUrl = active?.url ?? (typeof window === 'undefined' ? '' : window.location.origin)
  const redirectUri = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/sso/callback` : ''

  function testSignIn() {
    if (!serverUrl) return
    // Technitium serves the flow itself; it is not proxied through this app.
    window.open(`${serverUrl.replace(/\/+$/, '')}/sso/login`, '_blank', 'noopener')
  }

  /**
   * The local-group options for the mapping rows.
   *
   * `SsoSettings` declares `localGroups: string[]` as required
   * (`lib/api/types/admin.ts:163`) and the probe agrees
   * (`.probe/admin.sso.get.json:16-20`), but upstream only emits the key when
   * the request carries `includeGroups=true` — which `getSso` never sends
   * (`lib/api/domains/admin.ts:104-106`; the stock console does, see
   * `.probe/console-js/auth.js:2160`). Reading it straight off the payload
   * therefore crashed the whole tab with `undefined.length` as soon as a mapping
   * row was added. Until the SDK sends the flag, `admin/groups/list` fills the
   * gap; it is already cached under `queryKeys.groups` by the Groups tab.
   */
  const declaredGroups = settings.localGroups ?? NO_GROUPS
  const fallbackGroups = useQuery({
    queryKey: queryKeys.groups(target),
    queryFn: () => listGroups(),
    enabled: canModify && declaredGroups.length === 0,
  })
  const localGroups = React.useMemo(
    () =>
      declaredGroups.length > 0
        ? declaredGroups
        : (fallbackGroups.data?.groups ?? []).map((group) => group.name),
    [declaredGroups, fallbackGroups.data],
  )

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
    >
      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t('sso.title')}</AlertTitle>
        <AlertDescription>{t('sso.warning')}</AlertDescription>
      </Alert>

      <SwitchRow
        id="sso-enabled"
        label={t('sso.enable')}
        help={t('sso.enableHelp')}
        control={form.control}
        name="ssoEnabled"
        disabled={!canModify}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="sso-authority" required={enabled}>
            {t('sso.authority')}
          </FieldLabel>
          <Input
            id="sso-authority"
            className="font-data"
            autoComplete="off"
            placeholder={t('sso.authorityPlaceholder')}
            disabled={!canModify}
            aria-invalid={Boolean(form.formState.errors.ssoAuthority)}
            {...form.register('ssoAuthority')}
          />
          <FieldDescription>{t('sso.authorityHelp')}</FieldDescription>
          <FieldError>{form.formState.errors.ssoAuthority?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="sso-client-id" required={enabled}>
            {t('sso.clientId')}
          </FieldLabel>
          <Input
            id="sso-client-id"
            className="font-data"
            autoComplete="off"
            disabled={!canModify}
            aria-invalid={Boolean(form.formState.errors.ssoClientId)}
            {...form.register('ssoClientId')}
          />
          <FieldError>{form.formState.errors.ssoClientId?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="sso-client-secret">{t('sso.clientSecret')}</FieldLabel>
          <Input
            id="sso-client-secret"
            type="password"
            autoComplete="new-password"
            disabled={!canModify}
            placeholder={settings.ssoClientSecret ? maskSecret(settings.ssoClientSecret) : undefined}
            {...form.register('ssoClientSecret')}
          />
          <FieldDescription>{t('sso.clientSecretHelp')}</FieldDescription>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="sso-metadata">{t('sso.metadataAddress')}</FieldLabel>
          <Input
            id="sso-metadata"
            className="font-data"
            autoComplete="off"
            disabled={!canModify}
            aria-invalid={Boolean(form.formState.errors.ssoMetadataAddress)}
            {...form.register('ssoMetadataAddress')}
          />
          <FieldDescription>{t('sso.metadataAddressHelp')}</FieldDescription>
          <FieldError>{form.formState.errors.ssoMetadataAddress?.message}</FieldError>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="sso-scopes">{t('sso.scopes')}</FieldLabel>
          <Textarea
            id="sso-scopes"
            rows={3}
            className="font-data"
            disabled={!canModify}
            {...form.register('scopes')}
          />
          <FieldDescription>
            {t('sso.scopesHelp')} — {tc('form.onePerLine')}
          </FieldDescription>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel>{t('sso.redirectUri')}</FieldLabel>
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
            <code className="font-data min-w-0 flex-1 break-all text-xs">{redirectUri || tc('fields.unknown')}</code>
            <CopyButton
              value={redirectUri}
              label={t('sso.copyRedirectUri')}
              variant="outline"
              size="icon-sm"
              disabled={!redirectUri}
            />
          </div>
          <FieldDescription>{t('sso.redirectUriHelp')}</FieldDescription>
        </Field>
      </div>

      <SwitchRow
        id="sso-allow-signup"
        label={t('sso.allowSignup')}
        help={t('sso.allowSignupHelp')}
        control={form.control}
        name="ssoAllowSignup"
        disabled={!canModify}
      />

      <SwitchRow
        id="sso-mapped-only"
        label={t('sso.allowSignupOnlyForMappedUsers')}
        help={t('sso.allowSignupOnlyForMappedUsersHelp')}
        control={form.control}
        name="ssoAllowSignupOnlyForMappedUsers"
        disabled={!canModify}
      />

      <Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel>{t('sso.groupMap')}</FieldLabel>
          {canModify && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setRows((current) => [...current, { remoteGroup: '', localGroup: '' }])}
            >
              <CirclePlus className="size-3.5" aria-hidden />
              {t('sso.addMapping')}
            </Button>
          )}
        </div>
        <FieldDescription>{t('sso.groupMapHint')}</FieldDescription>

        {rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{t('sso.emptyMapping')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  className="font-data h-8 w-52"
                  value={row.remoteGroup}
                  disabled={!canModify}
                  aria-label={t('sso.remoteGroup')}
                  placeholder={t('sso.remoteGroup')}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item, i) => (i === index ? { ...item, remoteGroup: event.target.value } : item)),
                    )
                  }
                />
                <Select
                  value={row.localGroup || NONE}
                  onValueChange={(value) =>
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, localGroup: value === NONE ? '' : value } : item,
                      ),
                    )
                  }
                  disabled={!canModify || localGroups.length === 0}
                >
                  <SelectTrigger size="sm" className="w-52" aria-label={t('sso.localGroup')}>
                    <SelectValue placeholder={t('sso.localGroup')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tc('fields.none')}</SelectItem>
                    {localGroups.map((name) => (
                      <SelectItem key={name} value={name}>
                        <span className="font-data">{name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canModify && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`${tc('actions.remove')} — ${row.remoteGroup || index}`}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash className="size-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Field>

      {save.error ? <ErrorState error={save.error} compact /> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        {canModify && (
          <Button type="submit" size="sm" loading={save.isPending}>
            {!save.isPending && <Save className="size-3.5" aria-hidden />}
            {save.isPending ? t('sso.saving') : t('sso.save')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={testSignIn}
          disabled={!enabled || !serverUrl}
          title={t('sso.testHint')}
        >
          <ExternalLink className="size-3.5" aria-hidden />
          {t('sso.test')}
        </Button>
        <KeyRound className="ml-auto size-4 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">{t('sso.testHint')}</span>
      </div>
    </form>
  )
}

/** Label + Switch on one row, wired through react-hook-form's `Controller`. */
function SwitchRow<TFieldValues extends FieldValues>({
  id,
  label,
  help,
  control,
  name,
  disabled = false,
}: {
  id: string
  label: string
  help?: string
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />
        )}
      />
    </div>
  )
}
