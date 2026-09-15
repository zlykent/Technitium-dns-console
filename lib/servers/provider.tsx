'use client'

import * as React from 'react'
import { getActiveTarget, setActiveTarget } from '@/lib/api/client'
import { useMounted } from '@/lib/hooks/use-mounted'
import { createPersistentStore, usePersistentStore } from '@/lib/hooks/use-persistent-state'
import {
  DEFAULT_PROFILE_ID,
  SERVERS_STORAGE_KEY,
  isDefaultProfile,
  makeProfileId,
  normaliseServerUrl,
  parseStoredServers,
  withDefaultProfile,
  type ServerProfile,
  type StoredServers,
} from './store'

/**
 * Which DNS server the whole app is talking to.
 *
 * The value is applied by calling `setActiveTarget()`, which makes the API
 * client send the `X-Dns-Target` header. Two deliberate details:
 *
 *  - The env-configured default is selected by sending **no header at all**.
 *    The proxy then treats the target as operator-supplied and trusted, which
 *    is what allows a same-host (`localhost`) deployment to work.
 *  - `ready` is false until `localStorage` has been read. Consumers that issue
 *    requests gate on it, so the first query is never sent to the wrong server.
 */

export interface ServersContextValue {
  /** Every selectable server, env default first. */
  profiles: ServerProfile[]
  /** Only the operator-added ones — the env default cannot be edited/removed. */
  customProfiles: ServerProfile[]
  active: ServerProfile | null
  /** False during SSR and until the stored list has been hydrated. */
  ready: boolean
  defaultTarget: string | null
  setActive: (id: string) => void
  addProfile: (input: { name: string; url: string }) => ServerProfile | null
  updateProfile: (id: string, patch: Partial<Pick<ServerProfile, 'name' | 'url'>>) => boolean
  removeProfile: (id: string) => boolean
  /**
   * Add-or-select the profile for `url` and apply it to the API client in the
   * same tick. The login form needs this: without the synchronous
   * `setActiveTarget` the credential POST could be sent to the previously
   * selected server while React is still reconciling the new one.
   */
  selectByUrl: (url: string | null) => ServerProfile | null
}

const ServersContext = React.createContext<ServersContextValue | null>(null)

/** Only the custom list is persisted; the env default is derived, never stored. */
const serialiseStoredServers = (value: StoredServers): string =>
  JSON.stringify({ profiles: value.profiles, activeId: value.activeId })

/**
 * Module scope, not component scope. The snapshot memo has to outlive a single
 * render: a store rebuilt per render would re-parse the JSON into a fresh object
 * every time and drive `useSyncExternalStore` into an infinite loop.
 */
const serversStore = createPersistentStore<StoredServers>({
  key: SERVERS_STORAGE_KEY,
  parse: parseStoredServers,
  serialize: serialiseStoredServers,
})

export interface ServersProviderProps {
  /** `TECHNITIUM_API_URL`, read on the server and passed down. */
  defaultTarget?: string | null
  children: React.ReactNode
}

export function ServersProvider({ defaultTarget = null, children }: ServersProviderProps) {
  const normalisedDefault = React.useMemo(() => normaliseServerUrl(defaultTarget ?? ''), [defaultTarget])
  const [stored, setStored] = usePersistentStore(serversStore)

  // Until hydration finishes the snapshot is the anonymous server default, so
  // anything that issues a request has to wait: asking the wrong server for a
  // token it never issued looks exactly like "credentials rejected".
  const ready = useMounted()

  const profiles = React.useMemo(() => withDefaultProfile(stored.profiles, normalisedDefault), [stored.profiles, normalisedDefault])
  const customProfiles = React.useMemo(() => profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID), [profiles])

  const active = React.useMemo(() => {
    if (!profiles.length) return null
    return profiles.find((p) => p.id === stored.activeId) ?? profiles[0]
  }, [profiles, stored.activeId])

  // Apply the selection during render, not in an effect: effects run
  // children-first, so an effect here always loses the race against the first
  // session probe of a freshly hydrated page — the probe leaves with no
  // header at all and asks the env default for a cookie only the stored
  // server issued. The write is idempotent, and SSR-safe because the server
  // snapshot resolves the selection to `null` on every server render.
  const activeUrl = active?.url ?? null
  const activeIsDefault = isDefaultProfile(active)
  const desiredTarget = activeIsDefault || !activeUrl ? null : activeUrl
  if (getActiveTarget() !== desiredTarget) setActiveTarget(desiredTarget)

  const value = React.useMemo<ServersContextValue>(() => {
    const setActive = (id: string) => setStored((prev) => ({ ...prev, activeId: id }))

    const addProfile = (input: { name: string; url: string }): ServerProfile | null => {
      const url = normaliseServerUrl(input.url)
      if (!url) return null
      const profile: ServerProfile = {
        id: makeProfileId(url),
        name: input.name.trim() || urlHost(url),
        url,
      }
      setStored((prev) => {
        const withoutDuplicate = prev.profiles.filter((p) => p.url !== url)
        return { profiles: [...withoutDuplicate, profile], activeId: profile.id }
      })
      return profile
    }

    const updateProfile = (id: string, patch: Partial<Pick<ServerProfile, 'name' | 'url'>>): boolean => {
      if (id === DEFAULT_PROFILE_ID) return false
      let nextUrl: string | null = null
      if (patch.url !== undefined) {
        nextUrl = normaliseServerUrl(patch.url)
        if (!nextUrl) return false
      }
      let ok = false
      setStored((prev) => {
        const index = prev.profiles.findIndex((p) => p.id === id)
        if (index < 0) return prev
        ok = true
        const current = prev.profiles[index]
        const updated: ServerProfile = {
          id: nextUrl && nextUrl !== current.url ? makeProfileId(nextUrl) : current.id,
          name: patch.name?.trim() || current.name,
          url: nextUrl ?? current.url,
        }
        const profiles = [...prev.profiles]
        profiles[index] = updated
        return { profiles, activeId: prev.activeId === id ? updated.id : prev.activeId }
      })
      return ok
    }

    const removeProfile = (id: string): boolean => {
      if (id === DEFAULT_PROFILE_ID) return false
      let removed = false
      setStored((prev) => {
        const next = prev.profiles.filter((p) => p.id !== id)
        removed = next.length !== prev.profiles.length
        if (!removed) return prev
        return { profiles: next, activeId: prev.activeId === id ? (next[0]?.id ?? DEFAULT_PROFILE_ID) : prev.activeId }
      })
      return removed
    }

    const selectByUrl = (url: string | null): ServerProfile | null => {
      // `null` / empty means "the operator's default server", which is addressed
      // by sending no target header at all.
      if (!url || !url.trim()) {
        if (!normalisedDefault) return null
        setActiveTarget(null)
        setStored((prev) => ({ ...prev, activeId: DEFAULT_PROFILE_ID }))
        return { id: DEFAULT_PROFILE_ID, name: urlHost(normalisedDefault), url: normalisedDefault }
      }
      const origin = normaliseServerUrl(url)
      if (!origin) return null
      const existing = profiles.find((p) => p.url === origin)
      if (existing) {
        setActiveTarget(isDefaultProfile(existing) ? null : existing.url)
        setStored((prev) => ({ ...prev, activeId: existing.id }))
        return existing
      }
      const profile: ServerProfile = { id: makeProfileId(origin), name: urlHost(origin), url: origin }
      setActiveTarget(profile.url)
      setStored((prev) => {
        const withoutDuplicate = prev.profiles.filter((p) => p.url !== origin)
        return { profiles: [...withoutDuplicate, profile], activeId: profile.id }
      })
      return profile
    }

    return {
      profiles,
      customProfiles,
      active,
      ready,
      defaultTarget: normalisedDefault,
      setActive,
      addProfile,
      updateProfile,
      removeProfile,
      selectByUrl,
    }
  }, [profiles, customProfiles, active, ready, normalisedDefault, setStored])

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>
}

function urlHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function useServers(): ServersContextValue {
  const ctx = React.useContext(ServersContext)
  if (!ctx) throw new Error('useServers must be used inside <ServersProvider>')
  return ctx
}

/**
 * Stable string for query keys. Everything the app caches is per-server, so
 * every key must include this or switching servers would show stale data.
 *
 * The env default is keyed by `DEFAULT_PROFILE_ID`, never by its URL: the API
 * client addresses it by sending no target header at all, and
 * `currentSessionKey()` in `lib/auth/session` resolves that same no-header
 * case to `DEFAULT_PROFILE_ID`. The two must agree — a session filed under
 * the default's URL is a session the mounted probe never watches, which
 * bounces a successful sign-in on the default server straight back to /login.
 */
export function useTargetKey(): string {
  const { active } = useServers()
  return active && !isDefaultProfile(active) ? active.url : DEFAULT_PROFILE_ID
}
