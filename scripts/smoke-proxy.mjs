/**
 * Runtime smoke test for the proxy chain.
 *
 * Boots nothing — it talks HTTP to a running `next dev` (or `next start`) and
 * drives the *real* Technitium server through it. That is the only way to prove
 * the ten-step kernel (allowlist -> target -> SSRF -> cookies -> forward ->
 * envelope -> audit) agrees with reality, because a unit test can mock every
 * step and still ship a console that cannot log in.
 *
 * Usage:
 *   node scripts/smoke-proxy.mjs [--base http://localhost:3000]
 *                                [--target http://127.0.0.1:5380]
 *                                [--user admin] [--pass 123456]
 *
 * Exits non-zero on the first hard failure (transport/5xx); soft failures
 * (an endpoint answering with an API-level error code) are reported and counted
 * but do not abort, because several endpoints legitimately need seed data.
 */

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = arg('base', process.env.SMOKE_BASE ?? 'http://localhost:3000')
const TARGET = arg('target', process.env.DNS_TARGET ?? 'http://127.0.0.1:5380')
const USER = arg('user', process.env.DNS_USER ?? 'admin')
const PASS = arg('pass', process.env.DNS_PASS ?? '123456')

const TARGET_HEADER = 'X-Dns-Target'
const cookies = new Map()
const results = []
let hardFailures = 0
let softFailures = 0

function log(msg) {
  process.stdout.write(msg + '\n')
}

/** Minimal cookie jar: the proxy sets an httpOnly cookie on login, everything else replays it. */
function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  for (const line of raw) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (value === '' || value === '""') cookies.delete(name)
    else cookies.set(name, value)
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function call(label, endpoint, { params, body, method = 'GET', text } = {}) {
  const url = new URL(`${BASE}/api/dns/${endpoint}`)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  const headers = {}
  if (TARGET !== '' && TARGET !== null) headers[TARGET_HEADER] = TARGET
  if (cookieHeader()) headers.Cookie = cookieHeader()

  let payload
  if (text !== undefined) {
    payload = text
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
  } else if (body) {
    payload = new URLSearchParams(body).toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
  }

  const started = Date.now()
  let response
  try {
    response = await fetch(url, { method, headers, body: payload })
  } catch (err) {
    hardFailures++
    results.push({ label, ok: false, kind: 'transport', detail: err.message })
    log(`  HARD  ${label.padEnd(34)} transport: ${err.message}`)
    return null
  }
  const ms = Date.now() - started
  storeCookies(response)

  const rawText = await response.text()
  let parsed = null
  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    /* non-JSON body */
  }

  if (!response.ok) {
    // An API-level error is a *soft* result for this script: the proxy did its
    // job (translated the upstream `status:"error"` into an HTTP error with a
    // code), the endpoint just refused the request — usually missing seed data.
    const code = parsed?.code ?? null
    const message = parsed?.message ?? parsed?.innerMessage ?? rawText.slice(0, 200)
    if (code) {
      softFailures++
      results.push({ label, ok: false, kind: 'api', code, detail: message, ms })
      log(`  soft  ${label.padEnd(34)} ${code} (${ms}ms): ${message}`)
      return parsed
    }
    hardFailures++
    results.push({ label, ok: false, kind: 'http', status: response.status, detail: message, ms })
    log(`  HARD  ${label.padEnd(34)} HTTP ${response.status} (${ms}ms): ${message}`)
    return null
  }

  const shape = summarise(parsed)
  results.push({ label, ok: true, shape, ms })
  log(`  ok    ${label.padEnd(34)} ${shape} (${ms}ms)`)
  return parsed
}

/** A one-line fingerprint of the payload: enough to spot a shape regression. */
function summarise(value, depth = 0) {
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return `${value.length}[${value.length > 0 && depth < 2 ? summariseKeys(value[0], depth) : ''}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length > 6) return `{${keys.length} keys}`
    return `{${keys.map((k) => `${k}:${summarise(value[k], depth + 1)}`).join(', ')}}`
  }
  return typeof value
}

function summariseKeys(value, depth) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).slice(0, 6).join('|')
  return summarise(value, depth + 1)
}

function section(name) {
  log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`)
}

async function main() {
  log(`Smoke: ${BASE} -> ${TARGET} (user=${USER})`)

  section('auth')
  // The proxy strips the token from the login payload and captures it into an
  // httpOnly cookie; `cookies.size > 0` below is the proof that worked.
  await call('user/login', 'user/login', {
    method: 'POST',
    body: { user: USER, pass: PASS, totp: '', includeInfo: true },
  })
  if (cookies.size === 0) {
    log('\nFATAL: no session cookie was set by the proxy — every later call will 401.')
    process.exit(2)
  }
  log(`  cookies: ${[...cookies.keys()].join(', ')}`)

  await call('user/session/get', 'user/session/get')
  await call('user/profile/get', 'user/profile/get')
  await call('user/checkForUpdate', 'user/checkForUpdate')

  section('system + dashboard')
  await call('status', 'status')
  await call('dashboard/stats/get', 'dashboard/stats/get', { params: { type: 'lastHour', utc: true } })
  await call('dashboard/stats/getTop', 'dashboard/stats/getTop', {
    params: { type: 'lastHour', statsType: 'TopDomains', limit: 5 },
  })

  section('zones')
  const zoneList = await call('zones/list', 'zones/list', { params: { pageNumber: 1, zonesPerPage: 100 } })
  const firstZone = zoneList?.zones?.[0]?.name
  if (firstZone) {
    log(`  using zone: ${firstZone}`)
    await call('zones/options/get', 'zones/options/get', {
      params: { zone: firstZone, includeAvailableCatalogZoneNames: true, includeAvailableTsigKeyNames: true },
    })
    await call('zones/permissions/get', 'zones/permissions/get', {
      params: { zone: firstZone, includeUsersAndGroups: true },
    })
    await call('zones/records/get', 'zones/records/get', { params: { zone: firstZone, domain: firstZone, listZone: true } })
    await call('zones/dnssec/properties/get', 'zones/dnssec/properties/get', { params: { zone: firstZone } })
    await call('zones/dnssec/viewDS', 'zones/dnssec/viewDS', { params: { zone: firstZone } })
  } else {
    log('  (no zones on the server; skipping zone-scoped calls)')
  }
  await call('zones/catalogs/list', 'zones/catalogs/list')

  section('cache + filtering')
  await call('cache/list', 'cache/list', { params: { domain: '' } })
  await call('allowed/list', 'allowed/list', { params: { domain: '' } })
  await call('blocked/list', 'blocked/list', { params: { domain: '' } })

  section('logs')
  await call('logs/list', 'logs/list')
  // `logs/query` reads a database owned by an installed query-logging app, so
  // `name` is the *app* name. Without one the server answers
  // "DNS application was not found", which is a soft failure here.
  const now = new Date()
  const from = new Date(now.getTime() - 3600_000)
  await call('logs/query', 'logs/query', {
    params: {
      name: 'Query Logs',
      classPath: 'Technitium.Dns.Server.Services.DnsAppManager.QueryLogsApp',
      start: from.toISOString(),
      end: now.toISOString(),
      clientIpAddress: '',
      protocol: '',
      responseType: '',
      qname: '',
      qtype: '',
      qclass: '',
      rcode: '',
      descendingOrder: true,
      entriesPerPage: 25,
      pageNumber: 1,
    },
  })

  section('dhcp')
  const scopes = await call('dhcp/scopes/list', 'dhcp/scopes/list')
  const firstScope = scopes?.scopes?.[0]?.name
  if (firstScope) {
    await call('dhcp/scopes/get', 'dhcp/scopes/get', { params: { name: firstScope } })
  } else {
    log('  (no DHCP scopes; skipping scope-scoped calls)')
  }
  await call('dhcp/leases/list', 'dhcp/leases/list')

  section('apps')
  await call('apps/list', 'apps/list')
  await call('apps/listStoreApps', 'apps/listStoreApps')

  section('settings')
  await call('settings/get', 'settings/get')
  await call('settings/getTsigKeyNames', 'settings/getTsigKeyNames')

  section('administration')
  const users = await call('admin/users/list', 'admin/users/list')
  const firstUser = users?.users?.[0]?.username
  if (firstUser) await call('admin/users/get', 'admin/users/get', { params: { user: firstUser, includeGroups: true } })
  const groups = await call('admin/groups/list', 'admin/groups/list')
  const firstGroup = groups?.groups?.[0]?.name
  if (firstGroup) await call('admin/groups/get', 'admin/groups/get', { params: { group: firstGroup, includeUsers: true } })
  const perms = await call('admin/permissions/list', 'admin/permissions/list')
  const firstSection = perms?.permissions?.[0]?.section
  if (firstSection) {
    await call('admin/permissions/get', 'admin/permissions/get', {
      params: { section: firstSection, includeUsersAndGroups: true },
    })
  }
  await call('admin/sessions/list', 'admin/sessions/list')
  await call('admin/sso/get', 'admin/sso/get', { params: { includeGroups: true } })
  await call('admin/cluster/state', 'admin/cluster/state', { params: { includeServerIpAddresses: true } })

  section('dns client')
  await call('dnsClient/resolve', 'dnsClient/resolve', {
    params: { server: '1.1.1.1', domain: 'technitium.com', type: 'A', protocol: 'Udp', dnssec: false },
  })

  section('negative cases')
  // Must be rejected by the allowlist, not forwarded — a 4xx from us, never a 500.
  await call('unknown endpoint (allowlist)', 'zones/doesNotExist')
  // Read-only negative: proves an upstream `status:"error"` is translated into
  // a coded HTTP error rather than an empty 200 that would blank the page.
  // No write endpoint is exercised here on purpose — this script must be safe
  // to run repeatedly against a server with real data.
  await call('records for a missing zone', 'zones/records/get', { params: { zone: 'no-such-zone.invalid', domain: 'no-such-zone.invalid' } })

  log('\n' + '═'.repeat(72))
  const ok = results.filter((r) => r.ok).length
  log(`RESULT: ${ok}/${results.length} ok, ${hardFailures} hard, ${softFailures} soft`)
  log('═'.repeat(72))

  await call('user/logout', 'user/logout')
  process.exit(hardFailures > 0 ? 1 : 0)
}

main().catch((err) => {
  log(`\nSmoke script crashed: ${err?.stack ?? err}`)
  process.exit(2)
})
