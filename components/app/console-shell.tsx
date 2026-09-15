'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LockKeyhole, ServerCrash } from 'lucide-react'
import * as React from 'react'
import { Sidebar, useSidebarCollapsed } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useSession } from '@/lib/auth/session'
import { landingRoute, requiredSectionFor } from '@/lib/nav'

/**
 * Authenticated shell + route guard.
 *
 * The guard is client-side by design: the token lives in an httpOnly cookie that
 * the server component could read, but the *permission map* comes from
 * `user/session/get` against whichever server the browser has selected — a fact
 * that only exists in `localStorage`. Checking on the server would mean either
 * duplicating that state or letting an unauthorised user see a page shell before
 * the client bounced them.
 *
 * Three outcomes: not signed in -> `/login`, signed in but lacking the section
 * -> a permission panel with a link to the first page they *can* open, and a
 * transport failure -> a retry panel (never a silent redirect, which would hide
 * a downed server).
 */

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()
  const { ready, isAuthenticated, permissions, connectionError, refresh } = useSession()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()

  React.useEffect(() => {
    if (ready && !isAuthenticated && !connectionError) {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''
      router.replace(`/login${next}`)
    }
  }, [ready, isAuthenticated, connectionError, router, pathname])

  if (!ready || (!isAuthenticated && !connectionError)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Spinner className="size-5" />
          <span className="sr-only" role="status">
            {tc('a11y.loading')}
          </span>
        </div>
      </div>
    )
  }

  if (connectionError && !isAuthenticated) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="surface flex max-w-md flex-col items-center gap-3 rounded-lg p-8 text-center">
          <span className="grid size-11 place-items-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
            <ServerCrash className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-semibold">{t('connectionFailed.title')}</p>
          <p className="font-data max-w-sm break-all text-xs text-muted-foreground">{connectionError}</p>
          <div className="mt-1 flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              {tc('actions.retry')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.replace('/login')}>
              {t('connectionFailed.backToLogin')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const section = requiredSectionFor(pathname)
  const allowed = !section || (permissions[section]?.canView ?? false)

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main"
          // `relative` makes the scroll container the containing block for any
          // absolutely-positioned descendant that lacks a positioned ancestor
          // (Radix mounts hidden form-submission inputs like that inside
          // Switch/Checkbox). Without it those elements escape to the document
          // and stretch a second, page-level scrollbar next to this one.
          className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
          >
            {tc('a11y.skipToContent')}
          </a>
          {allowed ? children : <PermissionDenied />}
        </main>
      </div>
    </div>
  )
}

function PermissionDenied() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const { permissions } = useSession()
  const home = landingRoute(permissions)

  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="surface flex max-w-md flex-col items-center gap-3 rounded-lg p-8 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-warning/25 bg-warning/10 text-warning">
          <LockKeyhole className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-semibold">{t('permission.title')}</p>
        <p className="text-xs text-muted-foreground">{t('permission.hint')}</p>
        <div className="mt-1 flex gap-2">
          <Button asChild size="sm">
            <Link href={home}>{t('permission.backToDashboard')}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/account">{tc('actions.details')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
