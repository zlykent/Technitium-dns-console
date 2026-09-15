'use client'

import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { KeyRound, LogIn, ShieldCheck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import * as React from 'react'
import { ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TARGET_HEADER } from '@/lib/api/client'
import { DnsApiError, isDnsApiError } from '@/lib/api/errors'
import type { Session } from '@/lib/api/types/common'
import { login } from '@/lib/api/domains/user'
import { useSession } from '@/lib/auth/session'
import { landingRoute } from '@/lib/nav'
import { useServers } from '@/lib/servers/provider'

/**
 * Sign-in.
 *
 * Three modes in one form because the upstream only has one credential
 * endpoint: password, password + TOTP (Technitium signals this by answering
 * `2fa-required` to the first attempt), and a pasted long-lived API token which
 * is verified and stored by `/api/auth/token`.
 *
 * The server address is part of the form rather than a separate step: the
 * console is multi-server, and an operator arriving at a bookmark must be able
 * to point it somewhere before authenticating.
 */

const DEFAULT_CREDENTIALS = { user: 'admin', pass: '123456' }

export function LoginForm() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { active, defaultTarget, selectByUrl, ready } = useServers()
  const { adopt, isAuthenticated, permissions, refresh } = useSession()

  const [mode, setMode] = React.useState<'password' | 'token'>('password')
  const [server, setServer] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [apiToken, setApiToken] = React.useState('')
  const [totp, setTotp] = React.useState('')
  const [needsTotp, setNeedsTotp] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [warnDefault, setWarnDefault] = React.useState(false)

  // Seed the address from the active profile once localStorage has hydrated.
  const seeded = React.useRef(false)
  React.useEffect(() => {
    if (!ready || seeded.current) return
    seeded.current = true
    setServer(active?.url ?? defaultTarget ?? '')
  }, [ready, active, defaultTarget])

  /**
   * The `?next=` target, or null when it is absent or unsafe.
   *
   * Both navigations below read this rather than one of them computing it:
   * `redirectAfterLogin` calls `adopt`, which flips `isAuthenticated` and fires
   * the "already signed in" effect on the next render. When only the first of
   * the two honoured `?next=`, the second overwrote it and a deep link landed on
   * the dashboard instead.
   */
  const nextParam = React.useMemo(() => {
    const requested = searchParams.get('next')
    // Only accept same-origin relative paths; an absolute URL here would be an
    // open redirect straight off a successful login.
    return requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : null
  }, [searchParams])

  const redirectAfterLogin = React.useCallback(
    (session: Session) => {
      adopt(session)
      refresh()
      const target = nextParam ?? landingRoute(session.info?.permissions ?? permissions)
      toast.success(t('login.signedIn'))
      router.replace(target)
    },
    [adopt, refresh, nextParam, permissions, router, t],
  )

  // Already signed in (e.g. back-button after a successful login) — skip ahead.
  React.useEffect(() => {
    if (isAuthenticated && !pending) router.replace(nextParam ?? landingRoute(permissions))
  }, [isAuthenticated, pending, router, permissions, nextParam])

  /**
   * Point the API client at whatever is in the address field. Returns an error
   * rather than setting state, because React state is not visible until the
   * next render and the submit handler has to branch on it immediately.
   */
  const applyServer = (): { target: string | null; error: DnsApiError | null } => {
    const raw = server.trim()
    if (!raw) {
      if (!defaultTarget) return { target: null, error: new DnsApiError('no_target', t('login.serverRequired')) }
      selectByUrl(null)
      return { target: null, error: null }
    }
    const profile = selectByUrl(raw)
    if (!profile) return { target: null, error: new DnsApiError('no_target', tc('form.invalidUrl')) }
    return { target: profile.url, error: null }
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const { error: targetError } = applyServer()
    if (targetError) {
      setError(targetError)
      return
    }
    if (!username.trim()) {
      setError(new DnsApiError('proxy_error', t('login.usernameRequired')))
      return
    }

    setPending(true)
    try {
      const session = await login({ user: username.trim(), pass: password, totp: totp.trim() || undefined })
      setWarnDefault(username.trim() === DEFAULT_CREDENTIALS.user && password === DEFAULT_CREDENTIALS.pass)
      setNeedsTotp(false)
      setPassword('')
      setTotp('')
      redirectAfterLogin(session)
    } catch (err) {
      if (isDnsApiError(err) && err.code === 'two_factor_required') {
        // First leg succeeded; the account wants a TOTP before a token is issued.
        setNeedsTotp(true)
        setError(null)
      } else {
        setNeedsTotp(false)
        setError(err)
      }
    } finally {
      setPending(false)
    }
  }

  const submitToken = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const { target, error: targetError } = applyServer()
    if (targetError) {
      setError(targetError)
      return
    }

    setPending(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // `applyServer` already pointed the SDK client at this server, but this
      // call bypasses that client, so the header has to be set explicitly. A
      // null target means "the operator's default", addressed by omitting it.
      if (target && target !== defaultTarget) headers[TARGET_HEADER] = target

      const response = await fetch('/api/auth/token', {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: apiToken.trim() }),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const body = (await response.json()) as Session & { code?: string; message?: string }
      if (!response.ok) {
        throw DnsApiError.from(body, response.status)
      }
      setApiToken('')
      redirectAfterLogin(body)
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{needsTotp ? t('twoFactor.title') : t('login.title')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{needsTotp ? t('twoFactor.subtitle') : t('login.subtitle')}</p>
      </div>

      <Tabs value={mode} onValueChange={(value) => { setMode(value as 'password' | 'token'); setError(null); setNeedsTotp(false) }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password" className="gap-1.5 text-xs">
            <LogIn className="size-3.5" aria-hidden />
            {t('login.credentialsTab')}
          </TabsTrigger>
          <TabsTrigger value="token" className="gap-1.5 text-xs">
            <KeyRound className="size-3.5" aria-hidden />
            {t('login.tokenTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-4">
          <form onSubmit={submitPassword} className="flex flex-col gap-4" noValidate>
            <Field>
              <FieldLabel htmlFor="server">{t('login.serverLabel')}</FieldLabel>
              <Input
                id="server"
                value={server}
                onChange={(event) => setServer(event.target.value)}
                placeholder={t('login.serverPlaceholder')}
                className="font-data"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                disabled={pending}
              />
              <FieldDescription>{t('login.serverHelp')}</FieldDescription>
            </Field>

            {needsTotp ? (
              <Field>
                <FieldLabel htmlFor="totp" required>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-primary" aria-hidden />
                    {t('twoFactor.codeLabel')}
                  </span>
                </FieldLabel>
                <Input
                  id="totp"
                  value={totp}
                  onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('twoFactor.codePlaceholder')}
                  className="font-data tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  disabled={pending}
                />
                <FieldDescription>{t('twoFactor.codeHint')}</FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="username" required>
                    {t('login.usernameLabel')}
                  </FieldLabel>
                  <Input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t('login.usernamePlaceholder')}
                    autoComplete="username"
                    autoFocus
                    required
                    disabled={pending}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="password" required>
                    {t('login.passwordLabel')}
                  </FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    autoComplete="current-password"
                    required
                    disabled={pending}
                  />
                  <FieldDescription>{t('login.rememberHelp')}</FieldDescription>
                </Field>
              </>
            )}

            {error ? <ErrorState error={error} compact /> : null}

            <Button type="submit" loading={pending} className="w-full">
              {needsTotp ? t('twoFactor.verify') : t('login.submit')}
            </Button>

            {needsTotp && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNeedsTotp(false); setTotp('') }} disabled={pending}>
                {t('twoFactor.back')}
              </Button>
            )}
          </form>
        </TabsContent>

        <TabsContent value="token" className="mt-4">
          <form onSubmit={submitToken} className="flex flex-col gap-4" noValidate>
            <Field>
              <FieldLabel htmlFor="token-server">{t('login.serverLabel')}</FieldLabel>
              <Input
                id="token-server"
                value={server}
                onChange={(event) => setServer(event.target.value)}
                placeholder={t('login.serverPlaceholder')}
                className="font-data"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                disabled={pending}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="api-token" required>
                {t('login.tokenLabel')}
              </FieldLabel>
              <Input
                id="api-token"
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                placeholder={t('login.tokenPlaceholder')}
                className="font-data"
                autoComplete="off"
                spellCheck={false}
                required
                disabled={pending}
              />
              <FieldDescription>{t('login.tokenHelp')}</FieldDescription>
              {apiToken.length > 0 && apiToken.trim().length < 16 && (
                <FieldError id="api-token-error">{t('login.tokenTooShort')}</FieldError>
              )}
            </Field>

            {error ? <ErrorState error={error} compact /> : null}

            <Button type="submit" loading={pending} disabled={apiToken.trim().length < 16} className="w-full">
              {t('login.submit')}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {warnDefault && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t('login.defaultCredentialsWarning')}</span>
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">{t('login.needHelp')}</p>
    </div>
  )
}
