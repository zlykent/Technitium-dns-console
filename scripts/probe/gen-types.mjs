// Dev tool: infer TypeScript interfaces from the real API payloads captured by
// probe-api.mjs. Output is a DRAFT to be hand-refined into lib/api/types/*.ts.
//
//   node scripts/probe/gen-types.mjs <probeDir> <outFile>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [probeDir, outFile] = process.argv.slice(2)
if (!probeDir || !outFile) {
  console.error('usage: gen-types.mjs <probeDir> <outFile>')
  process.exit(1)
}

const pascal = (s) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')

/** merge-style type node */
function node(value) {
  if (value === null) return { kind: 'null' }
  if (Array.isArray(value)) {
    const n = { kind: 'array', of: { kind: 'empty' } }
    for (const v of value) n.of = merge(n.of, node(v))
    return n
  }
  switch (typeof value) {
    case 'string':
      return { kind: 'string', samples: new Set([value]) }
    case 'number':
      return { kind: 'number' }
    case 'boolean':
      return { kind: 'boolean' }
    case 'object': {
      const n = { kind: 'object', props: new Map() }
      for (const [k, v] of Object.entries(value)) n.props.set(k, { type: node(v), count: 1 })
      n.total = 1
      return n
    }
    default:
      return { kind: 'unknown' }
  }
}

function merge(a, b) {
  if (a.kind === 'empty') return b
  if (b.kind === 'empty') return a
  if (a.kind === 'null') return b.kind === 'null' ? a : { ...b, nullable: true }
  if (b.kind === 'null') return { ...a, nullable: true }
  if (a.kind !== b.kind) {
    const kinds = new Set([...(a.kinds ?? [a.kind]), ...(b.kinds ?? [b.kind])])
    return { kind: 'union', kinds, nullable: a.nullable || b.nullable }
  }
  if (a.kind === 'string') {
    const samples = new Set([...a.samples, ...b.samples])
    return { kind: 'string', samples, nullable: a.nullable || b.nullable }
  }
  if (a.kind === 'array') return { kind: 'array', of: merge(a.of, b.of), nullable: a.nullable || b.nullable }
  if (a.kind === 'object') {
    const props = new Map(a.props)
    const total = (a.total ?? 1) + (b.total ?? 1)
    for (const [k, v] of b.props) {
      const ex = props.get(k)
      props.set(k, ex ? { type: merge(ex.type, v.type), count: ex.count + v.count } : { type: v.type, count: v.count })
    }
    return { kind: 'object', props, total, nullable: a.nullable || b.nullable }
  }
  return { ...a, nullable: a.nullable || b.nullable }
}

const UNION_NAMES = new Map()
let anon = 0

function render(n, nameHint) {
  if (!n) return 'unknown'
  const nul = n.nullable ? ' | null' : ''
  switch (n.kind) {
    case 'empty':
      return 'unknown'
    case 'null':
      return 'null'
    case 'unknown':
      return 'unknown'
    case 'union':
      return [...n.kinds].map((k) => (k === 'string' ? 'string' : k === 'number' ? 'number' : k === 'boolean' ? 'boolean' : k === 'null' ? 'null' : 'unknown')).join(' | ') + nul
    case 'string':
      return 'string' + nul
    case 'number':
      return 'number' + nul
    case 'boolean':
      return 'boolean' + nul
    case 'array': {
      const inner = render(n.of, nameHint ? `${nameHint}Item` : '')
      return (inner.includes('|') || inner.includes(' ') ? `(${inner})` : inner) + '[]' + nul
    }
    case 'object': {
      const iname = nameHint || `Anon${++anon}`
      const lines = []
      const props = [...n.props.entries()].sort((x, y) => x[0].localeCompare(y[0]))
      for (const [k, v] of props) {
        const optional = (v.count ?? 1) < (n.total ?? 1) ? '?' : ''
        const childName = `${iname}${pascal(k)}`
        const t = render(v.type, v.type.kind === 'object' || v.type.kind === 'array' ? childName : '')
        if (v.type.kind === 'object') {
          UNION_NAMES.set(childName, v.type)
          lines.push(`  ${k}${optional}: ${childName}${v.type.nullable ? ' | null' : ''};`)
        } else if (v.type.kind === 'array' && v.type.of?.kind === 'object') {
          UNION_NAMES.set(childName, v.type.of)
          lines.push(`  ${k}${optional}: ${childName}[]${v.type.nullable ? ' | null' : ''};`)
        } else {
          lines.push(`  ${k}${optional}: ${t};`)
        }
      }
      const body = `export interface ${iname} {\n${lines.join('\n') || '  [key: string]: unknown;'}\n}`
      return body
    }
    default:
      return 'unknown'
  }
}

const files = readdirSync(probeDir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'user.login.json')

/** endpoint base name -> merged node of unwrapped payload */
const byEndpoint = new Map()

for (const f of files) {
  const json = JSON.parse(readFileSync(join(probeDir, f), 'utf8'))
  if (json.status !== 'ok') continue
  const base = f.replace(/\.json$/, '').replace(/\.(lastDay|topDomains|topBlocked|listZone|soa|starClassPath|byDomain)$/, '')
  const payload = json.response !== undefined ? json.response : stripMeta(json)
  const n = node(payload)
  byEndpoint.set(base, byEndpoint.has(base) ? merge(byEndpoint.get(base), n) : n)
}

function stripMeta(o) {
  const c = { ...o }
  delete c.status
  delete c.server
  return c
}

// login is flat
{
  const login = JSON.parse(readFileSync(join(probeDir, 'user.login.json'), 'utf8'))
  byEndpoint.set('user.login', node(stripMeta(login)))
}

const out = []
out.push('// GENERATED DRAFT by scripts/probe/gen-types.mjs — hand-refine before use.')
out.push('/* eslint-disable */')
for (const [base, n] of [...byEndpoint.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rootName = pascal(base.replace(/\./g, '_')) + 'Payload'
  UNION_NAMES.clear()
  const body = render(n, rootName)
  out.push(`\n// ---- ${base} ----`)
  if (body.startsWith('export interface')) out.push(body)
  else out.push(`export type ${rootName} = ${body};`)
  for (const [name, sub] of UNION_NAMES) {
    const s = render(sub, name)
    if (s.startsWith('export interface')) out.push(s)
  }
}

writeFileSync(outFile, out.join('\n\n'))
console.log('wrote', outFile, 'endpoints:', byEndpoint.size, 'lines:', out.join('\n').split('\n').length)
