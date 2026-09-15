import { E2E, E2E_PREFIX } from './env'

/**
 * Sweep anything the suite left on the real DNS server.
 *
 * Specs delete their own scratch zones in `afterAll`, but a crash, a timeout or
 * a `--last-failed` rerun skips that. Because every write is prefixed, teardown
 * can find the orphans without a manifest — and without risking a zone that was
 * there before the suite ran.
 *
 * This talks to Technitium directly rather than through the console: by now the
 * web server may already be down, and cleanup must not depend on the thing being
 * tested.
 */
export default async function globalTeardown(): Promise<void> {
  // Iterating on one spec while another run is in flight would let this sweep a
  // zone that run is still using, so the guard exists for exactly that case.
  if (process.env.E2E_SKIP_TEARDOWN === '1') return

  try {
    const token = await loginToken()
    if (!token) return
    const zones = await listZones(token)
    const orphans = zones.filter((zone) => zone.startsWith(E2E_PREFIX))
    for (const zone of orphans) {
      await deleteZone(token, zone)
      console.log(`[e2e-teardown] removed leftover zone ${zone}`)
    }
  } catch (error) {
    // Cleanup is best-effort. Failing the run here would mask the real failure.
    console.warn('[e2e-teardown] skipped cleanup:', (error as Error).message)
  }
}

async function loginToken(): Promise<string | null> {
  const response = await fetch(`${E2E.dnsUrl}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: E2E.user, pass: E2E.pass }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return null
  const parsed = (await response.json()) as { status?: string; token?: string }
  return parsed.status === 'ok' && parsed.token ? parsed.token : null
}

async function listZones(token: string): Promise<string[]> {
  const response = await fetch(`${E2E.dnsUrl}/api/zones/list`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return []
  const parsed = (await response.json()) as { response?: { zones?: { name?: string }[] } }
  return (parsed.response?.zones ?? []).map((zone) => zone.name ?? '').filter(Boolean)
}

async function deleteZone(token: string, zone: string): Promise<void> {
  // Same shape the SDK uses (see `deleteZones` in lib/api/domains/zones.ts): a
  // single name goes in the `zone` query parameter. Mirroring it means the
  // cleanup path is one the proxy smoke test has already proven.
  const query = new URLSearchParams({ zone })
  await fetch(`${E2E.dnsUrl}/api/zones/delete?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
}
