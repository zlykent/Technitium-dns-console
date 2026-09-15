import { handleProxy } from '@/lib/proxy/kernel'

/**
 * Single catch-all proxy for all 129 Technitium endpoints.
 *
 * `GET|POST /api/dns/<endpoint>?<params>` -> `<target>/api/<endpoint>?<params>`
 *
 * The route handler is intentionally a shim: every decision (allowlist, verb,
 * auth, envelope, timeout, audit) lives in `lib/proxy/kernel.ts` so it can be
 * unit-tested without booting Next.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Zone exports and backups can be large; do not let the platform buffer them.
export const maxDuration = 300

interface RouteContext {
  params: Promise<{ path: string[] }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params
  return handleProxy(request, path)
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params
  return handleProxy(request, path)
}
