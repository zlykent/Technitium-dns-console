// Dev tool: recover the element shape of arrays that were EMPTY in the live
// probe (cache records, blocked zones, dhcp leases, apps, dnssec keys, ...) by
// harvesting `response.<arr>[i].<field>` accesses from the official console JS.
//
//   node scripts/probe/extract-shapes.mjs <dir-with-console-js>
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const files = readdirSync(dir).filter((f) => f.endsWith('.js'))

/** "<path>.<arr>" -> Set<field> */
const arrays = new Map()
/** "<path>" -> Set<field>   (scalar/object access) */
const objects = new Map()

function addArray(key, field) {
  if (!arrays.has(key)) arrays.set(key, new Set())
  arrays.get(key).add(field)
}
function addObject(key, field) {
  if (!objects.has(key)) objects.set(key, new Set())
  objects.get(key).add(field)
}

for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8')

  // response.a.b[i].field  /  response.a[i].field  /  responseJSON.response.x[i].y
  const reArr = /response(?:JSON)?\.(?:response\.)?((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(?:i|j|k|index|\d+)\s*\]\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*))?/g
  let m
  while ((m = reArr.exec(src))) {
    if (m[2]) addArray(m[1], m[2])
  }

  // nested one level deeper: response.x[i].y[j].z
  const reDeep = /response(?:JSON)?\.(?:response\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(?:i|j|k|index)\s*\]\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(?:j|k|index)\s*\]\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g
  while ((m = reDeep.exec(src))) addArray(`${m[1]}[].${m[2]}`, m[3])

  // response.field (scalars / objects, no index)
  const reObj = /response(?:JSON)?\.response\.([A-Za-z_][A-Za-z0-9_]*)(?!\s*\[)(?!\w)/g
  while ((m = reObj.exec(src))) addObject('(root)', m[1])
}

const out = []
out.push('=== ARRAY ELEMENT SHAPES (from console JS) ===')
for (const [k, v] of [...arrays.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  out.push(`${k}[]  ->  ${[...v].sort().join(', ')}`)
}
out.push('')
out.push('=== ROOT RESPONSE FIELDS REFERENCED ===')
for (const [, v] of objects) out.push([...v].sort().join(', '))

console.log(out.join('\n'))
