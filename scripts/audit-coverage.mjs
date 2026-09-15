/**
 * Endpoint coverage audit — the "is every feature actually wired up?" gate.
 *
 * Three sets are compared:
 *
 *   upstream   every `api/<path>` literal in the stock console's JavaScript
 *   registry   the keys of `ENDPOINTS` in `lib/api/registry.ts`
 *   sdk        the endpoints a function in `lib/api/domains/*.ts` really calls
 *
 * Why each direction matters:
 *
 *  - **upstream − registry** is a feature this console cannot even reach: the
 *    proxy allowlist would refuse it. `gen-registry.mjs` harvests the same
 *    literal with the same pattern, so this should stay empty; a non-empty
 *    result means the registry was hand-edited (its header forbids that) or the
 *    probe snapshot was refreshed without regenerating.
 *  - **registry − sdk** is the interesting one: an endpoint the server offers
 *    and the proxy would forward, but that no UI action ever calls. That is an
 *    unimplemented feature wearing a type definition. Entries here must be
 *    listed in `DELIBERATELY_UNUSED` with a reason, so "we chose not to" and
 *    "we forgot" stay distinguishable.
 *  - **sdk − registry** cannot happen while `EndpointId` is a literal union, but
 *    the check is free and would catch a loosened signature.
 *
 * Usage: node scripts/audit-coverage.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const JS_DIR = join(ROOT, '.probe', 'console-js')
const REGISTRY = join(ROOT, 'lib', 'api', 'registry.ts')
const DOMAINS_DIR = join(ROOT, 'lib', 'api', 'domains')

/**
 * Endpoints in the registry that no SDK function calls, and why that is correct.
 *
 * Keep the reason next to the name: an unexplained gap here is indistinguishable
 * from a feature nobody finished, which is the whole thing this script exists to
 * prevent.
 */
const DELIBERATELY_UNUSED = new Map([
  [
    'user/createSingleUseToken',
    'Downloads stream through the proxy as a blob instead. The classic Technitium ' +
      '`?token=` single-use-token URL would put a credential in browser history, server ' +
      'logs and the Referer header — see the note in lib/proxy/cookies.ts.',
  ],
])

for (const dir of [JS_DIR, DOMAINS_DIR]) {
  if (!existsSync(dir)) {
    console.error(`missing ${dir} — run the probe step first`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- upstream

/**
 * The same harvest `scripts/probe/gen-registry.mjs` performs, deliberately
 * character-for-character: two patterns that drift apart would let an endpoint
 * exist in one set and not the other for no reason but the regex.
 */
function upstreamEndpoints() {
  const paths = new Set()
  for (const file of readdirSync(JS_DIR)) {
    if (!file.endsWith('.js')) continue
    const src = readFileSync(join(JS_DIR, file), 'utf8')
    for (const m of src.matchAll(/(?<![\w/.])api\/([A-Za-z0-9_/]+)/g)) {
      const id = m[1].replace(/\/+$/, '')
      if (id && id.includes('/')) paths.add(id)
      else if (id === 'status') paths.add(id)
    }
  }
  return paths
}

// ---------------------------------------------------------------- registry

/** Keys of the `ENDPOINTS` object literal: `'path': { methods: ... }`. */
function registryEndpoints() {
  const src = readFileSync(REGISTRY, 'utf8')
  const body = src.slice(src.indexOf('export const ENDPOINTS'))
  const paths = new Set()
  for (const m of body.matchAll(/^\s*'([A-Za-z0-9_/]+)':\s*\{\s*methods:/gm)) paths.add(m[1])
  return paths
}

// --------------------------------------------------------------------- sdk

/**
 * Endpoints a domain module can reach.
 *
 * Two shapes have to be recognised, and only the first is a direct call:
 *
 *   apiRequest('zones/list', ...)
 *   apiRequest(LIST_ENDPOINT[scope], ...)   // filtering.ts
 *
 * `lib/api/domains/filtering.ts` drives cache/allowed/blocked from one set of
 * functions, so its endpoint ids live in `as const` maps keyed by scope rather
 * than next to a call. That keeps them literal `EndpointId` members — no cast,
 * so the compiler still rejects a typo — but it means "adjacent to a call" is
 * not a sufficient test.
 *
 * So: every quoted literal in the domain modules that names a registry entry
 * counts as reachable. The failure mode of the looser rule is a *hidden* gap (a
 * literal that merely mentions an id would look like usage), which is why the
 * E2E suite stays the backstop for "is the button actually wired up".
 */
function sdkEndpoints(registry) {
  const paths = new Set()
  for (const file of readdirSync(DOMAINS_DIR)) {
    if (!file.endsWith('.ts')) continue
    const src = readFileSync(join(DOMAINS_DIR, file), 'utf8')
    for (const m of src.matchAll(/'([A-Za-z0-9_/]+)'/g)) {
      if (registry.has(m[1])) paths.add(m[1])
    }
  }
  return paths
}

// -------------------------------------------------------------------- main

const upstream = upstreamEndpoints()
const registry = registryEndpoints()
const sdk = sdkEndpoints(registry)

const missingFromRegistry = [...upstream].filter((id) => !registry.has(id)).sort()
const extraInRegistry = [...registry].filter((id) => !upstream.has(id)).sort()
const unregisteredCalls = [...sdk].filter((id) => !registry.has(id)).sort()
const notCalledBySdk = [...registry].filter((id) => !sdk.has(id)).sort()

const unexplained = notCalledBySdk.filter((id) => !DELIBERATELY_UNUSED.has(id))
const staleAllowlist = [...DELIBERATELY_UNUSED.keys()].filter((id) => !notCalledBySdk.includes(id))

console.log(`upstream ${upstream.size} · registry ${registry.size} · called by the SDK ${sdk.size}`)

for (const id of notCalledBySdk) {
  const reason = DELIBERATELY_UNUSED.get(id)
  console.log(`  ${reason ? '·' : '!'} ${id}${reason ? ` — ${reason}` : ''}`)
}

let failures = 0
function report(label, list) {
  if (list.length === 0) return
  failures += list.length
  console.log(`\n${label} (${list.length})`)
  for (const id of list) console.log(`  ${id}`)
}

report('MISSING FROM REGISTRY — upstream offers it, the proxy would refuse it', missingFromRegistry)
report('IN REGISTRY BUT NOT UPSTREAM — stale entry, or a hand edit', extraInRegistry)
report('CALLED BUT NOT REGISTERED — would throw endpoint_not_found at runtime', unregisteredCalls)
report('NEVER CALLED AND NOT EXPLAINED — an unimplemented feature', unexplained)
report('ALLOWLIST ENTRY NOW CALLED — remove it from DELIBERATELY_UNUSED', staleAllowlist)

if (failures > 0) {
  console.error(`\ncoverage audit FAILED — ${failures} problem(s)`)
  process.exit(1)
}
console.log(
  `\ncoverage audit passed — every upstream endpoint is registered, and all but ` +
    `${DELIBERATELY_UNUSED.size} documented exception(s) are reachable from the UI`,
)
