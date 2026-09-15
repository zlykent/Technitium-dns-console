'use client'

import { useLocale } from 'next-intl'
import { defaultLocale, isLocale, type Locale } from './config'

/**
 * `useLocale()` is typed `string` because next-intl cannot know our locale
 * union, but every formatter in `lib/format` takes a `Locale`. Narrowing once
 * here keeps eleven pages from repeating the same cast — and from casting to a
 * locale we do not actually ship.
 */
export function useLocaleCode(): Locale {
  const locale = useLocale()
  return isLocale(locale) ? locale : defaultLocale
}
