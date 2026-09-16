export const locales = ['zh', 'en'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'zh'

/** Language preference cookie — non-httpOnly so the client switcher can write it. */
export const LOCALE_COOKIE = 'tdns_locale'

/** One year in seconds — how long a language preference persists. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const LOCALE_LABELS: Record<Locale, { native: string; english: string; flag: string }> = {
  zh: { native: '简体中文', english: 'Simplified Chinese', flag: '🇨🇳' },
  en: { native: 'English', english: 'English', flag: '🇬🇧' },
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (locales as readonly string[]).includes(value)
}

/**
 * Accept-Language negotiation, used on the very first visit before any cookie
 * exists. Only distinguishes Chinese from everything else, matching the two
 * locales we ship.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return defaultLocale
  let best: Locale = defaultLocale
  let bestQ = -1
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    let q = 1
    for (const p of params) {
      const m = p.trim().match(/^q=([0-9.]+)$/)
      if (m) q = Number.parseFloat(m[1])
    }
    const lang = tag.trim().toLowerCase()
    const locale: Locale | undefined = lang.startsWith('zh') ? 'zh' : lang.startsWith('en') ? 'en' : undefined
    if (locale && q > bestQ) {
      best = locale
      bestQ = q
    }
  }
  return bestQ > 0 ? best : defaultLocale
}

/**
 * Map an ordered list of BCP-47 language tags — exactly what the browser exposes
 * as `navigator.languages` — to the first locale we ship.
 *
 * This is the client-side sibling of `negotiateLocale`, and two differences
 * matter: the array carries no `q` values (its order *is* the preference order),
 * and it returns `null` when nothing matches instead of falling back to a
 * default. That `null` lets first-visit detection leave the server-resolved
 * locale untouched when the visitor's system speaks a language we do not ship,
 * rather than forcing one on them.
 */
export function localeFromLanguageTags(tags: readonly string[] | null | undefined): Locale | null {
  if (!tags) return null
  for (const tag of tags) {
    const lang = tag?.trim().toLowerCase()
    if (!lang) continue
    if (lang.startsWith('zh')) return 'zh'
    if (lang.startsWith('en')) return 'en'
  }
  return null
}

/** True once a locale preference cookie exists — a manual switch or a prior detect. */
export function hasLocaleCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`))
}

/**
 * Persist a language preference so the next request resolves it on the server
 * without re-detecting. Mirrors the cookie the switcher writes; a no-op during
 * SSR/prerender where `document` is absent.
 */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`
}
