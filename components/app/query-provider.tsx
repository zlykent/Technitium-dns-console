'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { isAuthError } from '@/lib/api/errors'
import { DEFAULT_GC_TIME, DEFAULT_STALE_TIME } from '@/lib/api/query-keys'

/**
 * TanStack Query setup.
 *
 * The client is created in state so it survives re-renders but is rebuilt per
 * browser session — a module-level singleton would leak cached DNS data between
 * users on a shared machine.
 *
 * A 401 from *any* query or mutation means the httpOnly token is gone or
 * rejected, i.e. the operator is not signed in — and the `ConsoleShell` guard
 * only redirects when the *session probe* says so. Left alone, a page whose
 * own query 401s renders a "not signed in" error inside a shell the stale
 * probe still calls signed in. The help below is deliberate about TanStack
 * v5's measured cache semantics:
 *
 *  - `clear()`/`removeQueries()` on the probe leaves its mounted observer
 *    holding the last result — no notification, no refetch — so the guard
 *    would never hear about the sign-out;
 *  - `setQueryData(key, undefined)` is swallowed by the probe's
 *    `placeholderData: (previous) => previous`;
 *  - `setQueryData(key, null)` *does* notify: `useSession` reads `data: null`
 *    as "the probe answered: nobody is signed in", `ready` flips, and the
 *    guard bounces to `/login?next=…`.
 *
 * So the failed request's target gets its session nulled in place, and only
 * that target's remaining caches are removed (their observers unmount with
 * the redirect, and the next sign-in must not inherit another operator's
 * rows). Other targets' sessions stay untouched — their cookies are still
 * good. The probe's own 401 is excluded: that is the guard's normal input.
 */

export function makeQueryClient(): QueryClient {
  const dropSession = (client: QueryClient, error: unknown, target?: string) => {
    if (!isAuthError(error)) return
    const cache = client.getQueryCache()
    // A failed query names its target in its key; a failed mutation carries
    // no key, so the probe that is actually mounted — the observed session
    // query — names the target the console is operating on.
    const sessions = target
      ? cache.findAll({ queryKey: [target, 'session'], exact: true })
      : cache.findAll().filter((query) => query.queryKey[1] === 'session' && query.getObserversCount() > 0)
    for (const session of sessions) client.setQueryData(session.queryKey, null)
    const dead = new Set(sessions.map((session) => session.queryKey[0]))
    client.removeQueries({ predicate: (query) => query.queryKey[1] !== 'session' && dead.has(query.queryKey[0]) })
  }
  // The explicit `QueryClient` annotation is load-bearing: the `onError`
  // callbacks below close over `client` (they need its cache to null the
  // session), so without it TS sees a self-referential initialiser, cannot
  // infer the type, and widens `client` to `any` (TS7022) — which then makes
  // the concise-body `onError` return type `any` too (TS7023).
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[1] === 'session') return
        dropSession(client, error, typeof query.queryKey[0] === 'string' ? query.queryKey[0] : undefined)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => dropSession(client, error),
    }),
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: DEFAULT_GC_TIME,
        refetchOnWindowFocus: false,
        // The admin API is on a LAN box: two quick retries cover a transient
        // blip without hammering it when a server is genuinely down.
        retry: (failureCount, error) => {
          const status = (error as { httpStatus?: number } | undefined)?.httpStatus
          if (status && status >= 400 && status < 500) return false
          return failureCount < 2
        },
      },
      mutations: {
        // A failed write must be surfaced, never silently repeated.
        retry: false,
      },
    },
  })
  return client
}

let browserQueryClient: QueryClient | undefined

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Lazy `useState`, not a ref: the client is created during render, and
  // reading or writing a ref there is what the react-hooks rules forbid. The
  // initialiser still runs exactly once and the value survives re-renders.
  const [client] = React.useState(getQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
