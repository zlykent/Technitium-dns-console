// Dev tool: live-probe the read-only Technitium endpoints and persist their real
// response payloads, so the TypeScript layer is derived from observed shapes
// instead of guesswork.
//
//   node scripts/probe/probe-api.mjs <baseUrl> <user> <pass> <outDir>
//
// Only GET/read-only endpoints are called. Nothing destructive is touched.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [baseUrl, user, pass, outDir] = process.argv.slice(2)
if (!baseUrl || !user || !pass || !outDir) {
  console.error('usage: probe-api.mjs <baseUrl> <user> <pass> <outDir>')
  process.exit(1)
}

const root = baseUrl.replace(/\/$/, '')
mkdirSync(outDir, { recursive: true })

let token = ''

async function call(endpoint, { method = 'GET', params = {}, form } = {}) {
  const url = new URL(`${root}/api/${endpoint}`)
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let body
  if (method === 'POST') {
    if (form) {
      body = form
    } else {
      body = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
      ).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  } else {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }

  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { __raw: text.slice(0, 2000) }
  }
  return { httpStatus: res.status, json, text }
}

// ---------------------------------------------------------------- login
{
  const r = await call('user/login', {
    method: 'POST',
    form: new URLSearchParams({ user, pass, includeInfo: 'true' }),
  })
  if (r.json.status !== 'ok') {
    console.error('LOGIN FAILED:', JSON.stringify(r.json).slice(0, 400))
    process.exit(1)
  }
  token = r.json.token
  writeFileSync(join(outDir, 'user.login.json'), JSON.stringify(r.json, null, 2))
  console.log('login ok, version =', r.json.info?.version)
}

// ---------------------------------------------------------------- seeds
const seeds = { zone: '', domain: '', group: '', section: '', app: '', scope: '', log: '', keyTag: '', server: '' }

async function seed(endpoint, params, pick) {
  const r = await call(endpoint, { params })
  if (r.json.status === 'ok') pick(r.json)
  else console.warn(`seed ${endpoint} -> ${r.json.status}: ${r.json.errorMessage}`)
  return r
}

await seed('zones/list', { pageNumber: 1, zonesPerPage: 100 }, (j) => {
  const z = j.response?.zones?.[0]
  if (z) {
    seeds.zone = z.name
    seeds.domain = z.name
  }
})
await seed('admin/groups/list', {}, (j) => {
  seeds.group = j.response?.groups?.[0]?.name ?? ''
})
await seed('admin/permissions/list', {}, (j) => {
  seeds.section = j.response?.permissions?.[0]?.section ?? ''
})
await seed('apps/list', {}, (j) => {
  seeds.app = j.response?.apps?.[0]?.name ?? ''
})
await seed('dhcp/scopes/list', {}, (j) => {
  seeds.scope = j.response?.scopes?.[0]?.name ?? ''
})
await seed('logs/list', {}, (j) => {
  seeds.log = j.response?.logFiles?.[0]?.fileName ?? ''
})
seeds.server = new URL(root).hostname

console.log('seeds:', JSON.stringify(seeds))
writeFileSync(join(outDir, '_seeds.json'), JSON.stringify(seeds, null, 2))

// ------------------------------------------------------- read-only probes
const PROBES = [
  ['status', {}],
  ['user/session/get', {}],
  ['user/profile/get', {}],
  ['user/checkForUpdate', {}],
  ['admin/users/list', {}],
  ['admin/users/get', { user, includeGroups: true }],
  ['admin/groups/list', {}],
  ['admin/groups/get', { group: seeds.group, includeUsers: true }],
  ['admin/permissions/list', {}],
  ['admin/permissions/get', { section: seeds.section, includeUsersAndGroups: true }],
  ['admin/sessions/list', {}],
  ['admin/sso/get', { includeGroups: true }],
  ['admin/cluster/state', { includeServerIpAddresses: true }],
  ['zones/list', { pageNumber: 1, zonesPerPage: 100 }],
  ['zones/catalogs/list', {}],
  ['zones/options/get', { zone: seeds.zone, includeAvailableCatalogZoneNames: true, includeAvailableTsigKeyNames: true }],
  ['zones/permissions/get', { zone: seeds.zone, includeUsersAndGroups: true }],
  ['zones/dnssec/properties/get', { zone: seeds.zone }],
  ['zones/dnssec/viewDS', { zone: seeds.zone }],
  ['zones/records/get', { domain: seeds.domain }],
  ['zones/records/get', { domain: seeds.domain, listZone: true }, 'listZone'],
  ['dashboard/stats/get', { type: 'LastHour', utc: true }],
  ['dashboard/stats/get', { type: 'LastDay', utc: true }, 'lastDay'],
  ['dashboard/stats/getTop', { type: 'LastHour', statsType: 'TopClients', limit: 10 }],
  ['dashboard/stats/getTop', { type: 'LastHour', statsType: 'TopDomains', limit: 10 }, 'topDomains'],
  ['dashboard/stats/getTop', { type: 'LastHour', statsType: 'TopBlockedDomains', limit: 10 }, 'topBlocked'],
  ['cache/list', { domain: seeds.domain }],
  ['allowed/list', {}],
  ['blocked/list', {}],
  ['apps/list', {}],
  ['apps/listStoreApps', {}],
  ['apps/config/get', { name: seeds.app }],
  ['dhcp/scopes/list', {}],
  ['dhcp/scopes/get', { name: seeds.scope }],
  ['dhcp/leases/list', {}],
  ['logs/list', {}],
  ['logs/query', { name: seeds.log, classPath: '', pageNumber: 1, entriesPerPage: 20, descendingOrder: true }],
  ['logs/query', { name: seeds.log, classPath: '*', pageNumber: 1, entriesPerPage: 5, descendingOrder: true }, 'starClassPath'],
  ['settings/get', {}],
  ['settings/getTsigKeyNames', {}],
  ['dnsClient/resolve', { domain: 'example.com', type: 'A', protocol: 'Udp', server: seeds.server, dnssec: false }],
  ['dnsClient/resolve', { domain: seeds.domain, type: 'SOA', protocol: 'Udp', server: seeds.server, dnssec: false }, 'soa'],
]

const summary = []
for (const [endpoint, params, tag] of PROBES) {
  const name = endpoint.replaceAll('/', '.') + (tag ? `.${tag}` : '')
  try {
    const r = await call(endpoint, { params })
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(r.json, null, 2))
    const ok = r.json.status === 'ok'
    summary.push({ endpoint, tag: tag ?? '', httpStatus: r.httpStatus, status: r.json.status, ok, params, error: r.json.errorMessage ?? '' })
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  ${ok ? '' : '-> ' + r.json.status + ': ' + (r.json.errorMessage ?? '').slice(0, 120)}`)
  } catch (e) {
    summary.push({ endpoint, tag: tag ?? '', ok: false, error: String(e.message) })
    console.log(`ERR  ${name} -> ${e.message}`)
  }
}

writeFileSync(join(outDir, '_summary.json'), JSON.stringify(summary, null, 2))
console.log('\nprobed:', summary.length, ' ok:', summary.filter((s) => s.ok).length)
