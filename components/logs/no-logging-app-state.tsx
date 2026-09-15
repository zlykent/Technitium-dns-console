'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Puzzle } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/app/states'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/**
 * "No query-log app installed" — the most important state on `/logs`.
 *
 * Query logs do not live on the DNS server itself: they are a database owned by
 * an installed *query logging DNS app*. On a server with no apps, `logs/query`
 * answers `DNS application was not found: <name>`. That is not a failure the
 * operator can retry their way out of, and rendering it through the red
 * `ErrorState` (with its stack-trace drawer and "connection failed" copy) would
 * send them hunting for a network problem that does not exist. Hence a guided
 * empty state pointing at `/apps`.
 *
 * `isMissingLoggingAppError` exists so the view can also classify a *late*
 * arrival of the same condition — the app was uninstalled in another tab between
 * the `apps/list` read and the `logs/query` call — and downgrade it here instead
 * of showing the error card.
 */

/** True when the upstream rejected the call because no such DNS app exists. */
export function isMissingLoggingAppError(error: unknown): boolean {
  if (!error) return false
  return /application was not found|app was not found|no such application/i.test(describeError(error).message)
}

export interface NoLoggingAppStateProps {
  /** Set when `apps/list` itself failed — a genuine error, not a missing app. */
  error?: unknown
  onRetry?: () => void
  className?: string
}

export function NoLoggingAppState({ error, onRetry, className }: NoLoggingAppStateProps) {
  const t = useTranslations('logs')

  // A failed `apps/list` is indistinguishable from "no apps" only if we let it
  // be; keep the honest error path so a downed server is not mis-reported as a
  // missing app.
  if (error) return <ErrorState error={error} onRetry={onRetry} className={className} />

  return (
    <div data-slot="no-logging-app-state" className={cn('surface rounded-lg', className)}>
      <EmptyState
        icon={Puzzle}
        title={t('query.requiresApp')}
        body={t('query.requiresAppBody')}
        action={
          <Button asChild size="sm">
            <Link href="/apps">
              <Puzzle className="size-3.5" aria-hidden />
              {t('query.requiresAppAction')}
            </Link>
          </Button>
        }
      />
    </div>
  )
}
