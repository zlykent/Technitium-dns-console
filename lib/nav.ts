import {
  Ban,
  CircleCheck,
  CircleUser,
  Database,
  FileText,
  FolderTree,
  LayoutDashboard,
  Network,
  Puzzle,
  ScrollText,
  Settings,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { PERMISSION_SECTIONS, type PermissionFlags, type PermissionMap, type PermissionSection } from '@/lib/api/types/common'

/**
 * Navigation model.
 *
 * Declared as data rather than JSX so three things can read it: the sidebar, the
 * route guard, and the post-login redirect. Each entry names the permission
 * section that governs it, so hiding a menu item and blocking its page are the
 * same decision expressed once.
 */

export interface NavItem {
  /** Route path. */
  href: string
  /** Key under `nav.items` in the messages bundle. */
  key: string
  icon: LucideIcon
  /** Permission section required to see and enter the route. */
  section: PermissionSection
  /** Which flag of the section is required. Pages need `canView`. */
  flag: keyof PermissionFlags
  /** Match the href exactly instead of as a prefix. */
  exact?: boolean
  /** Hide from the sidebar but still guard the route. */
  hidden?: boolean
}

export interface NavSection {
  /** Key under `nav.sections` in the messages bundle. */
  key: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'monitor',
    items: [
      { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard, section: 'Dashboard', flag: 'canView' },
    ],
  },
  {
    key: 'dns',
    items: [
      { href: '/zones', key: 'zones', icon: FolderTree, section: 'Zones', flag: 'canView' },
      { href: '/resolve', key: 'dnsClient', icon: Terminal, section: 'DnsClient', flag: 'canView' },
      { href: '/cache', key: 'cache', icon: Database, section: 'Cache', flag: 'canView' },
    ],
  },
  {
    key: 'security',
    items: [
      { href: '/allowed', key: 'allowed', icon: CircleCheck, section: 'Allowed', flag: 'canView' },
      { href: '/blocked', key: 'blocked', icon: Ban, section: 'Blocked', flag: 'canView' },
      { href: '/logs', key: 'logs', icon: ScrollText, section: 'Logs', flag: 'canView' },
      { href: '/system-logs', key: 'systemLogs', icon: FileText, section: 'Logs', flag: 'canView' },
    ],
  },
  {
    key: 'services',
    items: [
      { href: '/dhcp', key: 'dhcp', icon: Network, section: 'DhcpServer', flag: 'canView' },
      { href: '/apps', key: 'apps', icon: Puzzle, section: 'Apps', flag: 'canView' },
    ],
  },
  {
    key: 'manage',
    items: [
      { href: '/settings', key: 'settings', icon: Settings, section: 'Settings', flag: 'canView' },
      { href: '/admin', key: 'administration', icon: ShieldCheck, section: 'Administration', flag: 'canView' },
    ],
  },
  {
    key: 'account',
    items: [{ href: '/account', key: 'account', icon: CircleUser, section: 'Dashboard', flag: 'canView', hidden: true }],
  },
]

/** Every route that carries a permission requirement, flattened. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items)

export const VISIBLE_NAV_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((item) => !item.hidden)

/** Routes reachable without a session. */
export const PUBLIC_ROUTES = ['/login'] as const

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export function isAllowed(item: NavItem, permissions: PermissionMap): boolean {
  return (permissions[item.section] ?? { canView: false, canModify: false, canDelete: false })[item.flag]
}

/** Sidebar entries the current user may see. */
export function visibleSections(permissions: PermissionMap): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.hidden && isAllowed(item, permissions)),
  })).filter((section) => section.items.length > 0)
}

/** Where to land after login: the first section the user can actually open. */
export function landingRoute(permissions: PermissionMap): string {
  for (const item of VISIBLE_NAV_ITEMS) {
    if (isAllowed(item, permissions)) return item.href
  }
  // An account with no view permission at all still gets its own profile page.
  return '/account'
}

/**
 * Longest-prefix match, so `/zones/example.com` highlights `Zones` and
 * `/system-logs` does not highlight `/logs`.
 */
export function activeNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null
  for (const item of ALL_NAV_ITEMS) {
    const matched = pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))
    if (!matched) continue
    if (!best || item.href.length > best.href.length) best = item
  }
  return best
}

/** Route guard table: path prefix -> required permission. */
export function requiredSectionFor(pathname: string): PermissionSection | null {
  const item = activeNavItem(pathname)
  return item ? item.section : null
}

export { PERMISSION_SECTIONS }
