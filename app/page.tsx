'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Spinner } from '@/components/ui/spinner'
import { useSession } from '@/lib/auth/session'
import { landingRoute } from '@/lib/nav'

/**
 * `/` — a redirect, not a page.
 *
 * The destination depends on the session's permission map (an operator with
 * only `Zones.canView` should land on Zones, not on a 403), and that map only
 * exists after `user/session/get` answers against the selected server. So the
 * root route waits for the probe and then replaces itself.
 */
export default function RootRedirect() {
  const router = useRouter()
  const { ready, isAuthenticated, permissions } = useSession()

  React.useEffect(() => {
    if (!ready) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    router.replace(landingRoute(permissions))
  }, [ready, isAuthenticated, permissions, router])

  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  )
}
