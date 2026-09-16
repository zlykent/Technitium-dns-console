'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { hasLocaleCookie, localeFromLanguageTags, writeLocaleCookie } from '@/lib/i18n/config'

/**
 * First-visit system-language detection.
 *
 * The server already negotiates a locale from `Accept-Language`
 * (`lib/i18n/request.ts`), but this console is routinely reached through a
 * reverse proxy that can strip or normalise that header — and then the server
 * silently falls back to Chinese while an English-system operator stares at a UI
 * they cannot read. The browser always knows the real system language through
 * `navigator.languages`, so we use it as a client-side safety net.
 *
 * The rules keep this from ever surprising anyone:
 *  - It runs only when no preference cookie exists. A cookie written by the
 *    manual switcher (or by an earlier detect) always wins, so an explicit
 *    choice is never overridden.
 *  - If the system speaks a language we do not ship, detection returns nothing
 *    and the server-resolved locale stands — we do not force a language.
 *  - When the detected language matches what the server rendered (the common
 *    case: `Accept-Language` arrived fine) we only persist the cookie, so there
 *    is no refresh and no flash. Only a genuine disagreement — the stripped-header
 *    case — triggers `router.refresh()` to re-render in the right language once.
 *
 * Side-effect only; renders nothing. Mounted in the root layout inside
 * `NextIntlClientProvider` so `useLocale()` reports the server-rendered locale.
 */
export function LocaleDetect() {
  const router = useRouter()
  // The locale the server rendered with, inherited through NextIntlClientProvider.
  const serverLocale = useLocale()

  React.useEffect(() => {
    // An existing cookie is an explicit preference — never override it.
    if (hasLocaleCookie()) return

    const tags = typeof navigator === 'undefined' ? null : (navigator.languages ?? [navigator.language])
    const detected = localeFromLanguageTags(tags)
    // The system speaks something we do not ship; keep the server default.
    if (!detected) return

    // Remember it so the next request resolves on the server without re-detecting.
    writeLocaleCookie(detected)

    if (detected !== serverLocale) {
      // The server could not detect the language and rendered the fallback. Update
      // `<html lang>` eagerly for screen readers, then re-run the server components
      // so the visible UI switches to the detected language.
      document.documentElement.lang = detected
      router.refresh()
    }
    // `serverLocale` is the only reactive input; `router` is stable across renders.
  }, [serverLocale, router])

  return null
}
