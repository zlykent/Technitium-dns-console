'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Check, Languages } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LOCALE_COOKIE, LOCALE_LABELS, locales, type Locale } from '@/lib/i18n/config'

/**
 * Language switcher for a prefix-less next-intl setup.
 *
 * There is no `/en/...` URL to navigate to, so switching means rewriting the
 * locale cookie and asking the router to re-run the server components — which
 * re-read that cookie in `getRequestConfig`. The cookie is deliberately not
 * httpOnly: it holds a language preference, and being able to write it here
 * saves a round trip.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function LocaleToggle() {
  const t = useTranslations('common')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [pending, setPending] = React.useState<Locale | null>(null)

  const select = React.useCallback(
    (next: Locale) => {
      if (next === locale) return
      setPending(next)
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`
      // `document.documentElement.lang` is updated eagerly so screen readers do
      // not announce the new content in the old language while the RSC payload
      // is in flight.
      document.documentElement.lang = next
      router.refresh()
      setPending(null)
    },
    [locale, router],
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('language.label')}
          title={t('language.label')}
          data-pending={pending ?? undefined}
        >
          <Languages className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => select(code)}
            disabled={pending !== null}
            aria-checked={code === locale}
            role="menuitemradio"
          >
            <span className="flex-1">{LOCALE_LABELS[code].native}</span>
            <span className="text-xs text-muted-foreground">{LOCALE_LABELS[code].english}</span>
            {code === locale && <Check className="size-4 text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
