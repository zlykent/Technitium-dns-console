import { QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { makeQueryClient } from '@/components/app/query-provider'
import { DnsApiError } from '@/lib/api/errors'

/**
 * The global "any 401 means signed out" behaviour.
 *
 * The `ConsoleShell` guard only redirects when the session probe says nobody
 * is signed in, so a page-level 401 has to be translated into a probe answer
 * or the operator stares at a "not signed in" error inside a signed-in shell.
 * These pin the translation — and the cache mechanics it survives: nulling
 * the session in place (a removed probe query would leave its mounted
 * observer holding the stale result forever), scoping the cleanup to the
 * dead target, and leaving transport failures alone.
 */

const SESSION = { info: { displayName: 'Ada' } }
const OTHER_SESSION = { info: { displayName: 'Someone else' } }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mirrors the probe's options in `lib/auth/session.tsx`, placeholder included. */
function observeSession(client: ReturnType<typeof makeQueryClient>, target = 't', queryFn?: () => Promise<unknown>) {
  const observer = new QueryObserver(client, {
    queryKey: [target, 'session'],
    queryFn: queryFn ?? (async () => SESSION),
    retry: false,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })
  const unsubscribe = observer.subscribe(() => {})
  return { observer, unsubscribe }
}

describe('query client — a page-level 401 signs the console out', () => {
  it('nulls the observed session so the guard redirects', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'session'], SESSION)
    const session = observeSession(client)
    const page = new QueryObserver(client, {
      queryKey: ['t', 'settings'],
      queryFn: async (): Promise<never> => {
        throw new DnsApiError('missing_token', 'No token.')
      },
    })
    const unsubscribePage = page.subscribe(() => {})

    await sleep(80)

    // What `useSession` feeds the guard: the probe answered (ready) and the
    // answer is "nobody home" — not pending, not a connection error.
    const result = session.observer.getCurrentResult()
    expect(result.isSuccess).toBe(true)
    expect(result.data).toBeNull()

    unsubscribePage()
    session.unsubscribe()
  })

  it('drops the dead target caches but keeps the session query itself', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'session'], SESSION)
    client.setQueryData(['t', 'zones'], ['zone-a'])
    const session = observeSession(client)
    const page = new QueryObserver(client, {
      queryKey: ['t', 'settings'],
      queryFn: async (): Promise<never> => {
        throw new DnsApiError('invalid_token', 'Token is invalid.')
      },
    })
    const unsubscribePage = page.subscribe(() => {})

    await sleep(80)

    // Stale private rows must not survive into the next sign-in…
    expect(client.getQueryCache().find({ queryKey: ['t', 'zones'] })).toBeUndefined()
    // …but the session query must: an observer bound to a removed query keeps
    // its last result and would miss the `adopt()` that follows the re-login.
    expect(client.getQueryCache().find({ queryKey: ['t', 'session'] })).toBeDefined()

    unsubscribePage()
    session.unsubscribe()
  })

  it('leaves another target’s session alone', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'session'], SESSION)
    client.setQueryData(['other', 'session'], OTHER_SESSION)
    const session = observeSession(client)
    const page = new QueryObserver(client, {
      queryKey: ['t', 'settings'],
      queryFn: async (): Promise<never> => {
        throw new DnsApiError('missing_token', 'No token.')
      },
    })
    const unsubscribePage = page.subscribe(() => {})

    await sleep(80)

    expect(client.getQueryData(['other', 'session'])).toEqual(OTHER_SESSION)

    unsubscribePage()
    session.unsubscribe()
  })
})

describe('query client — failures that must NOT sign the console out', () => {
  it('keeps the session for a transport failure', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'session'], SESSION)
    client.setQueryData(['t', 'zones'], ['zone-a'])
    const session = observeSession(client)
    const page = new QueryObserver(client, {
      queryKey: ['t', 'settings'],
      queryFn: async (): Promise<never> => {
        throw new DnsApiError('upstream_unreachable', 'No route to host.')
      },
    })
    const unsubscribePage = page.subscribe(() => {})

    await sleep(80)

    expect(session.observer.getCurrentResult().data).toEqual(SESSION)
    expect(client.getQueryCache().find({ queryKey: ['t', 'zones'] })).toBeDefined()

    unsubscribePage()
    session.unsubscribe()
  })

  it('lets the probe’s own 401 stand without touching the cache', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'zones'], ['zone-a'])
    const session = observeSession(client, 't', async (): Promise<never> => {
      throw new DnsApiError('missing_token', 'No token.')
    })

    await sleep(80)

    // The guard reads the probe's own error; nothing else may be disturbed.
    expect(session.observer.getCurrentResult().isError).toBe(true)
    expect(client.getQueryCache().find({ queryKey: ['t', 'zones'] })).toBeDefined()

    session.unsubscribe()
  })
})

describe('query client — a mutation 401 signs the console out too', () => {
  it('nulls the mounted probe even though mutations carry no target key', async () => {
    const client = makeQueryClient()
    client.setQueryData(['t', 'session'], SESSION)
    client.setQueryData(['other', 'session'], OTHER_SESSION)
    const session = observeSession(client)

    const mutation = client.getMutationCache().build(client, {
      mutationFn: async (): Promise<never> => {
        throw new DnsApiError('invalid_token', 'Token is invalid.')
      },
    })
    await mutation.execute({}).then(
      () => {},
      () => {},
    )
    await sleep(30)

    expect(session.observer.getCurrentResult().data).toBeNull()
    expect(client.getQueryData(['other', 'session'])).toEqual(OTHER_SESSION)

    session.unsubscribe()
  })
})
