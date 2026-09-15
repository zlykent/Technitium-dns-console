import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Compass } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button-variants'

/**
 * 404. Rendered outside the console layout, so it must stand alone.
 *
 * Deliberately a Server Component: a 404 needs no interactivity, and shipping
 * zero JS for it is the difference between an instant page and a blank shell.
 * That is also why the class variants come from `button-variants` rather than
 * `button` — calling an export of a `'use client'` module from the server is a
 * build error, not a runtime one.
 */
export default async function NotFound() {
  const t = await getTranslations('errors')
  const tc = await getTranslations('common')

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="surface flex max-w-md flex-col items-center gap-3 rounded-lg p-10 text-center">
        <span className="grid size-12 place-items-center rounded-full border border-border/60 bg-muted/50 text-muted-foreground">
          <Compass className="size-5" aria-hidden />
        </span>
        <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">404</p>
        <h1 className="text-lg font-semibold tracking-tight">{t('ui.notFoundTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('ui.notFoundBody')}</p>
        <Link href="/dashboard" className={`${buttonVariants({ size: 'sm' })} mt-2`}>
          {t('ui.notFoundAction')}
        </Link>
        <Link href="/account" className={`${buttonVariants({ variant: 'ghost', size: 'sm' })}`}>
          {tc('actions.back')}
        </Link>
      </div>
    </div>
  )
}
