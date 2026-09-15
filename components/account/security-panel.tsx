'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { KeyRound, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/app/states'
import { Section } from '@/components/app/page-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { changePassword, getProfile } from '@/lib/api/domains/user'
import { isDnsApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import { useSession } from '@/lib/auth/session'
import { useTargetKey } from '@/lib/servers/provider'
import { MIN_PASSWORD_LENGTH, passwordStrength, type PasswordStrength } from '@/components/account/password-strength'
import { TotpSetup } from '@/components/account/totp-setup'

/**
 * Security tab: change password + enrol/disable TOTP.
 *
 * The whole tab is gated on `isSsoUser`. An SSO account's credential lives in
 * the external IdP, so `user/changePassword` and `user/2fa/*` are meaningless
 * (and rejected upstream) — rather than render forms that can only fail, the
 * panel collapses to a single explanatory alert. This is the same reasoning the
 * stock console uses when it hides the password box for federated users.
 *
 * The profile query is repeated here (and in the profile/tokens/sessions tabs)
 * on purpose: identical `queryKeys.profile(target)` means TanStack Query dedupes
 * them into one request and one cache entry, so each panel stays self-contained
 * and invalidation stays local. Hoisting would only add prop drilling.
 *
 * `changePassword` returns a fresh `Session`, so success adopts it directly
 * (`adopt`) instead of forcing another `user/session/get` round trip — the
 * operator's permissions and display name cannot have changed, but the token in
 * the httpOnly cookie has, and `adopt` keeps the client session object in step.
 */

export function SecurityPanel() {
  const t = useTranslations('account')
  const target = useTargetKey()

  const profile = useQuery({
    queryKey: queryKeys.profile(target),
    queryFn: () => getProfile(),
  })

  if (profile.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="surface h-72 w-full rounded-lg" />
        <Skeleton className="surface h-48 w-full rounded-lg" />
      </div>
    )
  }

  if (profile.error || !profile.data) {
    return <ErrorState error={profile.error ?? new Error('no data')} onRetry={() => void profile.refetch()} />
  }

  if (profile.data.isSsoUser) {
    return (
      <Section title={t('security.title')}>
        <Alert variant="info">
          <ShieldCheck aria-hidden />
          <AlertTitle>{t('profile.ssoUser')}</AlertTitle>
          <AlertDescription>{t('profile.ssoUserHint')}</AlertDescription>
        </Alert>
      </Section>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('security.password.title')} description={t('security.password.subtitle')}>
        <ChangePasswordForm />
      </Section>

      <Section title={t('security.totp.title')} description={t('security.totp.subtitle')}>
        <TotpSetup totpEnabled={profile.data.totpEnabled} />
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ChangePasswordForm() {
  const t = useTranslations('account')
  const { adopt, refresh } = useSession()

  const [pass, setPass] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [totp, setTotp] = React.useState('')
  const [needsTotp, setNeedsTotp] = React.useState(false)
  const [errors, setErrors] = React.useState<{ next?: string; confirm?: string }>({})

  const change = useMutation({
    mutationFn: () => changePassword({ pass, newPass: next, totp: totp.trim() || undefined, includeInfo: true }),
    onSuccess: (session) => {
      adopt(session)
      refresh()
      toast.success(t('security.password.success'))
      setPass('')
      setNext('')
      setConfirm('')
      setTotp('')
      setNeedsTotp(false)
      setErrors({})
    },
    onError: (error) => {
      // Technitium answers `2fa-required` to the first leg when the account has
      // TOTP on; that is a prompt, not a failure, so it reveals the code field
      // instead of surfacing an error banner.
      if (isDnsApiError(error) && error.code === 'two_factor_required') setNeedsTotp(true)
    },
  })

  const strength = passwordStrength(next)
  // The 2FA prompt is not an error; everything else (wrong current password,
  // rejected code) is shown inline so a failed submit never looks like success.
  const formError =
    change.error && !(isDnsApiError(change.error) && change.error.code === 'two_factor_required')
      ? change.error
      : null
  const canSubmit =
    pass.length > 0 && next.length > 0 && confirm.length > 0 && (!needsTotp || totp.length === 6)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: { next?: string; confirm?: string } = {}
    if (next.length < MIN_PASSWORD_LENGTH) {
      nextErrors.next = t('security.password.tooShort', { min: MIN_PASSWORD_LENGTH })
    } else if (next === pass) {
      nextErrors.next = t('security.password.sameAsCurrent')
    }
    if (confirm !== next) {
      nextErrors.confirm = t('security.password.mismatch')
    }
    setErrors(nextErrors)
    if (nextErrors.next || nextErrors.confirm) return
    void change.mutateAsync()
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor="cp-current" required>
          {t('security.password.current')}
        </FieldLabel>
        <Input
          id="cp-current"
          type="password"
          value={pass}
          onChange={(event) => setPass(event.target.value)}
          autoComplete="current-password"
          disabled={change.isPending}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="cp-next" required>
          {t('security.password.next')}
        </FieldLabel>
        <Input
          id="cp-next"
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          aria-invalid={Boolean(errors.next)}
          aria-describedby="cp-next-error"
          disabled={change.isPending}
        />
        {next.length > 0 ? <StrengthMeter strength={strength} /> : null}
        <FieldError id="cp-next-error">{errors.next}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor="cp-confirm" required>
          {t('security.password.confirm')}
        </FieldLabel>
        <Input
          id="cp-confirm"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirm)}
          aria-describedby="cp-confirm-error"
          disabled={change.isPending}
        />
        <FieldError id="cp-confirm-error">{errors.confirm}</FieldError>
      </Field>

      {needsTotp ? (
        <Field>
          <FieldLabel htmlFor="cp-totp" required>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              {t('security.totp.code')}
            </span>
          </FieldLabel>
          <Input
            id="cp-totp"
            value={totp}
            onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('security.totp.codePlaceholder')}
            className="font-data tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            disabled={change.isPending}
          />
        </Field>
      ) : null}

      {formError ? <ErrorState error={formError} compact /> : null}

      <div>
        <Button type="submit" loading={change.isPending} disabled={!canSubmit}>
          {!change.isPending && <KeyRound className="size-4" aria-hidden />}
          {change.isPending ? t('security.password.submitting') : t('security.password.submit')}
        </Button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */

const STRENGTH_TONES = ['destructive', 'warning', 'default', 'success'] as const

function StrengthMeter({ strength }: { strength: PasswordStrength }) {
  const t = useTranslations('account')
  const { score, hints } = strength
  const label = t(`security.password.strength.${['weak', 'fair', 'good', 'strong'][score]}`)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('security.password.strength.label')}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <Progress value={((score + 1) / 4) * 100} tone={STRENGTH_TONES[score]} aria-label={t('security.password.strength.label')} />
      {hints.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {hints.map((hint) => (
            <li key={hint} className="text-xs text-muted-foreground">
              {hint === 'length'
                ? t('security.password.strength.hintLength', { min: MIN_PASSWORD_LENGTH })
                : hint === 'mix'
                  ? t('security.password.strength.hintMix')
                  : t('security.password.strength.hintCommon')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
