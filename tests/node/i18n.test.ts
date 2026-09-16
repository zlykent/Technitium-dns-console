/**
 * Locale configuration and message loading.
 *
 * Two things make these few functions worth testing hard. First, locale
 * negotiation runs on a visitor's very first request, before any cookie exists,
 * and its input is an `Accept-Language` header — attacker- and browser-shaped
 * string garbage that must never throw inside middleware. Second, the message
 * bundle is the contract between every `useTranslations` call site and the JSON
 * on disk: a namespace that silently fails to load, or a key that exists only in
 * Chinese, surfaces to the user as a raw `MISSING_MESSAGE` string in production
 * rather than as a test failure.
 *
 * Division of labour with `scripts/check-i18n.mjs`: that script is the build
 * gate and does the deep work — per-file key trees, ICU placeholder parity, and
 * detecting untranslated CJK leftovers in the English bundle. This suite does
 * not reimplement it. It asserts the *runtime* surface (what `loadMessages`
 * actually hands next-intl) and the invariant the script cannot see, namely that
 * the namespaces declared in code match the files on disk and the keys the nav
 * model looks up.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALE_COOKIE, LOCALE_LABELS, defaultLocale, isLocale, localeFromLanguageTags, locales, negotiateLocale } from '@/lib/i18n/config'
import { MESSAGE_NAMESPACES, loadMessages } from '@/lib/i18n/messages'
import { ALL_NAV_ITEMS, NAV_SECTIONS, VISIBLE_NAV_ITEMS } from '@/lib/nav'

const MESSAGES_DIR = path.resolve(process.cwd(), 'messages')

/** Namespace key in code -> filename on disk (`dnsClient` -> `dns-client`). */
function namespaceFile(namespace: string): string {
  return `${namespace.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.json`
}

/** Every leaf path of a message tree, `namespace` prefix included. */
function leafPaths(value: unknown, prefix: string, out: string[]): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leafPaths(child, prefix === '' ? key : `${prefix}.${key}`, out)
    }
    return out
  }
  out.push(prefix)
  return out
}

/** Read one nested key out of a bundle, or undefined if any hop is missing. */
function pick(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[part]
  }, bundle)
}

const EXPECTED_NAMESPACES = [
  'common',
  'nav',
  'auth',
  'errors',
  'dashboard',
  'zones',
  'records',
  'dnssec',
  'filtering',
  'logs',
  'dhcp',
  'apps',
  'dnsClient',
  'settings',
  'admin',
  'account',
]

describe('locale config', () => {
  it('ships exactly Chinese and English, defaulting to Chinese', () => {
    expect([...locales]).toEqual(['zh', 'en'])
    expect(defaultLocale).toBe('zh')
    expect([...locales]).toContain(defaultLocale)
  })

  it('names the preference cookie the client switcher writes', () => {
    expect(LOCALE_COOKIE).toBe('tdns_locale')
  })

  it('labels both locales in their own script and in English', () => {
    expect(Object.keys(LOCALE_LABELS).sort()).toEqual([...locales].sort())
    expect(LOCALE_LABELS.zh).toEqual({ native: '简体中文', english: 'Simplified Chinese', flag: '🇨🇳' })
    expect(LOCALE_LABELS.en).toEqual({ native: 'English', english: 'English', flag: '🇬🇧' })
  })

  it('gives every locale a non-empty, distinct label set', () => {
    const natives = new Set<string>()
    for (const locale of locales) {
      const label = LOCALE_LABELS[locale]
      for (const field of ['native', 'english', 'flag'] as const) {
        expect(typeof label[field], `${locale}.${field}`).toBe('string')
        expect(label[field].length, `${locale}.${field} is empty`).toBeGreaterThan(0)
      }
      natives.add(label.native)
    }
    expect(natives.size, 'the switcher would show two identical entries').toBe(locales.length)
  })
})

describe('isLocale', () => {
  it.each(['zh', 'en'])('accepts the shipped locale %s', (value) => {
    expect(isLocale(value)).toBe(true)
  })

  it.each(['ZH', 'Zh', 'EN', 'en-US', 'zh-CN', 'zh-Hant', 'fr', 'de', '', ' ', 'zh,en'])(
    'rejects %j, which is not one of the two shipped codes',
    (value) => {
      expect(isLocale(value)).toBe(false)
    },
  )

  it.each([null, undefined])('rejects the absent value %s', (value) => {
    expect(isLocale(value)).toBe(false)
  })

  it('narrows the type only for real locales', () => {
    const input: string = 'zh'
    if (isLocale(input)) {
      const narrowed: (typeof locales)[number] = input
      expect(narrowed).toBe('zh')
    } else {
      throw new Error('isLocale rejected a valid locale')
    }
  })
})

describe('negotiateLocale', () => {
  it.each([null, undefined, ''])('falls back to the default for an absent header (%p)', (header) => {
    expect(negotiateLocale(header)).toBe(defaultLocale)
  })

  it('reads a plain tag', () => {
    expect(negotiateLocale('zh')).toBe('zh')
    expect(negotiateLocale('en')).toBe('en')
  })

  it('reads a region-qualified tag by its language subtag', () => {
    expect(negotiateLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh')
    expect(negotiateLocale('en-US,en;q=0.9')).toBe('en')
    expect(negotiateLocale('zh-Hant-TW')).toBe('zh')
    expect(negotiateLocale('en-GB')).toBe('en')
  })

  it('honours q weights over document order', () => {
    expect(negotiateLocale('en;q=0.5,zh;q=0.9')).toBe('zh')
    expect(negotiateLocale('zh;q=0.2,en;q=0.8')).toBe('en')
  })

  it('breaks a tie by taking the first listed tag', () => {
    expect(negotiateLocale('en;q=0.9,zh;q=0.9')).toBe('en')
    expect(negotiateLocale('zh;q=0.9,en;q=0.9')).toBe('zh')
  })

  it('treats an explicit q=0 as "not acceptable" and falls back to the default', () => {
    expect(negotiateLocale('en;q=0')).toBe(defaultLocale)
    expect(negotiateLocale('*;q=0')).toBe(defaultLocale)
    expect(negotiateLocale('zh;q=0,en;q=0')).toBe(defaultLocale)
  })

  it('falls back to the default for a language we do not ship', () => {
    expect(negotiateLocale('fr-FR,fr;q=0.9')).toBe(defaultLocale)
    expect(negotiateLocale('de-DE,de;q=0.9,ja;q=0.8')).toBe(defaultLocale)
    expect(negotiateLocale('*')).toBe(defaultLocale)
  })

  it('is case insensitive about the tag itself', () => {
    expect(negotiateLocale('EN-us')).toBe('en')
    expect(negotiateLocale('ZH')).toBe('zh')
  })

  it('ignores a malformed q parameter and scores the tag as 1', () => {
    expect(negotiateLocale('en;q=abc')).toBe('en')
    expect(negotiateLocale('en;q=,zh;q=0.5')).toBe('en')
  })

  it.each([';;;', 'zh,,en', 'q=0.9', ',,,', 'zh;', '  ', 'zh;q=0.9;;en', 'en;q=0.5.5'])(
    'survives the malformed header %j without throwing',
    (header) => {
      expect(locales).toContain(negotiateLocale(header))
    },
  )

  it('never returns anything outside the shipped set, whatever it is fed', () => {
    const fuzz = ['', ',', ';', 'q=', 'zh;q', '\u0000', 'a'.repeat(500), 'zh;q=1e999', 'en;q=-1']
    for (const header of fuzz) {
      const result = negotiateLocale(header)
      expect(locales, `negotiateLocale(${JSON.stringify(header)}) -> ${result}`).toContain(result)
    }
  })
})

describe('localeFromLanguageTags', () => {
  // The client-side sibling of negotiateLocale: input is navigator.languages, an
  // already-ordered preference list with no q-values, and the contract is to
  // return null (not a forced default) when the system speaks nothing we ship.
  it('returns null for an absent or empty tag list', () => {
    expect(localeFromLanguageTags(null)).toBeNull()
    expect(localeFromLanguageTags(undefined)).toBeNull()
    expect(localeFromLanguageTags([])).toBeNull()
  })

  it('reads the first tag that maps to a shipped locale', () => {
    expect(localeFromLanguageTags(['en-US', 'en'])).toBe('en')
    expect(localeFromLanguageTags(['zh-CN', 'zh', 'en-US'])).toBe('zh')
  })

  it('matches a region-qualified tag by its language subtag', () => {
    expect(localeFromLanguageTags(['zh-Hant-TW'])).toBe('zh')
    expect(localeFromLanguageTags(['en-GB'])).toBe('en')
  })

  it('skips languages we do not ship and keeps scanning in preference order', () => {
    expect(localeFromLanguageTags(['fr-FR', 'de', 'en-US'])).toBe('en')
  })

  it('returns null when no shipped language appears at all', () => {
    expect(localeFromLanguageTags(['fr-FR', 'de-DE', 'ja'])).toBeNull()
  })

  it('is case insensitive and tolerates whitespace and empty entries', () => {
    expect(localeFromLanguageTags(['  EN-us '])).toBe('en')
    expect(localeFromLanguageTags(['', '  ', 'ZH'])).toBe('zh')
  })
})

describe('MESSAGE_NAMESPACES', () => {
  it('lists the sixteen feature namespaces in declaration order', () => {
    expect([...MESSAGE_NAMESPACES]).toEqual(EXPECTED_NAMESPACES)
  })

  it('holds no duplicates', () => {
    expect(new Set(MESSAGE_NAMESPACES).size).toBe(MESSAGE_NAMESPACES.length)
  })

  it('has a JSON file behind every declared namespace, in both locales', () => {
    for (const namespace of MESSAGE_NAMESPACES) {
      for (const locale of locales) {
        const file = path.join(MESSAGES_DIR, locale, namespaceFile(namespace))
        expect(fs.existsSync(file), `missing ${locale}/${namespaceFile(namespace)}`).toBe(true)
      }
    }
  })

  it('declares every JSON file on disk, so none is dead weight', () => {
    const declared = new Set(MESSAGE_NAMESPACES.map(namespaceFile))
    for (const locale of locales) {
      const onDisk = fs
        .readdirSync(path.join(MESSAGES_DIR, locale))
        .filter((file) => file.endsWith('.json'))
        .sort()
      expect(onDisk, `${locale}/ has files no namespace imports`).toEqual([...declared].sort())
    }
  })
})

describe('loadMessages', () => {
  it('returns a bundle carrying all sixteen namespaces for each locale', () => {
    for (const locale of locales) {
      const bundle = loadMessages(locale)
      expect(Object.keys(bundle).sort()).toEqual([...EXPECTED_NAMESPACES].sort())
      for (const namespace of EXPECTED_NAMESPACES) {
        expect(bundle[namespace], `${locale}:${namespace} is not loaded`).not.toBeUndefined()
        expect(typeof bundle[namespace], `${locale}:${namespace} is not an object`).toBe('object')
      }
    }
  })

  it('returns a different tree per locale', () => {
    expect(loadMessages('zh')).not.toBe(loadMessages('en'))
    expect(pick(loadMessages('zh'), 'common.actions.confirm')).toBe('确认')
    expect(pick(loadMessages('en'), 'common.actions.confirm')).toBe('Confirm')
  })

  it('hands back the same object on repeat calls, so callers can compare by identity', () => {
    expect(loadMessages('zh')).toBe(loadMessages('zh'))
    expect(loadMessages('en')).toBe(loadMessages('en'))
  })

  it('falls back to the Chinese bundle for a locale it was never given', () => {
    // Defensive: the type forbids this, but a stale cookie or a hand-written
    // `searchParams.get('lang')` can still reach the function at runtime.
    expect(loadMessages('fr' as never)).toBe(loadMessages('zh'))
    expect(loadMessages(undefined as never)).toBe(loadMessages('zh'))
    expect(loadMessages('' as never)).toBe(loadMessages('zh'))
  })

  it('holds only string leaves, which is what next-intl expects', () => {
    for (const locale of locales) {
      for (const namespace of MESSAGE_NAMESPACES) {
        const paths = leafPaths(loadMessages(locale)[namespace], '', [])
        expect(paths.length, `${locale}:${namespace} is empty`).toBeGreaterThan(0)
        for (const leaf of paths) {
          const value = pick(loadMessages(locale)[namespace] as Record<string, unknown>, leaf)
          expect(typeof value, `${locale}:${namespace}.${leaf}`).toBe('string')
        }
      }
    }
  })
})

describe('key tree parity between locales', () => {
  it('exposes the same set of leaf paths in Chinese and in English', () => {
    const zh = leafPaths(loadMessages('zh'), '', []).sort()
    const en = leafPaths(loadMessages('en'), '', []).sort()
    const enSet = new Set(en)
    const zhSet = new Set(zh)

    const missingFromEn = zh.filter((key) => !enSet.has(key))
    const missingFromZh = en.filter((key) => !zhSet.has(key))

    // Reported as explicit paths rather than a giant toEqual diff. The script
    // `scripts/check-i18n.mjs` does the same check per file and is the build
    // gate; this assertion protects the *assembled* bundle the app really uses.
    expect(missingFromEn, `en is missing ${missingFromEn.length} key(s): ${missingFromEn.slice(0, 25).join(', ')}`).toEqual(
      [],
    )
    expect(missingFromZh, `zh is missing ${missingFromZh.length} key(s): ${missingFromZh.slice(0, 25).join(', ')}`).toEqual(
      [],
    )
    expect(zh.length).toBe(en.length)
    expect(zh.length).toBeGreaterThan(1000)
  })

  it('has no namespace whose two versions drifted apart', () => {
    for (const namespace of MESSAGE_NAMESPACES) {
      const zh = leafPaths(loadMessages('zh')[namespace], '', []).sort()
      const en = leafPaths(loadMessages('en')[namespace], '', []).sort()
      expect(zh, `${namespace} key trees differ between locales`).toEqual(en)
    }
  })
})

describe('keys the app actually looks up', () => {
  const SPOT_CHECKS: Array<[namespace: string, key: string]> = [
    ['common', 'actions.confirm'],
    ['common', 'actions.cancel'],
    ['common', 'actions.retry'],
    ['common', 'actions.details'],
    ['common', 'a11y.loading'],
    ['common', 'a11y.skipToContent'],
    ['auth', 'login.title'],
    ['auth', 'permission.title'],
    ['auth', 'permission.backToDashboard'],
    ['auth', 'connectionFailed.backToLogin'],
    ['nav', 'items.zones.label'],
    ['errors', 'codes.invalid_token.title'],
  ]

  it.each(SPOT_CHECKS)('%s:%s is a non-empty string in both locales', (namespace, key) => {
    for (const locale of locales) {
      const value = pick(loadMessages(locale)[namespace] as Record<string, unknown>, key)
      expect(typeof value, `${locale}:${namespace}.${key}`).toBe('string')
      expect((value as string).trim().length, `${locale}:${namespace}.${key} is blank`).toBeGreaterThan(0)
    }
  })

  it('labels every section the sidebar renders', () => {
    for (const locale of locales) {
      const nav = loadMessages(locale).nav as Record<string, unknown>
      for (const section of NAV_SECTIONS) {
        const label = pick(nav, `sections.${section.key}`)
        expect(typeof label, `${locale}:nav.sections.${section.key}`).toBe('string')
        expect((label as string).trim().length, `${locale}:nav.sections.${section.key}`).toBeGreaterThan(0)
      }
    }
  })

  it('labels every item the sidebar can show', () => {
    for (const locale of locales) {
      const nav = loadMessages(locale).nav as Record<string, unknown>
      for (const item of VISIBLE_NAV_ITEMS) {
        const label = pick(nav, `items.${item.key}.label`)
        expect(typeof label, `${locale}:nav.items.${item.key}.label`).toBe('string')
        expect((label as string).trim().length, `${locale}:nav.items.${item.key}.label`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps nav.items keys for sub-pages only, not for routes that no longer exist', () => {
    const used = new Set(ALL_NAV_ITEMS.map((item) => item.key))
    for (const locale of locales) {
      const items = (loadMessages(locale).nav as Record<string, Record<string, unknown>>).items
      // Sub-pages (users, groups, cluster, …) reuse the `nav.items` namespace for
      // breadcrumbs and tab labels, so these extra keys are deliberate. Pinning
      // the exact set means renaming a nav item leaves an orphan behind instead
      // of silently resurrecting the old label.
      expect(Object.keys(items).filter((key) => !used.has(key)).sort()).toEqual([
        'about',
        'cluster',
        'groups',
        'permissions',
        'profile',
        'security2fa',
        'sessions',
        'sso',
        'tokens',
        'users',
      ])
    }
  })

  it('gives the hidden account route a nav label anyway', () => {
    // `hidden` only keeps the item out of the sidebar; the topbar still resolves
    // `nav:items.<key>.label` from `activeNavItem(pathname)`, so a hidden route
    // without a label renders MISSING_MESSAGE as the page title. This is the
    // regression guard for exactly that: /account once showed the raw key.
    expect(ALL_NAV_ITEMS.some((item) => item.key === 'account')).toBe(true)
    for (const locale of locales) {
      expect(pick(loadMessages(locale).nav as Record<string, unknown>, 'items.account.label')).toBeTruthy()
    }
  })
})
