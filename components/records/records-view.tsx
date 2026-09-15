'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ChevronRight,
  CircleCheck,
  CirclePlus,
  CircleStop,
  Download,
  FolderTree,
  RefreshCw,
  Trash,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DefinitionList, PageHeader, PageShell, Section } from '@/components/app/page-shell'
import { DebouncedSearch } from '@/components/app/search-input'
import { EmptyState, ErrorState } from '@/components/app/states'
import { ImportZoneDialog } from '@/components/zones/import-zone-dialog'
import { ZoneTabs } from '@/components/zones/zone-tabs'
import { RecordEditorDialog, type RecordEditorResult } from '@/components/records/record-editor-dialog'
import { RecordTable, type RecordRow } from '@/components/records/record-table'
import { RecordSummary, summarizeRecord } from '@/components/records/record-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/api/client'
import {
  addRecord,
  deleteRecord,
  getRecords,
  setRecordState,
  updateRecord,
} from '@/lib/api/domains/records'
import { exportZone } from '@/lib/api/domains/zones'
import { RECORD_TYPES, type RecordType } from '@/lib/api/enums'
import { queryKeys } from '@/lib/api/query-keys'
import type { DnsRecord, ZoneSummary } from '@/lib/api/types/zones'
import { useCan } from '@/lib/auth/session'
import { formatDateTime, formatNumber, splitRecordName } from '@/lib/format'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Zone record browser/editor — the t11 landing surface for a single zone.
 *
 * `zones/records/get` with `listZone=true` returns the *whole* zone in one shot
 * (no server pagination), so every filter — search, type, disabled and the
 * owner-name rail — runs client-side over one cached array. The query key
 * therefore carries no discriminators at all: the endpoint has no parameters to
 * vary, and adding placeholders would turn each filter keystroke into a cache
 * miss. Invalidation goes through the `domain(target,'zones')` prefix like the
 * rest of the module.
 *
 * Non-obvious details:
 *
 *  - **Writes are three separate mutations** (save / toggleState / remove) plus
 *    two bulk variants, all invalidating the `zones` domain subtree and toasting
 *    on success. "Create disabled" is an add followed by `setRecordState(true)`
 *    because `add` has no `disable` parameter.
 *  - **Row identity for busy-state** is by `DnsRecord` object reference (the rows
 *    hold the same references the query returned), so a per-row spinner survives
 *    the index-suffixed row ids used to keep duplicate records selectable.
 *  - This page is verified read-only against the live server; the write paths are
 *    exercised to the front-end validation layer only.
 */

/** Sentinel for the "all types" filter entry — Radix `Select` forbids "". */
const ALL_TYPES = '__all__'

export interface RecordsViewProps {
  zone: string
}

export function RecordsView({ zone }: RecordsViewProps) {
  const t = useTranslations('records')
  const tc = useTranslations('common')
  const tz = useTranslations('zones')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Zones')

  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<RecordType | ''>('')
  const [includeDisabled, setIncludeDisabled] = React.useState(true)
  const [grouped, setGrouped] = React.useState(false)
  const [expandGlue, setExpandGlue] = React.useState(false)
  const [selectedDomain, setSelectedDomain] = React.useState<string | null>(null)
  const [navOpen, setNavOpen] = React.useState(true)
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorRecord, setEditorRecord] = React.useState<DnsRecord | null>(null)
  const [editorName, setEditorName] = React.useState('')
  const [editorType, setEditorType] = React.useState<RecordType>('A')
  // Bumped on every open so `RecordEditorDialog` remounts with fresh state
  // (it seeds from props on mount instead of running a reset effect).
  const [editorKey, setEditorKey] = React.useState(0)
  const [deleteTarget, setDeleteTarget] = React.useState<DnsRecord | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  const records = useQuery({
    queryKey: queryKeys.zoneRecords(target, zone),
    queryFn: () => getRecords({ zone, domain: zone, listZone: true }),
    enabled: can.canView,
  })

  const allRecords = React.useMemo(() => records.data?.records ?? [], [records.data])
  const zoneInfo: ZoneSummary | null = records.data?.zone ?? null
  const soaRecord = React.useMemo(() => allRecords.find((r) => r.type === 'SOA') ?? null, [allRecords])

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'zones') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  // ---- derived: domain nav -------------------------------------------------
  // Badge counts run over every record that survives the filters *other* than
  // the rail's own selection (facet style), so a badge always equals the rows
  // the operator gets by clicking it — under any search/type/disabled
  // combination. Selection matches the owner name exactly: a subtree rule made
  // `@` (whose subtree is the whole zone) a synonym for "all names" and showed
  // descendants its badge never counted.
  const countable = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRecords.filter((record) => {
      if (typeFilter && record.type !== typeFilter) return false
      if (!includeDisabled && record.disabled) return false
      if (q) {
        const haystack = `${record.name} ${summarizeRecord(record)} ${record.comments ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [allRecords, search, typeFilter, includeDisabled])

  const domainGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of countable) counts.set(record.name, (counts.get(record.name) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [countable])

  // ---- derived: filter -> rows --------------------------------------------
  const { rows, rowById, idByRecord } = React.useMemo(() => {
    const selectedLower = selectedDomain?.toLowerCase() ?? null
    const filtered = countable.filter((record) => !selectedLower || record.name.toLowerCase() === selectedLower)

    const built: RecordRow[] = []
    const byId = new Map<string, DnsRecord>()
    const byRecord = new Map<DnsRecord, string>()
    filtered.forEach((record, index) => {
      const id = `${record.name}|${record.type}|${index}`
      built.push({ id, record, label: labelOf(record.name, zone), type: record.type, ttl: record.ttl, depth: 0, isGlue: false })
      byId.set(id, record)
      byRecord.set(record, id)
      if (expandGlue && record.glueRecords?.length) {
        record.glueRecords.forEach((glue, glueIndex) => {
          const glueId = `glue|${index}|${glueIndex}`
          built.push({ id: glueId, record: glue, label: labelOf(glue.name, zone), type: glue.type, ttl: glue.ttl, depth: 1, isGlue: true })
        })
      }
    })
    return { rows: built, rowById: byId, idByRecord: byRecord }
  }, [countable, selectedDomain, expandGlue, zone])

  const selectedIds = React.useMemo(() => Object.keys(rowSelection).filter((key) => rowSelection[key]), [rowSelection])

  // ---- mutations -----------------------------------------------------------
  const save = useMutation({
    mutationFn: async (result: RecordEditorResult): Promise<'add' | 'update'> => {
      if (result.mode === 'add') {
        const res = await addRecord(
          {
            zone,
            domain: result.newDomain,
            type: result.type,
            ttl: result.ttl,
            comments: result.comments,
            expiryTtl: result.expiryTtl,
            overwrite: result.overwrite,
          },
          result.values,
        )
        // `add` cannot create a disabled record; chain the state change.
        if (result.disable && res.addedRecord) await setRecordState(res.addedRecord, zone, true)
        return 'add'
      }
      if (!result.current) throw new Error('Cannot update a record without its current value.')
      await updateRecord(
        {
          zone,
          domain: result.domain,
          newDomain: result.newDomain,
          type: result.type,
          ttl: result.ttl,
          comments: result.comments,
          expiryTtl: result.expiryTtl,
          disable: result.disable,
        },
        result.values,
        result.current,
      )
      return 'update'
    },
    onSuccess: (mode) => {
      toast.success(mode === 'add' ? t('form.addSuccess') : t('form.updateSuccess'))
      invalidate()
      setEditorOpen(false)
    },
    onError,
  })

  const toggleState = useMutation({
    mutationFn: ({ record, disable }: { record: DnsRecord; disable: boolean }) => setRecordState(record, zone, disable),
    onSuccess: (_result, vars) => {
      toast.success(vars.disable ? t('form.disableSuccess') : t('form.enableSuccess'))
      invalidate()
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: (record: DnsRecord) => deleteRecord({ zone, domain: record.name, type: record.type }, record),
    onSuccess: () => {
      toast.success(t('form.deleteSuccess'))
      invalidate()
      setDeleteTarget(null)
    },
    onError,
  })

  const bulkState = useMutation({
    mutationFn: async ({ ids, disable }: { ids: string[]; disable: boolean }) => {
      for (const id of ids) {
        const record = rowById.get(id)
        if (record) await setRecordState(record, zone, disable)
      }
    },
    onSuccess: (_result, vars) => {
      toast.success(vars.disable ? t('form.disableSuccess') : t('form.enableSuccess'))
      invalidate()
      setRowSelection({})
    },
    onError,
  })

  const bulkRemove = useMutation({
    mutationFn: async (ids: string[]) => {
      let count = 0
      for (const id of ids) {
        const record = rowById.get(id)
        if (record) {
          await deleteRecord({ zone, domain: record.name, type: record.type }, record)
          count += 1
        }
      }
      return count
    },
    onSuccess: (count) => {
      toast.success(t('form.bulkDeleteSuccess', { count }))
      invalidate()
      setRowSelection({})
      setBulkDeleteOpen(false)
    },
    onError,
  })

  const exportOne = useMutation({
    mutationFn: () => exportZone(zone),
    onSuccess: () => toast.success(tz('export.success', { zone })),
    onError,
  })

  // ---- row busy state ------------------------------------------------------
  const busyRecord =
    (toggleState.isPending ? toggleState.variables?.record : null) ??
    (remove.isPending ? remove.variables : null) ??
    null
  const busyId = busyRecord ? (idByRecord.get(busyRecord) ?? null) : null

  // ---- editor launchers ----------------------------------------------------
  const openAdd = React.useCallback(() => {
    setEditorRecord(null)
    setEditorName(selectedDomain && selectedDomain !== zone ? labelOf(selectedDomain, zone) : '')
    setEditorType('A')
    setEditorKey((key) => key + 1)
    setEditorOpen(true)
  }, [selectedDomain, zone])

  const openEdit = React.useCallback((record: DnsRecord) => {
    setEditorRecord(record)
    setEditorKey((key) => key + 1)
    setEditorOpen(true)
  }, [])

  const openAddGlue = React.useCallback(
    (nsRecord: DnsRecord) => {
      setEditorRecord(null)
      setEditorName(labelOf(nsRecord.name, zone))
      setEditorType('A')
      setEditorKey((key) => key + 1)
      setEditorOpen(true)
    },
    [zone],
  )

  const editSoa = React.useCallback(() => {
    if (soaRecord) openEdit(soaRecord)
  }, [soaRecord, openEdit])

  // SOA identity is matched on zone+domain+type (its SPEC fields carry no `old`
  // slot), so pre-bumping the serial in a cloned rData is safe — the clone's
  // serial is never sent as identity.
  const bumpSerial = React.useCallback(() => {
    if (!soaRecord) return
    const current = Number(soaRecord.rData.serial ?? zoneInfo?.soaSerial ?? 0)
    setEditorRecord({ ...soaRecord, rData: { ...soaRecord.rData, serial: current + 1 } })
    setEditorKey((key) => key + 1)
    setEditorOpen(true)
  }, [soaRecord, zoneInfo])

  const notFound = !records.isPending && !records.error && !zoneInfo && allRecords.length === 0
  const emptyTitle = allRecords.length === 0 ? t('empty.noZoneRecords') : t('empty.title')
  const emptyBody = allRecords.length === 0 ? t('empty.hint') : t('empty.body')

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: tz('detail.backToList'), href: '/zones' }, { label: zone }, { label: tz('detail.tabs.records') }]}
        title={<span className="font-data">{zone}</span>}
        description={t('subtitle', { zone })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void records.refetch()} loading={records.isFetching}>
              {!records.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {t('toolbar.refresh')}
            </Button>
            {can.canModify && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-3.5" aria-hidden />
                {t('toolbar.import')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => exportOne.mutate()} loading={exportOne.isPending} disabled={!can.canView}>
              {!exportOne.isPending && <Download className="size-3.5" aria-hidden />}
              {t('toolbar.export')}
            </Button>
            {can.canModify && (
              <Button size="sm" onClick={openAdd}>
                <CirclePlus className="size-3.5" aria-hidden />
                {t('toolbar.add')}
              </Button>
            )}
          </>
        }
      />

      <ZoneTabs zone={zone} current="records" />

      {records.error ? (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      ) : notFound ? (
        <EmptyState title={tz('detail.notFound')} body={tz('detail.notFoundHint')} icon={FolderTree} />
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <DomainNav
            open={navOpen}
            onOpenChange={setNavOpen}
            heading={tc('fields.domain')}
            groups={domainGroups}
            zone={zone}
            selected={selectedDomain}
            onSelect={setSelectedDomain}
            allLabel={t('toolbar.allNames')}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <Section>
              {zoneInfo ? (
                <DefinitionList
                  items={[
                    { label: tz('detail.summary.type'), value: <Badge>{tz(`types.${zoneInfo.type}.label`)}</Badge> },
                    {
                      label: tz('detail.summary.status'),
                      value: zoneInfo.disabled ? tz('list.statusDisabled') : tz('list.statusActive'),
                    },
                    { label: tz('detail.summary.soaSerial'), value: <span className="font-data">{zoneInfo.soaSerial}</span> },
                    { label: tz('detail.summary.lastModified'), value: formatDateTime(zoneInfo.lastModified, locale) },
                    { label: tz('detail.summary.dnssec'), value: dnssecLabel(zoneInfo.dnssecStatus, tz) },
                    { label: tz('detail.summary.catalog'), value: zoneInfo.catalog ?? '—' },
                    { label: tz('detail.summary.expiry'), value: zoneInfo.expiry ? formatDateTime(zoneInfo.expiry, locale) : '—' },
                    { label: tz('detail.summary.recordCount'), value: formatNumber(allRecords.length, locale) },
                  ]}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-9 w-full" />
                  ))}
                </div>
              )}
            </Section>

            {soaRecord ? (
              <Section
                title={t('soa.title')}
                actions={
                  can.canModify ? (
                    <>
                      <Button variant="outline" size="xs" onClick={bumpSerial}>
                        {t('soa.bumpSerial')}
                      </Button>
                      <Button variant="outline" size="xs" onClick={editSoa}>
                        {t('soa.edit')}
                      </Button>
                    </>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-2">
                  <RecordSummary record={soaRecord} copyLabel={tc('toast.copied')} />
                  <p className="text-xs text-muted-foreground">{t('soa.serialHelp')}</p>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="muted">
                      {soaRecord.rData.useSerialDateScheme ? t('soa.schemeSerialDate') : t('soa.schemeSerial')}
                    </Badge>
                  </p>
                </div>
              </Section>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <DebouncedSearch onSearch={setSearch} placeholder={t('toolbar.search')} />
              <Select
                value={typeFilter || ALL_TYPES}
                onValueChange={(value) => setTypeFilter(value === ALL_TYPES ? '' : (value as RecordType))}
              >
                <SelectTrigger size="sm" className="w-40" aria-label={t('toolbar.filterType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>{t('toolbar.filterType')}</SelectItem>
                  {RECORD_TYPES.map((rt) => (
                    <SelectItem key={rt} value={rt}>
                      {t(`types.${rt}.label`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={includeDisabled} onCheckedChange={setIncludeDisabled} />
                {t('toolbar.filterDisabled')}
              </label>

              <Button variant="outline" size="sm" onClick={() => setGrouped((prev) => !prev)} aria-pressed={grouped}>
                {grouped ? t('toolbar.ungrouped') : t('toolbar.groupBy')}
              </Button>

              <Button variant="outline" size="sm" onClick={() => setExpandGlue((prev) => !prev)} aria-pressed={expandGlue}>
                {t('toolbar.expandGlue')}
              </Button>
            </div>

            {expandGlue ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{t('glue.title')}:</span> {t('glue.hint')}
              </p>
            ) : null}

            <RecordTable
              rows={rows}
              zone={zone}
              grouped={grouped}
              loading={records.isPending}
              error={records.error}
              onRetry={() => void records.refetch()}
              // Every filter runs client-side over the one cached zone array, so
              // an empty table under any of them means "no match" — saying "this
              // zone has no records" would be actively wrong.
              filterActive={Boolean(search.trim()) || Boolean(typeFilter) || !includeDisabled || Boolean(selectedDomain)}
              canModify={can.canModify}
              canDelete={can.canDelete}
              busyId={busyId}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              selectionActions={(ids) => (
                <>
                  <span className="text-xs font-medium text-primary">{t('toolbar.selected', { count: ids.length })}</span>
                  {can.canModify && (
                    <Button size="xs" variant="outline" onClick={() => bulkState.mutate({ ids, disable: false })} loading={bulkState.isPending}>
                      {!bulkState.isPending && <CircleCheck className="size-3.5" aria-hidden />}
                      {t('toolbar.bulkEnable')}
                    </Button>
                  )}
                  {can.canModify && (
                    <Button size="xs" variant="outline" onClick={() => bulkState.mutate({ ids, disable: true })} loading={bulkState.isPending}>
                      {!bulkState.isPending && <CircleStop className="size-3.5" aria-hidden />}
                      {t('toolbar.bulkDisable')}
                    </Button>
                  )}
                  {can.canDelete && (
                    <Button size="xs" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                      <Trash className="size-3.5" aria-hidden />
                      {t('toolbar.bulkDelete')}
                    </Button>
                  )}
                </>
              )}
              onEdit={openEdit}
              onToggleState={(record) => toggleState.mutate({ record, disable: !record.disabled })}
              onDelete={setDeleteTarget}
              emptyTitle={emptyTitle}
              emptyBody={emptyBody}
              emptyAction={
                can.canModify ? (
                  <Button size="sm" onClick={openAdd}>
                    <CirclePlus className="size-3.5" aria-hidden />
                    {t('toolbar.add')}
                  </Button>
                ) : undefined
              }
              label={t('title')}
            />

            <p className="text-right text-xs text-muted-foreground">{t('toolbar.totalRecords', { count: rows.length })}</p>
          </div>
        </div>
      )}

      <RecordEditorDialog
        key={editorKey}
        open={editorOpen}
        // Only toggle `open` here. Do NOT clear `editorRecord` on close: Radix
        // keeps the dialog mounted through its exit animation, and nulling the
        // record mid-animation would flip it from edit to add mode with stale
        // values. The next launcher bumps `editorKey`, remounting the dialog
        // with freshly-seeded state, so the old record is harmless here.
        onOpenChange={setEditorOpen}
        zone={zone}
        record={editorRecord}
        defaultName={editorName}
        defaultType={editorType}
        pending={save.isPending}
        error={save.error ?? undefined}
        onAddGlue={openAddGlue}
        onSubmit={async (result) => {
          save.mutate(result)
        }}
      />

      <ImportZoneDialog open={importOpen} onOpenChange={setImportOpen} initialZone={zone} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('form.deleteTitle')}
        description={
          deleteTarget ? t('form.deleteConfirm', { name: deleteTarget.name, type: deleteTarget.type }) : undefined
        }
        confirmLabel={tc('actions.delete')}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={t('form.deleteTitle')}
        description={t('form.deleteBulkConfirm', { count: selectedIds.length })}
        confirmLabel={t('toolbar.bulkDelete')}
        requireText={String(selectedIds.length)}
        onConfirm={async () => {
          await bulkRemove.mutateAsync(selectedIds)
        }}
        pending={bulkRemove.isPending}
        error={bulkRemove.error ?? undefined}
      />
    </PageShell>
  )
}

interface DomainNavProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  groups: [string, number][]
  zone: string
  selected: string | null
  onSelect: (name: string | null) => void
  allLabel: string
}

/** Collapsible owner-name list; an entry shows exactly the records its badge counts. */
function DomainNav({ open, onOpenChange, heading, groups, zone, selected, onSelect, allLabel }: DomainNavProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="surface h-fit rounded-lg">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent/50"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          {heading}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 border-t border-border/60 p-2">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
              selected === null && 'bg-accent font-medium',
            )}
          >
            <span className="font-data truncate">{allLabel}</span>
          </button>
          {groups.map(([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                selected === name && 'bg-accent font-medium',
              )}
              title={name}
            >
              <span className="font-data min-w-0 truncate">{labelOf(name, zone) || '@'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Relative owner label for display; `@` is the apex. */
function labelOf(name: string, zone: string): string {
  const { label } = splitRecordName(name, zone)
  return label === '@' ? '' : label
}

/** Map a zone DNSSEC status wire value to its `zones:list.dnssecStatus.*` label. */
function dnssecLabel(status: string, tz: (key: string) => string): string {
  const known = ['Unsigned', 'Signed', 'PendingSigning', 'Disabled']
  return known.includes(status) ? tz(`list.dnssecStatus.${status}`) : status
}
