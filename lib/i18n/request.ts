import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { defaultLocale, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from './config'
import { loadMessages } from './messages'

/**
 * Locale resolution for a prefix-less next-intl setup.
 *
 * There is no `/en/...` segment to read, so the cookie is the source of truth;
 * `Accept-Language` only breaks the tie on a first visit. `resolveLocale` is
 * exported separately because server components outside next-intl's provider
 * (route handlers, metadata) also need it.
 */
export async function resolveLocale(): Promise<Locale> {
  try {
    const store = await cookies()
    const fromCookie = store.get(LOCALE_COOKIE)?.value
    if (isLocale(fromCookie)) return fromCookie
  } catch {
    // outside a request scope (build-time prerender, unit tests)
    return defaultLocale
  }

  try {
    const headerStore = await headers()
    return negotiateLocale(headerStore.get('accept-language'))
  } catch {
    return defaultLocale
  }
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale()
  return {
    locale,
    messages: await loadMessages(locale),
  }
})
