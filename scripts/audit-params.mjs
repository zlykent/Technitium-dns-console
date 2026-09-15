/**
 * Cross-check every parameter name the SDK sends against the names the real
 * Technitium console sends for the same endpoint.
 *
 * Why this exists: `admin/users/set` accepts an unknown parameter without
 * complaint and answers `status: ok`. A misspelled rename field therefore
 * reported success while doing nothing — invisible to every test that only
 * asserts "no error". Only the upstream's own JavaScript knows the real names,
 * and it is already on disk from the probe step.
 *
 * Exits non-zero on a name that is neither upstream's nor listed in
 * `BENIGN_EXTRA_PARAMS`, so it can sit in the `verify` chain: the two ways a
 * name ends up unexplained are a typo (silent no-op on a live server) and a
 * newly added parameter nobody wrote down a justification for.
 *
 * Usage: node scripts/audit-params.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const JS_DIR = join(ROOT, '.probe', 'console-js')

if (!existsSync(JS_DIR)) {
  console.error('missing .probe/console-js — run the probe step first')
  process.exit(1)
}

// ---------------------------------------------------------------- upstream

/**
 * Pull `paramName` out of every `api/<endpoint>?a=..&b=..` literal and every
 * `params += "&b="` that follows it in the same function.
 *
 * The console builds URLs by string concatenation across several statements, so
 * a single regex over the whole file is not enough — this walks line by line and
 * attributes an appended parameter to the most recent endpoint it saw.
 */
function upstreamParams() {
  const found = new Map() // endpoint -> Set<param>
  const add = (endpoint, param) => {
    if (!endpoint || !param) return
    if (!found.has(endpoint)) found.set(endpoint, new Set())
    found.get(endpoint).add(param)
  }

  for (const file of readdirSync(JS_DIR)) {
    if (!file.endsWith('.js')) continue
    const lines = readFileSync(join(JS_DIR, file), 'utf8').split(/\r?\n/)
    let current = null
    for (const line of lines) {
      // A fresh `api/<endpoint>?a=1&b=2` literal resets the attribution window.
      const url = line.match(/["'`](?:\/)?api\/([A-Za-z0-9_/]+)\?([^"'`]*)/)
      if (url) {
        current = url[1]
        for (const pair of url[2].split('&')) {
          const name = pair.split('=')[0].trim()
          if (name && !name.startsWith('"') && !name.includes('$')) add(current, name)
        }
        // The console keeps concatenating the query on the *same* line —
        //   "api/zones/list?filterName=" + encodeURIComponent(x) + "&node=" + …
        // — and the capture above stops at the first closing quote, so without
        // this every parameter after the first looked like our invention. That
        // is what made `node` (a real cluster-targeting parameter upstream sends
        // on ~25 endpoints) show up as unverified across the whole report.
        for (const rest of line.matchAll(/&([A-Za-z0-9_]+)=/g)) add(current, rest[1])
        continue
      }
      // `api/<endpoint>` with the query built separately.
      const bare = line.match(/["'`](?:\/)?api\/([A-Za-z0-9_/]+)["'`]/)
      if (bare && !line.includes('?')) current = bare[1]

      if (!current) continue
      // `params += "&name=" + ...` / `apiUrl += "&name=" + ...`
      const append = line.match(/\+=\s*["'`]&([A-Za-z0-9_]+)=/)
      if (append) add(current, append[1])
      // `data: "config=" + encodeURIComponent(x)` — a POST body's field names are
      // parameters too, and the `inline` rule below cannot see them because the
      // quote is preceded by `:` rather than `=`. `apps/config/set` keeps its
      // `name` in the query and its `config` in the body, so without this the
      // body half looked invented.
      const body = line.match(/\bdata\s*:\s*["'`]([A-Za-z0-9_]+=[^"'`]*)/)
      if (body) {
        for (const pair of body[1].split('&')) {
          const name = pair.split('=')[0].trim()
          if (/^[A-Za-z0-9_]+$/.test(name)) add(current, name)
        }
        for (const rest of line.matchAll(/&([A-Za-z0-9_]+)=/g)) add(current, rest[1])
      }
      // `var params = "a=1&b=2"`
      const inline = line.match(/=\s*"([A-Za-z0-9_]+=[^"]*)"|=\s*'([A-Za-z0-9_]+=[^']*)'/)
      if (inline) {
        const body = inline[1] ?? inline[2]
        for (const pair of body.split('&')) {
          const name = pair.split('=')[0].trim()
          if (/^[A-Za-z0-9_]+$/.test(name)) add(current, name)
        }
      }
      // URLSearchParams-style / object literal keys are not used by this console.
    }
  }
  return found
}

// -------------------------------------------------------------------- ours

/** Parameter names our own types declare, keyed by endpoint. */
function sdkParams() {
  const out = new Map()
  const domainsDir = join(ROOT, 'lib', 'api', 'domains')
  const typesDir = join(ROOT, 'lib', 'api', 'types')

  // Resolve a spread identifier to the keys of its declared interface.
  const interfaces = new Map()
  for (const file of readdirSync(typesDir)) {
    if (!file.endsWith('.ts')) continue
    const src = readFileSync(join(typesDir, file), 'utf8')
    for (const match of src.matchAll(/export interface (\w+)(?: extends [\w,\s]+)?\s*\{([\s\S]*?)\n\}/g)) {
      const keys = new Set()
      for (const line of match[2].split(/\r?\n/)) {
        const key = line.match(/^\s*(\w+)\??:/)
        if (key) keys.add(key[1])
      }
      interfaces.set(match[1], keys)
    }
  }

  // Every call site is one line: `apiRequest<T>('endpoint', { ... })`. Reading
  // the remainder of the line sidesteps the nested braces in the options object
  // that a `[^}]*` pattern cannot survive.
  for (const file of readdirSync(domainsDir)) {
    if (!file.endsWith('.ts')) continue
    const lines = readFileSync(join(domainsDir, file), 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const call = line.match(/apiRequest<[^>]*>\(\s*'([A-Za-z0-9_/]+)'\s*,\s*(.+)$/) ?? line.match(/api(?:Download|DownloadBlob)[^(]*\(\s*'([A-Za-z0-9_/]+)'\s*,\s*(.+)$/)
      if (!call) continue
      const [, endpoint, rest] = call
      const set = out.get(endpoint) ?? new Set()

      // `{ ...SomeParams }` — a whole interface is forwarded verbatim.
      for (const spread of rest.matchAll(/\.\.\.(\w+)/g)) {
        for (const key of interfaces.get(spread[1]) ?? []) set.add(key)
      }
      // `{ node }` / `{ user, node }` / `{ zone: name }` — shorthand or renamed.
      for (const literal of rest.matchAll(/(?:params|body)\s*:\s*\{([^{}]*)\}/g)) {
        for (const part of literal[1].split(',')) {
          const key = part.match(/^\s*(\w+)\s*(?::|$)/)
          if (key && key[1] !== 'raw') set.add(key[1])
        }
      }
      // `formData` built separately: the variable names are the field names.
      for (const fd of rest.matchAll(/formData\s*:\s*(\w+)/g)) set.add(`<<formData:${fd[1]}>>`)

      if (set.size > 0) out.set(endpoint, set)
    }
  }
  return out
}

// -------------------------------------------------------------------- main

/**
 * Parameter names we send that the stock console does not, and why that is safe.
 *
 * Without this list the report is advisory noise that a reader has to
 * re-derive by hand on every run — which is how a genuinely misspelled name
 * hides among the benign ones. An entry here has to state the mechanism that
 * makes the extra parameter harmless.
 */
const BENIGN_EXTRA_PARAMS = new Map([
  [
    'node',
    'Cluster-node targeting. `appendParams` (lib/api/client.ts:226) drops an ' +
      'undefined value, so on a server with no node selected nothing extra is sent ' +
      'and the request is byte-identical to upstream. The stock console only wires ' +
      'a node picker into ~25 of its screens; the parameter itself is a general ' +
      'Technitium one, and where an endpoint ignores it the effect is nil.',
  ],
])

const upstream = upstreamParams()
const ours = sdkParams()

let suspect = 0
let benign = 0
const report = []
let compared = 0
for (const [endpoint, sent] of [...ours.entries()].sort()) {
  const known = upstream.get(endpoint)
  if (!known) continue // the console never calls it inline; nothing to compare
  compared += 1
  // `<<formData:x>>` marks a multipart body assembled elsewhere; the field
  // names are not visible from the call site, so they cannot be checked here.
  const unknown = [...sent].filter((p) => !p.startsWith('<<') && !known.has(p))
  if (unknown.length === 0) continue
  const explained = unknown.filter((p) => BENIGN_EXTRA_PARAMS.has(p))
  const unexplained = unknown.filter((p) => !BENIGN_EXTRA_PARAMS.has(p))
  benign += explained.length
  suspect += unexplained.length
  report.push({ endpoint, explained, unexplained, known: [...known].sort() })
}

for (const { endpoint, explained, unexplained, known } of report) {
  console.log(`\n${endpoint}`)
  if (unexplained.length > 0) console.log(`  ! ours but not upstream: ${unexplained.join(', ')}`)
  if (explained.length > 0) console.log(`  · explained extra:       ${explained.join(', ')}`)
  console.log(`  upstream accepts:        ${known.join(', ')}`)
}

console.log(`\n=== ${suspect} unexplained parameter name(s) across ${report.length} endpoint(s) ===`)
console.log(`(${benign} explained by BENIGN_EXTRA_PARAMS; upstream endpoints parsed: ${upstream.size}; sdk endpoints compared: ${compared}/${ours.size})`)

if (suspect > 0) {
  console.error(
    '\nparameter audit FAILED — an unexplained name above is either a typo ' +
      '(the server answers `status: ok` and changes nothing) or a new benign ' +
      'parameter that needs an entry in BENIGN_EXTRA_PARAMS with its reason.',
  )
  process.exit(1)
}
console.log('parameter audit passed — every name we send is one upstream sends, or is explained')
