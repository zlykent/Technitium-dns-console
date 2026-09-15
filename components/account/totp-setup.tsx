'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { copyText } from '@/components/app/copy-button'
import { ErrorState } from '@/components/app/states'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { disableTotp, enableTotp, initTotp } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import { useSession } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'

/**
 * TOTP enrolment and teardown.
 *
 * `user/2fa/init` is a **mutation, not a query**: it has a server-side effect
 * (Technitium generates and stores a fresh secret each call), so it must never
 * run on a refetch, a window focus, or a cache replay. Modelling it as a query
 * would silently rotate the secret under an operator mid-enrolment.
 *
 * The enrolment is two steps in one surface rather than a wizard with routes:
 * the QR and the code field belong together (you scan, then type what the app
 * now shows), and keeping them on one screen means an operator being walked
 * through setup over the phone never loses their place to a navigation.
 *
 * Disabling is destructive — it drops the account's second factor — so it goes
 * through `ConfirmDialog` and, like the stock console, requires a live code to
 * prove the operator still holds the authenticator. Enrolment state is derived
 * from the mutation (`init.data && !init.isPending`) instead of a hand-kept
 * phase flag, so a re-enrolment after a disable can never paint the previous
 * run's stale QR while the new secret is in flight.
 */

export function TotpSetup({ totpEnabled }: { totpEnabled: boolean }) {
  const t = useTranslations('account')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const queryClient = useQueryClient()
  const { refresh } = useSession()

  const [code, setCode] = React.useState('')
  const [disableOpen, setDisableOpen] = React.useState(false)
  const [disableCode, setDisableCode] = React.useState('')
  const [disableCodeError, setDisableCodeError] = React.useState<string | null>(null)

  const init = useMutation({ mutationFn: () => initTotp() })

  const enable = useMutation({
    mutationFn: (value: string) => enableTotp({ totp: value }),
    onSuccess: () => {
      toast.success(t('security.totp.enabled'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
      refresh()
      setCode('')
      enable.reset()
      // `init` is intentionally left populated: the profile refetch flips
      // `totpEnabled`, and holding the last result avoids a flash back to the
      // "enable" button during the round trip.
    },
  })

  const disable = useMutation({
    mutationFn: (value: string) => disableTotp(value),
    onSuccess: () => {
      toast.success(t('security.totp.disabled'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(target) })
      refresh()
      setDisableOpen(false)
      setDisableCode('')
      setDisableCodeError(null)
    },
  })

  const enrolling = Boolean(init.data) && !init.isPending
  const secret = init.data?.totpSecretKeyBase32 ?? init.data?.totpSecretKey ?? ''

  function cancelEnrol() {
    init.reset()
    setCode('')
    enable.reset()
  }

  async function copySecret() {
    const ok = await copyText(secret)
    if (ok) toast.success(t('security.totp.copied'))
    else toast.error(tc('toast.failed'))
  }

  if (totpEnabled) {
    return (
      <div className="flex flex-col gap-3">
        <TotpStatusBadge enabled />
        <p className="text-sm text-muted-foreground">{t('security.totp.disableHint')}</p>
        <div>
          <Button variant="outline" onClick={() => setDisableOpen(true)}>
            <ShieldOff className="size-4" aria-hidden />
            {t('security.totp.disable')}
          </Button>
        </div>

        <ConfirmDialog
          open={disableOpen}
          onOpenChange={(open) => {
            setDisableOpen(open)
            if (!open) {
              setDisableCode('')
              setDisableCodeError(null)
            }
          }}
          title={t('security.totp.disableConfirm')}
          confirmLabel={t('security.totp.confirmDisable')}
          onConfirm={async () => {
            const value = disableCode.trim()
            if (value.length !== 6) {
              setDisableCodeError(t('security.totp.invalidCode'))
              return
            }
            setDisableCodeError(null)
            await disable.mutateAsync(value)
          }}
        >
          <Field>
            <FieldLabel htmlFor="totp-disable-code" required>
              {t('security.totp.disableCode')}
            </FieldLabel>
            <Input
              id="totp-disable-code"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('security.totp.codePlaceholder')}
              className="font-data tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
            <FieldError>{disableCodeError}</FieldError>
          </Field>
        </ConfirmDialog>
      </div>
    )
  }

  if (enrolling && init.data) {
    return (
      <div className="flex flex-col gap-4">
        <TotpStatusBadge enabled={false} />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('security.totp.step1')}</p>
          <p className="text-xs text-muted-foreground">{t('security.totp.step1Hint')}</p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* A `data:` PNG cannot go through `next/image` (no loader, no
                optimisation), so a plain `<img>` is the correct primitive. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${init.data.qrCodePngImage}`}
              alt={t('security.totp.qrAlt')}
              width={160}
              height={160}
              className="size-40 shrink-0 rounded-md border border-border bg-card"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('security.totp.secret')}</span>
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 p-2">
                <code className="font-data min-w-0 flex-1 break-all text-xs">{secret}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copySecret()}>
                  <Copy className="size-3.5" aria-hidden />
                  {t('security.totp.copySecret')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
          <p className="text-sm font-medium">{t('security.totp.step2')}</p>
          <p className="text-xs text-muted-foreground">{t('security.totp.step2Hint')}</p>
          <Field>
            <FieldLabel htmlFor="totp-code" required>
              {t('security.totp.code')}
            </FieldLabel>
            <Input
              id="totp-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('security.totp.codePlaceholder')}
              className="font-data tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={enable.isPending}
            />
          </Field>

          {enable.error ? <ErrorState error={enable.error} title={t('security.totp.invalidCode')} compact /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              loading={enable.isPending}
              disabled={code.length !== 6}
              onClick={() => void enable.mutateAsync(code)}
            >
              {!enable.isPending && <ShieldCheck className="size-4" aria-hidden />}
              {enable.isPending ? t('security.totp.confirming') : t('security.totp.confirmEnable')}
            </Button>
            <Button type="button" variant="ghost" onClick={cancelEnrol} disabled={enable.isPending}>
              {t('security.totp.cancel')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <TotpStatusBadge enabled={false} />
      <div>
        <Button type="button" loading={init.isPending} onClick={() => init.mutate()}>
          {!init.isPending && <ShieldCheck className="size-4" aria-hidden />}
          {t('security.totp.enable')}
        </Button>
      </div>
      {init.error ? <ErrorState error={init.error} compact onRetry={() => init.mutate()} /> : null}
    </div>
  )
}

function TotpStatusBadge({ enabled }: { enabled: boolean }) {
  const t = useTranslations('account')
  return (
    <Badge variant={enabled ? 'success' : 'muted'}>
      <StatusDot tone={enabled ? 'success' : 'neutral'} pulse={enabled} />
      {enabled ? t('security.totp.statusEnabled') : t('security.totp.statusDisabled')}
    </Badge>
  )
}
