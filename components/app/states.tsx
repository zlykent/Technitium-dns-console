'use client'

import { useTranslations } from 'next-intl'
import { Inbox, RefreshCw, SearchX, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { describeError } from '@/lib/api/client'
import { isDnsApiError } from '@/lib/api/errors'
import { cn } from '@/lib/utils'

/**
 * The four non-happy states every data surface needs: loading, empty, no
 * matches, and error. Keeping them in one module is what stops eleven pages
 * from inventing eleven slightly different error panels.
 */

/**
 * Any component that accepts a className works here, not just a lucide icon —
 * callers legitimately pass custom badges and `React.ComponentType` wrappers.
 */
export type StateIcon = React.ComponentType<{ className?: string }>

interface CentredStateProps {
  icon: StateIcon
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  className?: string
  tone?: 'neutral' | 'danger' | 'warning'
}

function CentredState({ icon: Icon, title, body, action, className, tone = 'neutral' }: CentredStateProps) {
  return (
    <div data-slot="centred-state" className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      <span
        className={cn(
          'grid size-11 place-items-center rounded-full border',
          tone === 'danger' && 'border-destructive/25 bg-destructive/10 text-destructive',
          tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
          tone === 'neutral' && 'border-border/60 bg-muted/50 text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        {body && <div className="mt-1 text-xs text-muted-foreground text-pretty">{body}</div>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon = Inbox,
  className,
}: {
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  icon?: StateIcon
  className?: string
}) {
  return <CentredState icon={icon} title={title} body={body} action={action} className={className} />
}

/** Same shape as `EmptyState` but for "your filter matched nothing". */
export function NoResultsState({ title, body, action, className }: { title?: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const t = useTranslations('common')
  return <CentredState icon={SearchX} title={title ?? t('table.noResults')} body={body} action={action} className={className} />
}

export function LoadingState({ rows = 5, className }: { rows?: number; className?: string }) {
  const t = useTranslations('common')
  return (
    <div data-slot="loading-state" role="status" aria-live="polite" className={cn('flex flex-col gap-2 p-4', className)}>
      <span className="sr-only">{t('table.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  )
}

/** Inline spinner for buttons and small regions. */
export function InlineLoading({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations('common')
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <Spinner className="size-3.5" />
      <span className="sr-only sm:not-sr-only">{label ?? t('table.loading')}</span>
    </span>
  )
}

export interface ErrorStateProps {
  error: unknown
  /** Re-runs the query. Omit to render without a retry button. */
  onRetry?: () => void
  title?: string
  className?: string
  /** Compact variant for inline regions (form submission failures). */
  compact?: boolean
}

/**
 * Renders a `DnsApiError` with copy from the `errors` namespace.
 *
 * The upstream message is shown verbatim in a collapsed panel: it is usually the
 * only actionable detail ("Zone 'x' already exists."), but it is English-only
 * and sometimes carries a .NET stack trace, so it is one click away rather than
 * in the operator's face.
 */
export function ErrorState({ error, onRetry, title, className, compact = false }: ErrorStateProps) {
  const t = useTranslations('errors')
  const tc = useTranslations('common')
  const [open, setOpen] = React.useState(false)

  const described = describeError(error)
  const code = isDnsApiError(error) ? error.code : 'unknown'
  const upstream = isDnsApiError(error) ? error.message : null
  const inner = isDnsApiError(error) ? error.innerMessage : undefined
  const stack = isDnsApiError(error) ? error.stackTrace : undefined

  if (compact) {
    return (
      <div
        data-slot="error-state"
        role="alert"
        className={cn('flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive', className)}
      >
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title ?? t(`codes.${code}.title`)}</p>
          <p className="mt-0.5 break-words text-destructive/80">{upstream ?? described.message}</p>
        </div>
        {onRetry && (
          <Button variant="ghost" size="xs" onClick={onRetry} className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
            <RefreshCw className="size-3" aria-hidden />
            {tc('actions.retry')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div data-slot="error-state" role="alert" className={cn('surface rounded-lg', className)}>
      <CentredState
        icon={TriangleAlert}
        tone="danger"
        title={title ?? t(`codes.${code}.title`)}
        body={
          <span className="flex flex-col gap-1">
            <span>{t(`codes.${code}.message`)}</span>
            {upstream && <span className="font-data break-all text-foreground/80">{upstream}</span>}
          </span>
        }
        action={
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden />
              {tc('actions.retry')}
            </Button>
          )
        }
        className="py-10"
      />

      {(inner || stack) && (
        <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border/60 px-4 py-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="w-full justify-start text-muted-foreground">
              {open ? t('ui.hideDetails') : t('ui.details')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {inner && (
              <p className="mb-2">
                <span className="text-xs font-medium text-muted-foreground">{t('ui.innerMessage')}: </span>
                <span className="font-data break-all text-xs">{inner}</span>
              </p>
            )}
            {stack && (
              <pre className="font-data max-h-48 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {stack}
              </pre>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
