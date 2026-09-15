'use client'

import * as React from 'react'

/**
 * `true` once the component has hydrated in the browser.
 *
 * Same intent as the familiar `useState(false)` + `useEffect(() => setMounted(true))`
 * pair, but without the second render pass: `useSyncExternalStore` swaps the
 * server snapshot for the client one as part of hydration itself, so nothing has
 * to be "mounted" by hand and no effect-driven re-render is scheduled.
 *
 * Use it whenever a value can only be known client-side (applied theme, stored
 * preferences, `window` measurements) and rendering a guess during SSR would
 * produce a hydration mismatch.
 */

const emptySubscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useMounted(): boolean {
  return React.useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot)
}
