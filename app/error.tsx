'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { LifeBuoy, RotateCw } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { describeError } from '@/lib/api/client'

/**
 * Route-level error boundary.
 *
 * Must be a client component. The message shown first is the translated one;
 * the raw error is one disclosure away because a render crash is nearly always
 * a shape mismatch with the upstream, and the stack is the only thing that says
 * which field.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const described = describeError(error)

  React.useEffect(() => {
    // Surface it in the console too; a swallowed render error is undebuggable.
    console.error('[route-error]', error)
  }, [error])

  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="surface flex w-full max-w-lg flex-col items-center gap-3 rounded-lg p-8 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
          <LifeBuoy className="size-5" aria-hidden />
        </span>
        <h1 className="text-base font-semibold tracking-tight">{t('ui.serverErrorTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('ui.serverErrorBody')}</p>

        <div className="mt-1 flex gap-2">
          <Button size="sm" onClick={reset}>
            <RotateCw className="size-3.5" aria-hidden />
            {tc('actions.retry')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
            {t('ui.notFoundAction')}
          </Button>
        </div>

        <Collapsible open={open} onOpenChange={setOpen} className="mt-3 w-full">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="w-full justify-center text-muted-foreground">
              {open ? t('ui.hideDetails') : t('ui.details')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 text-left">
            <pre className="font-data max-h-56 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {described.message}
              {error.digest ? `\ndigest: ${error.digest}` : ''}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
