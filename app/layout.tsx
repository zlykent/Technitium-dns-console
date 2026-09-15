import type { Metadata, Viewport } from 'next'
import { getTranslations } from 'next-intl/server'
import './globals.css'
import { Providers } from './providers'
import { resolveLocale } from '@/lib/i18n/request'

/**
 * Root layout.
 *
 * The locale is resolved here (cookie first, `Accept-Language` as the tie-break)
 * and written onto `<html lang>` so screen readers and hyphenation behave. There
 * is no path prefix — the language switcher rewrites the cookie and refreshes the
 * router, which keeps every URL stable and shareable.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale()
  const t = await getTranslations({ locale, namespace: 'common' })
  return {
    title: {
      default: t('appName'),
      template: `%s · ${t('appName')}`,
    },
    description: t('appTagline'),
    applicationName: t('appName'),
    robots: { index: false, follow: false },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // An ops console is used on desktops and on a phone in a rack room; let the
  // user zoom, but start at a density that fits a data table.
  minimumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale()
  const defaultTarget = process.env.TECHNITIUM_API_URL?.trim() || null

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <Providers defaultTarget={defaultTarget}>{children}</Providers>
      </body>
    </html>
  )
}
