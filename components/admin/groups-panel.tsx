'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { EllipsisVertical, Eye, Pencil, RefreshCw, Trash, UsersRound } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { DataTable, textColumn } from '@/components/app/data-table'
import { Section } from '@/components/app/page-shell'
import { SearchInput } from '@/components/app/search-input'
import { ErrorState, LoadingState } from '@/components/app/states'
import { GroupDialog } from '@/components/admin/group-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { describeError } from '@/lib/api/client'
import { deleteGroup, getGroup, listGroups } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { GroupSummary } from '@/lib/api/types/admin'
import { useCan } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Groups tab: the group inventory plus an on-demand member pane.
 *
 * `admin/groups/list` returns `{name, description}` and nothing else — the
 * member arrays only come from `admin/groups/get`. Fetching all of them up front
 * would be N calls for a table whose "Members" column is the least interesting
 * cell on the page, so the column renders a `groups.viewMembers` button that
 * lazily loads one group into `queryKeys.groups(target) + name`.
 *
 * The same extended key is what `group-dialog.tsx` reads, so opening the editor
 * for a group whose members were already viewed is instant and — more
 * importantly — both views can never disagree about membership. That matters
 * because `admin/groups/set` is a **full replace**: editing a group against a
 * stale (or empty) member list silently strips everyone out of it.
 */

export function GroupsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const can = useCan('Administration')

  const [search, setSearch] = React.useState('')
  const [inspected, setInspected] = React.useState<string | null>(null)
  const [dialogGroup, setDialogGroup] = React.useState<GroupSummary | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogNonce, setDialogNonce] = React.useState(0)
  const [deleteTarget, setDeleteTarget] = React.useState<GroupSummary | null>(null)

  const groups = useQuery({
    queryKey: queryKeys.groups(target),
    queryFn: () => listGroups(),
    enabled: can.canView,
  })

  const detail = useQuery({
    queryKey: [...queryKeys.groups(target), inspected ?? '__none__'],
    queryFn: () => getGroup(inspected!),
    enabled: can.canView && inspected !== null,
  })

  const remove = useMutation({
    mutationFn: (name: string) => deleteGroup(name),
    onSuccess: () => {
      toast.success(t('groups.delete.success'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
      setDeleteTarget(null)
      setInspected(null)
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  const filtered = React.useMemo(() => {
    const rows = groups.data?.groups ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.description.toLowerCase().includes(q))
  }, [groups.data, search])

  function openCreate() {
    setDialogGroup(null)
    setDialogNonce((n) => n + 1)
    setDialogOpen(true)
  }

  function openEdit(row: GroupSummary) {
    setDialogGroup(row)
    setDialogNonce((n) => n + 1)
    setDialogOpen(true)
  }

  const columns = React.useMemo(
    () => [
      textColumn<GroupSummary>({
        id: 'name',
        accessorKey: 'name',
        header: t('groups.columns.name'),
        cell: (value) => <span className="font-data text-sm">{String(value)}</span>,
      }),
      textColumn<GroupSummary>({
        id: 'description',
        accessorKey: 'description',
        header: t('groups.columns.description'),
        // The one column that should soak up the leftover width so a short
        // group list still fills the page without every column stretching; the
        // cap is dropped so the text can actually use the room before it clips.
        flex: true,
        cell: (value) => (
          <span className="block truncate text-xs text-muted-foreground">{String(value) || '—'}</span>
        ),
      }),
      textColumn<GroupSummary>({
        id: 'members',
        header: t('groups.columns.members'),
        enableSorting: false,
        cell: (_value: unknown, row: GroupSummary) => (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={(event) => {
              event.stopPropagation()
              setInspected((current) => (current === row.name ? null : row.name))
            }}
          >
            <Eye className="size-3.5" aria-hidden />
            {t('groups.viewMembers')}
          </Button>
        ),
      }),
      textColumn<GroupSummary>({
        id: 'actions',
        header: t('groups.columns.actions'),
        align: 'right' as const,
        hug: true,
        enableSorting: false,
        cell: (_value: unknown, row: GroupSummary) => (
          <GroupRowActions
            row={row}
            canModify={can.canModify}
            canDelete={can.canDelete}
            onEdit={openEdit}
            onInspect={setInspected}
            onDelete={setDeleteTarget}
          />
        ),
      }),
    ],
    [t, can.canModify, can.canDelete],
  )

  const members = detail.data?.members ?? []

  return (
    // Flex column so the scrollable table fills the tab's leftover height;
    // the members pane keeps its natural size underneath.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <DataTable<GroupSummary>
        label={t('groups.title')}
        columns={columns}
        data={filtered}
        scrollable
        getRowId={(row) => row.name}
        loading={groups.isPending}
        error={groups.error}
        onRetry={() => void groups.refetch()}
        clientPagination={{ pageSize: 25 }}
        // The search runs in the `filtered` memo, not in the DataTable.
        filterActive={Boolean(search.trim())}
        empty={{ title: tc('table.empty'), body: tc('table.emptyHint'), icon: UsersRound }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('groups.searchPlaceholder')} />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void groups.refetch()} loading={groups.isFetching}>
                {!groups.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
                {tc('actions.refresh')}
              </Button>
              {can.canModify && (
                <Button size="sm" onClick={openCreate}>
                  <UsersRound className="size-3.5" aria-hidden />
                  {t('groups.add')}
                </Button>
              )}
            </div>
          </>
        }
        footerNote={t('groups.totalGroups', { count: filtered.length })}
      />

      {inspected && (
        <Section
          className="shrink-0"
          title={t('groups.membersTitle', { name: inspected })}
          actions={
            <Button variant="outline" size="xs" onClick={() => setInspected(null)}>
              {tc('actions.close')}
            </Button>
          }
        >
          {detail.isPending ? (
            <LoadingState rows={2} />
          ) : detail.error ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{t('groups.memberCount', { count: members.length })}</p>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('groups.form.noMembers')}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {members.map((name) => (
                    <li key={name}>
                      <Badge variant="outline" className="font-data">
                        {name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}

      <GroupDialog key={dialogNonce} open={dialogOpen} onOpenChange={setDialogOpen} group={dialogGroup} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? t('groups.delete.title', { name: deleteTarget.name }) : ''}
        description={deleteTarget ? t('groups.delete.body', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('groups.delete.submit')}
        requireText={deleteTarget?.name}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget.name)
        }}
        pending={remove.isPending}
        error={remove.error ?? undefined}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface GroupRowActionsProps {
  row: GroupSummary
  canModify: boolean
  canDelete: boolean
  onEdit: (row: GroupSummary) => void
  onInspect: (name: string) => void
  onDelete: (row: GroupSummary) => void
}

function GroupRowActions({ row, canModify, canDelete, onEdit, onInspect, onDelete }: GroupRowActionsProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tc('actions.more')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onInspect(row.name)
          }}
        >
          <Eye aria-hidden />
          {t('groups.viewMembers')}
        </DropdownMenuItem>
        {canModify && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onEdit(row)
            }}
          >
            <Pencil aria-hidden />
            {tc('actions.edit')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault()
                onDelete(row)
              }}
            >
              <Trash aria-hidden />
              {t('groups.delete.action')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
