// Dev tool: harvest every <select> and its <option> values from the official
// console's index.html. These are the authoritative enum lists (record types,
// zone types, protocols, DNSSEC algorithms, ...) that the UI must offer.
//
//   node scripts/probe/extract-enums.mjs .probe/console-js/index.html
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
if (!file) {
  console.error('usage: extract-enums.mjs <index.html>')
  process.exit(1)
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const html = readFileSync(file, 'utf8')

const out = {}
const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
for (const m of html.matchAll(selectRe)) {
  const attrs = m[1]
  const inner = m[2]
  const idMatch = attrs.match(/\bid="([^"]+)"/i)
  const nameMatch = attrs.match(/\bname="([^"]+)"/i)
  const key = idMatch?.[1] ?? nameMatch?.[1]
  if (!key) continue

  const options = []
  const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
  for (const o of inner.matchAll(optRe)) {
    const oattrs = o[1]
    const v = oattrs.match(/\bvalue="([^"]*)"/i)?.[1]
    const label = o[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    options.push({ value: v ?? label, label: label || v || '' })
  }
  if (options.length === 0) continue
  if (!out[key]) out[key] = options
}

// radio groups also encode enums in this console
const radioRe = /<input\b([^>]*type="radio"[^>]*)>/gi
const radios = {}
for (const m of html.matchAll(radioRe)) {
  const attrs = m[1]
  const name = attrs.match(/\bname="([^"]+)"/i)?.[1]
  const value = attrs.match(/\bvalue="([^"]*)"/i)?.[1]
  if (!name || value === undefined) continue
  ;(radios[name] ??= new Set()).add(value)
}
const radioOut = {}
for (const [k, v] of Object.entries(radios)) radioOut[k] = [...v]

const result = { selects: out, radios: radioOut }
writeFileSync(join(repoRoot, '.probe', 'enums.json'), JSON.stringify(result, null, 2))

console.log(`selects: ${Object.keys(out).length}, radio groups: ${Object.keys(radioOut).length}`)
const interesting = Object.keys(out).filter((k) => /type|protocol|algorithm|state|scheme|policy|access|transfer|digest|hash|curve|mode|scope|option/i.test(k))
for (const k of interesting) {
  console.log(`  ${k} = [${out[k].map((o) => o.value).join(', ')}]`)
}
