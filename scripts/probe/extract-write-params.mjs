// Dev tool: extract write-side parameter names for POST endpoints.
//
// extract-params.mjs only saw jQuery `data: {...}` object literals. Most of the
// console's mutations instead build a query string in a `formData` variable and
// pass it as `data: formData`, so the real parameter names live in the string
// concatenation above the call. This scans a window around every `api/<id>`
// reference and harvests every `key=` / `formData.append("key"` / `data["key"]`
// it can find.
//
//   node scripts/probe/extract-write-params.mjs .probe/console-js
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: extract-write-params.mjs <consoleJsDir>')
  process.exit(1)
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const BEFORE = 9000
const AFTER = 600

const result = new Map()

function add(endpoint, key) {
  if (!key || key.length > 40) return
  if (/^\d+$/.test(key)) return
  const set = result.get(endpoint) ?? new Set()
  set.add(key)
  result.set(endpoint, set)
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(dir, file), 'utf8')
  for (const m of src.matchAll(/(?<![\w/.])api\/([A-Za-z0-9_/]+)/g)) {
    const endpoint = m[1]
    const window = src.slice(Math.max(0, m.index - BEFORE), m.index + AFTER)

    // `&key=` / `?key=` inside a concatenated form string
    for (const k of window.matchAll(/[&?]([A-Za-z][A-Za-z0-9_]*)=/g)) add(endpoint, k[1])
    // FormData uploads
    for (const k of window.matchAll(/\.append\(\s*["']([A-Za-z][A-Za-z0-9_]*)["']/g)) add(endpoint, k[1])
    // jQuery object literal `data: { key: value }`
    for (const k of window.matchAll(/data:\s*\{([^}]*)\}/g)) {
      for (const p of k[1].matchAll(/(?:^|[{,\s])([A-Za-z][A-Za-z0-9_]*)\s*:/g)) add(endpoint, p[1])
    }
    // `data["key"] = ...`
    for (const k of window.matchAll(/data\[\s*["']([A-Za-z][A-Za-z0-9_]*)["']\s*\]/g)) add(endpoint, k[1])
    // URL query built separately, e.g. `url += "&key=" + x`
    for (const k of window.matchAll(/["'`][&?]([A-Za-z][A-Za-z0-9_]*)=["'`]/g)) add(endpoint, k[1])
  }
}

// noise that is never an API parameter
const STOP = new Set(['token', 'url', 'type', 'method', 'dataType', 'contentType', 'processData', 'success', 'error', 'cache', 'async', 'beforeSend'])

const out = {}
for (const [endpoint, keys] of [...result].sort((a, b) => a[0].localeCompare(b[0]))) {
  out[endpoint] = [...keys].filter((k) => !STOP.has(k) || k === 'type').sort()
}

writeFileSync(join(repoRoot, '.probe', 'write-params.json'), JSON.stringify(out, null, 2))

const tsv = Object.entries(out)
  .map(([k, v]) => `${k}\t${v.join(',')}`)
  .join('\n')
writeFileSync(join(repoRoot, '.probe', 'write-params.tsv'), tsv + '\n')

console.log(`${Object.keys(out).length} endpoints with harvested parameters`)
for (const focus of process.argv.slice(3)) {
  console.log(`\n${focus}: ${(out[focus] ?? []).join(', ') || '(none)'}`)
}
