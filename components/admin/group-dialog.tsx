'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CirclePlus, Save, UsersRound, X } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ErrorState, LoadingState } from '@/components/app/states'
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/api/client'
import { createGroup, getGroup, listUsers, setGroup } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { GroupSummary } from '@/lib/api/types/admin'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Create / edit group dialog.
 *
 * `admin/groups/create` is positional in the SDK (`createGroup(group, description)`)
 * while `admin/groups/set` takes an object — easy to mix up, and the difference
 * matters because `create` cannot set members at all. A brand-new group is
 * therefore created first and, if the operator already picked members, updated
 * in a second call; both run inside one mutation so the dialog reports a single
 * success or failure.
 *
 * Gotchas:
 *
 *  - **`admin/groups/list` has no members.** `GroupSummary` is `{name, description}`
 *    only, so edit mode fetches `admin/groups/get` for the membership and mounts
 *    the form once it lands (keyed, so `defaultValues` are never stale).
 *  - **`members: []` cannot be sent.** `appendParams` (`lib/api/client.ts:233`)
 *    drops empty arrays; `['']` serialises to `members=`, which is what the stock
 *    console sends to clear a group (`.probe/console-js/auth.js:1872`).
 *  - **Renaming is not offered.** Upstream supports `newGroup` on
 *    `admin/groups/set`, but `SetGroupParams` (`lib/api/types/admin.ts:69-74`)
 *    does not model it and `messages/{zh,en}/admin.json` has no key for it, so the
 *    name field is read-only in edit mode.
 */

/**
 * The member picker's "nothing chosen yet" value.
 *
 * It has to be `""`: Radix renders `SelectValue`'s `placeholder` only when the
 * root's value is `""` or `undefined`, and a non-empty sentinel matches no
 * `SelectItem` — the trigger would render nothing at all. `undefined` is not an
 * option either, because it flips the Select into uncontrolled mode and the
 * post-add reset would then leave the previous choice on screen.
 */
const NOTHING = ''

export interface GroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The group being edited, or `null` for create mode. */
  group: GroupSummary | null
}

export function GroupDialog({ open, onOpenChange, group }: GroupDialogProps) {
  const t = useTranslations('admin')
  const target = useTargetKey()
  const editing = group !== null

  const detail = useQuery({
    // `queryKeys` has no per-group admin key, so the detail is cached under the
    // list key extended with the group name. Prefix invalidation through
    // `queryKeys.domain(target, 'admin')` still matches, and it cannot collide
    // with the `GroupListResult` entry itself.
    queryKey: [...queryKeys.groups(target), group?.name ?? '__new__'],
    queryFn: () => getGroup(group!.name),
    enabled: open && editing,
  })

  const body = !editing ? (
    <GroupForm open={open} onOpenChange={onOpenChange} group={null} members={[]} />
  ) : detail.isPending ? (
    <LoadingState rows={3} />
  ) : detail.error ? (
    <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact />
  ) : (
    <GroupForm
      key={detail.data ? 'loaded' : 'pending'}
      open={open}
      onOpenChange={onOpenChange}
      group={group}
      members={detail.data?.members ?? []}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('groups.editTitle', { name: group.name }) : t('groups.addTitle')}</DialogTitle>
          <DialogDescription>{t('groups.subtitle')}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

interface GroupFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupSummary | null
  members: string[]
}

interface GroupFormValues {
  group: string
  description: string
}

function GroupForm({ open, onOpenChange, group, members }: GroupFormProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const editing = group !== null

  const schema = React.useMemo(
    () =>
      z.object({
        group: z.string().trim().min(1, t('groups.form.nameRequired')),
        description: z.string().trim(),
      }),
    [t],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])

  const form = useForm<GroupFormValues>({
    resolver,
    defaultValues: { group: group?.name ?? '', description: group?.description ?? '' },
  })
  const [selected, setSelected] = React.useState<string[]>(members)
  const [pending, setPending] = React.useState(NOTHING)

  const allUsers = useQuery({
    queryKey: queryKeys.users(target),
    queryFn: () => listUsers(),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: async (values: GroupFormValues) => {
      if (!editing) {
        await createGroup(values.group, values.description)
        // `create` cannot set members; a follow-up `set` does, and only if the
        // operator actually picked someone.
        if (selected.length > 0) await setGroup({ group: values.group, members: selected })
        return
      }
      await setGroup({
        group: values.group,
        description: values.description,
        // See the `['']` note in the file header.
        members: selected.length > 0 ? selected : [''],
      })
    },
    onSuccess: () => {
      toast.success(
        editing
          ? t('groups.form.updateSuccess', { name: form.getValues('group') })
          : t('groups.form.createSuccess', { name: form.getValues('group') }),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
      close()
    },
    onError: (error) => toast.error(describeError(error).message),
  })

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      form.reset({ group: group?.name ?? '', description: group?.description ?? '' })
      setSelected(members)
      setPending(NOTHING)
      save.reset()
    }, 0)
  }

  const usernames = React.useMemo(
    () => (allUsers.data?.users ?? []).map((row) => row.username),
    [allUsers.data],
  )
  const available = React.useMemo(
    () => usernames.filter((name) => !selected.includes(name)),
    [usernames, selected],
  )

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <Field>
          <FieldLabel htmlFor="gd-name" required>
            {t('groups.form.name')}
          </FieldLabel>
          <Input
            id="gd-name"
            className="font-data"
            autoComplete="off"
            placeholder={t('groups.form.namePlaceholder')}
            disabled={editing}
            aria-invalid={Boolean(form.formState.errors.group)}
            {...form.register('group')}
          />
          <FieldError>{form.formState.errors.group?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="gd-description">{t('groups.form.description')}</FieldLabel>
          <Textarea
            id="gd-description"
            rows={2}
            placeholder={t('groups.form.descriptionPlaceholder')}
            {...form.register('description')}
          />
        </Field>

        <Field>
          <FieldLabel>{t('groups.form.members')}</FieldLabel>
          {allUsers.isPending ? (
            <LoadingState rows={2} />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select value={pending} onValueChange={setPending} disabled={available.length === 0}>
                  <SelectTrigger size="sm" className="w-52" aria-label={t('groups.form.pickMember')}>
                    <SelectValue placeholder={t('groups.form.pickMember')} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((name) => (
                      <SelectItem key={name} value={name}>
                        <span className="font-data">{name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pending}
                  onClick={() => {
                    if (!pending) return
                    setSelected((current) => [...current, pending])
                    setPending(NOTHING)
                  }}
                >
                  <CirclePlus className="size-3.5" aria-hidden />
                  {t('groups.form.addMember')}
                </Button>
              </div>

              {selected.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('groups.form.noMembers')}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {selected.map((name) => (
                    <li key={name}>
                      <Badge variant="secondary" className="font-data gap-1 pr-1">
                        {name}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-5 rounded-full"
                          aria-label={`${tc('actions.remove')} — ${name}`}
                          onClick={() => setSelected((current) => current.filter((item) => item !== name))}
                        >
                          <X className="size-3" aria-hidden />
                        </Button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <FieldDescription>{t('groups.form.membersHelp')}</FieldDescription>
        </Field>

        {save.error ? <ErrorState error={save.error} compact /> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {!save.isPending &&
            (editing ? <Save className="size-4" aria-hidden /> : <UsersRound className="size-4" aria-hidden />)}
          {editing
            ? save.isPending
              ? t('groups.form.saving')
              : t('groups.form.save')
            : save.isPending
              ? t('groups.form.creating')
              : t('groups.form.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
