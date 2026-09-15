import type { ApiDomain } from '@/lib/api/registry'

/**
 * Query key factory.
 *
 * Every key starts with the active server's target so that switching servers
 * can never show another server's cached rows. Keys are arrays (not strings) so
 * `invalidateQueries({ queryKey: keys.zones(target) })` invalidates a whole
 * domain subtree in one call.
 */

export const queryKeys = {
  /** Invalidating this drops everything — used on logout and server switch. */
  all: (target: string) => [target] as const,

  session: (target: string) => [target, 'session'] as const,
  profile: (target: string) => [target, 'user', 'profile'] as const,
  status: (target: string) => [target, 'status'] as const,

  domain: (target: string, domain: ApiDomain) => [target, domain] as const,

  // ---- dashboard
  stats: (target: string, range: Record<string, unknown>) => [target, 'dashboard', 'stats', range] as const,
  topStats: (target: string, range: Record<string, unknown>, type: string) => [target, 'dashboard', 'top', type, range] as const,

  // ---- zones
  /**
   * `extra` carries every other discriminator the request depends on
   * (`filterType`, `zonesPerPage`, …). It is merged into the same trailing
   * object so the `[target, 'zones', 'list']` prefix still matches a
   * `domain(target, 'zones')` invalidation — do not append it as a separate
   * array element.
   */
  zoneList: (target: string, page: number, keyword: string, extra?: Record<string, unknown>) =>
    [target, 'zones', 'list', { page, keyword, ...extra }] as const,
  zone: (target: string, zone: string) => [target, 'zones', 'detail', zone] as const,
  /**
   * `zones/records/get` returns the whole zone in one shot — there is no paging
   * or type filter upstream — so these discriminators are client-side view
   * state only. Pass just the ones your `queryFn` reads; passing all three when
   * the fetch ignores them turns every filter keystroke into a cache miss.
   */
  zoneRecords: (target: string, zone: string, page?: number, keyword?: string, type?: string) =>
    [target, 'zones', 'records', zone, { page, keyword, type }] as const,
  zoneOptions: (target: string, zone: string) => [target, 'zones', 'options', zone] as const,
  zonePermissions: (target: string, zone: string) => [target, 'zones', 'permissions', zone] as const,
  catalogs: (target: string) => [target, 'zones', 'catalogs'] as const,

  // ---- dnssec
  dnssecProperties: (target: string, zone: string) => [target, 'dnssec', 'properties', zone] as const,
  dnssecDs: (target: string, zone: string) => [target, 'dnssec', 'ds', zone] as const,
  dnssecOptions: (target: string, zone: string) => [target, 'dnssec', 'options', zone] as const,

  // ---- cache / allowed / blocked
  /**
   * All three scopes answer with a lazy domain tree, so `page` is always 0 and
   * the node being browsed travels in `keyword`. The signature predates the
   * tree shape; invalidation goes through `domain(target, scope)`, which matches
   * the two-element prefix regardless.
   */
  cache: (target: string, page: number, keyword: string) => [target, 'cache', { page, keyword }] as const,
  allowed: (target: string, page: number, keyword: string) => [target, 'allowed', { page, keyword }] as const,
  blocked: (target: string, page: number, keyword: string) => [target, 'blocked', { page, keyword }] as const,

  // ---- logs
  logFiles: (target: string) => [target, 'logs', 'files'] as const,
  logEntries: (target: string, params: Record<string, unknown>) => [target, 'logs', 'entries', params] as const,

  // ---- dhcp
  dhcpScopes: (target: string) => [target, 'dhcp', 'scopes'] as const,
  dhcpScope: (target: string, name: string) => [target, 'dhcp', 'scope', name] as const,
  dhcpLeases: (target: string, scope: string) => [target, 'dhcp', 'leases', scope] as const,

  // ---- apps
  apps: (target: string) => [target, 'apps', 'installed'] as const,
  storeApps: (target: string) => [target, 'apps', 'store'] as const,
  appConfig: (target: string, name: string) => [target, 'apps', 'config', name] as const,

  // ---- settings
  settings: (target: string) => [target, 'settings'] as const,
  tsigKeys: (target: string) => [target, 'settings', 'tsig'] as const,

  // ---- admin
  users: (target: string) => [target, 'admin', 'users'] as const,
  user: (target: string, name: string) => [target, 'admin', 'user', name] as const,
  groups: (target: string) => [target, 'admin', 'groups'] as const,
  permissions: (target: string, section: string) => [target, 'admin', 'permissions', section] as const,
  permissionSections: (target: string) => [target, 'admin', 'permission-sections'] as const,
  sessions: (target: string) => [target, 'admin', 'sessions'] as const,
  sso: (target: string) => [target, 'admin', 'sso'] as const,
  cluster: (target: string) => [target, 'admin', 'cluster'] as const,
  clusterState: (target: string) => [target, 'admin', 'cluster', 'state'] as const,
}

/**
 * Default query options. Technitium is a single-threaded admin API on a LAN
 * box: aggressive refetching on window focus produces more load than value, so
 * it is off and mutations invalidate explicitly.
 */
export const DEFAULT_STALE_TIME = 30_000
export const DEFAULT_GC_TIME = 5 * 60_000
