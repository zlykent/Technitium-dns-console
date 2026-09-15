/**
 * Server profiles — pure storage logic, no React.
 *
 * Operators can keep several DNS servers and switch between them. The list is
 * only `{name, url}`: nothing secret, so `localStorage` is the right home and
 * the server side stays stateless. Credentials never come near this module —
 * the token lives in an httpOnly cookie that the proxy derives from the URL.
 */

import { parseServerUrl } from '@/lib/url'

export const SERVERS_STORAGE_KEY = 'tdns.servers.v1'
export const ACTIVE_STORAGE_KEY = 'tdns.active.v1'

/** Synthetic id for the operator-configured `TECHNITIUM_API_URL` target. */
export const DEFAULT_PROFILE_ID = '__env__'

export interface ServerProfile {
  id: string
  name: string
  /** Origin, e.g. `http://127.0.0.1:5380`. */
  url: string
}

/**
 * Normalise whatever the operator typed into a bare origin. Accepts
 * `host:port`, `http://host:port` and `https://host:port/path` alike. Returns
 * `null` when the value cannot become an http(s) URL — including when it names
 * another protocol outright, which is a typo worth rejecting at the form rather
 * than storing as a profile called `ftp`.
 */
export function normaliseServerUrl(raw: string): string | null {
  const parsed = parseServerUrl(raw)
  return parsed.ok ? parsed.origin : null
}

export function makeProfileId(url: string): string {
  // Deterministic and collision-resistant enough for a handful of servers,
  // while staying readable in devtools.
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0
  }
  return `s${(hash >>> 0).toString(36)}`
}

export interface StoredServers {
  profiles: ServerProfile[]
  activeId: string | null
}

export function emptyStore(): StoredServers {
  return { profiles: [], activeId: null }
}

/**
 * Build the effective profile list: the env-configured default first (when the
 * operator set one), then the saved profiles, de-duplicated by origin so the
 * same server cannot appear twice under different names.
 */
export function withDefaultProfile(profiles: readonly ServerProfile[], defaultTarget: string | null | undefined): ServerProfile[] {
  const normalisedDefault = defaultTarget ? normaliseServerUrl(defaultTarget) : null
  const out: ServerProfile[] = []
  if (normalisedDefault) {
    out.push({ id: DEFAULT_PROFILE_ID, name: defaultTargetLabel(normalisedDefault), url: normalisedDefault })
  }
  const seen = new Set(out.map((p) => p.url))
  for (const profile of profiles) {
    if (seen.has(profile.url)) continue
    seen.add(profile.url)
    out.push(profile)
  }
  return out
}

function defaultTargetLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Parse + validate persisted JSON; any corruption degrades to an empty store. */
export function parseStoredServers(raw: string | null): StoredServers {
  if (!raw) return emptyStore()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyStore()
    const candidate = parsed as Partial<StoredServers>
    if (!Array.isArray(candidate.profiles)) return emptyStore()

    const profiles: ServerProfile[] = []
    const seen = new Set<string>()
    for (const item of candidate.profiles) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Partial<ServerProfile>
      if (typeof entry.url !== 'string') continue
      const url = normaliseServerUrl(entry.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      profiles.push({
        id: typeof entry.id === 'string' && entry.id ? entry.id : makeProfileId(url),
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : defaultTargetLabel(url),
        url,
      })
    }

    const activeId = typeof candidate.activeId === 'string' ? candidate.activeId : null
    return { profiles, activeId }
  } catch {
    return emptyStore()
  }
}

export function readStoredServers(storage: Pick<Storage, 'getItem'> | null | undefined): StoredServers {
  if (!storage) return emptyStore()
  try {
    return parseStoredServers(storage.getItem(SERVERS_STORAGE_KEY))
  } catch {
    return emptyStore()
  }
}

export function writeStoredServers(storage: Pick<Storage, 'setItem'> | null | undefined, state: StoredServers): void {
  if (!storage) return
  try {
    storage.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ profiles: state.profiles, activeId: state.activeId }))
  } catch {
    // quota or private mode — the app still works for this tab, it just will
    // not remember the list on reload
  }
}

/** The env profile must be addressed by omitting the header, not by URL. */
export function isDefaultProfile(profile: ServerProfile | null | undefined): boolean {
  return profile?.id === DEFAULT_PROFILE_ID
}
