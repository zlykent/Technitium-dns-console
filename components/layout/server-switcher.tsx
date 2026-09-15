'use client'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Pencil, Plus, Server, Trash } from 'lucide-react'
import * as React from 'react'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useSession } from '@/lib/auth/session'
import { probeReason, probeServer, type ServerProbeResult } from '@/lib/servers/probe'
import { DEFAULT_PROFILE_ID, isDefaultProfile, normaliseServerUrl, type ServerProfile } from '@/lib/servers/store'
import { useServers } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Server switcher.
 *
 * Switching servers is just changing which `X-Dns-Target` the proxy receives;
 * the token cookie is derived per origin, so each server keeps its own session
 * and no re-login is needed when flipping back. Cached queries are keyed by
 * target too, so both directions are instant.
 *
 * A switch is never blind: opening the menu probes every profile through the
 * proxy (anonymous `status` call), and selecting one re-verifies it before the
 * selection is applied. A server that does not answer keeps the operator on
 * the current server, with the reason in a toast and on the row.
 *
 * The env-configured default is listed but not editable: it is operator policy,
 * not a user bookmark.
 */

/** Per-row reachability state; `detail` carries the raw proxy message. */
type ProbeState = { status: 'checking' } | { status: 'ok' } | { status: 'fail'; reason: string; detail?: string }

export function ServerSwitcher({ className }: { className?: string }) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const { profiles, active, setActive, addProfile, updateProfile, removeProfile } = useServers()
  const { isAuthenticated, connectionError, isLoading } = useSession()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ServerProfile | 'new' | null>(null)
  const [confirmRemove, setConfirmRemove] = React.useState<ServerProfile | null>(null)
  const [probes, setProbes] = React.useState<Record<string, ProbeState>>({})
  /** Row currently blocked on a select-time verification. */
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null)
  const probeAbort = React.useRef<AbortController | null>(null)
  const probeRun = React.useRef(0)

  const tone = connectionError ? 'danger' : isLoading ? 'warning' : isAuthenticated ? 'success' : 'neutral'

  /** Translate the probe's failure codes; unknown codes keep the raw message. */
  const failState = (res: ServerProbeResult): Extract<ProbeState, { status: 'fail' }> => ({
    status: 'fail',
    reason: probeReason(res, (key) => t(`serverSwitcher.${key}`)),
    detail: res.message,
  })

  /** Probe every row in parallel; a newer run or a close discards late answers. */
  const refreshProbes = (list: ServerProfile[]) => {
    probeAbort.current?.abort()
    const controller = new AbortController()
    probeAbort.current = controller
    const run = ++probeRun.current
    setProbes(Object.fromEntries(list.map((profile) => [profile.id, { status: 'checking' as const }])))
    for (const profile of list) {
      const url = isDefaultProfile(profile) ? null : profile.url
      void probeServer(url, controller.signal).then((res) => {
        if (probeRun.current !== run || controller.signal.aborted) return
        setProbes((prev) => ({ ...prev, [profile.id]: res.ok ? { status: 'ok' } : failState(res) }))
      })
    }
  }

  React.useEffect(() => () => probeAbort.current?.abort(), [])

  /**
   * Verify before applying: a dead server must not become the active target,
   * because every query in the app would then fail behind it.
   */
  const handleSelect = async (profile: ServerProfile) => {
    if (verifyingId) return
    setVerifyingId(profile.id)
    setProbes((prev) => ({ ...prev, [profile.id]: { status: 'checking' } }))
    const res = await probeServer(isDefaultProfile(profile) ? null : profile.url)
    setVerifyingId(null)
    if (res.ok) {
      setProbes((prev) => ({ ...prev, [profile.id]: { status: 'ok' } }))
      setActive(profile.id)
      setOpen(false)
      return
    }
    const fail = failState(res)
    setProbes((prev) => ({ ...prev, [profile.id]: fail }))
    toast.error(t('serverSwitcher.probeFailed', { name: profile.name, reason: fail.reason }))
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) refreshProbes(profiles)
          else probeAbort.current?.abort()
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-8 max-w-64 gap-2 px-2.5', className)}
            aria-label={t('serverSwitcher.title')}
          >
            <StatusDot tone={tone} pulse={isLoading} />
            <span className="truncate text-xs font-medium">{active?.name ?? t('serverSwitcher.noServers')}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('serverSwitcher.title')}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {profiles.length === 0 && (
            <div className="px-2 py-4 text-center">
              <p className="text-sm font-medium">{t('serverSwitcher.noServers')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('serverSwitcher.noServersHint')}</p>
            </div>
          )}

          {profiles.map((profile) => {
            const isActive = profile.id === active?.id
            const isDefault = profile.id === DEFAULT_PROFILE_ID
            const probe = probes[profile.id]
            const busy = verifyingId === profile.id || probe?.status === 'checking'
            return (
              <DropdownMenuItem
                key={profile.id}
                onSelect={(event) => {
                  // Keep the menu open when the row's own buttons are used.
                  const target = event.target as HTMLElement
                  if (target.closest('[data-row-action]')) {
                    event.preventDefault()
                    return
                  }
                  // …and also until the reachability check decides: a failed
                  // verification leaves the operator on the current server,
                  // looking at the reason, instead of inside a dead one.
                  event.preventDefault()
                  void handleSelect(profile)
                }}
                className="flex items-start gap-2 py-2"
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {isActive ? <Check className="size-4 text-primary" aria-hidden /> : <Server className="size-3.5 text-muted-foreground/50" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{profile.name}</span>
                    {isDefault && <Badge variant="muted" className="shrink-0 text-[10px]">{t('serverSwitcher.default')}</Badge>}
                  </span>
                  <span className="font-data block truncate text-[11px] text-muted-foreground">{profile.url}</span>
                </span>
                <span
                  className="flex shrink-0 items-center gap-1.5 pt-1"
                  title={probe?.status === 'fail' ? (probe.detail || probe.reason) : undefined}
                >
                  {busy ? (
                    <>
                      <Spinner size="sm" />
                      <span className="sr-only">{t('serverSwitcher.checking')}</span>
                    </>
                  ) : probe?.status === 'ok' ? (
                    <>
                      <StatusDot tone="success" />
                      <span className="text-[11px] text-muted-foreground">{t('serverSwitcher.reachable')}</span>
                    </>
                  ) : probe?.status === 'fail' ? (
                    <>
                      <StatusDot tone="danger" />
                      <span className="text-[11px] text-destructive">{probe.reason}</span>
                    </>
                  ) : null}
                </span>
                {!isDefault && (
                  <span className="flex shrink-0 items-center gap-0.5" data-row-action>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('serverSwitcher.editServer')}
                      onClick={() => setEditing(profile)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:text-destructive"
                      aria-label={t('serverSwitcher.removeServer')}
                      onClick={() => setConfirmRemove(profile)}
                    >
                      <Trash aria-hidden />
                    </Button>
                  </span>
                )}
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing('new')} className="text-primary">
            <Plus className="size-4" aria-hidden />
            {t('serverSwitcher.addServer')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ServerDialog
        state={editing}
        onClose={() => setEditing(null)}
        onSubmit={(input) => {
          if (editing === 'new') return addProfile(input) !== null
          if (editing === null) return false
          return updateProfile(editing.id, input)
        }}
      />

      <Dialog open={confirmRemove !== null} onOpenChange={(next) => !next && setConfirmRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('serverSwitcher.removeServer')}</DialogTitle>
            <DialogDescription>{t('serverSwitcher.confirmRemove', { name: confirmRemove?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>
              {tc('actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmRemove) removeProfile(confirmRemove.id)
                setConfirmRemove(null)
              }}
            >
              {tc('actions.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ServerDialogProps {
  state: ServerProfile | 'new' | null
  onClose: () => void
  onSubmit: (input: { name: string; url: string }) => boolean
}

function ServerDialog({ state, onClose, onSubmit }: ServerDialogProps) {
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const open = state !== null
  const isEdit = state !== null && state !== 'new'

  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)

  // Reset the form whenever the dialog is opened for a different profile.
  // `state` is a prop, so the fields are derived from it during render — an
  // effect would paint the previous profile's values into the inputs first.
  const [seededFrom, setSeededFrom] = React.useState(state)
  if (seededFrom !== state) {
    setSeededFrom(state)
    const editing = state !== null && state !== 'new' ? state : null
    setError(null)
    setChecking(false)
    setName(editing?.name ?? '')
    setUrl(editing?.url ?? '')
  }

  // Saving a profile also selects it, so an unreachable address must not get
  // through: the same probe the switch row runs, reported inline instead of in
  // a toast because the form is already the focus of attention.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalised = normaliseServerUrl(url)
    if (!normalised) {
      setError(tc('form.invalidUrl'))
      return
    }
    if (checking) return
    setChecking(true)
    const res = await probeServer(normalised)
    setChecking(false)
    if (!res.ok) {
      setError(probeReason(res, (key) => t(`serverSwitcher.${key}`)))
      return
    }
    if (onSubmit({ name, url })) onClose()
    else setError(tc('form.invalidUrl'))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('serverSwitcher.editServer') : t('serverSwitcher.addServer')}</DialogTitle>
          <DialogDescription>{t('serverSwitcher.url')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="server-name">{t('serverSwitcher.name')}</FieldLabel>
            <Input
              id="server-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('serverSwitcher.namePlaceholder')}
              autoComplete="off"
            />
            <FieldDescription>{tc('fields.optional')}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="server-url" required>
              {t('serverSwitcher.url')}
            </FieldLabel>
            <Input
              id="server-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setError(null)
              }}
              placeholder={t('serverSwitcher.urlPlaceholder')}
              className="font-data"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-invalid={error ? true : undefined}
              required
            />
            {error && <FieldError id="server-url-error">{error}</FieldError>}
            <FieldDescription>{urlPreview(url)}</FieldDescription>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={checking}>
              {checking ? t('serverSwitcher.checking') : isEdit ? tc('actions.save') : tc('actions.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function urlPreview(raw: string): string {
  const normalised = normaliseServerUrl(raw)
  return normalised ? `${normalised}/api/` : ''
}
