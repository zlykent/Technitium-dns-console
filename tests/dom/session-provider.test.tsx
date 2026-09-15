/**
 * SessionProvider sign-out semantics.
 *
 * The console route guard and /login's already-signed-in bounce both read
 * `isAuthenticated`, so signing out has to flip it in place. `queryClient.clear()`
 * alone cannot: it drops the probe's cache entry without notifying its mounted
 * observer, and the orphaned observer keeps serving the stale session (cache
 * writes to the same key build a new query instance it never joins, and the
 * root-layout provider does not re-render on navigation). The operator then
 * bounces between /login and a console whose queries all 401 — a permanent
 * "not signed in" strand with no way back. These tests pin the contract:
 * after `signOut()` resolves, the context reports signed-out and ready,
 * through React state rather than cache notification luck.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/components/app/query-provider'
import { SessionProvider, useSession } from '@/lib/auth/session'
import type { Session } from '@/lib/api/types/common'

const mockGetSession = vi.fn()
const mockLogout = vi.fn()

vi.mock('@/lib/api/domains/user', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}))
vi.mock('@/lib/api/client', () => ({ getActiveTarget: () => 't1' }))
vi.mock('@/lib/servers/provider', () => ({
  useServers: () => ({ ready: true }),
  useTargetKey: () => 't1',
}))

const SESSION = { info: { permissions: {} } } as unknown as Session

/** Publishes the context through the DOM: no module-level mutable state. */
function Probe() {
  const value = useSession()
  return (
    <div>
      <span data-testid="state">{`${value.isAuthenticated}|${value.ready}|${value.connectionError ?? ''}`}</span>
      <button onClick={() => void value.signOut()}>sign-out</button>
      <button onClick={() => value.adopt(SESSION)}>adopt</button>
    </div>
  )
}

function state() {
  const [isAuthenticated, ready, connectionError] = (screen.getByTestId('state').textContent ?? '||').split('|')
  return {
    isAuthenticated: isAuthenticated === 'true',
    ready: ready === 'true',
    connectionError: connectionError === '' ? null : connectionError,
  }
}

function renderProvider() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

async function signOut() {
  fireEvent.click(screen.getByRole('button', { name: 'sign-out' }))
  await waitFor(() => expect(mockLogout).toHaveBeenCalled())
}

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue(SESSION)
  mockLogout.mockReset().mockResolvedValue(undefined)
})

describe('SessionProvider — signOut', () => {
  it('flips isAuthenticated to false in place, no probe round trip needed', async () => {
    renderProvider()
    await waitFor(() => expect(state().isAuthenticated).toBe(true))

    await signOut()

    expect(mockLogout).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(state().isAuthenticated).toBe(false))
    // The guard only redirects once the probe has "answered"; a pending flip
    // would leave the shell on its spinner instead of bouncing to /login.
    expect(state().ready).toBe(true)
    expect(state().connectionError).toBeNull()
  })

  it('still leaves the console when the logout request itself fails', async () => {
    mockLogout.mockRejectedValue(new Error('token already gone'))
    renderProvider()
    await waitFor(() => expect(state().isAuthenticated).toBe(true))

    await signOut()

    await waitFor(() => expect(state().isAuthenticated).toBe(false))
  })

  it('adopt clears the signed-out flag so the next login sticks', async () => {
    renderProvider()
    await waitFor(() => expect(state().isAuthenticated).toBe(true))

    await signOut()
    await waitFor(() => expect(state().isAuthenticated).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'adopt' }))
    await waitFor(() => expect(state().isAuthenticated).toBe(true))
  })
})
