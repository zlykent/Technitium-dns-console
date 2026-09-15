import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Environment for the E2E suite.
 *
 * Next.js loads `.env.local` for the app under test, but Playwright runs in a
 * plain Node process and never sees it — so the credentials the suite needs have
 * to be read here. Duplicating them into the config or, worse, into the specs
 * would mean a second place to keep in sync.
 *
 * `process.env` wins over the file, which is what makes CI work: a runner sets
 * `E2E_DNS_URL` and any local file value is ignored. The shipped config files
 * carry none of these keys; the fallbacks below are the suite's own defaults,
 * so a plain `pnpm e2e` needs only environment overrides to point elsewhere.
 */

const ROOT = resolve(process.cwd())

function parseDotEnv(file: string): Record<string, string> {
  const absolute = resolve(ROOT, file)
  if (!existsSync(absolute)) return {}

  const out: Record<string, string> = {}
  for (const rawLine of readFileSync(absolute, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    // Only split on the first `=`: a URL value contains none, but a secret may.
    let value = line.slice(eq + 1).trim()
    const quoted = value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

const file = { ...parseDotEnv('.env'), ...parseDotEnv('.env.local') }

function read(key: string, fallback: string): string {
  const value = process.env[key] ?? file[key]
  return value && value.trim() !== '' ? value.trim() : fallback
}

/** Port the production build is served on for the suite. Kept off 3000/3100 so a
 *  developer's own `next dev` never becomes the thing under test. */
export const E2E_PORT = Number(read('E2E_PORT', '3200'))

export const E2E = {
  baseUrl: read('E2E_BASE_URL', `http://127.0.0.1:${E2E_PORT}`),
  /** The real Technitium server the console proxies to. */
  dnsUrl: read('E2E_DNS_URL', 'http://127.0.0.1:5380'),
  user: read('E2E_DNS_USER', 'admin'),
  pass: read('E2E_DNS_PASS', '123456'),
  /** Saved by `global-setup.ts` and reused by every spec. Overridable so two
   *  runs in flight (a developer iterating while CI executes) cannot overwrite
   *  each other's session file mid-run. */
  storageState: resolve(ROOT, read('E2E_STORAGE_STATE', 'tests/e2e/.auth/user.json')),
} as const

/**
 * Prefix for anything a spec creates on the real server.
 *
 * The suite runs against a live DNS server, so every write has to be both
 * recognisable and removable. A fixed prefix lets `global-teardown.ts` sweep up
 * leftovers from a crashed run instead of trusting `afterAll` to always fire.
 */
export const E2E_PREFIX = 'e2e-'

/** A zone name that cannot collide with a real one, unique per run. */
export function scratchZone(): string {
  return `${E2E_PREFIX}${Date.now().toString(36)}.test`
}
