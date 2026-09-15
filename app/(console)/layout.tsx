import { ConsoleShell } from '@/components/app/console-shell'

/**
 * Authenticated console layout.
 *
 * A Server Component that only mounts the client shell — the guard, sidebar and
 * top bar all need the session, which lives in the browser. Keeping this file
 * free of logic means the shell can be unit-tested on its own.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>
}
