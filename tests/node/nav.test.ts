/**
 * Navigation model and route-guard table.
 *
 * `lib/nav.ts` is the single source of truth for three separate decisions that
 * must never disagree: what the sidebar renders, which routes the shell blocks,
 * and where a freshly authenticated user lands. Because all three read the same
 * array, a mistake in that array is invisible in isolation and only shows up as
 * a menu entry that 403s on click, or a login that lands on a page the user may
 * not open.
 *
 * The last block is a filesystem contract: every real page under `app/(console)`
 * has to be reachable through the nav table (so it inherits a permission gate),
 * and every nav href has to resolve to a real page (so the sidebar never links
 * to a 404). That catches the common failure of adding a page and forgetting the
 * nav entry — which silently ships an unguarded route.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_NAV_ITEMS,
  NAV_SECTIONS,
  PUBLIC_ROUTES,
  VISIBLE_NAV_ITEMS,
  activeNavItem,
  isAllowed,
  isPublicRoute,
  landingRoute,
  requiredSectionFor,
  visibleSections,
  type NavItem,
} from '@/lib/nav'
import { emptyPermissionMap, type PermissionMap, type PermissionSection } from '@/lib/api/types/common'
import { locales } from '@/lib/i18n/config'
import { loadMessages } from '@/lib/i18n/messages'

/** Grant every flag on the listed sections, nothing anywhere else. */
function grantAll(...sections: PermissionSection[]): PermissionMap {
  const map = emptyPermissionMap()
  for (const section of sections) map[section] = { canView: true, canModify: true, canDelete: true }
  return map
}

/** Grant `canView` only — the flag pages actually require. */
function grantView(...sections: PermissionSection[]): PermissionMap {
  const map = emptyPermissionMap()
  for (const section of sections) map[section] = { canView: true, canModify: false, canDelete: false }
  return map
}

const EVERY_SECTION: PermissionSection[] = [
  'Administration',
  'Allowed',
  'Apps',
  'Blocked',
  'Cache',
  'Dashboard',
  'DhcpServer',
  'DnsClient',
  'Logs',
  'Settings',
  'Zones',
]

const FULL = grantAll(...EVERY_SECTION)
const NONE = emptyPermissionMap()

/** The whole table, pinned. Editing it here is the review checkpoint. */
const EXPECTED_ITEMS: Array<{ href: string; key: string; section: PermissionSection; hidden: boolean }> = [
  { href: '/dashboard', key: 'dashboard', section: 'Dashboard', hidden: false },
  { href: '/zones', key: 'zones', section: 'Zones', hidden: false },
  { href: '/resolve', key: 'dnsClient', section: 'DnsClient', hidden: false },
  { href: '/cache', key: 'cache', section: 'Cache', hidden: false },
  { href: '/allowed', key: 'allowed', section: 'Allowed', hidden: false },
  { href: '/blocked', key: 'blocked', section: 'Blocked', hidden: false },
  { href: '/logs', key: 'logs', section: 'Logs', hidden: false },
  { href: '/system-logs', key: 'systemLogs', section: 'Logs', hidden: false },
  { href: '/dhcp', key: 'dhcp', section: 'DhcpServer', hidden: false },
  { href: '/apps', key: 'apps', section: 'Apps', hidden: false },
  { href: '/settings', key: 'settings', section: 'Settings', hidden: false },
  { href: '/admin', key: 'administration', section: 'Administration', hidden: false },
  { href: '/account', key: 'account', section: 'Dashboard', hidden: true },
]

function shape(item: NavItem): { href: string; key: string; section: PermissionSection; hidden: boolean } {
  return { href: item.href, key: item.key, section: item.section, hidden: item.hidden === true }
}

describe('NAV_SECTIONS', () => {
  it('holds the six sections in declaration order', () => {
    expect(NAV_SECTIONS.map((section) => section.key)).toEqual([
      'monitor',
      'dns',
      'security',
      'services',
      'manage',
      'account',
    ])
  })

  it('holds the thirteen routes it advertises, with the expected key and section', () => {
    expect(ALL_NAV_ITEMS.map(shape)).toEqual(EXPECTED_ITEMS)
  })

  it('gives every item a rooted href with no trailing slash and no query', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.href.startsWith('/'), `${item.key} href must be absolute`).toBe(true)
      expect(item.href.length, `${item.key} href must not be bare "/"`).toBeGreaterThan(1)
      expect(item.href.endsWith('/'), `${item.key} href must not end in a slash`).toBe(false)
      expect(item.href, `${item.key} href must carry no query`).not.toContain('?')
      expect(item.href, `${item.key} href must carry no fragment`).not.toContain('#')
    }
  })

  it('gives every item a unique key and a unique href', () => {
    const keys = ALL_NAV_ITEMS.map((item) => item.key)
    expect(new Set(keys).size, `duplicate nav keys: ${keys.join(', ')}`).toBe(keys.length)
    const hrefs = ALL_NAV_ITEMS.map((item) => item.href)
    expect(new Set(hrefs).size, `duplicate nav hrefs: ${hrefs.join(', ')}`).toBe(hrefs.length)
  })

  it('names a real permission section on every item', () => {
    const known = new Set<string>(EVERY_SECTION)
    for (const item of ALL_NAV_ITEMS) {
      expect(known.has(item.section), `${item.key} -> unknown section '${item.section}'`).toBe(true)
    }
  })

  it('requires canView on every page', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.flag, `${item.key} must gate on canView`).toBe('canView')
    }
  })

  it('attaches a renderable lucide icon to every item', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.icon, `${item.key} has no icon`).toBeDefined()
      expect(typeof item.icon.displayName, `${item.key} icon is not a lucide component`).toBe('string')
      expect((item.icon.displayName ?? '').length, `${item.key} icon has no displayName`).toBeGreaterThan(0)
    }
  })

  it('hides only the account entry', () => {
    expect(VISIBLE_NAV_ITEMS.map((item) => item.href)).toEqual(
      EXPECTED_ITEMS.filter((entry) => !entry.hidden).map((entry) => entry.href),
    )
    expect(VISIBLE_NAV_ITEMS).toHaveLength(12)
    expect(ALL_NAV_ITEMS).toHaveLength(13)
  })

  it('leaves no href a strict prefix of another, so prefix matching stays unambiguous', () => {
    for (const a of ALL_NAV_ITEMS) {
      for (const b of ALL_NAV_ITEMS) {
        if (a === b) continue
        expect(b.href.startsWith(`${a.href}/`), `${a.href} is a prefix of ${b.href}`).toBe(false)
      }
    }
  })
})

describe('PUBLIC_ROUTES', () => {
  it('contains only the login page', () => {
    expect([...PUBLIC_ROUTES]).toEqual(['/login'])
  })

  it('matches the login route and its children but nothing that merely starts with it', () => {
    expect(isPublicRoute('/login')).toBe(true)
    expect(isPublicRoute('/login/sso')).toBe(true)
    expect(isPublicRoute('/loginx')).toBe(false)
    expect(isPublicRoute('/')).toBe(false)
    expect(isPublicRoute('/dashboard')).toBe(false)
  })

  it('keeps every public route out of the guarded table', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(activeNavItem(route), `${route} must not be permission gated`).toBeNull()
      expect(requiredSectionFor(route), `${route} must not require a section`).toBeNull()
    }
  })
})

describe('isAllowed', () => {
  it('reads the flag the item names', () => {
    const zones = activeNavItem('/zones') as NavItem
    expect(isAllowed(zones, grantView('Zones'))).toBe(true)
    expect(isAllowed(zones, NONE)).toBe(false)
  })

  it('does not accept canModify or canDelete in place of canView', () => {
    const zones = activeNavItem('/zones') as NavItem
    const modifyOnly = emptyPermissionMap()
    modifyOnly.Zones = { canView: false, canModify: true, canDelete: true }
    expect(isAllowed(zones, modifyOnly)).toBe(false)
  })

  it('falls back to denied when the map omits the section entirely', () => {
    const partial = { Zones: { canView: true, canModify: true, canDelete: true } } as PermissionMap
    expect(isAllowed(activeNavItem('/zones') as NavItem, partial)).toBe(true)
    expect(isAllowed(activeNavItem('/admin') as NavItem, partial)).toBe(false)
  })

  it('ignores the hidden flag, which only controls the sidebar', () => {
    const account = activeNavItem('/account') as NavItem
    expect(account.hidden).toBe(true)
    expect(isAllowed(account, grantView('Dashboard'))).toBe(true)
    expect(isAllowed(account, NONE)).toBe(false)
  })
})

describe('visibleSections', () => {
  it('renders every section except the hidden-only one, at full permissions', () => {
    expect(visibleSections(FULL).map((section) => section.key)).toEqual([
      'monitor',
      'dns',
      'security',
      'services',
      'manage',
    ])
  })

  it('keeps the declared item order inside each section', () => {
    expect(visibleSections(FULL).map((section) => section.items.map((item) => item.key))).toEqual([
      ['dashboard'],
      ['zones', 'dnsClient', 'cache'],
      ['allowed', 'blocked', 'logs', 'systemLogs'],
      ['dhcp', 'apps'],
      ['settings', 'administration'],
    ])
  })

  it('returns nothing at all for an account with no view permission', () => {
    expect(visibleSections(NONE)).toEqual([])
  })

  it('keeps only the section holding the one permitted route', () => {
    expect(visibleSections(grantView('Zones')).map((section) => [section.key, section.items.map((i) => i.key)])).toEqual([
      ['dns', ['zones']],
    ])
  })

  it('drops a section once its last item becomes invisible', () => {
    // Logs governs both /logs and /system-logs, so the security section needs
    // one of them plus nothing else to survive with a single entry.
    const onlySystemLogs = visibleSections(grantView('Logs'))
    expect(onlySystemLogs).toHaveLength(1)
    expect(onlySystemLogs[0].key).toBe('security')
    expect(onlySystemLogs[0].items.map((item) => item.key)).toEqual(['logs', 'systemLogs'])

    const withoutLogs = visibleSections(grantAll('Allowed', 'Blocked'))
    expect(withoutLogs.map((section) => section.key)).toEqual(['security'])
    expect(withoutLogs[0].items.map((item) => item.key)).toEqual(['allowed', 'blocked'])
  })

  it('never surfaces the hidden account entry in the sidebar', () => {
    for (const section of visibleSections(FULL)) {
      expect(
        section.items.some((item) => item.hidden === true),
        `${section.key} leaked a hidden item`,
      ).toBe(false)
    }
  })

  it('does not mutate the shared NAV_SECTIONS array', () => {
    const before = JSON.stringify(NAV_SECTIONS.map((section) => section.items.map((i) => i.href)))
    visibleSections(grantView('Zones'))
    visibleSections(FULL)
    expect(JSON.stringify(NAV_SECTIONS.map((section) => section.items.map((i) => i.href)))).toBe(before)
    expect(NAV_SECTIONS[3].items).toHaveLength(2)
  })
})

describe('landingRoute', () => {
  it('sends a fully permitted user to the dashboard', () => {
    expect(landingRoute(FULL)).toBe('/dashboard')
  })

  it('sends a zones-only user to the zones list', () => {
    expect(landingRoute(grantView('Zones'))).toBe('/zones')
  })

  it('picks the first permitted route in declaration order, not alphabetically', () => {
    expect(landingRoute(grantView('Cache', 'Zones'))).toBe('/zones')
    expect(landingRoute(grantView('Cache'))).toBe('/cache')
    expect(landingRoute(grantView('Administration'))).toBe('/admin')
    expect(landingRoute(grantView('Logs'))).toBe('/logs')
  })

  it('always returns a string, falling back to the account page', () => {
    expect(landingRoute(NONE)).toBe('/account')
    expect(landingRoute({} as PermissionMap)).toBe('/account')
  })

  it('never returns a route the user is barred from, except in the fallback', () => {
    const probes: PermissionMap[] = [
      FULL,
      NONE,
      grantView('Zones'),
      grantView('Administration'),
      grantView('DhcpServer', 'Apps'),
    ]
    for (const map of probes) {
      const href = landingRoute(map)
      const item = activeNavItem(href) as NavItem
      if (href === '/account' && !isAllowed(item, map)) continue
      expect(isAllowed(item, map), `${href} is not permitted for this map`).toBe(true)
    }
  })

  it('falls back to a route that is itself gated, leaving a zero-permission account with no page', () => {
    // Pinned defect: `/account` needs `Dashboard.canView`, which by definition a
    // zero-permission account lacks. Both buttons on the PermissionDenied card
    // point back at `landingRoute()` and `/account`, so the user has nowhere to
    // go. The account page documents itself as ungated; the nav table disagrees.
    const fallback = landingRoute(NONE)
    expect(fallback).toBe('/account')
    expect(requiredSectionFor(fallback)).toBe('Dashboard')
    expect(isAllowed(activeNavItem(fallback) as NavItem, NONE)).toBe(false)
  })
})

describe('activeNavItem', () => {
  it('matches each of the thirteen hrefs exactly', () => {
    for (const entry of EXPECTED_ITEMS) {
      expect(activeNavItem(entry.href)?.href, entry.href).toBe(entry.href)
    }
  })

  it('matches a child path against its parent entry', () => {
    expect(activeNavItem('/zones/example.com')?.key).toBe('zones')
    expect(activeNavItem('/zones/example.com/records')?.key).toBe('zones')
    expect(activeNavItem('/admin/cluster')?.key).toBe('administration')
    expect(activeNavItem('/settings/general')?.key).toBe('settings')
  })

  it('picks the longest match when several entries could apply', () => {
    // /system-logs shares no prefix boundary with /logs, and no href is a strict
    // prefix of another, so the longest-match rule is what keeps the two apart.
    expect(activeNavItem('/system-logs')?.key).toBe('systemLogs')
    expect(activeNavItem('/system-logs/detail')?.key).toBe('systemLogs')
    expect(activeNavItem('/logs')?.key).toBe('logs')
    expect(activeNavItem('/logs/detail')?.key).toBe('logs')
  })

  it('returns the hidden account entry so the route stays guarded', () => {
    const item = activeNavItem('/account')
    expect(item?.key).toBe('account')
    expect(item?.hidden).toBe(true)
  })

  it('returns null for the root and for anything unlisted', () => {
    expect(activeNavItem('/')).toBeNull()
    expect(activeNavItem('/nope')).toBeNull()
    expect(activeNavItem('/login')).toBeNull()
    expect(activeNavItem('')).toBeNull()
  })

  it('requires a path boundary, so a sibling name does not match', () => {
    expect(activeNavItem('/logsx')).toBeNull()
    expect(activeNavItem('/zones-archived')).toBeNull()
    expect(activeNavItem('/dashboardy')).toBeNull()
  })

  it('is case sensitive, matching how the router compares paths', () => {
    expect(activeNavItem('/ZONES')).toBeNull()
    expect(activeNavItem('/Dashboard')).toBeNull()
  })

  it('tolerates a trailing slash', () => {
    expect(activeNavItem('/zones/')?.key).toBe('zones')
    expect(activeNavItem('/dashboard/')?.key).toBe('dashboard')
  })

  it('does not strip a query string or hash, which the router never hands it', () => {
    // `usePathname()` already excludes the search part; passing one in would miss.
    expect(activeNavItem('/zones?a=1')).toBeNull()
    expect(activeNavItem('/zones#records')).toBeNull()
  })
})

describe('requiredSectionFor', () => {
  const CASES: Array<[string, PermissionSection]> = [
    ['/dashboard', 'Dashboard'],
    ['/zones', 'Zones'],
    ['/resolve', 'DnsClient'],
    ['/cache', 'Cache'],
    ['/allowed', 'Allowed'],
    ['/blocked', 'Blocked'],
    ['/logs', 'Logs'],
    ['/system-logs', 'Logs'],
    ['/dhcp', 'DhcpServer'],
    ['/apps', 'Apps'],
    ['/settings', 'Settings'],
    ['/admin', 'Administration'],
    ['/account', 'Dashboard'],
  ]

  it.each(CASES)('maps %s to %s', (pathname, section) => {
    expect(requiredSectionFor(pathname)).toBe(section)
  })

  it('extends the requirement to child paths', () => {
    expect(requiredSectionFor('/zones/example.com/dnssec')).toBe('Zones')
    expect(requiredSectionFor('/zones/example.com/permissions')).toBe('Zones')
    expect(requiredSectionFor('/admin/users')).toBe('Administration')
    expect(requiredSectionFor('/system-logs/tail')).toBe('Logs')
  })

  it('returns null for public and unknown paths, leaving them ungated', () => {
    expect(requiredSectionFor('/login')).toBeNull()
    expect(requiredSectionFor('/')).toBeNull()
    expect(requiredSectionFor('/nope')).toBeNull()
  })

  it('names only sections that exist in the permission map', () => {
    const known = new Set<string>(EVERY_SECTION)
    const seen = new Set<string>()
    for (const pathname of CASES.map(([p]) => p)) {
      const section = requiredSectionFor(pathname)
      if (section === null) continue
      expect(known.has(section), `${pathname} -> '${section}'`).toBe(true)
      seen.add(section)
    }
    expect([...seen].sort()).toEqual([...EVERY_SECTION].sort())
  })
})

// --------------------------------------------------------------- app contract

const APP_DIR = path.resolve(process.cwd(), 'app')

interface DiscoveredRoute {
  /** URL the router exposes, route groups stripped, dynamic segments kept. */
  url: string
  /** Name of the enclosing route group, or '' at the app root. */
  group: string
  dynamic: boolean
}

function walkPages(dir: string, segments: string[], group: string): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')')
      found.push(
        ...walkPages(
          path.join(dir, entry.name),
          isGroup ? segments : [...segments, entry.name],
          isGroup ? entry.name.slice(1, -1) : group,
        ),
      )
      continue
    }
    if (entry.isFile() && entry.name === 'page.tsx') {
      found.push({
        url: segments.length === 0 ? '/' : `/${segments.join('/')}`,
        group,
        dynamic: segments.some((segment) => segment.startsWith('[')),
      })
    }
  }
  return found
}

/** Fill every `[param]` with a plausible value so prefix matching can run. */
function sample(url: string): string {
  return url.replace(/\[[^\]]+\]/g, 'example.com')
}

const ROUTES = walkPages(APP_DIR, [], '')
const CONSOLE = ROUTES.filter((route) => route.group === 'console')
const NAV_HREFS = ALL_NAV_ITEMS.map((item) => item.href)

describe('app router contract', () => {
  it('discovers the pages on disk, split across the three route groups', () => {
    expect(ROUTES).toHaveLength(19)
    expect(CONSOLE).toHaveLength(17)
    expect(CONSOLE.filter((route) => route.dynamic)).toHaveLength(4)
    expect(CONSOLE.filter((route) => !route.dynamic)).toHaveLength(NAV_HREFS.length)
  })

  it('has a page for every nav href', () => {
    for (const href of NAV_HREFS) {
      const page = path.join(APP_DIR, '(console)', ...href.slice(1).split('/'), 'page.tsx')
      expect(fs.existsSync(page), `no page.tsx behind nav href ${href}`).toBe(true)
    }
  })

  it('has a nav entry for every static console page', () => {
    const staticUrls = CONSOLE.filter((route) => !route.dynamic)
      .map((route) => route.url)
      .sort()
    expect(staticUrls).toEqual([...NAV_HREFS].sort())
  })

  it('guards every console page, dynamic ones included', () => {
    for (const route of CONSOLE) {
      const url = sample(route.url)
      const section = requiredSectionFor(url)
      expect(section, `${route.url} has no permission gate`).not.toBeNull()
      const matched = activeNavItem(url)
      expect(matched?.href, `${route.url} matches no nav entry`).not.toBeNull()
      expect(url.startsWith(`${matched?.href}/`) || url === matched?.href, `${route.url} escaped its own entry`).toBe(
        true,
      )
    }
  })

  it('routes dynamic zone pages through the zones entry, so they inherit its gate', () => {
    const zonePages = CONSOLE.filter((route) => route.url.startsWith('/zones/[')).map((route) => route.url).sort()
    expect(zonePages).toEqual([
      '/zones/[zone]',
      '/zones/[zone]/dnssec',
      '/zones/[zone]/options',
      '/zones/[zone]/permissions',
    ])
    for (const url of zonePages) {
      expect(requiredSectionFor(sample(url)), url).toBe('Zones')
      expect(activeNavItem(sample(url))?.key, url).toBe('zones')
    }
  })

  it('keeps the login page public and the root ungated', () => {
    const auth = ROUTES.filter((route) => route.group === 'auth').map((route) => route.url)
    expect(auth).toEqual([...PUBLIC_ROUTES])
    expect(ROUTES.some((route) => route.url === '/' && route.group === '')).toBe(true)
    expect(requiredSectionFor('/')).toBeNull()
  })

  it('declares no page outside the three known route groups', () => {
    const groups = [...new Set(ROUTES.map((route) => route.group))].sort()
    expect(groups).toEqual(['', 'auth', 'console'])
  })
})

describe('nav i18n contract', () => {
  /**
   * The nav table declares keys; the message bundles supply the words. Nothing
   * links them at compile time, so a key added to `lib/nav.ts` without a
   * matching entry under `nav.items` in both locale bundles renders as its own
   * dotted path in the UI. `/account` shipped exactly that — the top bar read
   * `nav.items.account.label` and printed it verbatim, because the entry is
   * `hidden` and so never appears in the sidebar where the gap would be obvious.
   *
   * Hidden items are therefore the *most* important ones to check here.
   */
  function resolve(bundle: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc === null || typeof acc !== 'object') return undefined
      return (acc as Record<string, unknown>)[key]
    }, bundle)
  }

  it.each(locales)('gives every nav item a real label and description in %s', (locale) => {
    const nav = loadMessages(locale).nav as Record<string, unknown>
    for (const item of ALL_NAV_ITEMS) {
      for (const field of ['label', 'description'] as const) {
        const path = `items.${item.key}.${field}`
        const value = resolve(nav, path)
        expect(typeof value, `nav:${path} is missing for locale '${locale}'`).toBe('string')
        expect((value as string).trim().length, `nav:${path} is blank`).toBeGreaterThan(0)
        // A leaked key path is what next-intl renders when the lookup fails.
        expect(value, `nav:${path} resolved to a key path`).not.toBe(path)
      }
    }
  })

  it.each(locales)('gives every nav section a real title in %s', (locale) => {
    const nav = loadMessages(locale).nav as Record<string, unknown>
    for (const section of NAV_SECTIONS) {
      const value = resolve(nav, `sections.${section.key}`)
      expect(typeof value, `nav:sections.${section.key} is missing for locale '${locale}'`).toBe('string')
      expect((value as string).trim().length, `nav:sections.${section.key} is blank`).toBeGreaterThan(0)
    }
  })

  it('has no message entry for a nav item that no longer exists', () => {
    // The mirror of the check above, scoped to the keys the nav table owns.
    // `nav.items` also carries labels for the admin/account tabs, which are not
    // nav entries, so only the section keys are compared here.
    const declared = new Set(NAV_SECTIONS.map((section) => section.key))
    for (const locale of locales) {
      const sections = (loadMessages(locale).nav as { sections: Record<string, unknown> }).sections
      for (const key of Object.keys(sections)) {
        expect(declared.has(key), `nav:sections.${key} has no entry in lib/nav.ts (${locale})`).toBe(true)
      }
    }
  })
})
