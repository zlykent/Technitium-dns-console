'use client'

import * as React from 'react'

/**
 * `localStorage` treated as what it actually is: an external store.
 *
 * The naive shape — `useState(fallback)` plus `useEffect(() => setState(read()))` —
 * costs a second render on every mount and is precisely the cascading-render
 * pattern the react-hooks rules reject. `useSyncExternalStore` gets the same
 * result in one pass: `getServerSnapshot` keeps SSR deterministic, `getSnapshot`
 * reads the live value, and the `storage` event keeps sibling tabs in sync for
 * free.
 *
 * Snapshots must be referentially stable or React loops forever, so every parsed
 * value is cached against the raw string it came from. That cache lives on the
 * store object, which is why stores are created at module scope rather than
 * inside a component: a store built per render would defeat the caching.
 */

export interface PersistentStoreConfig<T> {
  /** `localStorage` key. Must be unique per store. */
  key: string
  /** Pure. Any corruption must degrade to a usable value, never throw. */
  parse: (raw: string | null) => T
  /** Pure. Must round-trip with `parse`. */
  serialize: (value: T) => string
}

export interface PersistentStore<T> {
  readonly key: string
  subscribe(onStoreChange: () => void): () => void
  getSnapshot(): T
  getServerSnapshot(): T
  /**
   * Write-through: persists, refreshes the cache and notifies subscribers.
   * A serialise-identical value is a no-op, so callers may set freely.
   */
  set(updater: T | ((previous: T) => T)): void
  /** Current value without subscribing. Useful outside React (tests, helpers). */
  peek(): T
}

export function createPersistentStore<T>(config: PersistentStoreConfig<T>): PersistentStore<T> {
  const { key, parse, serialize } = config

  // `cachedRaw`/`cachedValue` are the client snapshot memo; `serverValue` is
  // the parsed-empty default, computed at most once and shared by every SSR
  // render (it holds no request data, so module lifetime is correct).
  let cachedRaw: string | null = null
  let cachedValue: T | undefined
  let serverValue: T | undefined
  const listeners = new Set<() => void>()

  const readRaw = (): string | null => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      // Storage disabled — private mode, embedded webview, blocked cookies.
      // Behave as empty rather than taking the whole console down.
      return null
    }
  }

  const writeRaw = (raw: string): void => {
    try {
      window.localStorage.setItem(key, raw)
    } catch {
      // Quota exceeded or storage disabled. The cache below still updates, so
      // this tab keeps working; it just will not survive a reload.
    }
  }

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const snapshot = (): T => {
    const raw = readRaw()
    if (cachedValue !== undefined && cachedRaw === raw) return cachedValue
    const value = parse(raw)
    cachedRaw = raw
    cachedValue = value
    return value
  }

  return {
    key,

    subscribe(onStoreChange) {
      listeners.add(onStoreChange)

      // Cross-tab writes surface as `storage` events. `key === null` means
      // "everything was cleared", which also invalidates us.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return
        cachedValue = undefined
        onStoreChange()
      }
      window.addEventListener('storage', onStorage)

      return () => {
        listeners.delete(onStoreChange)
        window.removeEventListener('storage', onStorage)
      }
    },

    getSnapshot: snapshot,

    // Never derived from client state: SSR must render the same anonymous
    // default for every request, or the markup leaks one operator's server
    // list into another's HTML (and mismatches on hydration).
    getServerSnapshot() {
      if (serverValue === undefined) serverValue = parse(null)
      return serverValue
    },

    peek() {
      if (typeof window === 'undefined') {
        if (serverValue === undefined) serverValue = parse(null)
        return serverValue
      }
      return snapshot()
    },

    set(updater) {
      const raw = typeof window === 'undefined' ? null : readRaw()
      const previous = cachedValue !== undefined && cachedRaw === raw ? cachedValue : parse(raw)
      const next = typeof updater === 'function' ? (updater as (previous: T) => T)(previous) : updater
      const nextRaw = serialize(next)

      if (typeof window !== 'undefined' && nextRaw !== raw) writeRaw(nextRaw)
      cachedRaw = nextRaw
      cachedValue = next
      notify()
    },
  }
}

export type PersistentState<T> = [T, PersistentStore<T>['set']]

/** Subscribe a component to a module-scope store. */
export function usePersistentStore<T>(store: PersistentStore<T>): PersistentState<T> {
  const subscribe = React.useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  const getSnapshot = React.useCallback(() => store.getSnapshot(), [store])
  const getServerSnapshot = React.useCallback(() => store.getServerSnapshot(), [store])
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return [value, store.set]
}
