// Dev tool: static analysis of the Technitium console JS to derive the exact
// parameter names the official UI sends for every endpoint.
//
//   node scripts/probe/extract-params.mjs <dir-with-console-js>
//
// Output: <dir>/endpoints-params.json  + a TSV summary on stdout.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: extract-params.mjs <dir>')
  process.exit(1)
}
const files = readdirSync(dir).filter((f) => f.endsWith('.js'))

const IGNORE = new Set([
  'url', 'method', 'data', 'token', 'success', 'error', 'invalidToken',
  'twoFactorAuthRequired', 'objAlertPlaceholder', 'objLoaderPlaceholder',
  'processData', 'procecssData', 'contentType', 'dontHideAlert', 'showInnerError',
  'isTextResponse', 'dataType', 'async', 'cache', 'headers', 'if', 'else',
  'return', 'function', 'var', 'true', 'false', 'null', 'type',
])

/** endpointId -> { methods, query, body, seenIn } */
const map = new Map()

function bump(id, method, query, body, file) {
  if (!map.has(id)) map.set(id, { methods: new Set(), query: new Set(), body: new Set(), files: new Set() })
  const e = map.get(id)
  e.methods.add(method)
  query.forEach((q) => e.query.add(q))
  body.forEach((b) => e.body.add(b))
  e.files.add(file)
}

/** pull `key=` and `{ key:` tokens out of a raw expression blob */
function keys(src) {
  const out = []
  let m
  // The separator is kept because IGNORE alone cannot tell a query parameter
  // from a jQuery ajax option: `&url=` on `apps/downloadAndInstall` is a real
  // parameter the server requires, while `{ url: ... }` in the same call is
  // ajax plumbing. Only `?`/`&` position is unambiguous, so names seated there
  // survive the ignore list.
  const re1 = /(^|[?&"\s+])([A-Za-z_][A-Za-z0-9_]*)\s*=/g
  while ((m = re1.exec(src))) out.push({ name: m[2], sep: m[1] })
  const re2 = /[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g
  while ((m = re2.exec(src))) out.push({ name: m[1], sep: ':' })
  return [...new Map(out.map((k) => [k.name + k.sep, k])).values()]
    .filter((k) => !IGNORE.has(k.name) || k.sep === '?' || k.sep === '&')
    .map((k) => k.name)
}

for (const f of files) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n')

  lines.forEach((line, i) => {
    const m = line.match(/url\s*:\s*"(api\/[^"?]+)/)
    if (!m) return
    const id = m[1].replace(/^api\//, '').replace(/\/$/, '')

    let method = 'GET'
    const bodySrc = []
    for (let k = Math.max(0, i - 6); k < Math.min(lines.length, i + 24); k++) {
      const l = lines[k]
      const mm = l.match(/method\s*:\s*"([A-Z]+)"/)
      if (mm) method = mm[1]
      if (k >= i) {
        const dm = l.match(/(?:^|[\s{,])data\s*:\s*(.+)$/)
        if (dm) bodySrc.push(dm[1])
      }
    }

    // url line plus any string-concatenation continuation lines
    let urlBlob = line.slice(line.indexOf(m[1]))
    for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) {
      if (!/\+\s*$/.test(lines[k - 1].trim())) break
      urlBlob += ' ' + lines[k]
    }

    bump(id, method, keys(urlBlob), keys(bodySrc.join(' ')), f)
  })
}

const out = [...map.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([id, e]) => ({
    endpoint: id,
    methods: [...e.methods],
    query: [...e.query].sort(),
    body: [...e.body].sort(),
    seenIn: [...e.files],
  }))

writeFileSync(join(dir, 'endpoints-params.json'), JSON.stringify(out, null, 2))
console.log('endpoints discovered:', out.length)
for (const o of out) {
  console.log(`${o.endpoint}\t${o.methods.join('|')}\tQ:${o.query.join(',')}\tB:${o.body.join(',')}`)
}
