'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { RotateCcw, Save, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { ErrorState, NoResultsState } from '@/components/app/states'
import { PageHeader, PageShell } from '@/components/app/page-shell'
import { SearchInput, useDebouncedValue } from '@/components/app/search-input'
import {
  isPanelVisible,
  SettingsActionsProvider,
  SettingsFilterProvider,
  useSettingsFilterValue,
  type SettingsActionsValue,
} from '@/components/settings/settings-field'
import {
  buildPatch,
  CLUSTER_FIELDS,
  FIELD_LABEL_KEYS,
  FIELD_SECTION,
  isBase64,
  NODE_CLUSTER,
  NODE_LOCAL,
  pickParams,
  SECTION_FIELDS,
  SECTION_IDS,
  sectionParams,
  selectValueToNode,
  serializeTsigKeys,
  toFormValues,
  toTsigRows,
  type SectionId,
  type SettingsFieldName,
  type TsigRow,
} from '@/components/settings/settings-fields'
import { buildSettingsSchema, type SettingsFormValues, type SettingsSchemaMessages } from '@/components/settings/settings-schema'
import { scrollToSection, SettingsNav, useActiveSection } from '@/components/settings/settings-nav'
import { SectionAdvanced } from '@/components/settings/section-advanced'
import { SectionBackup } from '@/components/settings/section-backup'
import { SectionBlocking } from '@/components/settings/section-blocking'
import { SectionCache } from '@/components/settings/section-cache'
import { SectionDnsOverX } from '@/components/settings/section-dns-over-x'
import { SectionEdns } from '@/components/settings/section-edns'
import { SectionGeneral } from '@/components/settings/section-general'
import { SectionListeners } from '@/components/settings/section-listeners'
import { SectionLogging } from '@/components/settings/section-logging'
import { SectionProxy } from '@/components/settings/section-proxy'
import { SectionRateLimit } from '@/components/settings/section-rate-limit'
import { SectionRecursion } from '@/components/settings/section-recursion'
import { SectionTsig } from '@/components/settings/section-tsig'
import { SectionUpdates } from '@/components/settings/section-updates'
import { SectionWebService } from '@/components/settings/section-web-service'
import { SectionZoneDefaults } from '@/components/settings/section-zone-defaults'
import { describeError } from '@/lib/api/client'
import { getClusterState } from '@/lib/api/domains/admin'
import { getSettings, setSettings, type SettingsPatch } from '@/lib/api/domains/settings'
import { queryKeys } from '@/lib/api/query-keys'
import type { DnsSettings } from '@/lib/api/types/settings'
import { useCan } from '@/lib/auth/session'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Server settings: all 132 keys `settings/get` returns, in sixteen anchored
 * panels behind a sticky table of contents.
 *
 * The page is one form, not sixteen. `settings/set` is a single flat endpoint and
 * the stock console posts *every* parameter on every save (`main.js:1631-2201`),
 * so a shared form is what makes the wire payload identical to the reference
 * implementation. Per-panel saving is layered on top by validating and then
 * slicing that payload with `pickParams(patch, sectionParams(id))` — one code
 * path builds the body, which is the only way 120 parameters stay consistent.
 *
 * Non-obvious parts:
 *
 *  - **The form mounts only once data exists** (`SettingsView` renders
 *    `SettingsForm` in the success branch alone). Radix `Select` silently blanks
 *    itself when a controlled value points at an item that is not rendered yet;
 *    `components/zones/zone-options-view.tsx:150` documents the same trap.
 *  - **`revision` forces a subtree remount after every reset.** Most controls are
 *    fine with `form.reset()`, but `QpmRuleTable` keeps row state locally (its
 *    cells cannot be derived from the serialised value without losing
 *    half-typed rows), so a reset alone would leave it showing the old rules.
 *    Remounting is cheaper than threading a reset signal down.
 *  - **Scope is per field.** Selecting a cluster node makes the ~61 cluster-wide
 *    parameters inert and vice versa; `SettingsActionsValue.applies` drives the
 *    greying-out and `buildPatch` does the matching omission, so the UI can never
 *    show an editable control whose value would be dropped.
 *  - **TSIG rows live outside the form** — see `section-tsig.tsx`. They still
 *    ride along in the same patch, and `tsigValid` blocks every save path, not
 *    just the panel's own, because `settings/set` is all-or-nothing.
 *  - `beforeunload` is the only navigation guard available: this app has no
 *    router-level blocker, so an in-app click away still loses the edits. The
 *    sticky bar and the nav's dirty dots exist to make that unlikely.
 */

export function SettingsView() {
  const t = useTranslations('settings')
  const target = useTargetKey()
  const can = useCan('Settings')
  const canAdmin = useCan('Administration').canView

  const settings = useQuery({
    queryKey: queryKeys.settings(target),
    queryFn: () => getSettings(),
  })

  // Only useful once a cluster exists, and only to someone who may read it.
  const cluster = useQuery({
    queryKey: queryKeys.clusterState(target),
    queryFn: () => getClusterState(),
    enabled: canAdmin && Boolean(settings.data?.clusterInitialized),
    retry: false,
  })

  function reload() {
    void settings.refetch()
    if (canAdmin && settings.data?.clusterInitialized) void cluster.refetch()
  }

  return (
    <PageShell>
      <PageHeader
        actions={
          <Button type="button" variant="outline" size="sm" onClick={reload} loading={settings.isFetching}>
            {!settings.isFetching && <RotateCcw className="size-4" aria-hidden />}
            {t('reload')}
          </Button>
        }
      />

      {settings.isPending ? (
        <SettingsSkeleton />
      ) : settings.error || !settings.data ? (
        <ErrorState error={settings.error ?? new Error('no data')} onRetry={reload} />
      ) : (
        <SettingsForm
          data={settings.data}
          canModify={can.canModify}
          nodes={(cluster.data?.clusterNodes ?? []).map((node) => node.name)}
        />
      )}
    </PageShell>
  )
}

// ------------------------------------------------------------------------ form

interface SettingsFormProps {
  data: DnsSettings
  canModify: boolean
  /** Cluster node names; empty when the server is standalone. */
  nodes: readonly string[]
}

function SettingsForm({ data, canModify, nodes }: SettingsFormProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()

  const [revision, setRevision] = React.useState(0)
  const [nodeValue, setNodeValue] = React.useState<string>(NODE_LOCAL)
  const [search, setSearch] = React.useState('')
  const [savingSection, setSavingSection] = React.useState<SectionId | null>(null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const [tsigRows, setTsigRows] = React.useState<TsigRow[]>(() => toTsigRows(data))

  const debouncedSearch = useDebouncedValue(search, 250)
  const filter = useSettingsFilterValue(debouncedSearch)

  /** `settings/set` parameter, `''` meaning "this machine". */
  const node = selectValueToNode(nodeValue)
  const clustered = data.clusterInitialized && nodes.length > 0

  const tr = t as unknown as (key: string, values?: Record<string, unknown>) => string

  const messages = React.useMemo<SettingsSchemaMessages>(
    () => ({
      required: tc('form.required'),
      invalidNumber: tc('form.invalidNumber'),
      invalidIp: tc('form.invalidIp'),
      invalidDomain: tc('form.invalidDomain'),
      invalidUrl: tc('form.invalidUrl'),
      min: (value) => tc('form.minValue', { min: value }),
      max: (value) => tc('form.maxValue', { max: value }),
      invalidEndpoint: (value) => t('listeners.invalidEndpoint', { value }),
      portConflict: (port, other) => t('dnsOverX.portConflict', { port, other }),
      requiresAddress: t('proxy.requiresAddress'),
      // `{other}` in the port-conflict message is the *label* of the rival field,
      // resolved through the same index search uses so the two always agree.
      fieldLabel: (field) => {
        const key = FIELD_LABEL_KEYS[field]
        return key ? tr(key) : field
      },
    }),
    [t, tc, tr],
  )

  const schema = React.useMemo(() => buildSettingsSchema(messages), [messages])
  const resolver = React.useMemo(() => zodResolver(schema), [schema])

  const defaults = React.useMemo(() => toFormValues(data), [data])
  const form = useForm<SettingsFormValues>({ resolver, defaultValues: defaults, mode: 'onChange' })

  // ---------------------------------------------------------------- dirty state

  // `formState.dirtyFields` is mutated *in place* by react-hook-form: the object
  // identity never changes, so a `useMemo` keyed on it freezes at whatever the
  // first edit produced and the save bar under-counts forever. Read it fresh on
  // every render instead — 132 entries is nothing — and derive a stable string
  // signature for the (genuinely memoised) section set below.
  const dirtyFieldList = Object.entries(form.formState.dirtyFields)
    .filter(([, value]) => value === true)
    .map(([field]) => field)
  const dirtySignature = dirtyFieldList.join('|')

  const serverTsig = React.useMemo(() => serializeTsigKeys(toTsigRows(data)), [data])
  const currentTsig = React.useMemo(() => serializeTsigKeys(tsigRows), [tsigRows])
  const tsigChanged = serverTsig !== currentTsig
  const tsigValid = tsigRows.every((row) => row.keyName.trim() !== '' && isBase64(row.sharedSecret))

  const dirtySections = React.useMemo(() => {
    const out = new Set<SectionId>()
    for (const field of dirtySignature.split('|')) {
      if (field === '') continue
      const id = FIELD_SECTION.get(field)
      if (id) out.add(id)
    }
    if (tsigChanged) out.add('tsig')
    return out
  }, [dirtySignature, tsigChanged])

  const dirtyCount = dirtyFieldList.length + (tsigChanged ? 1 : 0)

  // Losing 132 parameters' worth of edits to a stray reload is the worst failure
  // mode on this page, so the browser is asked first.
  React.useEffect(() => {
    if (dirtyCount === 0) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Required by some browsers to actually show the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  // ------------------------------------------------------------------ mutations

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => setSettings(patch, node || undefined),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings(target), updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings(target) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tsigKeys(target) })
      toast.success(t('saved'))
      adoptServerState(updated)
    },
    onError: (error) => {
      setSavingSection(null)
      toast.error(describeError(error).message)
    },
  })

  function adoptServerState(updated: DnsSettings) {
    setSavingSection(null)
    form.reset(toFormValues(updated))
    setTsigRows(toTsigRows(updated))
    setRevision((value) => value + 1)
  }

  function discard() {
    form.reset(defaults)
    setTsigRows(toTsigRows(data))
    setRevision((value) => value + 1)
    setDiscardOpen(false)
  }

  function patchFrom(current: SettingsFormValues): SettingsPatch {
    return buildPatch({ values: current, tsigRows, node })
  }

  /**
   * Validate every field the panel owns, then submit just its parameters.
   * Validating the *whole* form would make an unrelated mistake in another panel
   * block a legitimate save here.
   */
  async function saveSection(id: SectionId) {
    if (!canModify || save.isPending) return

    const fields = SECTION_FIELDS[id]
    if (fields.length > 0) {
      const ok = await form.trigger([...fields])
      if (!ok) {
        toast.error(t('validationFailed'))
        scrollToSection(id)
        return
      }
    }
    if (id === 'tsig' && !tsigValid) {
      toast.error(t('tsig.invalidBase64'))
      return
    }

    const patch = pickParams(patchFrom(form.getValues()), sectionParams(id))
    if (Object.keys(patch).length === 0) {
      // Every parameter this panel owns is out of scope for the selected node.
      toast.warning(t('outOfScope'))
      return
    }

    setSavingSection(id)
    try {
      await save.mutateAsync(patch)
    } catch {
      // `onError` already surfaced the message and cleared `savingSection`.
    }
  }

  async function commitAll() {
    if (!tsigValid) {
      toast.error(t('tsig.invalidBase64'))
      scrollToSection('tsig')
      return
    }
    setSavingSection(null)
    try {
      await save.mutateAsync(patchFrom(form.getValues()))
    } catch {
      // handled by the mutation's `onError`
    }
  }

  // ------------------------------------------------------------------- scoping

  /**
   * Mirrors `buildPatch`'s `includeCluster` / `includeNode` split so the UI never
   * offers a control whose value would be dropped from the payload. `tsigKeys` is
   * cluster-scoped but is not a form field, hence the special case.
   */
  function applies(field: string): boolean {
    const isCluster = field === 'tsigKeys' || CLUSTER_FIELDS.has(field as SettingsFieldName)
    if (node === '') return true
    return node === NODE_CLUSTER ? isCluster : !isCluster
  }

  const actions = React.useMemo<SettingsActionsValue>(
    () => ({
      disabled: !canModify,
      savingSection,
      saveSection: (id) => {
        void saveSection(id)
      },
      applies,
    }),
    // `saveSection` and `applies` close over `tsigRows`, `node` and `save`, all of
    // which are already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canModify, savingSection, tsigRows, tsigValid, node],
  )

  // --------------------------------------------------------------------- layout

  const titles = React.useMemo<Record<SectionId, string>>(
    () => ({
      general: t('sections.general'),
      listeners: t('sections.listeners'),
      zoneDefaults: t('zoneDefaults.title'),
      webService: t('webService.title'),
      dnsOverX: t('dnsOverX.title'),
      recursion: t('recursion.title'),
      proxy: t('proxy.title'),
      blocking: t('blocking.title'),
      cache: t('cache.title'),
      rateLimit: t('rateLimit.title'),
      edns: t('edns.title'),
      logging: t('logging.title'),
      tsig: t('tsig.title'),
      updates: t('updates.title'),
      backup: t('backup.title'),
      advanced: t('advanced.title'),
    }),
    [t],
  )

  const visibleSections = React.useMemo(
    () => SECTION_IDS.filter((id) => isPanelVisible(tr, id, titles[id], filter)),
    [tr, titles, filter],
  )

  const active = useActiveSection(visibleSections)
  const searching = filter.needle !== ''
  const disabled = !canModify

  return (
    <FormProvider {...form}>
      <SettingsActionsProvider value={actions}>
        <SettingsFilterProvider value={filter}>
          <form
            noValidate
            onSubmit={form.handleSubmit(
              () => {
                void commitAll()
              },
              () => {
                toast.error(t('validationFailed'))
              },
            )}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-56 flex-col gap-1.5">
                <Label htmlFor="settings-node" className="text-xs text-muted-foreground">
                  {t('applyToNode')}
                </Label>
                <Select value={nodeValue} onValueChange={setNodeValue} disabled={!clustered}>
                  <SelectTrigger id="settings-node">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NODE_LOCAL}>{t('nodeLocal')}</SelectItem>
                    {clustered && <SelectItem value={NODE_CLUSTER}>{t('nodeCluster')}</SelectItem>}
                    {nodes.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('applyToNodeHelp')}</p>
              </div>

              <SearchInput
                id="settings-search"
                value={search}
                onChange={setSearch}
                placeholder={t('searchPlaceholder')}
                className="sm:w-80"
              />
            </div>

            {node === NODE_CLUSTER && (
              <Alert variant="warning">
                <AlertDescription>{t('clusterScopeWarning')}</AlertDescription>
              </Alert>
            )}

            {dirtyCount > 0 && (
              <div className="surface-raised sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-2.5 shadow-md">
                <p className="flex items-center gap-2 text-sm">
                  <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                  {t('unsavedChanges', { count: dirtyCount })}
                </p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDiscardOpen(true)}>
                    {t('discard')}
                  </Button>
                  <Button type="submit" size="sm" disabled={disabled} loading={save.isPending}>
                    {!save.isPending && <Save className="size-4" aria-hidden />}
                    {save.isPending ? t('saving') : t('saveAll')}
                  </Button>
                </div>
              </div>
            )}

            <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <SettingsNav
                ids={visibleSections}
                active={active}
                onNavigate={scrollToSection}
                dirty={dirtySections}
              />

              {searching && visibleSections.length === 0 ? (
                <NoResultsState title={t('searchEmpty', { query: filter.query })} />
              ) : (
                // `key={revision}` remounts every control after a reset — see the
                // header note about `QpmRuleTable`.
                <div key={revision} className="flex min-w-0 flex-col gap-4">
                  <SectionGeneral disabled={disabled} settings={data} locale={locale} />
                  <SectionListeners disabled={disabled} />
                  <SectionZoneDefaults disabled={disabled} />
                  <SectionWebService disabled={disabled} />
                  <SectionDnsOverX disabled={disabled} />
                  <SectionRecursion disabled={disabled} />
                  <SectionProxy disabled={disabled} />
                  <SectionBlocking disabled={disabled} />
                  <SectionCache disabled={disabled} />
                  <SectionRateLimit disabled={disabled} />
                  <SectionEdns disabled={disabled} />
                  <SectionLogging disabled={disabled} />
                  <SectionTsig rows={tsigRows} onChange={setTsigRows} disabled={disabled} />
                  <SectionUpdates disabled={disabled} version={data.version} />
                  <SectionBackup disabled={disabled} node={node || undefined} />
                  <SectionAdvanced settings={data} />
                </div>
              )}
            </div>
          </form>

          <ConfirmDialog
            open={discardOpen}
            onOpenChange={setDiscardOpen}
            title={t('discard')}
            description={t('discardConfirm')}
            confirmLabel={t('discard')}
            tone="destructive"
            onConfirm={discard}
          />
        </SettingsFilterProvider>
      </SettingsActionsProvider>
    </FormProvider>
  )
}

// -------------------------------------------------------------------- skeleton

/** Full-page placeholder mirroring the two-column layout. */
function SettingsSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <Skeleton className="h-[32rem] w-full rounded-lg" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, panel) => (
          <div key={panel} className="surface flex flex-col gap-4 rounded-lg p-4">
            <Skeleton className="h-4 w-48" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, cell) => (
                <Skeleton key={cell} className="h-14" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
