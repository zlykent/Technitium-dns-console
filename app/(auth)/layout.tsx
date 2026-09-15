import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Globe, ShieldCheck } from 'lucide-react'
import { BrandMark } from '@/components/app/brand-mark'
import { LocaleToggle } from '@/components/layout/locale-toggle'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { resolveLocale } from '@/lib/i18n/request'

/**
 * Unauthenticated layout.
 *
 * A split screen: the left panel is pure atmosphere (a CSS-only resolver
 * visual, no image request, no JS), the right panel holds the form. On narrow
 * viewports the panel collapses to a slim header so the form keeps the screen —
 * signing in from a phone in a rack room is a real scenario. The locale and
 * theme switchers sit in the page's top-right corner, out of the form's way.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale()
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('login.title') }
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const tc = await getTranslations('common')
  const t = await getTranslations('auth')

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_minmax(24rem,30rem)]">
      {/* corner controls: reachable before signing in, never inside the form */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 sm:top-5 sm:right-6">
        <LocaleToggle />
        <ThemeToggle />
      </div>
      {/* atmosphere panel */}
      <aside className="border-border/60 bg-sidebar relative hidden overflow-hidden border-r lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* sonar ripples: expand outward from the centre, then vanish.
              Base opacity-0 keeps delayed ripples invisible; under reduced
              motion they freeze into static concentric rings instead. */}
          <div className="animate-ring-ripple border-primary/40 absolute top-0 left-4 size-[18rem] rounded-full border opacity-0 motion-reduce:scale-100 motion-reduce:animate-none motion-reduce:opacity-25" />
          <div className="animate-ring-ripple border-primary/40 absolute top-0 left-4 size-[18rem] rounded-full border opacity-0 [animation-delay:1.2s] motion-reduce:scale-125 motion-reduce:animate-none motion-reduce:opacity-20" />
          <div className="animate-ring-ripple border-primary/40 absolute top-0 left-4 size-[18rem] rounded-full border opacity-0 [animation-delay:2.4s] motion-reduce:scale-150 motion-reduce:animate-none motion-reduce:opacity-15" />
          <div className="animate-ring-ripple border-primary/40 absolute top-0 left-4 size-[18rem] rounded-full border opacity-0 [animation-delay:3.6s] motion-reduce:scale-175 motion-reduce:animate-none motion-reduce:opacity-10" />
          <div className="animate-ring-ripple border-primary/40 absolute top-0 left-4 size-[18rem] rounded-full border opacity-0 [animation-delay:4.8s] motion-reduce:scale-200 motion-reduce:animate-none motion-reduce:opacity-5" />
          <div className="animate-glow-drift bg-primary/10 absolute top-10 left-16 size-24 rounded-full blur-2xl" />
          {/* signature azure -> cyan wash */}
          <div className="from-primary/12 absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t via-transparent to-transparent" />
          <div className="bg-info/10 absolute right-0 bottom-0 size-96 translate-x-1/3 translate-y-1/3 rounded-full blur-3xl" />
        </div>

        <div className="relative flex items-center gap-2.5 p-8">
          <span className="bg-primary/15 text-primary grid size-9 place-items-center rounded-lg">
            <BrandMark className="size-5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">{tc('appName')}</span>
        </div>

        <div className="relative max-w-md px-8 pb-6">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            {t('login.heroTitle')}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed text-pretty">
            {t('login.heroBody')}
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {[
              { icon: ShieldCheck, text: t('login.heroPoint1') },
              { icon: Globe, text: t('login.heroPoint2') },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="text-muted-foreground flex items-start gap-2.5 text-xs">
                <Icon className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground/60 relative px-8 pb-8 font-mono text-[11px]">
          {tc('appTagline')}
        </p>
      </aside>

      {/* form panel */}
      <main className="flex min-w-0 flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="bg-primary/15 text-primary grid size-8 place-items-center rounded-md">
              <BrandMark className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">{tc('appName')}</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
