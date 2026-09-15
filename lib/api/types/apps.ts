/** DNS apps: the installed set, the store, and their free-form config. */

export interface DnsAppEntry {
  name: string
  /** Fully-qualified type name used as `classPath` by `logs/query`. */
  classPath: string
  /** True for apps that record query logs — they unlock the Logs > Query tab. */
  isQueryLogs: boolean
}

export interface InstalledApp {
  name: string
  description: string
  version: string
  updateAvailable: boolean
  updateVersion: string | null
  updateUrl: string | null
  dnsApps: DnsAppEntry[]
}

export interface AppListResult {
  apps: InstalledApp[]
}

export interface StoreApp {
  name: string
  description: string
  version: string
  /** Human-readable, e.g. `61.54 KB`. */
  size: string
  url: string
  installed: boolean
}

export interface StoreAppListResult {
  storeApps: StoreApp[]
}

/**
 * `apps/config/get` returns the app's configuration as an **opaque string** —
 * each app defines its own format (JSON for most, but not guaranteed). The UI
 * therefore offers a structured JSON editor when the content parses, and a plain
 * text editor otherwise.
 */
export interface AppConfigResult {
  config: string
}

export interface InstallAppResult {
  installedApp: InstalledApp
}

export interface UpdateAppResult {
  updatedApp: InstalledApp
}

/** Everything `apps/list` can tell us about which apps produce query logs. */
export function queryLogApps(apps: readonly InstalledApp[]): { name: string; classPath: string }[] {
  const out: { name: string; classPath: string }[] = []
  for (const app of apps) {
    for (const entry of app.dnsApps ?? []) {
      if (entry.isQueryLogs) out.push({ name: app.name, classPath: entry.classPath })
    }
  }
  return out
}

export function tryParseJsonConfig(config: string): unknown | undefined {
  const trimmed = config.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}
