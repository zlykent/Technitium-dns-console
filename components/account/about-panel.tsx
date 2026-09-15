'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { CircleCheck, Download, ExternalLink, Info, LogOut, RefreshCw, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, useConfirmAction } from '@/components/app/confirm-dialog'
import { DataValue } from '@/components/app/copy-button'
import { DefinitionList, Section } from '@/components/app/page-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { describeError } from '@/lib/api/client'
import { getStatus } from '@/lib/api/domains/system'
import { checkForUpdate } from '@/lib/api/domains/user'
import { queryKeys } from '@/lib/api/query-keys'
import { useSession } from '@/lib/auth/session'
import { formatTtl, formatUptime } from '@/lib/format'
import { useMounted } from '@/lib/hooks/use-mounted'
import { useLocaleCode } from '@/lib/i18n/locale-code'
import { useServers, useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * About tab — read-only facts about the server, the defaults it hands out, and
 * this console itself, plus the sign-out affordance.
 *
 * Two data sources, deliberately not merged:
 *  - `useSession().session.info` (`SessionInfo`) already carries version,
 *    uptime, domain, the three default TTLs and the DNSSEC/cluster booleans, so
 *    most of this pane costs **zero** extra requests — it is the payload the
 *    session probe fetched at login.
 *  - `getStatus()` is queried separately (staleTime 0) only because it is the
 *    live "is the box reachable right now" signal. Verified against a real
 *    v15.4 server, `api/status` returns `{ status, server, hasDefaultCredentials,
 *    ssoEnabled }` and **no** `node` / `serverType` / `installedOn`, so those
 *    rows are omitted rather than rendered as `undefined` — the spec's rule.
 *
 * `checkForUpdate()` is a mutation, not a query: it makes the server dial out to
 * technitium.com, a side effect that must only run on an explicit button press.
 *
 * The theme row is `useMounted()`-guarded because `next-themes` cannot know the
 * applied theme during SSR; guessing would cause a hydration mismatch (the same
 * reason `theme-toggle.tsx` defers its icon).
 *
 * Sign-out mirrors `components/layout/user-menu.tsx` exactly — `signOut()` →
 * success toast → `router.replace('/login')` — so both entry points behave the
 * same; it just wraps the sequence in a `ConfirmDialog` because leaving the
 * console is destructive to unsaved work.
 */

const BUILT_WITH = 'Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query 5'
const UPSTREAM_URL = 'https://github.com/TechnitiumSoftware/DnsServer'
const API_DOCS_URL = 'https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md'
const ISSUES_URL = 'https://github.com/TechnitiumSoftware/DnsServer/issues'
const DOWNLOAD_URL = 'https://technitium.com/dns/'

export interface AboutPanelProps {
  /** `package.json` version, resolved on the server (see `page.tsx`). */
  consoleVersion: string
}

export function AboutPanel({ consoleVersion }: AboutPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <ServerSection />
      <DefaultsSection />
      <ConsoleSection consoleVersion={consoleVersion} />
      <CreditsAndLinks />
      <LogoutSection />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ServerSection() {
  const t = useTranslations('account')
  const locale = useLocaleCode()
  const target = useTargetKey()
  const { session } = useSession()
  const info = session?.info

  const status = useQuery({
    queryKey: queryKeys.status(target),
    queryFn: () => getStatus(),
    staleTime: 0,
  })

  const update = useMutation({
    mutationFn: () => checkForUpdate(),
    onError: (error) => toast.error(describeError(error).message),
  })

  const items: { label: React.ReactNode; value: React.ReactNode }[] = [
    { label: t('about.server.version'), value: <DataValue value={info?.version} className="text-sm" /> },
    {
      label: t('about.server.uptime'),
      value: <span className="font-data text-sm">{formatUptime(info?.uptimestamp, locale)}</span>,
    },
    { label: t('about.server.domain'), value: <DataValue value={info?.dnsServerDomain} className="text-sm" /> },
    { label: t('about.server.dnssecValidation'), value: <BoolBadge on={Boolean(info?.dnssecValidation)} /> },
    { label: t('about.server.clusterInitialized'), value: <BoolBadge on={Boolean(info?.clusterInitialized)} /> },
  ]

  const result = update.data

  return (
    <Section
      title={t('about.server.title')}
      actions={
        <Button variant="outline" size="sm" loading={update.isPending} onClick={() => update.mutate()}>
          {!update.isPending && <RefreshCw className="size-3.5" aria-hidden />}
          {update.isPending ? t('about.server.checking') : t('about.server.checkUpdate')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <DefinitionList items={items} />

        {status.error ? <ErrorNote message={describeError(status.error).message} /> : null}

        {result?.updateAvailable ? (
          <Alert variant="info">
            <Info aria-hidden />
            <AlertTitle>{t('about.server.updateAvailable', { version: result.updateVersion })}</AlertTitle>
            <AlertDescription>
              <a
                href={DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-1')}
              >
                <Download className="size-3.5" aria-hidden />
                {t('about.server.downloadUpdate')}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </AlertDescription>
          </Alert>
        ) : null}

        {result && !result.updateAvailable ? (
          <Alert variant="success">
            <CircleCheck aria-hidden />
            <AlertTitle>{t('about.server.upToDate')}</AlertTitle>
          </Alert>
        ) : null}

        {update.error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t('about.server.updateFailed')}</AlertTitle>
            <AlertDescription>{describeError(update.error).message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Section>
  )
}

function DefaultsSection() {
  const t = useTranslations('account')
  const { session } = useSession()
  const info = session?.info

  const items: { label: React.ReactNode; value: React.ReactNode }[] = [
    {
      label: t('about.defaults.recordTtl'),
      value: <span className="font-data text-sm">{formatTtl(info?.defaultRecordTtl)}</span>,
    },
    {
      label: t('about.defaults.nsRecordTtl'),
      value: <span className="font-data text-sm">{formatTtl(info?.defaultNsRecordTtl)}</span>,
    },
    {
      label: t('about.defaults.soaRecordTtl'),
      value: <span className="font-data text-sm">{formatTtl(info?.defaultSoaRecordTtl)}</span>,
    },
    {
      label: t('about.defaults.soaSerialScheme'),
      value: <span className="text-sm">{info?.useSoaSerialDateScheme ? t('about.defaults.schemeDate') : t('about.defaults.schemeSerial')}</span>,
    },
  ]

  return (
    <Section title={t('about.defaults.title')}>
      <DefinitionList items={items} />
    </Section>
  )
}

function ConsoleSection({ consoleVersion }: { consoleVersion: string }) {
  const t = useTranslations('account')
  const tc = useTranslations('common')
  const locale = useLocaleCode()
  const { theme } = useTheme()
  const mounted = useMounted()
  const { active, defaultTarget } = useServers()

  const themeLabel = !mounted
    ? '—'
    : theme === 'dark'
      ? tc('theme.dark')
      : theme === 'light'
        ? tc('theme.light')
        : tc('theme.system')

  const items: { label: React.ReactNode; value: React.ReactNode }[] = [
    { label: t('about.console.version'), value: <span className="font-data text-sm">{consoleVersion}</span> },
    { label: t('about.console.builtWith'), value: <span className="text-sm">{BUILT_WITH}</span> },
    { label: t('about.console.locale'), value: <span className="font-data text-sm">{locale}</span> },
    { label: t('about.console.theme'), value: <span className="text-sm">{themeLabel}</span> },
    { label: t('about.console.target'), value: <DataValue value={active?.url ?? defaultTarget} className="text-sm" /> },
  ]

  return (
    <Section title={t('about.console.title')} description={t('about.console.description')}>
      <DefinitionList items={items} />
    </Section>
  )
}

function CreditsAndLinks() {
  const t = useTranslations('account')

  return (
    <>
      <Section title={t('about.credits.title')}>
        <p className="text-sm text-muted-foreground text-pretty">{t('about.credits.body')}</p>
      </Section>

      <Section title={t('about.links.title')}>
        <div className="flex flex-wrap gap-2">
          <a href={UPSTREAM_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('about.links.upstream')}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <a href={API_DOCS_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('about.links.apiDocs')}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <a href={ISSUES_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('about.links.issues')}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </Section>
    </>
  )
}

function LogoutSection() {
  const t = useTranslations('account')
  const router = useRouter()
  const { signOut } = useSession()

  const logout = useConfirmAction(async () => {
    await signOut()
    toast.success(t('logout.success'))
    router.replace('/login')
  })

  return (
    <Section title={t('logout.label')} className="border-destructive/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('logout.confirm')}</p>
        <Button variant="destructive" size="sm" onClick={() => logout.setOpen(true)}>
          <LogOut className="size-4" aria-hidden />
          {t('logout.label')}
        </Button>
      </div>

      <ConfirmDialog
        open={logout.open}
        onOpenChange={logout.setOpen}
        title={t('logout.label')}
        description={t('logout.confirm')}
        confirmLabel={t('logout.label')}
        onConfirm={logout.confirm}
        pending={logout.pending}
        error={logout.error ?? undefined}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */

function BoolBadge({ on }: { on: boolean }) {
  const tc = useTranslations('common')
  return (
    <Badge variant={on ? 'success' : 'muted'}>
      <StatusDot tone={on ? 'success' : 'neutral'} />
      {on ? tc('fields.yes') : tc('fields.no')}
    </Badge>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
