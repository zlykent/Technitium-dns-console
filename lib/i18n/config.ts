export const locales = ['zh', 'en'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'zh'

/** Language preference cookie — non-httpOnly so the client switcher can write it. */
export const LOCALE_COOKIE = 'tdns_locale'

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
