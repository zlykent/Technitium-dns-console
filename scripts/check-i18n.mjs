// Gate: every namespace must exist in both locales with an identical key tree,
// and every ICU placeholder ({name}) must survive the translation.
//
//   node scripts/check-i18n.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const messagesDir = join(root, 'messages')
const LOCALES = ['zh', 'en']
const BASE = 'zh'

function walk(value, prefix, out) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, prefix ? `${prefix}.${k}` : k, out)
    return out
  }
  out[prefix] = value
  return out
}

function flat(file) {
  return walk(JSON.parse(readFileSync(file, 'utf8')), '', {})
}

function placeholders(str) {
  if (typeof str !== 'string') return []
  return [...str.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]).sort()
}

const namespaces = readdirSync(join(messagesDir, BASE)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))

let problems = 0
const report = []

for (const ns of namespaces) {
  const baseFile = join(messagesDir, BASE, `${ns}.json`)
  const base = flat(baseFile)
  const baseKeys = new Set(Object.keys(base))
  report.push(`${ns}: ${baseKeys.size} keys`)

  for (const locale of LOCALES) {
    if (locale === BASE) continue
    const file = join(messagesDir, locale, `${ns}.json`)
    if (!existsSync(file)) {
      console.error(`✗ ${locale}/${ns}.json is MISSING`)
      problems++
      continue
    }
    const other = flat(file)
    const otherKeys = new Set(Object.keys(other))

    for (const key of baseKeys) {
      if (!otherKeys.has(key)) {
        console.error(`✗ ${locale}/${ns}: missing key "${key}"`)
        problems++
      }
    }
    for (const key of otherKeys) {
      if (!baseKeys.has(key)) {
        console.error(`✗ ${locale}/${ns}: extra key "${key}" (not present in ${BASE})`)
        problems++
      }
    }
    for (const key of baseKeys) {
      if (!otherKeys.has(key)) continue
      const a = placeholders(base[key]).join(',')
      const b = placeholders(other[key]).join(',')
      if (a !== b) {
        console.error(`✗ ${locale}/${ns}: placeholder mismatch at "${key}" — ${BASE} has {${a || '∅'}}, ${locale} has {${b || '∅'}}`)
        problems++
      }
    }
    // untranslated leftovers: a value that is byte-identical to the Chinese source
    let untranslated = 0
    for (const key of baseKeys) {
      const v = other[key]
      if (typeof v === 'string' && /[\u3400-\u9fff]/.test(v)) untranslated++
    }
    if (untranslated > 0) {
      console.error(`✗ ${locale}/${ns}: ${untranslated} value(s) still contain CJK characters`)
      problems++
    }
  }
}

// every namespace referenced by lib/i18n/messages.ts must exist on disk
const messagesTs = readFileSync(join(root, 'lib', 'i18n', 'messages.ts'), 'utf8')
for (const m of messagesTs.matchAll(/@\/messages\/([a-z]{2})\/([a-z-]+)\.json/g)) {
  const [, locale, ns] = m
  const file = join(messagesDir, locale, `${ns}.json`)
  if (!existsSync(file)) {
    console.error(`✗ messages.ts imports @/messages/${locale}/${ns}.json but the file does not exist`)
    problems++
  }
}

console.log(report.join('\n'))
if (problems > 0) {
  console.error(`\ni18n check FAILED with ${problems} problem(s)`)
  process.exit(1)
}
console.log(`\ni18n check passed — ${namespaces.length} namespaces × ${LOCALES.length} locales`)
