'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { getActiveTarget } from '@/lib/api/client'
import { getSession, logout } from '@/lib/api/domains/user'
import { isAuthError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import { emptyPermissionMap, NO_PERMISSIONS, type PermissionFlags, type PermissionMap, type PermissionSection, type Session } from '@/lib/api/types/common'
import { useServers, useTargetKey } from '@/lib/servers/provider'
import { DEFAULT_PROFILE_ID } from '@/lib/servers/store'

/**
 * Session state.
 *
 * The token lives in an httpOnly cookie the browser cannot read, so "am I
 * signed in?" can only be answered by asking the server. `user/session/get`
 * does that and returns the permission map in the same round trip — which is
 * why the UI gates navigation on it instead of decoding anything client-side.
 *
 * The query is keyed by the active server, so switching servers re-authenticates
 * against that server's own cookie without any explicit teardown.
 */

export interface SessionContextValue {
  session: Session | null
  permissions: PermissionMap
  /** True once the session probe has answered, whichever way. */
  ready: boolean
  isLoading: boolean
  isAuthenticated: boolean
  /** Set when the probe failed for a non-auth reason (server down, proxy error). */
  connectionError: string | null
  refresh: () => void
  /** Publish a session obtained from `user/login` or `user/changePassword`. */
  adopt: (session: Session) => void
  signOut: () => Promise<void>
  canView: (section: PermissionSection) => boolean
  canModify: (section: PermissionSection) => boolean
  canDelete: (section: PermissionSection) => boolean
  flagsFor: (section: PermissionSection) => PermissionFlags
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

/**
 * The session key for whichever server is active *right now*, resolved at call
 * time rather than captured at render time.
 *
 * `selectByUrl` flips the module-level target synchronously inside the login
 * form's submit handler, but the React state behind `useTargetKey` only catches
 * up on the next render. An `adopt` closed over the render-time target would
 * therefore file a freshly minted session under the *previous* server's key,
 * leaving the new server's key holding the pre-login 401 — and the route guard
 * would bounce the user straight back to /login after a successful sign-in.
 * Mirrors `useTargetKey`: the env default is addressed by `DEFAULT_PROFILE_ID`.
 */
function currentSessionKey(): readonly unknown[] {
  return queryKeys.session(getActiveTarget() ?? DEFAULT_PROFILE_ID)
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { ready: serversReady } = useServers()
  const target = useTargetKey()
  const queryClient = useQueryClient()
  // Sign-out must flip every consumer in place. Wiping the cache is not
  // enough: `clear()` drops the probe's cache entry without notifying its
  // mounted observer, and the orphaned observer keeps serving the stale
  // session (no notification, no refetch) because cache writes to the same
  // key build a *new* query instance it never joins — and the root-layout
  // provider does not re-render on navigation to force a rebind. Left stale,
  // /login's already-signed-in bounce sends the operator straight back into
  // a console whose queries now 401. A state flag notifies through React
  // itself; `adopt` (sign-in) and switching servers clear it.
  const [signedOut, setSignedOut] = React.useState(false)
  const [flagTarget, setFlagTarget] = React.useState(target)
  if (flagTarget !== target) {
    // State adjustment during render, not an effect: switching servers means a
    // different cookie and probe, so the previous server's sign-out must not
    // mask this one's session.
    setFlagTarget(target)
    setSignedOut(false)
  }

  const query = useQuery({
    queryKey: queryKeys.session(target),
    queryFn: () => getSession(),
    // Until the server list is hydrated we do not know which cookie applies.
    enabled: serversReady,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // A background 401 must not blank the UI; keep the last good session.
    placeholderData: (previous) => previous,
  })

  const session = query.data ?? null
  const permissions = session?.info?.permissions ?? emptyPermissionMap()
  const authFailed = isAuthError(query.error)

  const value = React.useMemo<SessionContextValue>(() => {
    const flagsFor = (section: PermissionSection): PermissionFlags => permissions[section] ?? NO_PERMISSIONS

    return {
      session,
      permissions,
      ready: !serversReady ? false : query.isSuccess || authFailed || query.isError,
      isLoading: serversReady ? query.isPending || query.isFetching : true,
      isAuthenticated: !signedOut && Boolean(session) && !authFailed,
      connectionError: query.isError && !authFailed ? errorMessage(query.error) : null,
      refresh: () => {
        void queryClient.invalidateQueries({ queryKey: currentSessionKey() })
      },
      adopt: (next: Session) => {
        setSignedOut(false)
        queryClient.setQueryData(currentSessionKey(), next)
      },
      signOut: async () => {
        try {
          await logout()
        } catch {
          // The cookie is cleared by the proxy regardless; a failure here (an
          // already-expired token, say) must not trap the user in the console.
        }
        setSignedOut(true)
        queryClient.clear()
      },
      canView: (section) => flagsFor(section).canView,
      canModify: (section) => flagsFor(section).canModify,
      canDelete: (section) => flagsFor(section).canDelete,
      flagsFor,
    }
  }, [session, permissions, query.isSuccess, query.isPending, query.isFetching, query.isError, query.error, authFailed, serversReady, queryClient, signedOut])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

/** Narrow hook for permission checks — avoids re-rendering on session churn. */
export function usePermissions(): PermissionMap {
  return useSession().permissions
}

export function useCan(section: PermissionSection): PermissionFlags {
  return useSession().flagsFor(section)
}

export interface PermissionGateProps {
  section: PermissionSection
  /** Defaults to `canView`, which is what "may this page render" means. */
  require?: keyof PermissionFlags
  /** Rendered when the check fails. Omit to render nothing. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Declarative permission check. Use for whole pages; for individual buttons
 * prefer `useCan(...)` + `disabled` so the affordance stays visible and the
 * operator understands why it is greyed out.
 */
export function PermissionGate({ section, require: flag = 'canView', fallback = null, children }: PermissionGateProps) {
  const allowed = useSession().flagsFor(section)[flag]
  return <>{allowed ? children : fallback}</>
}
