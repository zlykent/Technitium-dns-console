import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider } from 'next-themes'
import type * as React from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryProvider } from '@/components/app/query-provider'
import { SessionProvider } from '@/lib/auth/session'
import { ServersProvider } from '@/lib/servers/provider'

/**
 * Provider stack, outermost first.
 *
 * Order is load-bearing:
 *   Theme        — writes the `dark` class before first paint (next-themes
 *                  injects a blocking script), so nothing flashes.
 *   Intl         — `locale` + messages are inherited from `getRequestConfig`,
 *                  so no props are needed here.
 *   Query        — every data provider below needs a QueryClient.
 *   Servers      — must precede Session: it decides which cookie the proxy
 *                  will read, and Session gates its probe on `ready`.
 *   Session      — gates the whole console on authentication + permissions.
 *
 * This is a Server Component: it only composes, so no client JS is added to the
 * bundle beyond the providers themselves.
 */
export function Providers({ children, defaultTarget }: { children: React.ReactNode; defaultTarget: string | null }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <NextIntlClientProvider>
        <QueryProvider>
          <ServersProvider defaultTarget={defaultTarget}>
            <SessionProvider>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </SessionProvider>
          </ServersProvider>
        </QueryProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  )
}
