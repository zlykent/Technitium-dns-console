'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  ArrowLeft,
  CirclePlus,
  Clock,
  Download,
  Flame,
  List,
  ListTree,
  Maximize,
  Minimize,
  RefreshCw,
  Trash,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { PageHeader, PageShell } from '@/components/app/page-shell'
import { DebouncedSearch } from '@/components/app/search-input'
import { DomainTree, queryKeyForScope } from '@/components/filtering/domain-tree'
import { AddDomainDialog } from '@/components/filtering/add-domain-dialog'
import { ImportDomainsDialog } from '@/components/filtering/import-domains-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/api/client'
import {
  deleteDomain,
  exportDomains,
  flushScope,
  listTree,
  type EditableScope,
  type FilterScope,
} from '@/lib/api/domains/filtering'
import { getSettings, temporaryDisableBlocking } from '@/lib/api/domains/settings'
import { queryKeys } from '@/lib/api/query-keys'
import { parentDomain } from '@/lib/api/types/filtering'
import type { PermissionSection } from '@/lib/api/types/common'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Shared cache / allowed / blocked browser.
 *
 * All three scopes answer `listTree` with the same `{ domain, zones[], records[] }`
 * shape, so one component drives every route and only the `scope` prop changes.
 * `cache` is the odd one out: read-only apart from eviction, with no
 * add / import / export, and no `enableBlocking` banner. Everything else is
 * gated on `editable` (allowed | blocked) plus the session's permission flags.
 *
 * Non-obvious details:
 *
 *  - The count query in the toolbar uses the *same* key as `DomainTree`'s root
 *    node (`queryKeyForScope`), so TanStack Query dedupes it into one request —
 *    the header total is free, not a second round trip.
 *  - "Expand all" / "collapse all" cannot reach into a lazy tree without
 *    fetching every branch, so they work by remounting `DomainTree` under a new
 *    `key` with `defaultExpanded` flipped. Cheap for the tens of domains these
 *    lists hold; deliberately not a recursive fetch.
 *  - The blocked page reads `enableBlocking` from `settings/get`. When it is off
 *    the whole blocked list is inert, so a warning banner links to settings and
 *    the temporary-disable shortcut is hidden (pausing an already-off feature is
 *    a no-op). The temporary-disable button only appears while blocking is on.
 *  - Search and flat-view drill-down both drive one `currentDomain`; the tree
 *    re-roots on it. `parentDomain` powers the back button.
 */

/** Permission section casing differs from the lowercase `FilterScope`. */
const SECTION: Record<FilterScope, PermissionSection> = {
  cache: 'Cache',
  allowed: 'Allowed',
  blocked: 'Blocked',
}

/** Which flush confirmation blurb applies to each scope. */
const FLUSH_CONFIRM: Record<FilterScope, 'flush.confirmCache' | 'flush.confirmAllowed' | 'flush.confirmBlocked'> = {
  cache: 'flush.confirmCache',
  allowed: 'flush.confirmAllowed',
  blocked: 'flush.confirmBlocked',
}

export interface FilterViewProps {
  scope: FilterScope
}

export function FilterView({ scope }: FilterViewProps) {
  const t = useTranslations('filtering')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan(SECTION[scope])

  const editable: EditableScope | null = scope === 'cache' ? null : scope

  const [currentDomain, setCurrentDomain] = React.useState('')
  const [viewMode, setViewMode] = React.useState<'tree' | 'flat'>('tree')
  const [treeKey, setTreeKey] = React.useState(0)
  const [defaultExpanded, setDefaultExpanded] = React.useState(false)

  const [addOpen, setAddOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [flushOpen, setFlushOpen] = React.useState(false)
  const [tempOpen, setTempOpen] = React.useState(false)
  const [minutes, setMinutes] = React.useState('5')

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, scope) })
  }, [queryClient, target, scope])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  // Shares its key with DomainTree's root node, so this is a deduped read used
  // only to surface the "N domains" total in the toolbar.
  const root = useQuery({
    queryKey: queryKeyForScope(scope, target, currentDomain),
    queryFn: () => listTree(scope, { domain: currentDomain }),
    staleTime: 30_000,
  })

  // Only the blocked page cares whether blocking is live server-wide.
  const settings = useQuery({
    queryKey: queryKeys.settings(target),
    queryFn: () => getSettings(),
    enabled: scope === 'blocked',
    staleTime: 60_000,
  })
  const blockingOff = scope === 'blocked' && settings.data?.enableBlocking === false
  const blockingOn = scope === 'blocked' && settings.data?.enableBlocking === true

  const remove = useMutation({
    mutationFn: (domain: string) => deleteDomain(scope, domain),
    onSuccess: (_r, domain) => {
      toast.success(t('delete.success', { domain }))
      invalidate()
      setDeleteTarget(null)
    },
    onError,
  })

  // No bulk endpoint exists, so delete sequentially like the zones bulk
  // actions do. Selection lives in a Set keyed by domain string.
  const bulkRemove = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) await deleteDomain(scope, name)
    },
    onSuccess: (_r, names) => {
      toast.success(t('delete.bulkSuccess', { count: names.length }))
      invalidate()
      setSelected(new Set())
      setBulkOpen(false)
    },
    onError,
  })

  const flush = useMutation({
    mutationFn: () => flushScope(scope),
    onSuccess: () => {
      toast.success(t('flush.success', { scope: t(`scopes.${scope}.title`) }))
      invalidate()
      setFlushOpen(false)
    },
    onError,
  })

  const exportList = useMutation({
    mutationFn: (value: EditableScope) => exportDomains(value),
    onSuccess: () => toast.success(tc('actions.done')),
    onError,
  })

  const tempDisable = useMutation({
    mutationFn: (value: number) => temporaryDisableBlocking(value),
    onSuccess: (_r, value) => {
      toast.success(t('blocking.success', { minutes: value }))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings(target) })
      setTempOpen(false)
    },
    onError,
  })

  const totalDomains = root.data?.zones.length ?? 0

  const selectedNames = React.useMemo(() => Array.from(selected), [selected])

  const toggleSelect = React.useCallback((domain: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }, [])

  const expandAll = () => {
    setDefaultExpanded(true)
    setTreeKey((key) => key + 1)
  }
  const collapseAll = () => {
    setDefaultExpanded(false)
    setTreeKey((key) => key + 1)
  }

  function onTempSubmit(event: React.FormEvent) {
    event.preventDefault()
    const value = Number.parseInt(minutes, 10)
    if (!Number.isFinite(value) || value <= 0) return
    tempDisable.mutate(value)
  }

  return (
    <PageShell className="h-full">
      <PageHeader
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void root.refetch()} loading={root.isFetching}>
              {!root.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
              {t('toolbar.refresh')}
            </Button>
            {blockingOn && can.canModify && (
              <Button variant="outline" size="sm" onClick={() => setTempOpen(true)}>
                <Clock className="size-3.5" aria-hidden />
                {t('blocking.temporaryDisable')}
              </Button>
            )}
            {editable && can.canModify && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-3.5" aria-hidden />
                {t('toolbar.import')}
              </Button>
            )}
            {editable && can.canModify && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportList.mutate(editable)}
                loading={exportList.isPending}
              >
                {!exportList.isPending && <Download className="size-3.5" aria-hidden />}
                {exportList.isPending ? t('toolbar.exporting') : t('toolbar.export')}
              </Button>
            )}
            {editable && can.canModify && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <CirclePlus className="size-3.5" aria-hidden />
                {t('toolbar.addDomain')}
              </Button>
            )}
            {can.canDelete && (
              <Button variant="destructive" size="sm" onClick={() => setFlushOpen(true)}>
                <Flame className="size-3.5" aria-hidden />
                {t('toolbar.flush')}
              </Button>
            )}
          </>
        }
      />

      {blockingOff && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('blocking.bannerTitle')}</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-3">
              <span>{t('blocking.bannerBody')}</span>
              <Button asChild size="xs" variant="outline">
                <Link href="/settings">{t('blocking.enableNow')}</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearch
          onSearch={(value) => setCurrentDomain(value.trim().replace(/^\./, ''))}
          placeholder={t('toolbar.searchPlaceholder')}
        />

        {currentDomain && (
          <div className="flex min-w-0 items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setCurrentDomain(parentDomain(currentDomain))}>
              <ArrowLeft className="size-3.5" aria-hidden />
              {tc('actions.back')}
            </Button>
            <span className="font-data truncate text-xs text-muted-foreground">{currentDomain}</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('toolbar.totalDomains', { count: totalDomains })}
          </span>

          <div
            role="group"
            aria-label={t('tree.viewMode')}
            className="flex items-center gap-0.5 rounded-md border border-input p-0.5"
          >
            <Button
              variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('tree')}
              aria-pressed={viewMode === 'tree'}
              aria-label={t('tree.viewTree')}
              title={t('tree.viewTree')}
            >
              <ListTree aria-hidden />
            </Button>
            <Button
              variant={viewMode === 'flat' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('flat')}
              aria-pressed={viewMode === 'flat'}
              aria-label={t('tree.viewFlat')}
              title={t('tree.viewFlat')}
            >
              <List aria-hidden />
            </Button>
          </div>

          {viewMode === 'tree' && (
            <>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={expandAll}
                aria-label={t('tree.expandAll')}
                title={t('tree.expandAll')}
              >
                <Maximize aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={collapseAll}
                aria-label={t('tree.collapseAll')}
                title={t('tree.collapseAll')}
              >
                <Minimize aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>

      {can.canDelete && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {t('toolbar.selected', { count: selected.size })}
          </span>
          <Button size="xs" variant="destructive" onClick={() => setBulkOpen(true)}>
            <Trash className="size-3.5" aria-hidden />
            {t('toolbar.bulkDelete')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
            {tc('actions.selectNone')}
          </Button>
        </div>
      )}

      {/* The card fills the leftover viewport height and the tree scrolls
          inside it, mirroring the scrollable DataTable pages. */}
      <div className={cn('surface flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg p-2')}>
        <DomainTree
          key={treeKey}
          scope={scope}
          domain={currentDomain}
          expandable={viewMode === 'tree'}
          defaultExpanded={defaultExpanded}
          canDelete={can.canDelete}
          selected={selected}
          onToggleSelect={can.canDelete ? toggleSelect : undefined}
          onDelete={can.canDelete ? setDeleteTarget : undefined}
          onNavigate={viewMode === 'flat' ? (domain) => setCurrentDomain(domain) : undefined}
        />
      </div>

      {editable && can.canModify && (
        <>
          <AddDomainDialog open={addOpen} onOpenChange={setAddOpen} scope={editable} />
          <ImportDomainsDialog open={importOpen} onOpenChange={setImportOpen} scope={editable} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('delete.action')}
        description={
          deleteTarget
            ? t('delete.confirm', { scope: t(`scopes.${scope}.title`), domain: deleteTarget })
            : undefined
        }
        confirmLabel={remove.isPending ? t('delete.deleting') : t('delete.action')}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={t('delete.action')}
        description={t('delete.bulkConfirm', { count: selected.size })}
        confirmLabel={bulkRemove.isPending ? t('delete.deleting') : t('toolbar.bulkDelete')}
        requireText={String(selected.size)}
        onConfirm={async () => {
          await bulkRemove.mutateAsync(selectedNames)
        }}
        pending={bulkRemove.isPending}
        error={bulkRemove.error ?? undefined}
      />

      <ConfirmDialog
        open={flushOpen}
        onOpenChange={setFlushOpen}
        title={t('flush.confirmTitle', { scope: t(`scopes.${scope}.title`) })}
        description={t(FLUSH_CONFIRM[scope])}
        confirmLabel={flush.isPending ? t('toolbar.flushing') : t('toolbar.flush')}
        onConfirm={async () => {
          await flush.mutateAsync()
        }}
        pending={flush.isPending}
        error={flush.error ?? undefined}
      />

      <Dialog open={tempOpen} onOpenChange={setTempOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('blocking.temporaryDisableTitle')}</DialogTitle>
            <DialogDescription>{t('blocking.temporaryDisableHint')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onTempSubmit} className="flex flex-col gap-4" noValidate>
            <Field>
              <FieldLabel htmlFor="temp-disable-minutes">{t('blocking.minutes')}</FieldLabel>
              <Input
                id="temp-disable-minutes"
                type="number"
                min={1}
                step={1}
                className="font-data"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTempOpen(false)}
                disabled={tempDisable.isPending}
              >
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" loading={tempDisable.isPending}>
                {!tempDisable.isPending && <Clock className="size-4" aria-hidden />}
                {t('blocking.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
