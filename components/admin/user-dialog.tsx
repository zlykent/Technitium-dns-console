'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Save, UserPlus } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { buildCreateUserPayload, buildSetUserPayload } from '@/components/admin/user-payload'
import { ErrorState, LoadingState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/api/client'
import { createUser, getUser, listGroups, setUser } from '@/lib/api/domains/admin'
import { queryKeys } from '@/lib/api/query-keys'
import type { UserDetail, UserSummary } from '@/lib/api/types/admin'
import { useSession } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * Create / edit user dialog.
 *
 * One component, two modes, and the two modes do *not* share a submit path —
 * `admin/users/create` takes three parameters (`user`, `pass`, `displayName`)
 * while `admin/users/set` takes nine. Conflating them is how you end up sending
 * `displayName=` on create and silently blanking a real display name on save.
 *
 * Gotchas encoded here:
 *
 *  - **The edit form needs `admin/users/get`, not the list row.**
 *    `admin/users/list` omits `sessionTimeoutSeconds`, `memberOfGroups` and
 *    `ssoManagedGroups` (see `.probe/admin.users.list.json` vs
 *    `.probe/admin.users.get.json`). The outer `UserDialog` fetches the detail
 *    and only mounts `UserForm` once it has arrived, keyed so `defaultValues`
 *    are captured from the real payload instead of needing a racing `reset()`.
 *  - **Passwords are "blank means unchanged" in edit mode.** The field is
 *    optional, but if anything is typed the confirmation must match and the
 *    minimum length applies — validated in `superRefine`, not per-field, because
 *    the two rules are conditional on each other.
 *  - **`memberOfGroups: []` cannot be sent.** `appendParams` in
 *    `lib/api/client.ts:233` drops empty arrays, so clearing the last group
 *    would be a no-op. `user-payload.ts` sends `['']` instead, which serialises
 *    to `memberOfGroups=` — byte-for-byte what the stock console does
 *    (`.probe/console-js/auth.js:1443`). Same trick for `members` in
 *    `group-dialog.tsx`.
 *  - **`ssoManagedGroups` is read-only.** `SetUserParams`
 *    (`lib/api/types/admin.ts:37-48`) has no such field and upstream derives it
 *    from the SSO configuration, so it is rendered as a disabled switch rather
 *    than a control that pretends to work.
 *  - **Self-lockout guard.** Disabling the account you are signed in with would
 *    end your session mid-edit, so the schema rejects it client-side
 *    (`users.form.cannotDisableSelf`) before the server has a chance to.
 */

/** Technitium rejects shorter passwords at `admin/users/create`. */
const MIN_PASSWORD = 8

export interface UserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The row being edited, or `null` for create mode. */
  user: UserSummary | null
}

export function UserDialog({ open, onOpenChange, user }: UserDialogProps) {
  const t = useTranslations('admin')
  const target = useTargetKey()
  const editing = user !== null

  const detail = useQuery({
    queryKey: queryKeys.user(target, user?.username ?? '__new__'),
    queryFn: () => getUser(user!.username),
    enabled: open && editing,
  })

  const body = !editing ? (
    <UserForm open={open} onOpenChange={onOpenChange} user={null} detail={null} />
  ) : detail.isPending ? (
    <LoadingState rows={5} />
  ) : detail.error ? (
    <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact />
  ) : (
    <UserForm
      // Remount exactly once, when the payload first lands, so `defaultValues`
      // are built from it. Keying on `dataUpdatedAt` would wipe in-progress
      // edits on every background refetch.
      key={detail.data ? 'loaded' : 'pending'}
      open={open}
      onOpenChange={onOpenChange}
      user={user}
      detail={detail.data ?? null}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('users.editTitle', { name: user.username }) : t('users.addTitle')}</DialogTitle>
          <DialogDescription>{t('users.subtitle')}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

interface UserFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserSummary | null
  detail: UserDetail | null
}

function buildUserSchema(m: {
  required: string
  invalidNumber: string
  minValue: string
  tooShort: string
  mismatch: string
  cannotDisableSelf: string
  isSelf: boolean
  isCreate: boolean
}) {
  return z
    .object({
      user: z.string().trim(),
      newUsername: z.string().trim(),
      displayName: z.string().trim(),
      pass: z.string(),
      confirmPassword: z.string(),
      disabled: z.boolean(),
      totpEnabled: z.boolean(),
      sessionTimeoutSeconds: z.number({ error: m.invalidNumber }).int().min(0, m.minValue),
    })
    .superRefine((data, ctx) => {
      if (!data.user) ctx.addIssue({ code: 'custom', path: ['user'], message: m.required })
      // Create *requires* a password (`auth.js:1189-1201` refuses an empty one);
      // edit treats blank as "leave the stored password alone".
      if (m.isCreate && !data.pass) {
        ctx.addIssue({ code: 'custom', path: ['pass'], message: m.required })
      }
      if (m.isCreate && !data.confirmPassword) {
        ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: m.required })
      }
      if (data.pass.length > 0 && data.pass.length < MIN_PASSWORD) {
        ctx.addIssue({ code: 'custom', path: ['pass'], message: m.tooShort })
      }
      // A mismatch is only worth reporting once the password is long enough,
      // otherwise both errors fire and the operator fixes the wrong one first.
      if (data.pass.length >= MIN_PASSWORD && data.pass !== data.confirmPassword) {
        ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: m.mismatch })
      }
      if (data.disabled && m.isSelf) {
        ctx.addIssue({ code: 'custom', path: ['disabled'], message: m.cannotDisableSelf })
      }
    })
}

type UserFormValues = z.infer<ReturnType<typeof buildUserSchema>>

function toFormValues(user: UserSummary | null, detail: UserDetail | null): UserFormValues {
  return {
    user: user?.username ?? '',
    newUsername: '',
    displayName: detail?.displayName ?? user?.displayName ?? '',
    pass: '',
    confirmPassword: '',
    disabled: detail?.disabled ?? user?.disabled ?? false,
    totpEnabled: detail?.totpEnabled ?? user?.totpEnabled ?? false,
    sessionTimeoutSeconds: detail?.sessionTimeoutSeconds ?? 0,
  }
}

function UserForm({ open, onOpenChange, user, detail }: UserFormProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const { session } = useSession()
  const editing = user !== null
  const isSelf = editing && user.username === session?.username

  /**
   * The TOTP state as the server currently holds it.
   *
   * `buildSetUserPayload` compares against this to decide whether `totpEnabled`
   * may be sent at all — upstream reads the field as a *transition*, and an
   * unchanged one rejects the entire request. See `user-payload.ts`.
   */
  const originalTotp = detail?.totpEnabled ?? user?.totpEnabled ?? false

  /**
   * Whether the 2FA switch has a move the server will accept.
   *
   * Named for what it gates, not for the direction: an administrator can only
   * ever turn 2FA *off* for somebody else, so the switch is live exactly when
   * this account currently has it on and the sole available move is disabling.
   * In create mode there is no move either — `admin/users/create` takes no such
   * parameter.
   */
  const canToggleTotp = editing && originalTotp

  const schema = React.useMemo(
    () =>
      buildUserSchema({
        required: tc('form.required'),
        invalidNumber: tc('form.invalidNumber'),
        minValue: tc('form.minValue', { min: 0 }),
        tooShort: t('users.form.passwordTooShort', { min: MIN_PASSWORD }),
        mismatch: t('users.form.passwordMismatch'),
        cannotDisableSelf: t('users.form.cannotDisableSelf'),
        isSelf,
        isCreate: !editing,
      }),
    [tc, t, isSelf, editing],
  )
  const resolver = React.useMemo(() => zodResolver(schema), [schema])

  const form = useForm<UserFormValues>({ resolver, defaultValues: toFormValues(user, detail) })
  const [groups, setGroups] = React.useState<string[]>(detail?.memberOfGroups ?? [])

  const availableGroups = useQuery({
    queryKey: queryKeys.groups(target),
    queryFn: () => listGroups(),
    enabled: open && editing,
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.domain(target, 'admin') })
  }, [queryClient, target])

  const onError = React.useCallback((error: unknown) => toast.error(describeError(error).message), [])

  const save = useMutation({
    mutationFn: async (values: UserFormValues) => {
      // Both bodies are built in `user-payload.ts`: every rule there is a
      // silent-failure trap that a rendered component cannot reveal, so the
      // construction is pure and unit-tested instead of living in this closure.
      if (!editing) {
        await createUser(buildCreateUserPayload(values))
        return
      }
      await setUser(buildSetUserPayload(values, groups, originalTotp))
    },
    onSuccess: () => {
      toast.success(
        editing
          ? t('users.form.updateSuccess', { name: form.getValues('newUsername') || form.getValues('user') })
          : t('users.form.createSuccess', { name: form.getValues('user') }),
      )
      invalidate()
      close()
    },
    onError,
  })

  function close() {
    onOpenChange(false)
    // Defer so Radix has already run its exit animation against the current
    // values; resetting synchronously flashes an empty form behind the fade.
    setTimeout(() => {
      form.reset(toFormValues(user, detail))
      setGroups(detail?.memberOfGroups ?? [])
      save.reset()
    }, 0)
  }

  const groupNames = availableGroups.data?.groups ?? []

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => void save.mutateAsync(values))}
    >
      <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
        <div className="flex flex-col gap-4 py-1 pr-2">
          <Field>
            <FieldLabel htmlFor="ud-user" required>
              {t('users.form.username')}
            </FieldLabel>
            <Input
              id="ud-user"
              className="font-data"
              autoComplete="off"
              disabled={editing}
              aria-invalid={Boolean(form.formState.errors.user)}
              {...form.register('user')}
            />
            <FieldDescription>{t('users.form.usernameHelp')}</FieldDescription>
            <FieldError>{form.formState.errors.user?.message}</FieldError>
          </Field>

          {editing && (
            <Field>
              <FieldLabel htmlFor="ud-new-username">{t('users.form.newUsername')}</FieldLabel>
              <Input id="ud-new-username" className="font-data" autoComplete="off" {...form.register('newUsername')} />
              <FieldDescription>{t('users.form.newUsernameHelp')}</FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="ud-display-name">{t('users.form.displayName')}</FieldLabel>
            <Input id="ud-display-name" autoComplete="off" {...form.register('displayName')} />
            <FieldDescription>{t('users.form.displayNameHelp')}</FieldDescription>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ud-pass" required={!editing}>
                {editing ? t('users.form.newPassword') : t('users.form.password')}
              </FieldLabel>
              <Input
                id="ud-pass"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.pass)}
                {...form.register('pass')}
              />
              <FieldDescription>
                {editing ? t('users.form.newPasswordHelp') : t('users.form.passwordHelp')}
              </FieldDescription>
              <FieldError>{form.formState.errors.pass?.message}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="ud-confirm" required={!editing}>
                {t('users.form.confirmPassword')}
              </FieldLabel>
              <Input
                id="ud-confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.confirmPassword)}
                {...form.register('confirmPassword')}
              />
              <FieldError>{form.formState.errors.confirmPassword?.message}</FieldError>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ud-timeout">{t('users.form.sessionTimeoutSeconds')}</FieldLabel>
            <Input
              id="ud-timeout"
              type="number"
              min={0}
              step={1}
              className="font-data w-40"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.sessionTimeoutSeconds)}
              {...form.register('sessionTimeoutSeconds', { valueAsNumber: true })}
            />
            <FieldDescription>{t('users.form.sessionTimeoutHelp')}</FieldDescription>
            <FieldError>{form.formState.errors.sessionTimeoutSeconds?.message}</FieldError>
          </Field>

          {editing && (
            <Field>
              <FieldLabel>{t('users.form.memberOfGroups')}</FieldLabel>
              {availableGroups.isPending ? (
                <LoadingState rows={2} />
              ) : groupNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc('fields.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {groupNames.map((group) => {
                    const checked = groups.includes(group.name)
                    const id = `ud-group-${group.name}`
                    return (
                      <li key={group.name}>
                        <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
                          <Checkbox
                            id={id}
                            checked={checked}
                            disabled={detail?.ssoManagedGroups === true}
                            onCheckedChange={(value) =>
                              setGroups((current) =>
                                value === true
                                  ? [...current, group.name]
                                  : current.filter((name) => name !== group.name),
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="font-data">{group.name}</span>
                            {group.description && (
                              <span className="block text-xs text-muted-foreground">{group.description}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              <FieldDescription>
                {detail?.ssoManagedGroups ? t('users.form.ssoManagedGroupsHelp') : t('users.form.memberOfGroupsHelp')}
              </FieldDescription>
            </Field>
          )}

          {editing && (
            <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium">{t('users.form.ssoManagedGroups')}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('users.form.ssoManagedGroupsHelp')}</p>
              </div>
              {/* Read-only: `SetUserParams` has no `ssoManagedGroups` field. */}
              <Switch id="ud-sso-groups" checked={detail?.ssoManagedGroups ?? false} disabled aria-hidden />
            </div>
          )}

          <SwitchRow
            id="ud-totp"
            label={t('users.form.totpEnabled')}
            help={canToggleTotp ? t('users.form.totpHelp') : t('users.form.totpEnableDenied')}
            control={form.control}
            name="totpEnabled"
            // Locked unless there is something to turn off. Upstream lets an
            // administrator disable 2FA for someone else but never enable it —
            // that is refused with "can be enabled only by the user
            // themselves" — so a switch that could be flipped into a guaranteed
            // rejection is worse than one that explains why it is locked. It is
            // also inert in create mode, where `admin/users/create` takes no
            // such parameter.
            disabled={!canToggleTotp}
          />

          <SwitchRow
            id="ud-disabled"
            label={t('users.form.disabled')}
            help={isSelf ? t('users.form.cannotDisableSelf') : t('users.form.disabledHelp')}
            control={form.control}
            name="disabled"
            disabled={isSelf || !editing}
          />

          {save.error ? <ErrorState error={save.error} compact /> : null}
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {!save.isPending &&
            (editing ? <Save className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />)}
          {editing
            ? save.isPending
              ? t('users.form.saving')
              : t('users.form.save')
            : save.isPending
              ? t('users.form.creating')
              : t('users.form.create')}
        </Button>
      </DialogFooter>
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
        render={({ field }) => <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />}
      />
    </div>
  )
}
